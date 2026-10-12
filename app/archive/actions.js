"use server";

import { headers } from "next/headers";
import { after } from "@/lib/background";
import { sendAlert } from "@/lib/alerts";
import { isSendingEnabled } from "@/lib/config";
import { upsertContact } from "@/lib/contacts";
import { recordRejection, recordVerification, verifySignupAddress } from "@/lib/emailable";
import { SIGNUP_REJECTED_MESSAGE } from "@/lib/emailable-rules";
import { getInbox } from "@/lib/inbox-links";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { SIGNUPS_PER_ADDRESS } from "@/lib/signup-limits";
import { queueConfirmationEmail, queueWelcomeEmail } from "@/lib/sending";
import { normalizeEmail } from "@/lib/validation";
import { first, toNewsletter } from "@/server/db";

const PER_IP = { name: "subscribe-ip", limit: 5, window: "10 m" };
// Only alerts: refusing signups past a shared limit would let one flooder block every real signup.
// A flood from many IPs (list bombing) still needs a look: it fills the list with spam traps.
const PER_NEWSLETTER = { name: "subscribe-newsletter", limit: 300, window: "10 m" };

// Cheapest checks first: the honeypot, then the limits, and only then the paid address check.
export async function subscribe(_state, formData) {
	// People never see this field; bots fill in every input they find.
	if (formData.get("website")) return { ok: true };

	const email = normalizeEmail(formData.get("email"));
	if (!email) return { error: "Enter a valid email" };

	if (await isRateLimited({ ...PER_IP, key: getClientIp(await headers()) })) {
		return { error: "Too many signups from your network. Try again in a few minutes." };
	}
	// Someone typing a stranger's address over and over can't fill that inbox with confirmations.
	if (await isRateLimited({ ...SIGNUPS_PER_ADDRESS, key: email })) {
		return { error: "Too many signups for this address. Try again in an hour." };
	}

	const newsletter = toNewsletter(
		await first("SELECT * FROM newsletters WHERE slug = ? AND archive_enabled = 1", [String(formData.get("newsletter") ?? "")])
	);
	if (!newsletter) return { error: "This newsletter is not taking signups" };

	if (await isRateLimited({ ...PER_NEWSLETTER, key: newsletter.slug })) {
		after(() =>
			sendAlert({
				key: `signup-flood:${newsletter.slug}`,
				title: "Website signup flood",
				detail: `Over ${PER_NEWSLETTER.limit} signups to ${newsletter.name} in 10 minutes. They still go through (${PER_IP.limit} per visitor per 10 minutes); check new contacts for junk.`,
				path: "/contacts",
			})
		);
	}

	const verification = await verifySignupAddress(email);
	if (verification && !verification.isAccepted) {
		after(() => recordRejection(email, verification).catch((error) => console.error("[subscribe] Check not saved:", error.message)));
		return { error: SIGNUP_REJECTED_MESSAGE, didYouMean: verification.didYouMean };
	}

	const { contact, created } = await upsertContact({ newsletter, email, source: "website", resubscribe: true });
	if (verification) {
		after(() =>
			recordVerification(email, verification, { contactId: contact._id, newsletterId: newsletter._id }).catch((error) =>
				console.error("[subscribe] Check not saved:", error.message)
			)
		);
	}
	const isPending = contact.status === "pending";
	if (isSendingEnabled() && (isPending || (created && contact.status === "active"))) {
		const queue = isPending ? queueConfirmationEmail : queueWelcomeEmail;
		after(() =>
			queue({ newsletter, contact }).catch((error) =>
				console.error(`[subscribe] Signup email for ${contact._id} failed:`, error.message)
			)
		);
	}
	if (!isPending) return { ok: true };
	return { ok: true, pending: true, email, inbox: getInbox({ email, fromEmail: newsletter.fromEmail }) };
}
