import crypto from "node:crypto";
import { PIXEL_STYLE, TRACKED_LINK_PATTERN, decodeHref, isUnsubscribeUrl } from "./email-size.js";

// Opens: a 1×1 image. Clicks: links through the app that redirect to the original URL. Both carry
// the message ID and an HMAC, so they can't be forged or used to redirect anywhere else.
const SIGNATURE_LENGTH = 22;
const OPEN_TOKEN_PATTERN = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{22})$/;
const CLICK_TOKEN_PATTERN = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{4,4000})$/;
// Security gateways (Microsoft, Proofpoint, Mimecast…) open every link as the email arrives.
const SCANNER_PATTERN =
	/bot|crawl|spider|preview|scan|proofpoint|mimecast|barracuda|safelinks|python|curl|wget|java\/|okhttp|go-http|headless/i;
const SCANNER_WINDOW_MS = 30_000;

// Rotating SESSION_SECRET breaks the signatures of links in already-sent emails (see readClickToken).
function getSigningKey() {
	const secret = process.env.SESSION_SECRET;
	if (!secret) throw new Error("SESSION_SECRET is required to sign tracking links");
	return Buffer.from(crypto.hkdfSync("sha256", secret, "", "newsletter-tracking-v1", 32));
}

function sign(value) {
	return crypto.createHmac("sha256", getSigningKey()).update(value).digest("base64url").slice(0, SIGNATURE_LENGTH);
}

function isSigned(value, signature) {
	const expected = Buffer.from(sign(value));
	const provided = Buffer.from(signature);
	return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function isHttpUrl(value) {
	try {
		return ["http:", "https:"].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

export function getOpenUrl(baseUrl, messageId) {
	const id = String(messageId).toLowerCase();
	return `${baseUrl}/o/${id}.${sign(`open:${id}`)}`;
}

export function getClickUrl(baseUrl, messageId, url) {
	const id = String(messageId).toLowerCase();
	return `${baseUrl}/c/${id}.${sign(`click:${id}:${url}`)}.${Buffer.from(url).toString("base64url")}`;
}

export function readOpenToken(token) {
	const match = OPEN_TOKEN_PATTERN.exec(String(token ?? ""));
	return match && isSigned(`open:${match[1]}`, match[2]) ? match[1] : null;
}

// A link whose signature doesn't match still decodes, so its page can be offered with a plain link.
export function readClickToken(token) {
	const match = CLICK_TOKEN_PATTERN.exec(String(token ?? ""));
	if (!match) return null;
	const url = Buffer.from(match[3], "base64url").toString("utf8");
	if (!isHttpUrl(url)) return null;
	return { messageId: match[1], url, isSigned: isSigned(`click:${match[1]}:${url}`, match[2]) };
}

// Unsubscribe links stay direct, as inbox providers expect. The pixel goes first so it still loads
// when Gmail clips a long email.
export function addTracking(html, { baseUrl, messageId }) {
	const withLinks = html.replace(TRACKED_LINK_PATTERN, (link, start, quote, href) => {
		const url = decodeHref(href);
		if (isUnsubscribeUrl(url)) return link;
		return `${start}${quote}${getClickUrl(baseUrl, messageId, url)}${quote}`;
	});
	const pixel = `<img src="${getOpenUrl(baseUrl, messageId)}" width="1" height="1" alt="" style="${PIXEL_STYLE}">`;
	return /<body\b[^>]*>/i.test(withLinks)
		? withLinks.replace(/<body\b[^>]*>/i, (tag) => `${tag}${pixel}`)
		: `${pixel}${withLinks}`;
}

// Scanners still get redirected; their visits just don't count as clicks.
export function isLikelyScanner({ userAgent, sentAt, now = Date.now() }) {
	if (!userAgent || SCANNER_PATTERN.test(userAgent)) return true;
	return Boolean(sentAt) && now - new Date(sentAt).getTime() < SCANNER_WINDOW_MS;
}
