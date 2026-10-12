import assert from "node:assert/strict";
import { test } from "node:test";
import { VERIFICATION_CACHE_DAYS, interpretVerification, readCachedVerification } from "../lib/emailable-rules.js";

const DAY = 24 * 60 * 60 * 1000;

test("only undeliverable and disposable addresses are refused", () => {
	assert.equal(interpretVerification({ state: "deliverable" }).isAccepted, true);
	assert.equal(interpretVerification({ state: "risky", reason: "accept_all" }).isAccepted, true);
	assert.equal(interpretVerification({ state: "unknown", reason: "timeout" }).isAccepted, true);
	assert.equal(interpretVerification({ state: "undeliverable", reason: "rejected_email" }).isAccepted, false);
	const disposable = interpretVerification({ state: "deliverable", disposable: true });
	assert.equal(disposable.isAccepted, false);
	assert.equal(disposable.reason, "disposable");
});

test("odd answers count as unknown and go through", () => {
	assert.deepEqual(interpretVerification({}), { state: "unknown", reason: null, didYouMean: null, isAccepted: true });
	assert.equal(interpretVerification(null).isAccepted, true);
	assert.equal(interpretVerification({ state: "weird" }).state, "unknown");
});

test("suggestions are kept only when they're addresses", () => {
	assert.equal(interpretVerification({ state: "undeliverable", did_you_mean: "Jane@Gmail.com" }).didYouMean, "jane@gmail.com");
	assert.equal(interpretVerification({ state: "undeliverable", did_you_mean: "gmail.com" }).didYouMean, null);
});

test("a saved check is reused for 30 days", () => {
	const now = Date.UTC(2026, 9, 10);
	const person = (state, reason, ageDays) => ({ verification: { state, reason, verifiedAt: new Date(now - ageDays * DAY) } });

	assert.deepEqual(readCachedVerification(person("deliverable", null, 1), now), {
		state: "deliverable",
		reason: null,
		didYouMean: null,
		isAccepted: true,
		isCached: true,
	});
	assert.equal(readCachedVerification(person("undeliverable", "rejected_email", 1), now).isAccepted, false);
	assert.equal(readCachedVerification(person("deliverable", "disposable", 1), now).isAccepted, false);
	assert.equal(readCachedVerification(person("deliverable", null, VERIFICATION_CACHE_DAYS + 1), now), null);
	assert.equal(readCachedVerification({ verification: { state: "deliverable" } }, now), null);
	assert.equal(readCachedVerification(null, now), null);
});
