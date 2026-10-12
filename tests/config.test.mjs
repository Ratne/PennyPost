import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, getConfigProblems, isSendingEnabled, readSendRate, setSettingOverrides } from "../lib/config.js";
import { register } from "../instrumentation.js";

const STRONG = { SESSION_SECRET: "s".repeat(32), ADMIN_PASSWORD: "p".repeat(12) };

test("SESSION_SECRET needs 32 characters and ADMIN_PASSWORD 12", () => {
	assert.deepEqual(getConfigProblems(STRONG), []);
	assert.match(getConfigProblems({ ...STRONG, SESSION_SECRET: "s".repeat(31) }).join(), /SESSION_SECRET must be at least 32/);
	assert.match(getConfigProblems({ ...STRONG, ADMIN_PASSWORD: "p".repeat(11) }).join(), /ADMIN_PASSWORD must be at least 12/);
	assert.equal(getConfigProblems({}).length, 1, "a missing secret counts as too short");
	assert.deepEqual(getConfigProblems({ SESSION_SECRET: "s".repeat(32) }), [], "the first admin can come from the database");
});

test("dashboard settings win over the environment, and empty ones fall back to it", () => {
	const previous = { ...process.env };
	try {
		process.env.SENDING_ENABLED = "true";
		process.env.SEND_RATE_PER_SECOND = "12";
		setSettingOverrides({});
		assert.equal(isSendingEnabled(), true);
		assert.equal(LIMITS.sendRatePerSecond, 12);
		setSettingOverrides({ SENDING_ENABLED: "false", SEND_RATE_PER_SECOND: "4" });
		assert.equal(isSendingEnabled(), false);
		assert.equal(LIMITS.sendRatePerSecond, 4);
		setSettingOverrides({ SENDING_ENABLED: "", SEND_RATE_PER_SECOND: "40" });
		assert.equal(isSendingEnabled(), true);
		assert.equal(LIMITS.sendRatePerSecond, 10, "out of range falls back to the default");
		assert.equal(readSendRate("14"), 14);
	} finally {
		setSettingOverrides({});
		process.env = previous;
	}
});

test("the server doesn't start with a short secret or seed password", () => {
	const previous = { ...process.env };
	try {
		Object.assign(process.env, STRONG);
		assert.doesNotThrow(register);
		process.env.ADMIN_PASSWORD = "short";
		assert.throws(register, /The newsletter app can't start\. ADMIN_PASSWORD must be at least 12 characters/);
		Object.assign(process.env, STRONG, { SESSION_SECRET: "short" });
		assert.throws(register, /SESSION_SECRET must be at least 32 characters/);
	} finally {
		process.env = previous;
	}
});
