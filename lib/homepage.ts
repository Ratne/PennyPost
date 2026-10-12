import { first } from "@/server/db";

// The newsletter whose archive visitors see on the app's "/". Only one can be marked, and only while its
// archive is public.
export async function getHomepageSlug(): Promise<string | null> {
	try {
		const row = await first<{ slug: string }>("SELECT slug FROM newsletters WHERE is_homepage = 1 AND archive_enabled = 1");
		return row?.slug ?? null;
	} catch (error: any) {
		console.error("[homepage] Could not load:", error?.message);
		return null;
	}
}
