import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSessionToken } from "@/lib/session-token";

// Browsers ignore a __Host- cookie, even an expired one, unless it's Secure with Path=/.
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: process.env.NODE_ENV === "production",
	sameSite: "lax",
	path: "/",
};

// Holds the id of the login code waiting to be typed, between the password step and the code step.
export const CHALLENGE_COOKIE = process.env.NODE_ENV === "production" ? "__Host-mail_newsletter_login" : "mail_newsletter_login";

export async function startSession(admin) {
	const store = await cookies();
	store.set(SESSION_COOKIE, await signSessionToken({ adminId: admin.id, version: admin.sessionVersion }), {
		...COOKIE_OPTIONS,
		maxAge: SESSION_MAX_AGE,
	});
}

export async function endSession() {
	const store = await cookies();
	store.delete({ name: SESSION_COOKIE, ...COOKIE_OPTIONS });
}

export async function setChallengeCookie(challengeId, maxAgeSeconds) {
	const store = await cookies();
	store.set(CHALLENGE_COOKIE, challengeId, { ...COOKIE_OPTIONS, sameSite: "strict", maxAge: maxAgeSeconds });
}

export async function getChallengeCookie() {
	const store = await cookies();
	return store.get(CHALLENGE_COOKIE)?.value ?? null;
}

export async function clearChallengeCookie() {
	const store = await cookies();
	store.delete({ name: CHALLENGE_COOKIE, ...COOKIE_OPTIONS, sameSite: "strict" });
}

export async function getSession() {
	const store = await cookies();
	return verifySession(store.get(SESSION_COOKIE)?.value);
}

// Server actions run outside proxy.js matching rules, so they re-check the session themselves.
export async function requireSession() {
	const session = await getSession();
	if (!session) redirect("/login");
	return session;
}
