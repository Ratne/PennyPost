import { MAX_BOUND_PARAMS, all, batch, chunk, newId, placeholders, statement } from "@/server/db";

export type ActivityType =
	| "subscribed"
	| "resubscribed"
	| "confirmed"
	| "unsubscribed"
	| "reactivated"
	| "dormant"
	| "kept"
	| "bounced"
	| "complained"
	| "imported"
	| "tag_added"
	| "tag_removed"
	| "profile_updated"
	| "verified"
	| "opened"
	| "clicked"
	| "automation_entered"
	| "automation_completed"
	| "automation_exited";

export type Activity = {
	email: string;
	type: ActivityType;
	newsletterId?: string | null;
	contactId?: string | null;
	campaignId?: string | null;
	messageId?: string | null;
	data?: Record<string, unknown> | null;
	occurredAt?: number;
};

export type ContactRef = { id: string; email: string; newsletterId: string };

const COLUMNS = 9;
const ROWS_PER_STATEMENT = Math.floor(MAX_BOUND_PARAMS / COLUMNS);

export function activityRow(activity: Activity) {
	return [
		newId(),
		activity.email,
		activity.newsletterId ?? null,
		activity.contactId ?? null,
		activity.campaignId ?? null,
		activity.messageId ?? null,
		activity.type,
		activity.data ? JSON.stringify(activity.data) : null,
		activity.occurredAt ?? Date.now(),
	];
}

// History never blocks the change it records: a failed insert is logged and the action goes on.
export async function logActivities(activities: Activity[]) {
	if (activities.length === 0) return;
	try {
		const statements = chunk(activities, ROWS_PER_STATEMENT).map((group) =>
			statement(
				`INSERT INTO contact_activity (id, email, newsletter_id, contact_id, campaign_id, message_id, type, data, occurred_at)
				 VALUES ${group.map(() => `(${placeholders(COLUMNS)})`).join(", ")}`,
				group.flatMap(activityRow)
			)
		);
		for (const group of chunk(statements, 50)) await batch(group);
	} catch (error: any) {
		console.error(`[activity] ${activities.length} events not recorded:`, error?.message);
	}
}

export function logActivity(activity: Activity) {
	return logActivities([activity]);
}

// Activities for contacts read back from an UPDATE ... RETURNING id, email, newsletter_id.
export function forContacts(
	rows: { id: string; email: string; newsletter_id: string }[],
	activity: Omit<Activity, "email" | "contactId" | "newsletterId">
): Activity[] {
	return rows.map((row) => ({ ...activity, email: row.email, contactId: row.id, newsletterId: row.newsletter_id }));
}

export async function findContactRefs(ids: string[]) {
	const refs = new Map<string, ContactRef>();
	for (const group of chunk([...new Set(ids)], MAX_BOUND_PARAMS)) {
		const rows = await all<{ id: string; email: string; newsletter_id: string }>(
			`SELECT id, email, newsletter_id FROM contacts WHERE id IN (${placeholders(group.length)})`,
			group
		);
		for (const row of rows) refs.set(row.id, { id: row.id, email: row.email, newsletterId: row.newsletter_id });
	}
	return refs;
}

// Opens and clicks are the bulk of the table; everything else is kept for good.
export const ENGAGEMENT_RETENTION_DAYS = 730;

export async function pruneEngagementActivity(now = Date.now()) {
	const cutoff = now - ENGAGEMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	await statement("DELETE FROM contact_activity WHERE type IN ('opened', 'clicked') AND occurred_at < ?", [cutoff]).run();
}
