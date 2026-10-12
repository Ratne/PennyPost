"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { notifyActivity } from "@/lib/alerts";
import { PUBLISHED_STATUSES, revalidateArchive } from "@/lib/archive-data";
import { requireSession } from "@/lib/auth";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { getScheduleProblem } from "@/lib/schedule";
import { countSegment, getSegment } from "@/lib/segment-store";
import { countAudience, getCampaign, getCleanupPreview, getNewsletter, queueCampaign, sendTestEmail, sendToMoreContacts } from "@/lib/sending";
import { getSendProblem } from "@/lib/sending-rules";
import { ARCHIVE_SLUG_PATTERN } from "@/lib/slug";
import { firstImageUrl } from "@/lib/thumbnail";
import { MAX_BODY_BYTES, isObjectIdString } from "@/lib/validation";
import { first, newId, run } from "@/server/db";

const MAX_SUBJECT_LENGTH = 200;
const COPY_SUFFIX = " (copy)";
// A scheduled campaign stays editable until it goes out.
const EDITABLE = "status IN ('draft', 'scheduled')";
const EDITABLE_STATUSES = ["draft", "scheduled"];

function readAudienceLimit(value) {
	const limit = Number(value);
	return Number.isInteger(limit) && limit > 0 ? limit : null;
}

function notifySend(campaign, action) {
	return notifyActivity([`${action}: ${campaign.subject || "(no subject)"}`, `${getAppUrl()}/campaigns/${campaign._id}`]);
}

function formatCount(count) {
	return count.toLocaleString("en-US");
}

async function findCampaign(id) {
	await requireSession();
	if (!isObjectIdString(id)) return null;
	return getCampaign(id);
}

// undefined keeps the campaign's segment; null (or "") sends to everyone.
async function readSegmentId(value, campaign) {
	if (value === undefined) return { segmentId: campaign.segmentId ?? null };
	if (!value) return { segmentId: null };
	const segment = await getSegment(value);
	if (!segment || segment.newsletterId !== campaign.newsletterId) return { error: "Segment not found" };
	return { segmentId: segment._id };
}

export async function createCampaign(newsletterId) {
	await requireSession();
	if (!isObjectIdString(newsletterId)) return { error: "Newsletter not found" };
	if (!(await first("SELECT 1 FROM newsletters WHERE id = ?", [newsletterId]))) return { error: "Newsletter not found" };

	const id = newId();
	const now = Date.now();
	await run("INSERT INTO campaigns (id, newsletter_id, created_at, updated_at) VALUES (?, ?, ?, ?)", [id, newsletterId, now, now]);
	revalidatePath("/campaigns");
	redirect(`/campaigns/${id}`);
}

// The status check is part of the write, so a save can't land on a campaign that just started sending.
export async function saveCampaign(id, values) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Only drafts can be edited" };

	const body = String(values?.body ?? "");
	const bytes = Buffer.byteLength(body, "utf8");
	if (bytes > MAX_BODY_BYTES) {
		return { error: `The content is ${Math.ceil(bytes / 1000)} KB. The limit is ${MAX_BODY_BYTES / 1000} KB.` };
	}

	// The editor opens Markdown drafts as rich text, so their first save moves them to it.
	const format = campaign.format === "markdown" ? "rich" : campaign.format;
	const { changes } = await run(
		`UPDATE campaigns SET subject = ?, preview_text = ?, format = ?, html = ?, thumbnail_url = ?, updated_at = ? WHERE id = ? AND ${EDITABLE}`,
		[
			String(values?.subject ?? "").slice(0, MAX_SUBJECT_LENGTH),
			String(values?.previewText ?? "").slice(0, 300),
			format,
			body,
			firstImageUrl({ format, html: body }) ?? null,
			Date.now(),
			campaign._id,
		]
	);
	if (!changes) return { error: "This campaign is already sending" };

	revalidatePath("/campaigns");
	return { ok: true };
}

// The audience of the next send: a segment of the newsletter, or everyone. Returns its reach.
export async function setCampaignSegment(id, segmentId) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Only drafts can change audience" };
	const segment = await readSegmentId(segmentId ?? null, campaign);
	if (segment.error) return segment;

	await run(`UPDATE campaigns SET segment_id = ?, updated_at = ? WHERE id = ? AND ${EDITABLE}`, [segment.segmentId, Date.now(), campaign._id]);
	revalidatePath(`/campaigns/${id}`);
	return { ok: true, audienceCount: await countAudience({ newsletterId: campaign.newsletterId, segmentId: segment.segmentId }) };
}

