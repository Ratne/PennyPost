import { getArchiveUrls } from "@/lib/archive-hosts";
import { first } from "@/server/db";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;

// Archive domains rewrite /p/slug in proxy.js; on the app's domain the link doesn't name the newsletter.
export async function GET(request, { params }) {
	const { slug } = await params;
	if (!SLUG_PATTERN.test(slug)) return new Response("Not found", { status: 404 });

	const newsletter = await first(
		"SELECT n.slug FROM campaigns c JOIN newsletters n ON n.id = c.newsletter_id WHERE c.archive_slug = ? AND n.archive_enabled = 1",
		[slug]
	);
	if (!newsletter) return new Response("Not found", { status: 404 });

	return Response.redirect(new URL(getArchiveUrls(newsletter).post(slug), request.url), 307);
}
