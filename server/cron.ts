import { pruneEngagementActivity } from "@/lib/contact-activity";
import { sendAlert } from "@/lib/alerts";
import { pruneAutomationLogs } from "@/lib/automation-engine";
import { queueCampaign } from "@/lib/sending";
import { all, run } from "@/server/db";

// Once a day, on the 03:00 UTC tick.
export function isMaintenanceTick(now: Date) {
	return now.getUTCHours() === 3 && now.getUTCMinutes() === 0;
}

export async function runDailyMaintenance(now = new Date()) {
	await pruneEngagementActivity(now.getTime());
	await pruneAutomationLogs(now.getTime());
	await run("DELETE FROM login_challenges WHERE expires_at < ?", [now.getTime() - 24 * 60 * 60 * 1000]);
}

// Closer than this to the scheduled time, the send starts on this tick instead of the next one.
const START_EARLY_MS = 30 * 1000;
const MAX_PER_TICK = 10;

// Runs every minute (wrangler.jsonc triggers.crons). A campaign rescheduled, unscheduled, sent or
// discarded since the last tick is simply no longer matched, so changing a schedule needs no cleanup.
export async function runScheduledSends(now = new Date()) {
	const due = await all<{ id: string; subject: string; scheduled_at: number }>(
		`SELECT id, subject, scheduled_at FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?
		 ORDER BY scheduled_at ASC LIMIT ?`,
		[now.getTime() + START_EARLY_MS, MAX_PER_TICK]
	);
	for (const campaign of due) await startScheduledSend(campaign);
	return { started: due.length };
}

async function startScheduledSend(campaign: { id: string; subject: string; scheduled_at: number }) {
	try {
		const result = await queueCampaign(campaign.id);
		console.info(`[scheduled] ${JSON.stringify({ campaignId: campaign.id, started: true, ...result })}`);
	} catch (error: any) {
		// Only a campaign still waiting goes back to draft: one that started and then paused alerts on its own.
		const { changes } = await run(
			"UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ? AND status = 'scheduled' AND scheduled_at = ?",
			[Date.now(), campaign.id, campaign.scheduled_at]
		);
		console.info(`[scheduled] ${JSON.stringify({ campaignId: campaign.id, failed: error?.message })}`);
		if (changes) {
			await sendAlert({
				key: `scheduled-send-${campaign.id}`,
				title: "Scheduled send didn't start",
				detail: `${error?.message}. "${campaign.subject || "Untitled"}" is a draft again.`,
				path: `/campaigns/${campaign.id}`,
				cooldownMinutes: 1,
			});
		}
	}
}
