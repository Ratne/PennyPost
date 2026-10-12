import { env } from "cloudflare:workers";
import { forContacts, logActivities } from "@/lib/contact-activity";
import { sendAlert } from "@/lib/alerts";
import { assignArchiveSlug } from "@/lib/archive-slugs";
import { normalizeStepConfig } from "@/lib/automation-rules";
import { addToPreview, emptyPreview, getCleanupSettings, splitAudience } from "@/lib/cleanup";
import { LIMITS, isSendingEnabled } from "@/lib/config";
import { getConfirmUrl } from "@/lib/confirmation";
import { getConfirmationContent } from "@/lib/confirmation-content";
import { getKeepUrl } from "@/lib/last-chance";
import { getLastChanceContent } from "@/lib/last-chance-content";
import { mailboxProvider } from "@/lib/providers";
import { compileSegmentRules } from "@/lib/segments";
import { sendSesEmail } from "@/lib/ses";
import {
	CAMPAIGN_MESSAGE_KINDS,
	MAX_BATCH_MESSAGES,
	MAX_CONSECUTIVE_FAILURES,
	SEND_BATCH_SIZE,
	TEST_CONTACT_ID,
	buildRecipientEmail,
	getCampaignPauseReason,
	getCampaignStatsPath,
	getFeedbackId,
	getNextStepLimit,
	getSendErrorAction,
	getSendProblem,
	getWelcomeContent,
} from "@/lib/sending-rules";
import { isObjectIdString, normalizeEmail } from "@/lib/validation";
import {
	MAX_BOUND_PARAMS,
	all,
	batch,
	campaignStatColumn,
	chunk,
	first,
	newId,
	placeholders,
	run,
	statement,
	toCampaign,
	toContact,
	toMessage,
	toNewsletter,
} from "@/server/db";

export { buildRecipientEmail } from "@/lib/sending-rules";

export type SendJob = { messageIds: string[] };

const QUEUEABLE_STATUSES = ["draft", "scheduled", "paused"];
const AUDIENCE_PAGE_SIZE = 1000;
// Queues accept at most 100 messages per sendBatch call.
const PUBLISH_CHUNK_SIZE = 100;
const WELCOME_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_KINDS = ["welcome", "confirmation"];
// Their links have to work, so they go out clean: no tracking pixel or redirect.
const UNTRACKED_KINDS = new Set(["confirmation", "last-chance"]);
// Signing up again resends the confirmation, but a script can't make us mail an address over and over.
const MAX_CONFIRMATIONS_PER_CONTACT = 3;
const MESSAGE_COLUMNS = 7;
// Engagement first: warm-up sends capped by audienceLimit reach likely openers.
const AUDIENCE_ORDER = `ORDER BY c.last_click_at IS NULL, c.last_click_at DESC,
	c.last_open_at IS NULL, c.last_open_at DESC,
	c.imported_click_rate IS NULL, c.imported_click_rate DESC,
	c.imported_open_rate IS NULL, c.imported_open_rate DESC,
	c.created_at ASC, c.id ASC`;

let nextSendAt = 0;

function assertSendingEnabled() {
	if (!isSendingEnabled()) throw new Error("Sending is off");
}

function formatError(error: any) {
	return String(error?.message || error).slice(0, 500);
}

// The send queue consumer runs one batch at a time (max_concurrency 1), so this pacing is global.
async function waitForSendSlot() {
	const now = Date.now();
	const sendAt = Math.max(now, nextSendAt);
	nextSendAt = sendAt + Math.ceil(1000 / LIMITS.sendRatePerSecond);
	if (sendAt > now) await new Promise((resolve) => setTimeout(resolve, sendAt - now));
}

function getMessageTags(message: any) {
	const tags = [
		{ name: "message_id", value: String(message._id) },
		{ name: "kind", value: message.kind },
	];
	if (message.campaignId) tags.push({ name: "campaign_id", value: String(message.campaignId) });
	if (message.stepId) tags.push({ name: "step_id", value: String(message.stepId) });
	return tags;
}

