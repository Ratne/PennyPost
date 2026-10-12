import { AwsClient } from "aws4fetch";
import { getSesRegion, isSendingEnabled, readSetting } from "@/lib/config";
import { buildSendEmailBody, getSesEndpoint, toSesError } from "@/lib/ses-request";

// The overview and the editor read the account and domains from here; the domains page asks fresh.
const CACHE_TTL_MS = 5 * 60_000;
// Reads only: a send that timed out could still have gone out, so sends are never retried here.
const READ_TIMEOUT_MS = 5000;
const SEND_TIMEOUT_MS = 15_000;
const cache = new Map<string, { promise: Promise<any>; expiresAt: number }>();
let client: { region: string; aws: AwsClient } | undefined;

// The region can change in Settings, so the client is rebuilt when it does.
function getClient(region: string) {
	const { SES_ACCESS_KEY_ID: accessKeyId, SES_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
	if (!accessKeyId || !secretAccessKey) throw new Error("SES is not configured (SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY)");
	if (client?.region !== region) {
		client = { region, aws: new AwsClient({ accessKeyId, secretAccessKey, service: "ses", region, retries: 0 }) };
	}
	return client.aws;
}

async function request(path: string, { method = "GET", body, timeoutMs }: { method?: string; body?: unknown; timeoutMs: number }) {
	const region = getSesRegion();
	const response = await getClient(region).fetch(`${getSesEndpoint(region)}${path}`, {
		method,
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await response.text();
	if (!response.ok) {
		throw toSesError({ status: response.status, errorType: response.headers.get("x-amzn-errortype"), body: text });
	}
	return text ? JSON.parse(text) : {};
}

const read = (path: string) => request(path, { timeoutMs: READ_TIMEOUT_MS });

// Callers that arrive while a load is running share it. Errors aren't kept.
async function cached(key: string, { fresh }: { fresh: boolean }, load: () => Promise<any>) {
	const hit = cache.get(key);
	if (!fresh && hit && hit.expiresAt > Date.now()) return hit.promise;
	const entry = { promise: load(), expiresAt: Date.now() + CACHE_TTL_MS };
	cache.set(key, entry);
	const value = await entry.promise;
	if (value?.error && cache.get(key) === entry) cache.delete(key);
	return value;
}

export function getSesAccount({ fresh = false } = {}) {
	return cached("account", { fresh }, loadSesAccount);
}

export function listSesDomains({ fresh = false } = {}) {
	return cached("domains", { fresh }, loadSesDomains);
}

async function loadSesAccount() {
	try {
		const account = await read("/v2/email/account");
		return {
			productionAccess: Boolean(account.ProductionAccessEnabled),
			reviewStatus: account.Details?.ReviewDetails?.Status || null,
			sendingEnabled: Boolean(account.SendingEnabled),
			enforcementStatus: account.EnforcementStatus,
			max24HourSend: account.SendQuota?.Max24HourSend ?? 0,
			maxSendRate: account.SendQuota?.MaxSendRate ?? 0,
			sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
		};
	} catch (error: any) {
		return { error: error.message };
	}
}

function dnsRecords(domain: string, identity: any) {
	const dkim = (identity.DkimAttributes?.Tokens || []).map((token: string) => ({
		type: "CNAME",
		name: `${token}._domainkey.${domain}`,
		value: `${token}.dkim.amazonses.com`,
	}));
	const mailFrom = identity.MailFromAttributes?.MailFromDomain;
	const bounce = mailFrom
		? [
				{ type: "MX", name: mailFrom, value: `10 feedback-smtp.${getSesRegion()}.amazonses.com` },
				{ type: "TXT", name: mailFrom, value: "v=spf1 include:amazonses.com ~all" },
			]
		: [];
	return [...dkim, ...bounce];
}

async function loadSesDomains() {
	try {
		const { EmailIdentities = [] } = await read("/v2/email/identities?PageSize=100");
		const domains = EmailIdentities.filter((identity: any) => identity.IdentityType === "DOMAIN");
		return await Promise.all(
			domains.map(async ({ IdentityName: domain }: { IdentityName: string }) => {
				const identity = await read(`/v2/email/identities/${encodeURIComponent(domain)}`);
				return {
					domain,
					verified: Boolean(identity.VerifiedForSendingStatus),
					dkimStatus: identity.DkimAttributes?.Status || "NOT_STARTED",
					mailFromDomain: identity.MailFromAttributes?.MailFromDomain || null,
					mailFromStatus: identity.MailFromAttributes?.MailFromDomainStatus || null,
					records: dnsRecords(domain, identity),
				};
			})
		);
	} catch (error: any) {
		return { error: error.message };
	}
}

export async function sendSesEmail(email: {
	from: string;
	to: string;
	replyTo?: string;
	subject: string;
	html: string;
	text?: string;
	headers?: Record<string, string>;
	tags?: { name: string; value: string }[];
}) {
	if (!isSendingEnabled()) throw new Error("Sending is off (SENDING_ENABLED is not true)");
	const body = buildSendEmailBody({ ...email, configurationSet: readSetting("SES_CONFIGURATION_SET") } as any);
	const result = await request("/v2/email/outbound-emails", { method: "POST", body, timeoutMs: SEND_TIMEOUT_MS });
	return { sesMessageId: result.MessageId as string };
}
