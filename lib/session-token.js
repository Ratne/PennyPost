import { SignJWT, jwtVerify } from "jose";
import { MIN_SESSION_SECRET_LENGTH } from "./config.js";

// __Host- cookies need HTTPS, which local dev doesn't have.
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-newsletter_session" : "newsletter_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();
let cachedKey = null;

// Email links derive their keys from SESSION_SECRET with other infos, so signing everyone out never breaks them.
async function getKey() {
	const secret = process.env.SESSION_SECRET;
	if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
		throw new Error(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`);
	}
	if (cachedKey?.secret !== secret) {
		const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveBits"]);
		const bits = await crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode("newsletter-session-v1") },
			material,
			256
		);
		cachedKey = { secret, key: new Uint8Array(bits) };
	}
	return cachedKey.key;
}

// The version is the admin's session_version: raising it (new password, "Sign out everywhere") ends
// every session signed before. lib/session.ts checks it against the database.
export async function signSessionToken({ adminId, version }) {
	const key = await getKey();
	return new SignJWT({ v: version })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(adminId)
		.setIssuedAt()
		.setExpirationTime(`${SESSION_MAX_AGE}s`)
		.sign(key);
}

// Signature and expiry only.
export async function verifySessionToken(token) {
	if (!token) return null;
	try {
		const key = await getKey();
		const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
		if (typeof payload.sub !== "string" || !Number.isInteger(payload.v)) return null;
		return { adminId: payload.sub, version: payload.v };
	} catch {
		return null;
	}
}
