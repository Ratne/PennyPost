import { env } from "cloudflare:workers";

// Sent emails point at these files forever, so their URLs never change and browsers can cache them for a year.
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const MEDIA_PREFIX = "/media/";

function randomSuffix() {
	return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// With IMAGES_PUBLIC_URL (an R2 custom domain), images are served straight from R2's CDN; otherwise
// the Worker serves them at /media/<key>.
export function getImageUrl(key: string) {
	const publicUrl = process.env.IMAGES_PUBLIC_URL?.replace(/\/$/, "");
	if (publicUrl) return `${publicUrl}/${key}`;
	const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
	return `${appUrl}${MEDIA_PREFIX}${key}`;
}

export async function putImage(pathname: string, bytes: Uint8Array, contentType: string) {
	const dot = pathname.lastIndexOf(".");
	const key = `${pathname.slice(0, dot)}-${randomSuffix()}${pathname.slice(dot)}`;
	await env.IMAGES.put(key, bytes, { httpMetadata: { contentType, cacheControl: IMAGE_CACHE_CONTROL } });
	return getImageUrl(key);
}
