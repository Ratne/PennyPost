import { sendAlert } from "@/lib/alerts";
import { logActivity } from "@/lib/contact-activity";
import { EMAILABLE_STILL_CHECKING, EMAILABLE_VERIFY_URL, interpretVerification, readCachedVerification } from "@/lib/emailable-rules";
import { getPersonByEmail, saveVerification } from "@/lib/people";
import { getEmailableApiKey } from "@/lib/settings";
import { run } from "@/server/db";

// Emailable checks for up to `timeout` seconds; the request gives it a little more before giving up.
const CHECK_SECONDS = 5;
const REQUEST_TIMEOUT_MS = 8000;

export type Verification = { state: string; reason: string | null; didYouMean: string | null; isAccepted: boolean; isCached?: boolean };

function failOpen(detail: string) {
	console.error(`[emailable] ${detail}`);
	// Not awaited by the signup: the alert has its own cooldown and never holds up the response.
	sendAlert({
		key: "emailable-unavailable",
		title: "Address checks skipped",
		detail: `${detail} Signups go through unchecked until it works again.`,
		path: "/settings",
	}).catch(() => {});
	return null;
}

// null means "not checked" (no key, or Emailable didn't answer): the signup goes through.
export async function verifySignupAddress(email: string): Promise<Verification | null> {
	const apiKey = await getEmailableApiKey();
	if (!apiKey) return null;

	const cached = readCachedVerification(await getPersonByEmail(email));
	if (cached) return cached;

	const url = new URL(EMAILABLE_VERIFY_URL);
	url.searchParams.set("email", email);
	url.searchParams.set("timeout", String(CHECK_SECONDS));
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey.key}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error: any) {
		return failOpen(`Emailable didn't answer (${error?.name === "TimeoutError" ? "timeout" : error?.message}).`);
	}
	if (response.status === EMAILABLE_STILL_CHECKING) {
		console.info(`[emailable] Still checking ${email}; letting the signup through`);
		return null;
	}
	if (!response.ok) {
		const detail =
			response.status === 401 ? "The Emailable key was refused." : response.status === 402 ? "Emailable is out of credits." : `Emailable answered ${response.status}.`;
		return failOpen(detail);
	}
	const body = await response.json().catch(() => null);
	if (!body) return failOpen("Emailable sent an answer that isn't JSON.");
	return interpretVerification(body);
}

// Called once the contact exists, so the result lands on the person and in their history.
export async function recordVerification(email: string, verification: Verification, ref: { contactId: string; newsletterId: string }) {
	if (verification.isCached) return;
	await saveVerification(email, verification);
	await logActivity({
		email,
		contactId: ref.contactId,
		newsletterId: ref.newsletterId,
		type: "verified",
		data: { state: verification.state, reason: verification.reason },
	});
}

// A refused address has no contact; if it has a profile from another newsletter, the result is kept there.
export async function recordRejection(email: string, verification: Verification) {
	if (verification.isCached) return;
	const now = Date.now();
	await run("UPDATE people SET verification_state = ?, verification_reason = ?, verified_at = ?, updated_at = ? WHERE email = ?", [
		verification.state,
		verification.reason,
		now,
		now,
		email,
	]);
}
