export const APP_NAME = "Penny Post";
export const MIN_SESSION_SECRET_LENGTH = 32;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

// SESSION_SECRET signs sessions and every email link, so a short one keeps the server from starting
// and the dashboard from logging in. ADMIN_EMAIL and ADMIN_PASSWORD only create the first admin.
export function getConfigProblems(env = process.env) {
	const problems = [];
	if ((env.SESSION_SECRET ?? "").length < MIN_SESSION_SECRET_LENGTH) {
		problems.push(
			`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters (generate one with: openssl rand -base64 48).`
		);
	}
	if (env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH) {
		problems.push(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
	}
	return problems;
}

// Settings saved in the dashboard (lib/settings.ts loads them) win over the environment variables
// of the same name. Kept on globalThis: the proxy, pages and queue handlers can load separate copies
// of this module in the same Worker.
const OVERRIDES = Symbol.for("mail-newsletter.setting-overrides");

export function setSettingOverrides(values) {
	globalThis[OVERRIDES] = { ...values };
}

export function readSetting(name) {
	const value = globalThis[OVERRIDES]?.[name];
	if (value !== undefined && value !== null && value !== "") return value;
	return typeof process === "undefined" ? undefined : process.env[name];
}

export function isSendingEnabled() {
	return readSetting("SENDING_ENABLED") === "true";
}

export function getSesRegion() {
	return readSetting("SES_REGION") || "us-east-1";
}

export function getAppUrl() {
	return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

export const MAX_SEND_RATE_PER_SECOND = 14;
export const DEFAULT_SEND_RATE_PER_SECOND = 10;

// New SES accounts in production start at 14 emails/s, shared with welcome emails.
export function readSendRate(value = readSetting("SEND_RATE_PER_SECOND")) {
	const rate = Number.parseInt(value, 10);
	return Number.isInteger(rate) && rate >= 1 && rate <= MAX_SEND_RATE_PER_SECOND ? rate : DEFAULT_SEND_RATE_PER_SECOND;
}

// SES reviews an account at 5% bounces or 0.1% complaints; pause well before that.
export const LIMITS = {
	bounceRate: 0.02,
	complaintRate: 0.0008,
	maxEmailBytes: 100_000,
	get sendRatePerSecond() {
		return readSendRate();
	},
	welcomeEmailsPer10Minutes: 100,
};
