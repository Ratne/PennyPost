import { headers } from "next/headers";
import { formatActivity } from "@/lib/activity";
import { after } from "@/lib/background";
import { listAdminEmails } from "@/lib/admins";
import { getAppUrl, isSendingEnabled, readSetting } from "@/lib/config";
import { getClientIp } from "@/lib/rate-limit";
import { sendSesEmail } from "@/lib/ses";
import { run } from "@/server/db";

const DEFAULT_COOLDOWN_MINUTES = 60;

function escapeHtml(value: string) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Optional: needs ALERT_FROM on a verified domain, and goes out only while sending is on. One email
// per admin, so no admin sees the others' addresses.
async function sendEmail({ title, text }: { title: string; text: string }) {
	const from = readSetting("ALERT_FROM");
	if (!from || !isSendingEnabled()) return;
	for (const to of await listAdminEmails()) {
		await sendSesEmail({
			from,
			to,
			subject: `[Newsletter] ${title}`,
			text,
			html: `<pre style="font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
		}).catch((error: any) => console.error(`[alert] Not sent to ${to}:`, error?.message));
	}
}

// One statement: inserts the key, or takes it over only once the cooldown is over.
async function claimAlert({ key, title, cooldownMinutes }: { key: string; title: string; cooldownMinutes: number }) {
	const now = Date.now();
	const cutoff = now - cooldownMinutes * 60_000;
	const { changes } = await run(
		`INSERT INTO alerts (key, title, last_sent_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET title = excluded.title, last_sent_at = excluded.last_sent_at, updated_at = excluded.last_sent_at
		 WHERE alerts.last_sent_at IS NULL OR alerts.last_sent_at < ?`,
		[key, title, now, cutoff]
	);
	return changes > 0;
}

// Never throws: a failing alert must not break a send or a webhook. Always logged; emailed to the
// admins at most once per cooldown.
export async function sendAlert({
	key,
	title,
	detail,
	path = "",
	cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
}: {
	key: string;
	title: string;
	detail: string;
	path?: string;
	cooldownMinutes?: number;
}) {
	console.warn(`[alert] ${title}: ${detail}`);
	try {
		if (!(await claimAlert({ key, title, cooldownMinutes }))) return;
		await sendEmail({ title, text: `${title}\n${detail}\n${getAppUrl()}${path}` });
	} catch (error: any) {
		console.error("[alert] Could not send:", error?.message);
	}
}

// Logins, new API keys and sends, every time: logged, and emailed like other alerts. It goes out after
// the response, so a failing alert never holds up or blocks the action.
export async function notifyActivity(lines: string[], { withUserAgent = false } = {}) {
	try {
		const list = await headers();
		const text = formatActivity(lines, {
			ip: getClientIp(list),
			country: list.get("cf-ipcountry"),
			userAgent: withUserAgent ? (list.get("user-agent") ?? "") : undefined,
		});
		after(async () => {
			console.info(`[activity] ${text.replaceAll("\n", " | ")}`);
			await sendEmail({ title: lines[0], text });
		});
	} catch (error: any) {
		console.error("[alert] Activity notice failed:", error?.message);
	}
}
