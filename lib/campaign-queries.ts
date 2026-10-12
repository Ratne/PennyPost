import { all, toCampaign } from "@/server/db";

const SENT_OR_SCHEDULED = ["scheduled", "sending", "paused", "sent"];
// The columns campaign lists show: issues also carry their HTML (up to 200 KB each).
const LIST_COLUMNS = `id, newsletter_id, subject, status, thumbnail_url, archive_slug, scheduled_at, started_at, sent_at, updated_at,
	stats_recipients, stats_sent, stats_delivered, stats_bounced, stats_complained, stats_opened, stats_clicked, stats_unsubscribed, stats_failed`;

// When the other issues went out, newest first. A schedule counts as the time picked, before and
// after it sends.
export async function listSendTimes({ newsletterId, excludeId, limit = 20 }: { newsletterId?: string; excludeId: string; limit?: number }) {
	const rows = await all<{ status: string; at: number }>(
		`SELECT status, COALESCE(scheduled_at, started_at, sent_at) AS at FROM campaigns
		 WHERE id != ? AND status IN (${SENT_OR_SCHEDULED.map(() => "?").join(", ")}) ${newsletterId ? "AND newsletter_id = ?" : ""}
		   AND COALESCE(scheduled_at, started_at, sent_at) IS NOT NULL
		 ORDER BY at DESC LIMIT ?`,
		[excludeId, ...SENT_OR_SCHEDULED, ...(newsletterId ? [newsletterId] : []), limit]
	);
	return rows.map(({ status, at }) => ({ status, at: new Date(at) }));
}

// Sent issues sort by send date, scheduled ones by the time they go out (so upcoming sends lead) and
// drafts by their last edit.
export async function listRecentCampaigns(limit: number, newsletterId?: string) {
	const rows = await all(
		`SELECT ${LIST_COLUMNS}, COALESCE(sent_at, started_at, scheduled_at, updated_at) AS activity_at FROM campaigns
		 WHERE status != 'canceled' ${newsletterId ? "AND newsletter_id = ?" : ""}
		 ORDER BY activity_at DESC, id DESC LIMIT ?`,
		[...(newsletterId ? [newsletterId] : []), limit]
	);
	return rows.map((row) => toCampaign(row)!);
}
