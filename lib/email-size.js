// Shared by lib/tracking.js (which signs the links) and the editor (which only needs their length),
// so it imports nothing server-only.
export const TRACKED_LINK_PATTERN = /(<a\b[^>]*?\shref\s*=\s*)(["'])(https?:\/\/[^"'\s]+)\2/gi;
export const PIXEL_STYLE = "display:block;width:1px;height:1px;border:0;";
// "<id>.<signature>": a 24-character message id and a 22-character HMAC.
const TOKEN_LENGTH = 24 + 1 + 22;
const IMG_SRC_PATTERN = /<img\b[^>]*?\ssrc\s*=\s*(["'])([^"']+)\1/gi;

const encoder = new TextEncoder();

export function byteLength(value) {
	return encoder.encode(String(value ?? "")).length;
}

export function isUnsubscribeUrl(value) {
	try {
		return /^\/(api\/)?unsubscribe\/?$/.test(new URL(value).pathname);
	} catch {
		return false;
	}
}

export function decodeHref(href) {
	return href.replace(/&amp;|&#0*38;|&#x0*26;/gi, "&");
}

function base64UrlLength(bytes) {
	return Math.ceil((bytes * 4) / 3);
}

// The HTML size once every link goes through /c/ and the open pixel is in: what Gmail measures
// against its ~100 KB clipping limit.
export function estimateTrackedBytes(html, baseUrl) {
	let bytes = byteLength(html);
	for (const [, , , href] of String(html ?? "").matchAll(TRACKED_LINK_PATTERN)) {
		const url = decodeHref(href);
		if (isUnsubscribeUrl(url)) continue;
		const tracked = `${baseUrl}/c/`.length + TOKEN_LENGTH + 1 + base64UrlLength(byteLength(url));
		bytes += tracked - byteLength(href);
	}
	const pixel = `<img src="${baseUrl}/o/" width="1" height="1" alt="" style="${PIXEL_STYLE}">`;
	return bytes + byteLength(pixel) + TOKEN_LENGTH;
}

// Remote pictures, which readers download on open but which don't count toward clipping.
export function listImageUrls(html) {
	const urls = new Set();
	for (const [, , src] of String(html ?? "").matchAll(IMG_SRC_PATTERN)) {
		if (/^https?:\/\//i.test(src)) urls.add(src.replace(/&amp;/g, "&"));
	}
	return [...urls];
}

export function formatKilobytes(bytes) {
	return `${Math.max(1, Math.ceil(bytes / 1000))} KB`;
}
