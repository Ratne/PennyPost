import Link from "next/link";
import { Plus, Tags } from "lucide-react";
import BadgeTag from "@/components/BadgeTag";
import DialogTag from "@/components/DialogTag";
import HeaderPage from "@/components/HeaderPage";
import MenuTag from "@/components/MenuTag";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { listTags } from "@/lib/tags";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
	const tags = await listTags();
	const newButton = (
		<Button>
			<Plus data-icon="inline-start" />
			New tag
		</Button>
	);

	return (
		<>
			<HeaderPage title="Tags">
				<DialogTag trigger={newButton} />
			</HeaderPage>

			{tags.length === 0 ? (
				<StateEmpty icon={Tags} title="No tags yet">
					<p className="max-w-sm text-sm text-muted-foreground text-pretty">
						Tag contacts from the contacts list, a CSV column named “tags”, or the API, then build segments from them.
					</p>
				</StateEmpty>
			) : (
				<div className="overflow-hidden rounded-xl shadow-border animate-enter">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-4">Tag</TableHead>
								<TableHead className="text-right">Contacts</TableHead>
								<TableHead className="w-12 pr-2" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{tags.map((tag) => (
								<TableRow key={tag.id}>
									<TableCell className="py-2.5 pl-4">
										<BadgeTag tag={tag} className="h-6 text-sm" />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										<Link href={`/contacts?tag=${tag.id}`} className="text-muted-foreground hover:text-foreground hover:underline">
											{formatNumber(tag.contacts ?? 0)}
										</Link>
									</TableCell>
									<TableCell className="pr-2 text-right">
										<MenuTag tag={tag} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	);
}
