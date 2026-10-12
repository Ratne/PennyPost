import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTING_NAMES, validateEmailableKey, validateSettings } from "../lib/setting-rules.js";

test("empty settings fall back to the environment", () => {
	const { values, error } = validateSettings({});
	assert.equal(error, undefined);
	assert.deepEqual(Object.keys(values), SETTING_NAMES);
	assert.ok(Object.values(values).every((value) => value === ""));
});

test("valid settings are trimmed and kept", () => {
	const { values } = validateSettings({
		SENDING_ENABLED: "true",
		SES_REGION: " eu-west-1 ",
		SES_CONFIGURATION_SET: "newsletter_events-1",
		SEND_RATE_PER_SECOND: "05",
		ALERT_FROM: "Newsletter <alerts@mail.example.com>",
	});
	assert.deepEqual(values, {
		SENDING_ENABLED: "true",
		SES_REGION: "eu-west-1",
		SES_CONFIGURATION_SET: "newsletter_events-1",
		SEND_RATE_PER_SECOND: "5",
		ALERT_FROM: "Newsletter <alerts@mail.example.com>",
	});
});

test("settings outside their rules are refused", () => {
	for (const input of [
		{ SENDING_ENABLED: "yes" },
		{ SES_REGION: "Europe" },
		{ SES_CONFIGURATION_SET: "has spaces" },
		{ SEND_RATE_PER_SECOND: "0" },
		{ SEND_RATE_PER_SECOND: "15" },
		{ SEND_RATE_PER_SECOND: "2.5" },
		{ ALERT_FROM: "not an address" },
		{ ALERT_FROM: "Alerts <alerts@mail.example.com>\r\nBcc: someone@example.com" },
	]) {
		assert.ok(validateSettings(input).error, JSON.stringify(input));
	}
});

test("Emailable keys are checked for shape only", () => {
	assert.deepEqual(validateEmailableKey("  live_abcdefghijklmnop  "), { key: "live_abcdefghijklmnop" });
	assert.ok(validateEmailableKey("short").error);
	assert.ok(validateEmailableKey("live key with spaces here").error);
	assert.ok(validateEmailableKey(undefined).error);
});