// For the segment picker: how many contacts a send to this segment would reach right now.
export async function countSegmentAudience(id, segmentId) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!segmentId) return { count: await countAudience({ newsletterId: campaign.newsletterId }) };
	const segment = await getSegment(segmentId);
	if (!segment || segment.newsletterId !== campaign.newsletterId) return { error: "Segment not found" };
	return { count: (await countSegment(campaign.newsletterId, segment.rules)).reachable };
}

// Sending errors become toasts; a thrown error would replace the page with the error boundary.
async function runSend(send) {
	try {
		await send();
		return { ok: true };
	} catch (error) {
		console.error("[campaigns] Send failed:", error);
		return { error: error.message || "Sending failed" };
	}
}

export async function sendTestCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const { email } = await requireSession();
	const result = await runSend(() => sendTestEmail({ campaignId: campaign._id, to: email }));
	revalidatePath(`/campaigns/${id}`);
	return result;
}

// Sending a scheduled campaign now replaces its schedule; the cron then finds nothing to send.
export async function sendCampaign(id, { audienceLimit, segmentId } = {}) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Already sent" };
	if (!isSendingEnabled()) return { error: "Sending is off" };
	const segment = await readSegmentId(segmentId, campaign);
	if (segment.error) return segment;

	const limit = readAudienceLimit(audienceLimit);
	await run(`UPDATE campaigns SET audience_limit = ?, segment_id = ?, scheduled_at = NULL, updated_at = ? WHERE id = ? AND ${EDITABLE}`, [
		limit,
		segment.segmentId,
		Date.now(),
		campaign._id,
	]);

	const result = await runSend(() => queueCampaign(campaign._id));
	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	if (result.ok) {
		revalidateArchive();
		await notifySend(campaign, limit ? `Send started (first ${formatCount(limit)})` : "Send started");
	}
	return result;
}

// Checked now and again when it goes out: content edited in between could still block the send. The
// minutely cron (server/cron.ts) picks it up when it's due.
export async function scheduleCampaign(id, { scheduledAt, audienceLimit, segmentId } = {}) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Already sent" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const at = new Date(scheduledAt ?? NaN);
	const problem = getScheduleProblem(at);
	if (problem) return { error: problem };
	const newsletter = await getNewsletter(campaign.newsletterId);
	const sendProblem = getSendProblem({ campaign, newsletter });
	if (sendProblem) return { error: sendProblem };
	const segment = await readSegmentId(segmentId, campaign);
	if (segment.error) return segment;

	const limit = readAudienceLimit(audienceLimit);
	const { changes } = await run(
		`UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, audience_limit = ?, segment_id = ?, updated_at = ? WHERE id = ? AND ${EDITABLE}`,
		[at.getTime(), limit, segment.segmentId, Date.now(), campaign._id]
	);
	if (!changes) return { error: "The campaign changed, refresh and try again" };

	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	const when = `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
	await notifySend(campaign, `Send scheduled for ${when}${limit ? ` (first ${formatCount(limit)})` : ""}`);
	return { ok: true };
}

export async function unscheduleCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };

	const { changes } = await run(
		"UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ? AND status = 'scheduled'",
		[Date.now(), campaign._id]
	);
	if (!changes) return { error: "It isn't scheduled anymore" };

	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	return { ok: true };
}

// The send dialogs ask when they open: it walks the whole list.
export async function previewCleanup(id) {
	await requireSession();
	if (!isObjectIdString(id)) return { error: "Campaign not found" };
	try {
		return await getCleanupPreview(id);
	} catch (error) {
		console.error("[campaigns] Cleanup preview failed:", error);
		return { error: error.message || "Couldn't count the list cleanup" };
	}
}

// Without a number, the campaign goes to everyone who hasn't received it yet.
export async function sendCampaignToMore(id, { additional } = {}) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const more = readAudienceLimit(additional);
	const result = await runSend(() => sendToMoreContacts(campaign._id, more ?? undefined));
	revalidatePath("/campaigns");
	revalidatePath(`/campaigns/${id}`);
	if (result.ok) await notifySend(campaign, `Send to more started (${more ? `next ${formatCount(more)}` : "everyone left"})`);
	return result;
}

export async function resumeCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (campaign.status !== "paused") return { error: "Only paused campaigns can resume" };
	if (!isSendingEnabled()) return { error: "Sending is off" };

	const result = await runSend(() => queueCampaign(campaign._id));
	revalidatePath(`/campaigns/${id}`);
	if (result.ok) await notifySend(campaign, "Send resumed");
	return result;
}

export async function pauseCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	await run("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'sending'", [Date.now(), campaign._id]);
	revalidatePath(`/campaigns/${id}`);
	return { ok: true };
}

export async function toggleArchivePin(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!campaign.archiveSlug || campaign.archiveListed === false) return { error: "Not listed on the archive" };

	await run("UPDATE campaigns SET archive_pinned = ?, updated_at = ? WHERE id = ?", [!campaign.archivePinned, Date.now(), campaign._id]);
	revalidatePath(`/campaigns/${id}`);
	revalidateArchive();
	return { ok: true };
}

export async function duplicateCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };

	const copyId = newId();
	const now = Date.now();
	await run(
		`INSERT INTO campaigns (id, newsletter_id, subject, preview_text, format, markdown, html, thumbnail_url, segment_id, source, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			copyId,
			campaign.newsletterId,
			campaign.subject ? `${campaign.subject.slice(0, MAX_SUBJECT_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}` : "",
			campaign.previewText,
			campaign.format,
			campaign.markdown,
			campaign.html,
			campaign.thumbnailUrl ?? null,
			campaign.segmentId ?? null,
			// A copy of an API draft is still content from the API key's holder, not from the dashboard.
			campaign.source === "api" ? "api" : "dashboard",
			now,
			now,
		]
	);
	revalidatePath("/campaigns");
	redirect(`/campaigns/${copyId}`);
}

