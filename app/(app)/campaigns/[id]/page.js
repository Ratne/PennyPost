import { notFound } from "next/navigation";
import CampaignReport from "@/components/CampaignReport";
import FormCampaign from "@/components/FormCampaign";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { requireSession } from "@/lib/auth";
import { listSendTimes } from "@/lib/campaign-queries";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { MESSAGE_STATS_SQL } from "@/lib/overview-data";
import { countSegment, describeSegments, listSegments } from "@/lib/segment-store";
import { countAudience, getCampaign, getNewsletter } from "@/lib/sending";
import { serialize } from "@/lib/serialize";
import { listSesDomains } from "@/lib/ses";
import { isObjectIdString } from "@/lib/validation";
import { all } from "@/server/db";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }) {
	const { id } = await params;
	if (!isObjectIdString(id)) notFound();

	const campaign = await getCampaign(id);
	if (!campaign) notFound();
	const newsletter = await getNewsletter(campaign.newsletterId);
	if (!newsletter) notFound();

	if (!["draft", "scheduled"].includes(campaign.status)) {
		const [providers, remainingCount] = await Promise.all([
			getProviderBreakdown(campaign._id),
			countRemaining(campaign),
		]);
		return (
			<CampaignReport
				campaign={serialize(campaign)}
				newsletter={serialize(newsletter)}
				providers={providers}
				remainingCount={remainingCount}
				appUrl={getAppUrl()}
			/>
		);
	}

	const [audienceCount, everyoneCount, domains, sendTimes, segments] = await Promise.all([
		countAudience(campaign),
		countAudience({ newsletterId: newsletter._id }),
		listSesDomains(),
		getSendTimes(campaign),
		getSegmentOptions(newsletter._id),
	]);
	const fromDomain = newsletter.fromEmail.split("@")[1];
	const isDomainVerified =
		Array.isArray(domains) && domains.some(({ domain, verified }) => domain === fromDomain && verified);

	return (
		<FormCampaign
			campaign={serialize(campaign)}
			newsletter={serialize(newsletter)}
			audienceCount={audienceCount}
			everyoneCount={everyoneCount}
			segments={segments}
			isDomainVerified={isDomainVerified}
			isSendingEnabled={isSendingEnabled()}
			testEmail={(await requireSession()).email}
			sendTimes={sendTimes}
			archiveUrlBase={newsletter.archiveEnabled ? getArchiveUrls(newsletter).absolutePost("") : null}
			appUrl={getAppUrl()}
		/>
	);
}

// Each segment with how many contacts a send to it would reach right now.
async function getSegmentOptions(newsletterId) {
	const segments = await describeSegments(await listSegments(newsletterId));
	return Promise.all(
		segments.map(async ({ _id, name, summary, rules }) => ({
			id: _id,
			name,
			summary,
			reachable: (await countSegment(newsletterId, rules)).reachable,
		}))
	);
}

// A newsletter's first issue borrows the times the other newsletters go out.
async function getSendTimes(campaign) {
	const own = await listSendTimes({ newsletterId: campaign.newsletterId, excludeId: campaign._id });
	const rows = own.length > 0 ? own : await listSendTimes({ excludeId: campaign._id });
	return {
		history: rows.map(({ at }) => at.toISOString()),
		taken: own.filter(({ status }) => status === "scheduled").map(({ at }) => at.toISOString()),
	};
}

// Only a send capped to the most engaged has a next step. Close enough for the dialog: contacts who
// left after receiving it make this a little low, and the send itself skips everyone who has it.
async function countRemaining(campaign) {
	if (campaign.status !== "sent" || !campaign.audienceLimit) return 0;
	const audience = await countAudience(campaign);
	const reached = (campaign.stats?.recipients ?? 0) + (campaign.lastChance?.recipients ?? 0);
	return Math.max(0, audience - reached);
}

async function getProviderBreakdown(campaignId) {
	const rows = await all(
		`SELECT COALESCE(provider, 'other') AS provider, ${MESSAGE_STATS_SQL} FROM messages
		 WHERE campaign_id = ? AND kind = 'campaign' GROUP BY COALESCE(provider, 'other') ORDER BY sent DESC`,
		[campaignId]
	);
	return rows.filter(({ sent }) => sent > 0);
}
