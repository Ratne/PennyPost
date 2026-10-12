"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createLoginChallenge, getChallengeAdmin, verifyCredentials, verifyLoginChallenge } from "@/lib/admins";
import { after } from "@/lib/background";
import { notifyActivity, sendAlert } from "@/lib/alerts";
import { clearChallengeCookie, getChallengeCookie, setChallengeCookie, startSession } from "@/lib/auth";
import { getConfigProblems } from "@/lib/config";
import { sendLoginCode } from "@/lib/login-code-email";
import { LOGIN_CODE_TTL_MS, normalizeLoginCode } from "@/lib/passwords";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/validation";

// Passwords: per visitor, per account (so many IPs can't take turns on one admin) and overall
// (a botnet spreading guesses over every address). The overall one alerts.
const PASSWORDS_PER_IP = { name: "login-ip", limit: 10, window: "15 m" };
const PASSWORDS_PER_EMAIL = { name: "login-email", limit: 5, window: "15 m" };
const PASSWORDS_OVERALL = { name: "login-all", limit: 100, window: "15 m" };
// Codes: how many an admin can be sent, and how many tries a visitor gets across codes.
const CODES_PER_ADMIN = { name: "login-code-admin", limit: 5, window: "1 h" };
const CODE_TRIES_PER_IP = { name: "login-code-ip", limit: 10, window: "15 m" };
// A wrong password or email waits this long, so guessing is slow even under the limits.
const FAILURE_DELAY_MS = 800;

const TOO_MANY = "Too many attempts. Try again in 15 minutes.";
const WRONG_LOGIN = "Wrong email or password";

function safeNextPath(value) {
	return typeof value === "string" && /^\/(?!\/)[\w\-/]*$/.test(value) ? value : "/";
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// "j•••@example.com": confirms where the code went without spelling out the address.
function maskEmail(email) {
	const [local, domain] = email.split("@");
	return `${local.charAt(0)}${"•".repeat(Math.min(Math.max(local.length - 1, 1), 5))}@${domain}`;
}

export async function getPendingLogin() {
	const challengeId = await getChallengeCookie();
	if (!challengeId) return null;
	const email = await getChallengeAdmin(challengeId);
	return email ? { email: maskEmail(email) } : null;
}

// Step 1: the password. Every failure gets the same answer and the same delay, whether or not the email
// is an admin's.
export async function login(_state, formData) {
	const problems = getConfigProblems();
	if (problems.length > 0) return { error: `Login is off until the server's settings are fixed. ${problems.join(" ")}` };

	const ip = getClientIp(await headers());
	const email = normalizeEmail(formData.get("email"));
	if (await isRateLimited({ ...PASSWORDS_PER_IP, key: ip })) return { error: TOO_MANY };
	if (await isRateLimited({ ...PASSWORDS_OVERALL, key: "all" })) {
		after(() =>
			sendAlert({
				key: "login-flood",
				title: "Login paused",
				detail: `Over ${PASSWORDS_OVERALL.limit} login attempts in 15 minutes, from many addresses. Logins are refused until it slows down; sessions already open keep working.`,
				path: "/login",
			})
		);
		return { error: TOO_MANY };
	}
	if (email && (await isRateLimited({ ...PASSWORDS_PER_EMAIL, key: email }))) return { error: TOO_MANY };

	const admin = await verifyCredentials(email, formData.get("password"));
	if (!admin) {
		await wait(FAILURE_DELAY_MS);
		return { error: WRONG_LOGIN };
	}

	if (await isRateLimited({ ...CODES_PER_ADMIN, key: admin.id })) {
		return { error: "Too many codes sent to this account. Try again in an hour." };
	}
	const challenge = await createLoginChallenge(admin.id);
	try {
		await sendLoginCode({ to: admin.email, code: challenge.code, ip });
	} catch (error) {
		console.error("[login] Code not sent:", error?.message);
		return { error: "The login code couldn't be sent. Try again in a minute." };
	}
	await setChallengeCookie(challenge.id, Math.ceil(LOGIN_CODE_TTL_MS / 1000));
	return { step: "code", email: maskEmail(admin.email) };
}

// Step 2: the emailed code.
export async function verifyCode(_state, formData) {
	const ip = getClientIp(await headers());
	if (await isRateLimited({ ...CODE_TRIES_PER_IP, key: ip })) return { step: "code", error: TOO_MANY };

	const challengeId = await getChallengeCookie();
	if (!challengeId) return { error: "The code expired. Log in again for a new one." };
	const code = normalizeLoginCode(formData.get("code"));
	if (!code) return { step: "code", error: "Enter the 6-digit code" };

	const result = await verifyLoginChallenge(challengeId, code);
	if (result.error === "expired") {
		await clearChallengeCookie();
		return { error: "The code expired. Log in again for a new one." };
	}
	if (result.error === "wrong") {
		await wait(FAILURE_DELAY_MS);
		return {
			step: "code",
			error: `Wrong code. ${result.attemptsLeft === 1 ? "1 try" : `${result.attemptsLeft} tries`} left before it stops working.`,
		};
	}

	await clearChallengeCookie();
	await startSession(result.admin);
	await notifyActivity(["New login", result.admin.email], { withUserAgent: true });
	redirect(safeNextPath(formData.get("next")));
}

export async function restartLogin() {
	await clearChallengeCookie();
	return { ok: true };
}