// Discarded campaigns keep everything: canceled hides them from the lists and stops a scheduled send.
export async function discardCampaign(id) {
	const campaign = await findCampaign(id);
	if (!campaign) return { error: "Campaign not found" };
	if (!EDITABLE_STATUSES.includes(campaign.status)) return { error: "Only drafts can be discarded" };

	const { changes } = await run(`UPDATE campaigns SET status = 'canceled', scheduled_at = NULL, updated_at = ? WHERE id = ? AND ${EDITABLE}`, [
		Date.now(),
		campaign._id,
	]);
	if (!changes) return { error: "This campaign is already sending" };

	revalidatePath("/");
	revalidatePath("/campaigns");
	return { ok: true };
}

// The page lives at /p/<slug> once the issue goes out. A draft without one gets the subject's slug then.
// Slugs are unique across newsletters: /p/<slug> on the app's own domain finds an issue by slug alone.
export async function updateArchiveSlug(id, value) {
	const campaign = await findCampaign(id);
	if (!campaign || campaign.status === "canceled") return { error: "Campaign not found" };

	const slug = String(value ?? "").trim().toLowerCase().replace(/-+$/, "");
	const isPublished = PUBLISHED_STATUSES.includes(campaign.status);
	if (!slug && isPublished) return { error: "A sent issue needs a URL" };
	if (slug && !ARCHIVE_SLUG_PATTERN.test(slug)) return { error: "Use lowercase letters, digits and hyphens" };
	if (slug === (campaign.archiveSlug ?? "")) return { ok: true, archiveSlug: slug };
	if (slug && (await first("SELECT 1 FROM campaigns WHERE id != ? AND archive_slug = ?", [campaign._id, slug]))) {
		return { error: "Another issue uses this URL" };
	}

	try {
		await run("UPDATE campaigns SET archive_slug = ?, updated_at = ? WHERE id = ?", [slug || null, Date.now(), campaign._id]);
	} catch (error) {
		if (String(error?.message).includes("UNIQUE")) return { error: "Another issue uses this URL" };
		throw error;
	}

	revalidatePath(`/campaigns/${id}`);
	if (isPublished) {
		revalidatePath("/campaigns");
		revalidateArchive();
	}
	return { ok: true, archiveSlug: slug };
}
