import { MAX_SEND_RATE_PER_SECOND } from "./config.js";
import { normalizeAddress } from "./validation.js";

// Operational settings that can live in the database. Secrets (SESSION_SECRET, the SES keys, the SNS
// topic) stay in Cloudflare secrets: a database export must never be enough to send as you.
export const SETTING_FIELDS = [
	{ name: "SENDING_ENABLED", label: "Sending", kind: "boolean" },
	{ name: "SES_REGION", label: "SES region", kind: "text", placeholder: "us-east-1" },
	{ name: "SES_CONFIGURATION_SET", label: "Configuration set", kind: "text", placeholder: "newsletter" },
	{ name: "SEND_RATE_PER_SECOND", label: "Send rate", kind: "number", placeholder: "10" },
	{ name: "ALERT_FROM", label: "Alerts from", kind: "text", placeholder: "Newsletter <alerts@mail.example.com>" },
];

export const SETTING_NAMES = SETTING_FIELDS.map(({ name }) => name);
export const EMAILABLE_KEY_SETTING = "EMAILABLE_API_KEY";

const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;
const CONFIGURATION_SET_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EMAILABLE_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// Empty means "use the environment variable". Returns the values to save, or the first problem.
export function validateSettings(input) {
	const values = {};
	for (const { name } of SETTING_FIELDS) {
		const raw = input?.[name];
		const text = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw).trim();
		values[name] = text;
	}

	if (values.SENDING_ENABLED && !["true", "false"].includes(values.SENDING_ENABLED)) return { error: "Sending must be on or off" };
	if (values.SES_REGION && !REGION_PATTERN.test(values.SES_REGION)) return { error: "SES region should look like eu-west-1" };
	if (values.SES_CONFIGURATION_SET && !CONFIGURATION_SET_PATTERN.test(values.SES_CONFIGURATION_SET)) {
		return { error: "Configuration set names use letters, numbers, dashes and underscores (64 at most)" };
	}
	if (values.SEND_RATE_PER_SECOND) {
		const rate = Number(values.SEND_RATE_PER_SECOND);
		if (!Number.isInteger(rate) || rate < 1 || rate > MAX_SEND_RATE_PER_SECOND) {
			return { error: `Send rate should be a whole number from 1 to ${MAX_SEND_RATE_PER_SECOND}` };
		}
		values.SEND_RATE_PER_SECOND = String(rate);
	}
	if (values.ALERT_FROM && (!normalizeAddress(values.ALERT_FROM) || /[\r\n]/.test(values.ALERT_FROM) || values.ALERT_FROM.length > 200)) {
		return { error: "Alerts from should be an address, like Newsletter <alerts@mail.example.com>" };
	}
	return { values };
}

export function validateEmailableKey(value) {
	const key = String(value ?? "").trim();
	if (!EMAILABLE_KEY_PATTERN.test(key)) return { error: "That doesn't look like an Emailable API key" };
	return { key };
}
