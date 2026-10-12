import { slugify } from "@/lib/slug";
import { first, run } from "@/server/db";

export async function uniqueArchiveSlug(base: string) {
	for (let suffix = 1; suffix < 100; suffix += 1) {
		const slug = suffix === 1 ? base : `${base}-${suffix}`;
		if (!(await first("SELECT 1 FROM campaigns WHERE archive_slug = ?", [slug]))) return slug;
	}
	return `${base}-${Date.now()}`;
}

// Unless the API set one, the slug comes from the subject as it is when the issue goes out, so the
// /p/ page exists before the first email links to it.
export async function assignArchiveSlug({ campaign, newsletter }: { campaign: any; newsletter: any }) {
	if (!newsletter.archiveEnabled || campaign.archiveSlug) return;
	const slug = await uniqueArchiveSlug(slugify(campaign.subject, 80) || "issue");
	await run("UPDATE campaigns SET archive_slug = ?, updated_at = ? WHERE id = ? AND archive_slug IS NULL", [
		slug,
		Date.now(),
		campaign._id,
	]);
}
