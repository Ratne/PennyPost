import assert from "node:assert/strict";
import { test } from "node:test";
import { maskSecret, openSecret, sealSecret } from "../lib/secret-box.js";

const secret = "s".repeat(40);
const name = "EMAILABLE_API_KEY";

test("a sealed secret opens with the same secret and name", async () => {
	const sealed = await sealSecret("live_abcdefghijklmnop", { secret, name });
	assert.match(sealed, /^v1:[^:]+:[^:]+$/);
	assert.ok(!sealed.includes("abcdefghijklmnop"));
	assert.equal(await openSecret(sealed, { secret, name }), "live_abcdefghijklmnop");
});

test("sealing twice gives different ciphertexts", async () => {
	assert.notEqual(await sealSecret("same", { secret, name }), await sealSecret("same", { secret, name }));
});

test("another SESSION_SECRET, another setting name or a tampered value can't open it", async () => {
	const sealed = await sealSecret("live_abcdefghijklmnop", { secret, name });
	assert.equal(await openSecret(sealed, { secret: "t".repeat(40), name }), null);
	assert.equal(await openSecret(sealed, { secret, name: "OTHER_SETTING" }), null);
	const [version, iv, ciphertext] = sealed.split(":");
	const flipped = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1);
	assert.equal(await openSecret(`${version}:${iv}:${flipped}`, { secret, name }), null);
	assert.equal(await openSecret("v2:abc:def", { secret, name }), null);
	assert.equal(await openSecret(null, { secret, name }), null);
});

test("sealing without SESSION_SECRET fails loudly", async () => {
	await assert.rejects(sealSecret("x", { secret: "", name }));
});

test("masks show only the last 4 characters", () => {
	assert.equal(maskSecret("live_abcdefghijklmnop"), "••••mnop");
	assert.equal(maskSecret(""), "");
	assert.equal(maskSecret(null), "");
});
