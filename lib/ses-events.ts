import { forContacts, logActivities, logActivity } from "@/lib/contact-activity";
import { sendAlert } from "@/lib/alerts";
import { ENGAGEMENT_SET } from "@/lib/contacts";
import { CAMPAIGN_MESSAGE_KINDS, getCampaignStatsPath } from "@/lib/sending-rules";
import { getSesEventPlan, getTrackingPlan } from "@/lib/ses-event-mapping";
import { isLikelyScanner } from "@/lib/tracking";
import { MAX_BOUND_PARAMS, all, batch, campaignStatColumn, chunk, first, newId, placeholders, run, statement, toMessage } from "@/server/db";

export { getSesEventPlan } from "@/lib/ses-event-mapping";

// Every send produces a delivery event; storing those raw would fill the database within months.
const RECORDED_EVENT_TYPES = new Set(["Bounce", "Complaint", "Reject", "DeliveryDelay", "RenderingFailure"]);
const MESSAGE_FIELDS = new Set(["deliveredAt", "openedAt", "clickedAt", "bouncedAt", "complainedAt"]);
const CONTACT_STATS: Record<string, string> = { opens: "stats_opens", clicks: "stats_clicks" };
const CONTACT_ENGAGEMENT: Record<string, string> = { lastOpenAt: "last_open_at", lastClickAt: "last_click_at" };

