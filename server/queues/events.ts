import { handleSesEvent } from "@/lib/ses-events";

// SES events (via SNS and /api/webhooks/ses), applied in batches. handleSesEvent is safe to replay, so
// a failed message is simply retried and, after max_retries, kept in the dead letter queue.
export async function handleEventsBatch(batch: MessageBatch<unknown>) {
	for (const message of batch.messages) {
		try {
			await handleSesEvent(message.body);
			message.ack();
		} catch (error: any) {
			console.error("[events-queue] Could not handle the event:", error?.message);
			message.retry({ delaySeconds: 30 });
		}
	}
}
