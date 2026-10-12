import { notFound } from "next/navigation";
import EditorSegment from "@/components/EditorSegment";
import HeaderPage from "@/components/HeaderPage";
import { getSegment } from "@/lib/segment-store";
import { listTags } from "@/lib/tags";
import { all } from "@/server/db";

export async function generateMetadata({ params }) {
	const segment = await getSegment((await params).id);
	return { title: segment?.name ?? "Segment" };
}

export default async function SegmentPage({ params }) {
	const segment = await getSegment((await params).id);
	if (!segment) notFound();
	const [newsletters, tags] = await Promise.all([all("SELECT id, name FROM newsletters ORDER BY created_at ASC"), listTags()]);

	return (
		<>
			<HeaderPage title={segment.name} backHref="/segments" />
			<EditorSegment
				segment={{ _id: segment._id, name: segment.name, newsletterId: segment.newsletterId, rules: segment.rules }}
				newsletters={newsletters}
				tags={tags.map(({ id, name, color }) => ({ id, name, color }))}
			/>
		</>
	);
}
