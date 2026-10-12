import { notFound } from "next/navigation";
import EditorSegment from "@/components/EditorSegment";
import HeaderPage from "@/components/HeaderPage";
import { listTags } from "@/lib/tags";
import { isObjectIdString } from "@/lib/validation";
import { all } from "@/server/db";

export const metadata = { title: "New segment" };

export default async function NewSegmentPage({ searchParams }) {
	const { newsletter } = await searchParams;
	const [newsletters, tags] = await Promise.all([all("SELECT id, name FROM newsletters ORDER BY created_at ASC"), listTags()]);
	if (newsletters.length === 0) notFound();

	return (
		<>
			<HeaderPage title="New segment" backHref="/segments" />
			<EditorSegment
				newsletters={newsletters}
				defaultNewsletterId={isObjectIdString(newsletter) ? newsletter : undefined}
				tags={tags.map(({ id, name, color }) => ({ id, name, color }))}
			/>
		</>
	);
}
