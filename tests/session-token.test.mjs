import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT, decodeJwt } from "jose";

process.env.SESSION_SECRET = "s".repeat(40);

const { SESSION_COOKIE, SESSION_MAX_AGE, signSessionToken, verifySessionToken } = await import("../lib/session-token.js");
const { createUnsubscribeToken } = await import("../lib/unsubscribe.js");
const { getClickUrl, getOpenUrl } = await import("../lib/tracking.js");
const { createConfirmToken } = await import("../lib/confirmation.js");
const { createKeepToken } = await import("../lib/last-chance.js");

async function withEnv(values, run) {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	Object.assign(process.env, values);
	try {
		await run();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

const ADMIN = { adminId: "65f0000000000000000000aa", version: 3 };

test("a session lasts 7 days and carries the admin and its session version", async () => {
	const token = await signSessionToken(ADMIN);
	const { iat, exp, sub, v } = decodeJwt(token);
	assert.equal(SESSION_MAX_AGE, 7 * 24 * 60 * 60);
	assert.equal(exp - iat, SESSION_MAX_AGE);
	assert.equal(sub, ADMIN.adminId);
	assert.equal(v, 3);
	assert.deepEqual(await verifySessionToken(token), ADMIN);
});

test("tokens without an admin or a whole version are refused", async () => {
	const key = await sessionKey();
	for (const claims of [{ v: 1 }, { sub: ADMIN.adminId }, { sub: ADMIN.adminId, v: "1" }]) {
		const token = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
		assert.equal(await verifySessionToken(token), null);
	}
});

test("sessions are signed with their own key, not SESSION_SECRET itself", async () => {
	const rawKey = new TextEncoder().encode(process.env.SESSION_SECRET);
	const forged = await new SignJWT({ v: 3 }).setProtectedHeader({ alg: "HS256" }).setSubject(ADMIN.adminId).setIssuedAt().setExpirationTime("1h").sign(rawKey);
	assert.equal(await verifySessionToken(forged), null);

	const token = await signSessionToken(ADMIN);
	await withEnv({ SESSION_SECRET: "t".repeat(40) }, async () => {
		assert.equal(await verifySessionToken(token), null);
	});
	await withEnv({ SESSION_SECRET: "s".repeat(31) }, async () => {
		assert.equal(await verifySessionToken(token), null);
		await assert.rejects(signSessionToken(ADMIN), /at least 32 characters/);
	});
	assert.equal(await verifySessionToken(`${token}x`), null);
	assert.equal(await verifySessionToken(""), null);
});

// The session key, derived the way lib/session-token.js does, to sign malformed tokens.
async function sessionKey() {
	const encoder = new TextEncoder();
	const material = await crypto.subtle.importKey("raw", encoder.encode(process.env.SESSION_SECRET), "HKDF", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode("newsletter-session-v1") },
		material,
		256
	);
	return new Uint8Array(bits);
}

// Signed with SESSION_SECRET = "s" x 40. Email links don't use the session key: changing how they're signed
// breaks the links in emails already sent.
test("email links keep their signatures", () => {
	const ids = { contactId: "65f000000000000000000001", newsletterId: "65f000000000000000000002" };
	const at = Date.UTC(2026, 9, 1);
	assert.equal(
		createUnsubscribeToken(ids),
		"eyJjIjoiNjVmMDAwMDAwMDAwMDAwMDAwMDAwMDAxIiwibiI6IjY1ZjAwMDAwMDAwMDAwMDAwMDAwMDAwMiJ9.SJU-csCAkm-1CIgzEqU6kOLcG611cI9uWiBPVLqtVyc"
	);
	assert.equal(
		getOpenUrl("https://app.example.com", "65f000000000000000000003"),
		"https://app.example.com/o/65f000000000000000000003.pcAdKgD1zSoZsx01KxwPUG"
	);
	assert.equal(
		getClickUrl("https://app.example.com", "65f000000000000000000003", "https://example.com/a"),
		"https://app.example.com/c/65f000000000000000000003.rjsC1MTelLEmpLgLod5qAU.aHR0cHM6Ly9leGFtcGxlLmNvbS9h"
	);
	assert.equal(
		createConfirmToken(ids, at),
		"eyJjIjoiNjVmMDAwMDAwMDAwMDAwMDAwMDAwMDAxIiwibiI6IjY1ZjAwMDAwMDAwMDAwMDAwMDAwMDAwMiIsInQiOjE3OTA4MTI4MDB9.BE6gmeueUD91C7oCrp7SdGq2O8tQpa8fElSleNarhtw"
	);
	assert.equal(
		createKeepToken(ids, at),
		"eyJjIjoiNjVmMDAwMDAwMDAwMDAwMDAwMDAwMDAxIiwibiI6IjY1ZjAwMDAwMDAwMDAwMDAwMDAwMDAwMiIsInQiOjE3OTA4MTI4MDB9.p26j21EZQY4Q0_Tsip5bmDpldw8YTig1HnefJZEP1mg"
	);
});

test("production keeps the session in a __Host- cookie", async () => {
	assert.equal(SESSION_COOKIE, "newsletter_session");
	await withEnv({ NODE_ENV: "production" }, async () => {
		const production = await import("../lib/session-token.js?production");
		assert.equal(production.SESSION_COOKIE, "__Host-newsletter_session");
	});
});
