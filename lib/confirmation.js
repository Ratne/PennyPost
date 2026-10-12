import { getAppUrl } from "./config.js";
import { createContactToken, verifyContactToken } from "./contact-token.js";

// Its own key, so an unsubscribe link can never confirm a subscription or the other way around.
const INFO = "newsletter-confirm-v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function createConfirmToken({ contactId, newsletterId }, now = Date.now()) {
	return createContactToken({ info: INFO, contactId, newsletterId }, now);
}

export function verifyConfirmToken(token, now = Date.now()) {
	return verifyContactToken(token, { info: INFO, maxAgeMs: MAX_AGE_MS, now });
}

export function getConfirmUrl({ contactId, newsletterId }) {
	return `${getAppUrl()}/confirm?token=${createConfirmToken({ contactId, newsletterId })}`;
}
