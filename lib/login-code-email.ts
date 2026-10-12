import { APP_NAME, isSendingEnabled, readSetting } from "@/lib/config";
import { sendSesEmail } from "@/lib/ses";
import { first } from "@/server/db";

function escapeHtml(value: string) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// From ALERT_FROM, or else the first newsletter's sender: both are on a domain SES has verified.
async function getSender() {
	const alertFrom = readSetting("ALERT_FROM");
	if (alertFrom) return alertFrom;
	const newsletter = await first<{ from_email: string }>("SELECT from_email FROM newsletters ORDER BY created_at ASC LIMIT 1");
	return newsletter?.from_email ? `${APP_NAME} <${newsletter.from_email}>` : null;
}

// While sending is off (local dev, or before SES is set up), the code goes to the Worker logs
// instead: only people with access to the Cloudflare account can read them.
export async function sendLoginCode({ to, code, ip }: { to: string; code: string; ip: string }) {
	if (!isSendingEnabled()) {
		console.info(`[login] Sending is off, so the code isn't emailed. Code for ${to}: ${code}`);
		return { ok: true };
	}
	const from = await getSender();
	if (!from) {
		console.info(`[login] No sender for login codes (set ALERT_FROM). Code for ${to}: ${code}`);
		return { ok: true };
	}
	const text = `Your ${APP_NAME} login code is ${code}\n\nIt works once, for 10 minutes. If you didn't just enter your password (from IP ${ip}), change it: someone knows it.`;
	await sendSesEmail({
		from,
		to,
		subject: `${code} is your ${APP_NAME} login code`,
		text,
		html: `<div style="font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#27272a;max-width:28rem">
<p>Your ${escapeHtml(APP_NAME)} login code:</p>
<p style="font:600 28px/1.2 ui-monospace,Menlo,monospace;letter-spacing:0.2em;margin:16px 0">${code}</p>
<p style="color:#71717a;font-size:14px">It works once, for 10 minutes. If you didn't just enter your password (from IP ${escapeHtml(ip)}), change it: someone knows it.</p>
</div>`,
	});
	return { ok: true };
}
