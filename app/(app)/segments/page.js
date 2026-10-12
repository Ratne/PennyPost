import Link from "next/link";
import { Plus, SlidersHorizontal } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import HeaderPage from "@/components/HeaderPage";
import MenuSegment from "@/components/MenuSegment";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { toNewsletterMap } from "@/lib/newsletters";
import { countSegment, describeSegments, listSegments } from "@/lib/segment-store";
import { all, toNewsletter } from "@/server/db";

export const metadata = { title: "Segments" };

export default async function SegmentsPage() {
	const [segments, newsletterRows] = await Promise.all([listSegments().then(describeSegments), all("SELECT * FROM newsletters")]);
	const newsletters = toNewsletterMap(newsletterRows.map(toNewsletter));
	const counts = await Promise.all(segments.map((segment) => countSegment(segment.newsletterId, segment.rules)));
	const newButton = (
		<Button asChild>
			<Link href="/segments/new">
				<Plus data-icon="inline-start" />
				New segment
			</Link>
		</Button>
	);

	return (
		<>
			<HeaderPage title="Segments">{segments.length > 0 && newButton}</HeaderPage>

			{segments.length === 0 ? (
				<StateEmpty icon={SlidersHorizontal} title="No segments yet">
					<p className="max-w-sm text-sm text-muted-foreground text-pretty">
						Save rules over tags, engagement and signup date, then send a campaign to just those contacts.
					</p>
					{newButton}
				</StateEmpty>
			) : (
				<div className="overflow-hidden rounded-xl shadow-border animate-enter">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-4">Segment</TableHead>
								<TableHead className="hidden md:table-cell">Newsletter</TableHead>
								<TableHead className="text-right">Reachable</TableHead>
								<TableHead className="w-12 pr-2" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{segments.map((segment, index) => {
								const newsletter = newsletters[segment.newsletterId];
								return (
									<TableRow key={segment._id}>
										<TableCell className="max-w-0 py-3 pl-4">
											<Link href={`/segments/${segment._id}`} className="block truncate font-medium hover:underline">
												{segment.name}
											</Link>
											<p className="truncate text-sm text-muted-foreground">{segment.summary}</p>
										</TableCell>
										<TableCell className="hidden text-muted-foreground md:table-cell">
											<span className="flex items-center gap-2">
												<AvatarNewsletter newsletter={newsletter} size={18} />
												<span className="truncate">{newsletter?.name}</span>
											</span>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											<Link href={`/contacts?segment=${segment._id}&status=active`} className="hover:underline">
												{formatNumber(counts[index].reachable)}
											</Link>
										</TableCell>
										<TableCell className="pr-2 text-right">
											<MenuSegment segment={{ id: segment._id, name: segment.name }} />
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	);
}
