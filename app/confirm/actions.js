"use server";

import { headers } from "next/headers";
import { after } from "@/lib/background";
import { isSendingEnabled } from "@/lib/config";
import { verifyConfirmToken } from "@/lib/confirmation";
import { confirmContact } from "@/lib/contacts";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { getNewsletter, queueWelcomeEmail } from "@/lib/sending";

// Each confirmation can send a welcome email. Shared networks (offices, schools) still fit many readers.
const PER_IP = { name: "confirm-ip", limit: 20, window: "10 m" };

export async function confirmSubscription(token) {
	if (await isRateLimited({ ...PER_IP, key: getClientIp(await headers()) })) return { error: "busy" };
	const reference = verifyConfirmToken(token);
	if (!reference) return { error: "invalid" };

	const { contact, confirmed } = await confirmContact(reference);
	if (contact?.status !== "active") return { error: "invalid" };

	if (confirmed && isSendingEnabled()) {
		const newsletter = await getNewsletter(reference.newsletterId);
		// Skipped while the newsletter confirms signups: the confirmation was their one email.
		after(() =>
			queueWelcomeEmail({ newsletter, contact }).catch((error) =>
				console.error(`[confirm] Welcome email for ${contact._id} failed:`, error.message)
			)
		);
	}
	return { ok: true };
}
