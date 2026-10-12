import handler from "vinext/server/fetch-handler";
import { runDueEnrollments } from "@/lib/automation-engine";
import { loadSettings } from "@/lib/settings";
import { isMaintenanceTick, runDailyMaintenance, runScheduledSends } from "@/server/cron";
import { handleEventsBatch } from "@/server/queues/events";
import { handleSendBatch } from "@/server/queues/send";

export { RateLimiter } from "@/server/rate-limiter";

export default {
	fetch(request, env, ctx) {
		return handler.fetch(request, env, ctx);
	},

	async queue(batch, env) {
		await loadSettings();
		if (batch.queue.startsWith("newsletter-send")) return handleSendBatch(batch as MessageBatch<any>);
		if (batch.queue.startsWith("newsletter-events")) return handleEventsBatch(batch as MessageBatch<any>);
		console.error(`[queue] No handler for ${batch.queue}`);
		batch.retryAll();
	},

	async scheduled(controller, env, ctx) {
		const now = new Date(controller.scheduledTime);
		await loadSettings();
		ctx.waitUntil(runScheduledSends(now));
		ctx.waitUntil(runDueEnrollments(now.getTime()).catch((error) => console.error("[automations] Run failed:", error?.message)));
		if (isMaintenanceTick(now)) {
			ctx.waitUntil(runDailyMaintenance(now).catch((error) => console.error("[maintenance] Failed:", error?.message)));
		}
	},
} satisfies ExportedHandler<Env>;
