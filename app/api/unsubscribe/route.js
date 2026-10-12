import { NextResponse } from "next/server";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { forContacts, logActivities } from "@/lib/contact-activity";
import { all, first, run } from "@/server/db";

const NO_STORE = { "Cache-Control": "no-store" };
const RECENT_CAMPAIGNS = 5;
// Gmail and Yahoo send one-click requests from shared mail servers, so keep this generous.
const RATE_LIMIT = { name: "unsubscribe", limit: 60, window: "1 m" };

// Links don't carry the campaign, so the unsubscribe counts for the latest campaign sent to them.
async function creditLatestCampaign({ contactId, newsletterId }) {
	const latest = await first(
		`SELECT m.campaign_id FROM messages m
		 WHERE m.kind = 'campaign' AND m.contact_id = ? AND m.sent_at IS NOT NULL
		   AND m.campaign_id IN (SELECT id FROM campaigns WHERE newsletter_id = ? AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT ?)
		 ORDER BY m.sent_at DESC LIMIT 1`,
		[contactId, newsletterId, RECENT_CAMPAIGNS]
	);
	if (latest) await run("UPDATE campaigns SET stats_unsubscribed = stats_unsubscribed + 1 WHERE id = ?", [latest.campaign_id]);
	return latest?.campaign_id ?? null;
}

async function unsubscribe({ contactId, newsletterId }, source) {
	// Bounced and complained contacts stay as they are: those statuses also block sending.
	const now = Date.now();
	const changed = await all(
		`UPDATE contacts SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ?
		 WHERE id = ? AND newsletter_id = ? AND status IN ('active', 'dormant') RETURNING id, email, newsletter_id`,
		[now, now, contactId, newsletterId]
	);
	if (!changed.length) return;

	console.log(`[unsubscribe] Contact ${contactId} unsubscribed from newsletter ${newsletterId}`);
	const campaignId = await creditLatestCampaign({ contactId, newsletterId }).catch((error) => {
		console.error("[unsubscribe] Could not credit the campaign:", error.message);
		return null;
	});
	await logActivities(forContacts(changed, { type: "unsubscribed", campaignId, occurredAt: now, data: { source } }));
}

function redirectToPage(request, params) {
	const url = new URL("/unsubscribe", request.url);
	for (const [key, value] of Object.entries(params)) {
		if (value) url.searchParams.set(key, value);
	}
	const response = NextResponse.redirect(url, 303);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

// Some mail apps open the List-Unsubscribe URL in a browser: never change anything on GET.
export function GET(request) {
	return redirectToPage(request, { token: new URL(request.url).searchParams.get("token") });
}

// RFC 8058 one-click endpoint. The confirmation page form posts here too, with source=page.
export async function POST(request) {
	const token = new URL(request.url).searchParams.get("token");
	const form = await request.formData().catch(() => null);
	const isPageForm = form?.get("source") === "page";

	function respond(status, pageStatus) {
		if (!isPageForm) return new NextResponse(null, { status, headers: NO_STORE });
		return redirectToPage(request, {
			token: pageStatus === "invalid" ? null : token,
			status: pageStatus,
		});
	}

	if (await isRateLimited({ ...RATE_LIMIT, key: getClientIp(request.headers) })) return respond(429, "error");

	const reference = verifyUnsubscribeToken(token);
	if (!reference) return respond(400, "invalid");

	try {
		await unsubscribe(reference, isPageForm ? "unsubscribe_page" : "one_click");
		return respond(200, "done");
	} catch (error) {
		console.error("[unsubscribe] Failed:", error);
		return respond(500, "error");
	}
}
