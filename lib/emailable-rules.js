// https://emailable.com/docs/api/#verify-an-email
export const EMAILABLE_VERIFY_URL = "https://api.emailable.com/v1/verify";
// Emailable answers 249 when the check takes longer than the timeout asked for: the result comes later.
export const EMAILABLE_STILL_CHECKING = 249;
export const VERIFICATION_CACHE_DAYS = 30;
export const SIGNUP_REJECTED_MESSAGE = "This email address can't receive email. Check it and try again.";

const STATES = new Set(["deliverable", "undeliverable", "risky", "unknown"]);

// Only addresses that can't receive email and throwaway inboxes are refused. Risky (catch-all, full
// mailbox, role address) and unknown ones are real often enough to let through.
export function interpretVerification(body) {
	const state = STATES.has(body?.state) ? body.state : "unknown";
	const isDisposable = body?.disposable === true;
	const didYouMean = typeof body?.did_you_mean === "string" && body.did_you_mean.includes("@") ? body.did_you_mean.toLowerCase() : null;
	const reason = isDisposable ? "disposable" : typeof body?.reason === "string" ? body.reason : null;
	return { state, reason, didYouMean, isAccepted: state !== "undeliverable" && !isDisposable };
}

// A saved check is reused for 30 days, so signing up again or to a second newsletter costs no credit.
export function readCachedVerification(person, now = Date.now()) {
	const verifiedAt = person?.verification?.verifiedAt ? new Date(person.verification.verifiedAt).getTime() : 0;
	if (!verifiedAt || now - verifiedAt > VERIFICATION_CACHE_DAYS * 24 * 60 * 60 * 1000) return null;
	const { state, reason } = person.verification;
	if (!STATES.has(state)) return null;
	return { state, reason: reason ?? null, didYouMean: null, isAccepted: state !== "undeliverable" && reason !== "disposable", isCached: true };
}
