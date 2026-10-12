import { isSendingEnabled } from "@/lib/config";
import { MAX_BATCH_MESSAGES } from "@/lib/sending-rules";
import { type SendJob, sendMessageBatch } from "@/lib/sending";
import { isObjectIdString } from "@/lib/validation";

// SES throttling or sending switched off: wait, then the same batch runs again. Messages already sent
// were claimed (queued -> sent) before SES was called, so a retry never sends one twice.
const RETRY_DELAY_SECONDS = 60;

function isValidJob(body: unknown): body is SendJob {
	const messageIds = (body as SendJob | null)?.messageIds;
	return Array.isArray(messageIds) && messageIds.length > 0 && messageIds.length <= MAX_BATCH_MESSAGES && messageIds.every(isObjectIdString);
}

export async function handleSendBatch(batch: MessageBatch<SendJob>) {
	for (const message of batch.messages) {
		if (!isValidJob(message.body)) {
			console.error("[send-queue] Dropping invalid job", JSON.stringify(message.body).slice(0, 200));
			message.ack();
			continue;
		}
		if (!isSendingEnabled()) {
			message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
			continue;
		}
		try {
			const result = await sendMessageBatch(message.body.messageIds);
			console.info(`[send-queue] ${JSON.stringify(result)}`);
			if (result.retry) message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
			else message.ack();
		} catch (error: any) {
			// Database or network trouble: the queue retries, then moves the job to the dead letter queue.
			console.error("[send-queue] Batch failed:", error?.message);
			message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
		}
	}
}
