import { revalidatePath } from "next/cache";
import { cache } from "react";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { ARCHIVE_SLUG_PATTERN } from "@/lib/slug";
import { all, first, placeholders, toCampaign, toNewsletter } from "@/server/db";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const PUBLISHED_STATUSES = ["sending", "paused", "sent"];
const LISTED_FILTER = `archive_slug IS NOT NULL AND archive_listed = 1 AND status IN (${placeholders(PUBLISHED_STATUSES.length)})`;
const CARD_COLUMNS =
	"id, newsletter_id, status, subject, preview_text, archive_slug, archive_pinned, archive_listed, sent_at, started_at, thumbnail_url, web_views";

function card(row: any) {
	const campaign = toCampaign(row)!;
	return {
		_id: campaign._id,
		subject: campaign.subject,
		previewText: campaign.previewText,
		archiveSlug: campaign.archiveSlug,
		archivePinned: campaign.archivePinned,
		sentAt: campaign.sentAt,
		startedAt: campaign.startedAt,
		thumbnailUrl: campaign.thumbnailUrl,
		webViews: campaign.webViews,
		...(row.format !== undefined && {
			format: campaign.format,
			markdown: campaign.markdown,
			html: campaign.html,
			source: campaign.source,
		}),
	};
}

// Only what public pages show: the from address and settings stay out of the page payload.
export const getArchiveNewsletter = cache(async (slug: string) => {
	if (!SLUG_PATTERN.test(slug)) return null;
	const newsletter = toNewsletter(await first("SELECT * FROM newsletters WHERE slug = ? AND archive_enabled = 1", [slug]));
	if (!newsletter) return null;
	const { _id, name, imageUrl, fromName, description, socialLinks, author, archiveEnabled } = newsletter;
	return { _id, name, slug: newsletter.slug, imageUrl, fromName, description, socialLinks, author, archiveEnabled };
});

// A picture several listed issues share is the newsletter's banner, not the issue's own. Those issues
// get a generated card instead, so the archive doesn't repeat one image on every card. Unlisted
// issues don't count.
const getSharedThumbnails = cache(async (newsletterId: string) => {
	const rows = await all<{ thumbnail_url: string }>(
		`SELECT thumbnail_url FROM campaigns WHERE newsletter_id = ? AND thumbnail_url IS NOT NULL AND ${LISTED_FILTER}
		 GROUP BY thumbnail_url HAVING COUNT(*) > 1`,
		[newsletterId, ...PUBLISHED_STATUSES]
	);
	return new Set(rows.map(({ thumbnail_url }) => thumbnail_url));
});

async function withOwnThumbnails<T extends { thumbnailUrl?: string }>(newsletterId: string, issues: T[]) {
	const shared = await getSharedThumbnails(String(newsletterId));
	return issues.map((issue) => (issue.thumbnailUrl && shared.has(issue.thumbnailUrl) ? { ...issue, thumbnailUrl: undefined } : issue));
}

export const getArchiveIssue = cache(async (newsletterId: string, postSlug: string) => {
	if (!ARCHIVE_SLUG_PATTERN.test(postSlug)) return null;
	const row = await first(
		`SELECT ${CARD_COLUMNS}, format, markdown, html, source FROM campaigns
		 WHERE newsletter_id = ? AND archive_slug = ? AND status IN (${placeholders(PUBLISHED_STATUSES.length)})`,
		[newsletterId, postSlug, ...PUBLISHED_STATUSES]
	);
	return row ? (await withOwnThumbnails(newsletterId, [card(row)]))[0] : null;
});

export async function listArchiveIssues(newsletterId: string, { limit = 0, excludeId }: { limit?: number; excludeId?: string } = {}) {
	const rows = await all(
		`SELECT ${CARD_COLUMNS} FROM campaigns WHERE newsletter_id = ? AND ${LISTED_FILTER} ${excludeId ? "AND id != ?" : ""}
		 ORDER BY sent_at DESC, started_at DESC ${limit ? "LIMIT ?" : ""}`,
		[newsletterId, ...PUBLISHED_STATUSES, ...(excludeId ? [excludeId] : []), ...(limit ? [limit] : [])]
	);
	return withOwnThumbnails(newsletterId, rows.map(card));
}

// For the API: every listed issue that went out.
export async function listPublishedIssues(newsletterId: string) {
	const rows = await all(
		`SELECT ${CARD_COLUMNS} FROM campaigns WHERE newsletter_id = ? AND ${LISTED_FILTER} ORDER BY sent_at DESC, started_at DESC`,
		[newsletterId, ...PUBLISHED_STATUSES]
	);
	return rows.map(card);
}

// Cached per render: the layout's popup and the page's own subscribe blocks show the same count.
export const countReaders = cache(async (newsletterId: string) => {
	const row = await first<{ count: number }>("SELECT COUNT(*) AS count FROM contacts WHERE newsletter_id = ? AND status = 'active'", [
		newsletterId,
	]);
	return row?.count ?? 0;
});

export function revalidateArchive() {
	revalidatePath("/archive/[slug]", "layout");
}

// Unlisted issues keep their page, so only the archive switch, the slug and the send decide.
export function getIssuePageUrl({ campaign, newsletter }: { campaign: any; newsletter: any }) {
	if (!newsletter?.archiveEnabled || !campaign.archiveSlug || !PUBLISHED_STATUSES.includes(campaign.status)) return null;
	return getArchiveUrls(newsletter).absolutePost(campaign.archiveSlug);
}
