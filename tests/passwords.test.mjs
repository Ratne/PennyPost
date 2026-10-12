import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DUMMY_PASSWORD_HASH,
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	PASSWORD_ITERATIONS,
	generateLoginCode,
	getPasswordProblem,
	hashLoginCode,
	hashPassword,
	isLoginCodeMatch,
	normalizeLoginCode,
	verifyPassword,
} from "../lib/passwords.js";

test("a hashed password verifies, a different one doesn't", async () => {
	const stored = await hashPassword("correct horse battery");
	assert.match(stored, new RegExp(`^pbkdf2-sha256\\$${PASSWORD_ITERATIONS}\\$[^$]+\\$[^$]+$`));
	assert.equal(await verifyPassword("correct horse battery", stored), true);
	assert.equal(await verifyPassword("correct horse batterY", stored), false);
});

test("the same password hashes differently each time", async () => {
	assert.notEqual(await hashPassword("same password here"), await hashPassword("same password here"));
});

test("malformed or out-of-range hashes never verify", async () => {
	for (const stored of [null, "", "plain", "bcrypt$10$abc$def", "pbkdf2-sha256$0$AAAA$AAAA", `pbkdf2-sha256$${PASSWORD_ITERATIONS + 1}$AAAA$AAAA`, "pbkdf2-sha256$1000$!!$!!"]) {
		assert.equal(await verifyPassword("anything at all", stored), false, String(stored));
	}
});

test("the dummy hash is well formed and matches nothing", async () => {
	assert.equal(await verifyPassword("", DUMMY_PASSWORD_HASH), false);
	assert.equal(await verifyPassword("a long enough password", DUMMY_PASSWORD_HASH), false);
});

test("passwords need 12 to 200 characters", () => {
	assert.ok(getPasswordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1)));
	assert.equal(getPasswordProblem("a".repeat(MIN_PASSWORD_LENGTH)), null);
	assert.equal(getPasswordProblem("a".repeat(MAX_PASSWORD_LENGTH)), null);
	assert.ok(getPasswordProblem("a".repeat(MAX_PASSWORD_LENGTH + 1)));
	assert.ok(getPasswordProblem(undefined));
});

test("login codes are 6 digits, leading zeros included", () => {
	for (let index = 0; index < 200; index++) assert.match(generateLoginCode(), /^\d{6}$/);
});

test("typed codes keep their digits only, and must have exactly 6", () => {
	assert.equal(normalizeLoginCode(" 012 345 "), "012345");
	assert.equal(normalizeLoginCode("012-345"), "012345");
	assert.equal(normalizeLoginCode("12345"), null);
	assert.equal(normalizeLoginCode("1234567"), null);
	assert.equal(normalizeLoginCode(null), null);
});

test("a code's hash depends on the challenge and the secret", async () => {
	const secret = "s".repeat(40);
	const stored = await hashLoginCode("123456", "challenge-a", secret);
	assert.equal(await isLoginCodeMatch("123456", "challenge-a", secret, stored), true);
	assert.equal(await isLoginCodeMatch("123457", "challenge-a", secret, stored), false);
	assert.equal(await isLoginCodeMatch("123456", "challenge-b", secret, stored), false);
	assert.equal(await isLoginCodeMatch("123456", "challenge-a", "t".repeat(40), stored), false);
});