function column(field: string) {
	if (!MESSAGE_FIELDS.has(field)) throw new Error(`Unknown message field ${field}`);
	return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// The message_id tag covers events that arrive before ses_message_id is saved.
async function findMessage({ sesMessageId, messageId }: { sesMessageId: string | null; messageId: string | null }) {
	if (sesMessageId) {
		const message = toMessage(await first("SELECT * FROM messages WHERE ses_message_id = ?", [sesMessageId]));
		if (message) return message;
	}
	if (!messageId) return null;

	const message = toMessage(await first("SELECT * FROM messages WHERE id = ?", [messageId]));
	if (!message) return null;
	if (message.sesMessageId && sesMessageId && message.sesMessageId !== sesMessageId) return null;
	if (!message.sesMessageId && sesMessageId) {
		await run("UPDATE messages SET ses_message_id = ? WHERE id = ? AND ses_message_id IS NULL", [sesMessageId, message._id]);
	}
	return message;
}

// Each counter moves only on the first transition, so SNS redeliveries are harmless.
async function applyMessageUpdates(message: any, plan: any) {
	const occurredAt = plan.occurredAt.getTime();
	const campaignInc = new Map<string, number>();
	const contactInc = new Map<string, number>();
	const statsPath = getCampaignStatsPath(message.kind);

	for (const { field, stat, contactStat } of plan.firsts) {
		const name = column(field);
		const { changes } = await run(`UPDATE messages SET ${name} = ? WHERE id = ? AND ${name} IS NULL`, [occurredAt, message._id]);
		if (!changes) continue;
		if (stat) campaignInc.set(campaignStatColumn(`${statsPath}.${stat}`), 1);
		if (contactStat && CONTACT_STATS[contactStat]) contactInc.set(CONTACT_STATS[contactStat], 1);
	}

	if (plan.status) {
		const { changes } = await run(
			`UPDATE messages SET status = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders(plan.status.from.length)})`,
			[plan.status.to, Date.now(), message._id, ...plan.status.from]
		);
		if (changes && plan.status.stat) campaignInc.set(campaignStatColumn(`${statsPath}.${plan.status.stat}`), 1);
	}

	if (plan.error) await run("UPDATE messages SET error = ? WHERE id = ?", [String(plan.error).slice(0, 500), message._id]);

	const updates = [];
	if (CAMPAIGN_MESSAGE_KINDS.includes(message.kind) && message.campaignId && campaignInc.size > 0) {
		const sets = [...campaignInc.keys()].map((name) => `${name} = ${name} + 1`).join(", ");
		updates.push(statement(`UPDATE campaigns SET ${sets} WHERE id = ?`, [message.campaignId]));
	}
	if (message.contactId && (plan.engagement || contactInc.size > 0)) {
		const sets: string[] = [...contactInc.keys()].map((name) => `${name} = ${name} + 1`);
		const params: (number | string)[] = [];
		for (const [key, value] of Object.entries(plan.engagement ?? {})) {
			const name = CONTACT_ENGAGEMENT[key];
			if (!name) continue;
			sets.push(`${name} = MAX(COALESCE(${name}, 0), ?)`);
			params.push((value as Date).getTime());
		}
		if (plan.engagement) {
			sets.push(ENGAGEMENT_SET);
			params.push(occurredAt);
		}
		updates.push(statement(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, [...params, message.contactId]));
	}
	await batch(updates);
}

// Global: the address is never emailed again, from any newsletter.
async function suppress({ emails, reason, detail, contactStatus, contactStatusFrom, campaignId }: any) {
	if (emails.length === 0) return;
	const now = Date.now();
	// A complaint outranks an earlier bounce or manual suppression.
	const onConflict =
		reason === "complaint"
			? "DO UPDATE SET reason = excluded.reason, detail = excluded.detail, updated_at = excluded.updated_at"
			: "DO NOTHING";
	await batch(
		emails.map((email: string) =>
			statement(
				`INSERT INTO suppressions (email, reason, detail, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) ${onConflict}`,
				[email, reason, detail, now, now]
			)
		)
	);
	for (const group of chunk(emails as string[], MAX_BOUND_PARAMS - contactStatusFrom.length - 2)) {
		const changed = await all<{ id: string; email: string; newsletter_id: string }>(
			`UPDATE contacts SET status = ?, updated_at = ? WHERE email IN (${placeholders(group.length)})
			 AND status IN (${placeholders(contactStatusFrom.length)}) RETURNING id, email, newsletter_id`,
			[contactStatus, now, ...group, ...contactStatusFrom]
		);
		await logActivities(
			forContacts(changed, { type: contactStatus, campaignId: campaignId ?? null, occurredAt: now, data: { reason, detail } })
		);
	}
}

// Opens this soon after the send are mail servers and privacy proxies prefetching images, not people.
const AUTOMATIC_OPEN_MS = 60 * 1000;

async function logEngagement(message: any, { type, occurredAt, url }: { type: string; occurredAt: number; url?: string | null }) {
	if (message.kind === "test") return;
	const sentAt = message.sentAt?.getTime?.() ?? null;
	const automatic = type === "Open" && sentAt !== null && occurredAt - sentAt < AUTOMATIC_OPEN_MS;
	await logActivity({
		email: message.email,
		newsletterId: message.newsletterId,
		contactId: message.contactId ?? null,
		campaignId: message.campaignId ?? null,
		messageId: message._id,
		type: type === "Click" ? "clicked" : "opened",
		occurredAt,
		data: { ...(url && { url }), ...(automatic && { automatic: true }) },
	});
}

// The app's own open pixel and click links update messages the way SES events do.
export async function recordEngagement({
	messageId,
	type,
	userAgent,
	url,
}: {
	messageId: string;
	type: string;
	userAgent?: string | null;
	url?: string | null;
}) {
	const message = toMessage(await first("SELECT * FROM messages WHERE id = ?", [messageId]));
	if (!message) return;
	if (type === "Click" && isLikelyScanner({ userAgent: userAgent ?? null, sentAt: message.sentAt })) return;
	const plan: any = getTrackingPlan(type);
	await applyMessageUpdates(message, plan);
	await logEngagement(message, { type, occurredAt: plan.occurredAt.getTime(), url });
}

export async function handleSesEvent(sesEvent: unknown) {
	const plan: any = getSesEventPlan(sesEvent);
	if (!plan) return { handled: false, messageId: null };

	const message = await findMessage(plan);
	if (message) await applyMessageUpdates(message, plan);
	if (message && plan.engagement) {
		const link = (plan.data as any)?.click?.link;
		await logEngagement(message, { type: plan.type, occurredAt: plan.occurredAt.getTime(), url: typeof link === "string" ? link : null });
	}
	if (plan.suppression) await suppress({ ...plan.suppression, campaignId: message?.campaignId });
	if (plan.suppression?.reason === "complaint") {
		await sendAlert({
			key: "complaints",
			title: "Spam complaint",
			detail: `${plan.suppression.emails.join(", ")} marked an email as spam. Contacts are suppressed.`,
			path: message?.campaignId ? `/campaigns/${message.campaignId}` : "",
		});
	}

	if (RECORDED_EVENT_TYPES.has(plan.type)) {
		await run(
			"INSERT INTO events (id, type, ses_message_id, message_id, campaign_id, email, occurred_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			[
				newId(),
				plan.type,
				plan.sesMessageId,
				message?._id,
				message?.campaignId,
				plan.email ?? message?.email,
				plan.occurredAt.getTime(),
				JSON.stringify(plan.data),
			]
		);
	}
	return { handled: true, messageId: message?._id ?? null };
}
