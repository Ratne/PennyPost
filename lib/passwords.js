// PBKDF2 through WebCrypto, which Workers run natively. Workers cap PBKDF2 at 100,000 iterations.
export const PASSWORD_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const encoder = new TextEncoder();

function toBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text) {
	return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

async function derive(password, salt, iterations) {
	const material = await crypto.subtle.importKey("raw", encoder.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, HASH_BITS);
	return new Uint8Array(bits);
}

export function equalBytes(a, b) {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
	return difference === 0;
}

// "pbkdf2-sha256$100000$<salt>$<hash>", base64.
export async function hashPassword(password, iterations = PASSWORD_ITERATIONS) {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(await derive(password, salt, iterations))}`;
}

export async function verifyPassword(password, stored) {
	const [scheme, iterations, salt, hash] = String(stored ?? "").split("$");
	const count = Number(iterations);
	if (scheme !== "pbkdf2-sha256" || !Number.isInteger(count) || count < 1 || count > PASSWORD_ITERATIONS || !salt || !hash) return false;
	try {
		return equalBytes(await derive(password, fromBase64(salt), count), fromBase64(hash));
	} catch {
		return false;
	}
}

// Checked against when the email matches no admin, so a wrong email takes as long as a wrong password.
export const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export function getPasswordProblem(password) {
	const text = String(password ?? "");
	if (text.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
	if (text.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
	return null;
}

export const LOGIN_CODE_LENGTH = 6;
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_LOGIN_CODE_ATTEMPTS = 3;

// Uniform over 000000–999999: values past the last whole million are drawn again.
export function generateLoginCode() {
	const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
	const buffer = new Uint32Array(1);
	do crypto.getRandomValues(buffer);
	while (buffer[0] >= limit);
	return String(buffer[0] % 1_000_000).padStart(LOGIN_CODE_LENGTH, "0");
}

export function normalizeLoginCode(value) {
	const digits = String(value ?? "").replace(/\D/g, "");
	return digits.length === LOGIN_CODE_LENGTH ? digits : null;
}

// Keyed with the challenge id, so a leaked table can't be checked against the million codes at once.
export async function hashLoginCode(code, challengeId, secret) {
	const key = await crypto.subtle.importKey("raw", encoder.encode(`${secret}\nmail-newsletter-login-code-v1`), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${challengeId}\n${code}`));
	return toBase64(new Uint8Array(signature));
}

export async function isLoginCodeMatch(code, challengeId, secret, storedHash) {
	return equalBytes(fromBase64(await hashLoginCode(code, challengeId, secret)), fromBase64(storedHash));
}