async function deliver({ message, content, newsletter, contact }: any) {
	const reference = { contactId: contact._id, newsletterId: newsletter._id };
	const email = buildRecipientEmail({
		campaign: content,
		newsletter,
		contact,
		messageId: UNTRACKED_KINDS.has(message.kind) ? null : message._id,
		confirmUrl: message.kind === "confirmation" ? getConfirmUrl(reference) : "",
		keepUrl: message.kind === "last-chance" ? getKeepUrl(reference) : "",
	});
	const feedbackId = getFeedbackId({ campaignId: message.campaignId ?? message.stepId, kind: message.kind, newsletterSlug: newsletter.slug });
	await waitForSendSlot();
	const { sesMessageId } = await sendSesEmail({
		...email,
		headers: { ...email.headers, "Feedback-ID": feedbackId },
		tags: getMessageTags(message),
	});
	return { sesMessageId, sentAt: new Date() };
}

function getMessageContent({ kind, newsletter, campaign, step }: any) {
	if (kind === "automation") return step ? normalizeStepConfig("email", step.config) : null;
	if (kind === "welcome") return getWelcomeContent(newsletter);
	if (kind === "confirmation") return newsletter ? getConfirmationContent(newsletter) : null;
	if (kind === "last-chance") return newsletter ? getLastChanceContent(newsletter) : null;
	return campaign;
}

// Welcome and confirmation emails share one cap per newsletter, so a signup flood can't burn its sending
// domain's reputation, and a flood on one newsletter doesn't hold up the others' signup emails.
async function countRecentSignupEmails(newsletter: any) {
	const row = await first<{ count: number }>(
		"SELECT COUNT(*) AS count FROM messages WHERE kind IN ('welcome', 'confirmation') AND newsletter_id = ? AND created_at >= ?",
		[newsletter._id, Date.now() - WELCOME_WINDOW_MS]
	);
	return row?.count ?? 0;
}

async function alertSignupCap(newsletter: any) {
	await sendAlert({
		key: `welcome-cap:${newsletter.slug}`,
		title: "Signup emails capped",
		detail: `Over ${LIMITS.welcomeEmailsPer10Minutes} welcome and confirmation emails for ${newsletter.name} in 10 minutes. New signups get none until it slows down.`,
		path: "/contacts",
	});
}

async function findByIds<T>(table: string, ids: (string | undefined)[], map: (row: any) => T | null) {
	const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
	const found = new Map<string, T>();
	for (const group of chunk(uniqueIds, MAX_BOUND_PARAMS)) {
		const rows = await all(`SELECT * FROM ${table} WHERE id IN (${placeholders(group.length)})`, group);
		for (const row of rows) found.set(String(row.id), map(row)!);
	}
	return found;
}

function toStepContent(row: any) {
	let config = {};
	try {
		config = JSON.parse(row.config || "{}");
	} catch {}
	return { _id: row.id as string, config };
}

export async function getCampaign(id: string) {
	return toCampaign(await first("SELECT * FROM campaigns WHERE id = ?", [id]));
}

export async function getNewsletter(id: string) {
	return toNewsletter(await first("SELECT * FROM newsletters WHERE id = ?", [id]));
}

async function pauseCampaign(campaignId: string, reason: string) {
	const { changes } = await run("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'sending'", [
		Date.now(),
		campaignId,
	]);
	if (!changes) return;
	await sendAlert({
		key: `campaign-paused-${campaignId}`,
		title: "Campaign paused",
		detail: reason,
		path: `/campaigns/${campaignId}`,
		cooldownMinutes: 1,
	});
}

async function pauseIfUnhealthy(campaignId: string) {
	const campaign = toCampaign(await first("SELECT * FROM campaigns WHERE id = ? AND status = 'sending'", [campaignId]));
	const reason = campaign ? getCampaignPauseReason(campaign.stats, campaign.lastChance) : null;
	if (reason) await pauseCampaign(campaignId, `${reason} is over the limit`);
	return Boolean(reason);
}

async function settleCampaign(campaignId: string) {
	if (await pauseIfUnhealthy(campaignId)) return;
	const queued = await first(
		"SELECT 1 FROM messages WHERE campaign_id = ? AND kind IN ('campaign', 'last-chance') AND status = 'queued' LIMIT 1",
		[campaignId]
	);
	if (queued) return;
	// A campaign sent in steps keeps the date of its first step.
	const now = Date.now();
	await run(
		"UPDATE campaigns SET status = 'sent', sent_at = MIN(COALESCE(sent_at, ?), ?), updated_at = ? WHERE id = ? AND status = 'sending'",
		[now, now, now, campaignId]
	);
}

type NewMessage = { kind: string; campaignId: string; newsletterId: string; contactId: string; email: string; provider: string };

// The unique index skips contacts this campaign already has a message for (retried or stepped sends).
async function insertIgnoringDuplicates(messages: NewMessage[]) {
	if (messages.length === 0) return;
	const now = Date.now();
	const rowsPerStatement = Math.floor(MAX_BOUND_PARAMS / (MESSAGE_COLUMNS + 1));
	const statements = chunk(messages, rowsPerStatement).map((group) =>
		statement(
			`INSERT OR IGNORE INTO messages (id, kind, campaign_id, newsletter_id, contact_id, email, provider, created_at)
			 VALUES ${group.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
			group.flatMap((message) => [
				newId(),
				message.kind,
				message.campaignId,
				message.newsletterId,
				message.contactId,
				message.email,
				message.provider,
				now,
			])
		)
	);
	for (const group of chunk(statements, 50)) await batch(group);
}

function toMessages(campaign: any, kind: string, contacts: any[]): NewMessage[] {
	return contacts.map((contact) => ({
		kind,
		campaignId: campaign._id,
		newsletterId: campaign.newsletterId,
		contactId: contact._id,
		email: contact.email,
		provider: mailboxProvider(contact.email),
	}));
}

// Contacts this campaign already reached: an earlier step, or an attempt that stopped halfway.
async function findPreviousMessages(campaignId: string) {
	const rows = await all<{ contact_id: string; kind: string }>(
		"SELECT contact_id, kind FROM messages WHERE campaign_id = ? AND kind IN ('campaign', 'last-chance')",
		[campaignId]
	);
	return new Map(rows.map(({ contact_id, kind }) => [String(contact_id), kind]));
}

async function getSegmentFilter(campaign: any) {
	if (!campaign.segmentId) return { sql: "1 = 1", params: [] as (string | number)[] };
	const segment = await first<{ rules: string }>("SELECT rules FROM segments WHERE id = ?", [campaign.segmentId]);
	if (!segment) throw new Error("The campaign's segment no longer exists");
	return compileSegmentRules(JSON.parse(segment.rules || "{}"), { ignoreStatuses: true });
}

// Active, unsuppressed contacts in the campaign's segment, most engaged first, a page at a time.
async function* walkAudience(campaign: any) {
	const segment = await getSegmentFilter(campaign);
	for (let offset = 0; ; offset += AUDIENCE_PAGE_SIZE) {
		const rows = await all(
			`SELECT c.* FROM contacts c
			 WHERE c.newsletter_id = ? AND c.status = 'active'
			   AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = c.email)
			   AND ${segment.sql}
			 ${AUDIENCE_ORDER} LIMIT ? OFFSET ?`,
			[campaign.newsletterId, ...segment.params, AUDIENCE_PAGE_SIZE, offset]
		);
		if (rows.length === 0) return;
		yield rows.map((row) => toContact(row)!);
		if (rows.length < AUDIENCE_PAGE_SIZE) return;
	}
}

async function makeDormant(campaignId: string, contacts: any[]) {
	let total = 0;
	const now = Date.now();
	// A sign of life since the walk read them sets ignored_issues back to 0: those contacts stay.
	for (const group of chunk(contacts.map(({ _id }) => _id), MAX_BOUND_PARAMS - 1)) {
		const changed = await all<{ id: string; email: string; newsletter_id: string }>(
			`UPDATE contacts SET status = 'dormant', updated_at = ?
			 WHERE id IN (${placeholders(group.length)}) AND status = 'active' AND ignored_issues > 0
			 RETURNING id, email, newsletter_id`,
			[now, ...group]
		);
		total += changed.length;
		await logActivities(forContacts(changed, { type: "dormant", campaignId, occurredAt: now }));
	}
	if (total > 0) {
		await run("UPDATE campaigns SET last_chance_dormant = last_chance_dormant + ? WHERE id = ?", [total, campaignId]);
	}
}

function normalizeLimit(audienceLimit: unknown) {
	const limit = Number(audienceLimit);
	return Number.isInteger(limit) && limit > 0 ? limit : null;
}

// Contacts made dormant are updated after the walk, so the pages it reads don't shift under it.
async function insertCampaignMessages(campaign: any, newsletter: any) {
	const settings = getCleanupSettings(newsletter);
	const limit = normalizeLimit(campaign.audienceLimit);
	const previous = settings.enabled ? await findPreviousMessages(campaign._id) : new Map();
	const now = Date.now();
	const dormant: any[] = [];
	let remaining = limit ?? Infinity;
	for await (const group of walkAudience(campaign)) {
		const split = splitAudience(group, { settings, limit: remaining, previous, now });
		await insertIgnoringDuplicates(toMessages(campaign, "campaign", split.issue));
		await insertIgnoringDuplicates(toMessages(campaign, "last-chance", split.lastChance));
		dormant.push(...split.dormant);
		remaining -= split.issue.length + split.received;
		if (remaining <= 0) break;
	}
	await makeDormant(campaign._id, dormant);
}

// What the list cleanup would do at this send, for the send dialogs: one walk over the whole list.
export async function getCleanupPreview(campaignId: string) {
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");
	const campaign = await getCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await getNewsletter(campaign.newsletterId);
	const settings = getCleanupSettings(newsletter);
	if (!settings.enabled) return { enabled: false };

	const previous = await findPreviousMessages(campaign._id);
	const preview = emptyPreview();
	const now = Date.now();
	for await (const group of walkAudience(campaign)) addToPreview(preview, group, { settings, previous, now });
	return { enabled: true, ...preview };
}

// How many contacts a send would reach right now (segment, active, unsuppressed).
export async function countAudience(campaign: { newsletterId: string; segmentId?: string | null }) {
	const segment = await getSegmentFilter(campaign);
	const row = await first<{ count: number }>(
		`SELECT COUNT(*) AS count FROM contacts c
		 WHERE c.newsletter_id = ? AND c.status = 'active'
		   AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = c.email)
		   AND ${segment.sql}`,
		[campaign.newsletterId, ...segment.params]
	);
	return row?.count ?? 0;
}

async function countCampaignMessages(campaignId: string) {
	const rows = await all<{ kind: string; count: number }>(
		"SELECT kind, COUNT(*) AS count FROM messages WHERE campaign_id = ? AND kind IN ('campaign', 'last-chance') GROUP BY kind",
		[campaignId]
	);
	const counts = new Map(rows.map(({ kind, count }) => [kind, count]));
	return CAMPAIGN_MESSAGE_KINDS.map((kind: string) => counts.get(kind) ?? 0);
}

// Issues first; last-chance emails go to the least engaged addresses, after everyone else. Each queue
// message carries one batch; the consumer sends them one at a time at sendRatePerSecond.
async function publishQueuedMessages(campaignId: string) {
	const queued = await all<{ id: string }>(
		`SELECT id FROM messages WHERE campaign_id = ? AND kind IN ('campaign', 'last-chance') AND status = 'queued'
		 ORDER BY kind ASC, id ASC`,
		[campaignId]
	);
	const jobs = chunk(
		queued.map(({ id }) => id),
		SEND_BATCH_SIZE
	).map((messageIds) => ({ body: { messageIds } satisfies SendJob }));
	for (const group of chunk(jobs, PUBLISH_CHUNK_SIZE)) await env.SEND_QUEUE.sendBatch(group);
	return jobs.length;
}

// Draft or scheduled: selects the audience. Paused: resumes with the audience it already has.
export async function queueCampaign(campaignId: string) {
	assertSendingEnabled();
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	const campaign = await getCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	if (!QUEUEABLE_STATUSES.includes(campaign.status)) throw new Error(`Campaign is already ${campaign.status}`);
	const newsletter = await getNewsletter(campaign.newsletterId);
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);

	if (campaign.status !== "paused") await insertCampaignMessages(campaign, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients + lastChances === 0) throw new Error("No active contacts to send to");

	const now = Date.now();
	const { changes } = await run(
		`UPDATE campaigns SET status = 'sending', stats_recipients = ?, last_chance_recipients = ?,
		 started_at = MIN(COALESCE(started_at, ?), ?), updated_at = ? WHERE id = ? AND status = ?`,
		[recipients, lastChances, now, now, now, campaign._id, campaign.status]
	);
	if (!changes) throw new Error("The campaign changed, refresh and try again");

	try {
		await assignArchiveSlug({ campaign, newsletter });
		const batches = await publishQueuedMessages(campaign._id);
		if (batches === 0) await settleCampaign(campaign._id);
		return { recipients, batches };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the campaign, it is paused: ${formatError(error)}`);
	}
}

// Sending in steps: a sent campaign goes to the next most engaged contacts. It takes the top of the
// audience again and the one-email-per-contact index skips everyone who already received it.
export async function sendToMoreContacts(campaignId: string, additional: unknown) {
	assertSendingEnabled();
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	const campaign = await getCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	if (campaign.status !== "sent") throw new Error("Wait until the current step has gone out");
	const newsletter = await getNewsletter(campaign.newsletterId);
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);

	const [sentSoFar, lastChancesSoFar] = await countCampaignMessages(campaign._id);
	const audienceLimit = getNextStepLimit({ sentSoFar, additional });
	await insertCampaignMessages({ ...campaign, audienceLimit }, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients === sentSoFar && lastChances === lastChancesSoFar) throw new Error("Everyone has received it already");

	const { changes } = await run(
		`UPDATE campaigns SET status = 'sending', stats_recipients = ?, last_chance_recipients = ?, audience_limit = ?, updated_at = ?
		 WHERE id = ? AND status = 'sent'`,
		[recipients, lastChances, audienceLimit ?? null, Date.now(), campaign._id]
	);
	if (!changes) throw new Error("The campaign changed, refresh and try again");

	try {
		const batches = await publishQueuedMessages(campaign._id);
		if (batches === 0) await settleCampaign(campaign._id);
		return { added: recipients - sentSoFar, recipients, batches };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the next step, the campaign is paused: ${formatError(error)}`);
	}
}

// Every issue counts toward the list cleanup until a sign of life sets the count back (lib/cleanup.js).
async function recordSent({ message, campaign, contact, sesMessageId, sentAt }: any) {
	const at = sentAt.getTime();
	const statements = [
		statement("UPDATE messages SET ses_message_id = ?, sent_at = ?, error = NULL, updated_at = ? WHERE id = ?", [
			sesMessageId,
			at,
			at,
			message._id,
		]),
		statement(
			`UPDATE contacts SET last_sent_at = ?, stats_sent = stats_sent + 1,
			 last_chance_at = CASE WHEN ? THEN ? ELSE last_chance_at END,
			 ignored_issues = CASE WHEN ? THEN COALESCE(ignored_issues, 0) + 1 ELSE ignored_issues END,
			 updated_at = ? WHERE id = ?`,
			[at, message.kind === "last-chance", at, message.kind === "campaign", at, contact._id]
		),
	];
	if (campaign) {
		const column = campaignStatColumn(`${getCampaignStatsPath(message.kind)}.sent`);
		statements.push(statement(`UPDATE campaigns SET ${column} = ${column} + 1 WHERE id = ?`, [campaign._id]));
	}
	await batch(statements);
}

async function recordFailed({ message, campaign, error }: any) {
	await run("UPDATE messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", [formatError(error), Date.now(), message._id]);
	if (campaign) {
		const column = campaignStatColumn(`${getCampaignStatsPath(message.kind)}.failed`);
		await run(`UPDATE campaigns SET ${column} = ${column} + 1 WHERE id = ?`, [campaign._id]);
	}
}

// At most once per message: the queued -> sent claim happens before SES is called.
export async function sendMessageBatch(messageIds: unknown) {
	assertSendingEnabled();
	const ids = [...new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id).toLowerCase()))]
		.filter(isObjectIdString)
		.slice(0, MAX_BATCH_MESSAGES);
	const result = { sent: 0, failed: 0, suppressed: 0, skipped: 0, retry: false };
	if (ids.length === 0) return result;

	const order = new Map(ids.map((id, index) => [id, index]));
	const rows = await all(
		`SELECT * FROM messages WHERE id IN (${placeholders(ids.length)}) AND status = 'queued'
		 AND kind IN ('campaign', 'last-chance', 'welcome', 'confirmation', 'automation')`,
		ids
	);
	const messages = rows.map((row) => toMessage(row)!).sort((a, b) => order.get(a._id)! - order.get(b._id)!);
	result.skipped = ids.length - messages.length;
	if (messages.length === 0) return result;

	const emails = [...new Set(messages.map(({ email }) => email))];
	const [campaigns, newsletters, contacts, steps, suppressedRows] = await Promise.all([
		findByIds("campaigns", messages.map(({ campaignId }) => campaignId), toCampaign),
		findByIds("newsletters", messages.map(({ newsletterId }) => newsletterId), toNewsletter),
		findByIds("contacts", messages.map(({ contactId }) => contactId), toContact),
		findByIds("automation_steps", messages.map(({ stepId }) => stepId), toStepContent),
		all<{ email: string }>(`SELECT email FROM suppressions WHERE email IN (${placeholders(emails.length)})`, emails),
	]);
	const suppressed = new Set(suppressedRows.map(({ email }) => email));
	for (const campaignId of campaigns.keys()) await pauseIfUnhealthy(campaignId);

	let consecutiveFailures = 0;
	for (const message of messages) {
		if (!isSendingEnabled()) {
			result.retry = true;
			break;
		}
		const campaign = message.campaignId ? (campaigns.get(message.campaignId) ?? null) : null;
		const isCampaignSending =
			!CAMPAIGN_MESSAGE_KINDS.includes(message.kind) ||
			(await first("SELECT 1 FROM campaigns WHERE id = ? AND status = 'sending'", [message.campaignId]));
		if (!isCampaignSending) {
			result.skipped++;
			continue;
		}

		const contact = message.contactId ? contacts.get(message.contactId) : undefined;
		const requiredStatus = message.kind === "confirmation" ? "pending" : "active";
		if (contact?.status !== requiredStatus || suppressed.has(message.email)) {
			await run("UPDATE messages SET status = 'suppressed', updated_at = ? WHERE id = ? AND status = 'queued'", [Date.now(), message._id]);
			result.suppressed++;
			continue;
		}

		const claim = await run("UPDATE messages SET status = 'sent', provider = ?, updated_at = ? WHERE id = ? AND status = 'queued'", [
			mailboxProvider(message.email),
			Date.now(),
			message._id,
		]);
		if (!claim.changes) {
			result.skipped++;
			continue;
		}

		const newsletter = newsletters.get(message.newsletterId);
		const step = message.stepId ? steps.get(message.stepId) : null;
		const content = getMessageContent({ kind: message.kind, newsletter, campaign, step });
		let delivery;
		try {
			if (!newsletter || !content) throw new Error("Newsletter or email content not found");
			delivery = await deliver({ message, content, newsletter, contact });
		} catch (error) {
			const action = campaign ? getSendErrorAction(error) : "fail";
			if (action === "fail") {
				await recordFailed({ message, campaign, error });
				result.failed++;
				consecutiveFailures++;
				if (!campaign || consecutiveFailures < MAX_CONSECUTIVE_FAILURES) continue;
				await pauseCampaign(campaign._id, `${consecutiveFailures} sends failed in a row`);
				break;
			}
			await run("UPDATE messages SET status = 'queued' WHERE id = ? AND status = 'sent'", [message._id]);
			if (action === "pause" && campaign) await pauseCampaign(campaign._id, formatError(error));
			else result.retry = true;
			break;
		}

		await recordSent({ message, campaign, contact, ...delivery });
		result.sent++;
		consecutiveFailures = 0;
	}

	for (const campaignId of campaigns.keys()) await settleCampaign(campaignId);
	return result;
}

async function createMessage(fields: { kind: string; campaignId?: string; newsletterId: string; contactId?: string; email: string }) {
	const id = newId();
	await run(
		"INSERT INTO messages (id, kind, campaign_id, newsletter_id, contact_id, email, provider) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[id, fields.kind, fields.campaignId, fields.newsletterId, fields.contactId, fields.email, mailboxProvider(fields.email)]
	);
	return { _id: id, ...fields };
}

async function sendTest({ content, newsletter, campaignId, to }: any) {
	const email = normalizeEmail(to);
	if (!email) throw new Error("The test email address is invalid");
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) throw new Error(problem);

	const message = await createMessage({ kind: "test", campaignId, newsletterId: newsletter._id, email });
	let delivery;
	try {
		delivery = await deliver({
			message,
			content: { ...content, subject: `[Test] ${content.subject}` },
			newsletter,
			contact: { _id: TEST_CONTACT_ID, email },
		});
	} catch (error) {
		await recordFailed({ message, campaign: null, error });
		throw error;
	}

	const { sesMessageId, sentAt } = delivery;
	await run("UPDATE messages SET status = 'sent', ses_message_id = ?, sent_at = ? WHERE id = ?", [sesMessageId, sentAt.getTime(), message._id]);
	return { messageId: message._id, sesMessageId, sentAt };
}

export async function sendTestEmail({ campaignId, to }: { campaignId: string; to: string }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	const campaign = await getCampaign(campaignId);
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await getNewsletter(campaign.newsletterId);
	const result = await sendTest({ content: campaign, newsletter, campaignId: campaign._id, to });
	await run("UPDATE campaigns SET test_sent_at = ? WHERE id = ?", [result.sentAt.getTime(), campaign._id]);
	return result;
}

// Sends the saved welcome email, whether or not it's switched on yet.
export async function sendWelcomeTestEmail({ newsletterId, to }: { newsletterId: string; to: string }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(newsletterId))) throw new Error("Newsletter not found");

	const newsletter = await getNewsletter(newsletterId);
	if (!newsletter) throw new Error("Newsletter not found");
	const content = getWelcomeContent({ welcome: { ...newsletter.welcome, enabled: true } });
	if (!content) throw new Error("Save a subject and content first");
	return sendTest({ content, newsletter, to });
}

// Sends an automation step's saved email, whether or not the automation is on.
export async function sendAutomationTestEmail({ stepId, to }: { stepId: string; to: string }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(stepId))) throw new Error("Email not found");

	const step = await first<{ id: string; type: string; config: string; newsletter_id: string }>(
		`SELECT s.id, s.type, s.config, a.newsletter_id FROM automation_steps s JOIN automations a ON a.id = s.automation_id WHERE s.id = ?`,
		[stepId]
	);
	if (step?.type !== "email") throw new Error("Email not found");
	const newsletter = await getNewsletter(step.newsletter_id);
	const content = getMessageContent({ kind: "automation", step: toStepContent(step) });
	return sendTest({ content, newsletter, to });
}

export async function queueWelcomeEmail({ newsletter, contact }: any) {
	assertSendingEnabled();
	const content = getWelcomeContent(newsletter);
	if (!content) return { skipped: "welcome email is off" };
	if (contact?.status !== "active") return { skipped: "contact is not active" };

	const [isSuppressed, hasWelcome, recentWelcomes] = await Promise.all([
		first("SELECT 1 FROM suppressions WHERE email = ?", [contact.email]),
		first("SELECT 1 FROM messages WHERE kind = 'welcome' AND contact_id = ? LIMIT 1", [contact._id]),
		countRecentSignupEmails(newsletter),
	]);
	if (isSuppressed) return { skipped: "suppressed" };
	if (hasWelcome) return { skipped: "already sent" };
	if (recentWelcomes >= LIMITS.welcomeEmailsPer10Minutes) {
		await alertSignupCap(newsletter);
		return { skipped: "rate limited" };
	}
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) {
		console.warn(`[sending] Welcome email for ${newsletter.slug} not sent: ${problem}`);
		return { skipped: problem };
	}
	return sendSignupEmail({ kind: "welcome", newsletter, contact });
}

export async function queueConfirmationEmail({ newsletter, contact }: any) {
	assertSendingEnabled();
	if (contact?.status !== "pending") return { skipped: "contact is not pending" };

	const [isSuppressed, sentToContact, sentRecently, recentSignupEmails] = await Promise.all([
		first("SELECT 1 FROM suppressions WHERE email = ?", [contact.email]),
		first<{ count: number }>("SELECT COUNT(*) AS count FROM messages WHERE kind = 'confirmation' AND contact_id = ?", [contact._id]),
		first("SELECT 1 FROM messages WHERE kind = 'confirmation' AND contact_id = ? AND created_at >= ? LIMIT 1", [
			contact._id,
			Date.now() - WELCOME_WINDOW_MS,
		]),
		countRecentSignupEmails(newsletter),
	]);
	if (isSuppressed) return { skipped: "suppressed" };
	if (sentRecently || (sentToContact?.count ?? 0) >= MAX_CONFIRMATIONS_PER_CONTACT) return { skipped: "already sent" };
	if (recentSignupEmails >= LIMITS.welcomeEmailsPer10Minutes) {
		await alertSignupCap(newsletter);
		return { skipped: "rate limited" };
	}
	return sendSignupEmail({ kind: "confirmation", newsletter, contact });
}

async function sendSignupEmail({ kind, newsletter, contact }: any) {
	const message = await createMessage({ kind, newsletterId: newsletter._id, contactId: contact._id, email: contact.email });
	return { messageId: message._id, ...(await sendMessageBatch([message._id])) };
}

export { SIGNUP_KINDS };
