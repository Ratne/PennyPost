import Link from "next/link";
import { Workflow } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import DialogNewAutomation from "@/components/DialogNewAutomation";
import HeaderPage from "@/components/HeaderPage";
import MenuAutomation from "@/components/MenuAutomation";
import StateEmpty from "@/components/StateEmpty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAutomations } from "@/lib/automations";
import { formatNumber } from "@/lib/format";
import { toNewsletterMap } from "@/lib/newsletters";
import { all, toNewsletter } from "@/server/db";

export const metadata = { title: "Automations" };

export default async function AutomationsPage() {
	const [automations, newsletterRows] = await Promise.all([listAutomations(), all("SELECT * FROM newsletters ORDER BY created_at ASC")]);
	const newsletters = toNewsletterMap(newsletterRows.map(toNewsletter));
	const newButton = <DialogNewAutomation newsletters={Object.values(newsletters)} />;

	return (
		<>
			<HeaderPage title="Automations">{automations.length > 0 && newButton}</HeaderPage>

			{automations.length === 0 ? (
				<StateEmpty icon={Workflow} title="No automations yet">
					<p className="max-w-sm text-sm text-muted-foreground text-pretty">
						When a contact gets a tag, walk them through waits, emails, webhooks and conditions, top to bottom.
					</p>
					{newButton}
				</StateEmpty>
			) : (
				<div className="overflow-hidden rounded-xl shadow-border animate-enter">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-4">Automation</TableHead>
								<TableHead className="hidden md:table-cell">Newsletter</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="hidden text-right sm:table-cell">In progress</TableHead>
								<TableHead className="hidden text-right sm:table-cell">Entered</TableHead>
								<TableHead className="w-12 pr-2" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{automations.map((automation) => {
								const newsletter = newsletters[automation.newsletterId];
								return (
									<TableRow key={automation.id}>
										<TableCell className="max-w-0 py-3 pl-4">
											<Link href={`/automations/${automation.id}`} className="block truncate font-medium hover:underline">
												{automation.name}
											</Link>
											<p className="truncate text-sm text-muted-foreground">
												{automation.tagName ? `Tag “${automation.tagName}” added` : "No trigger yet"} ·{" "}
												{automation.stepCount === 1 ? "1 step" : `${automation.stepCount} steps`}
											</p>
										</TableCell>
										<TableCell className="hidden text-muted-foreground md:table-cell">
											<span className="flex items-center gap-2">
												<AvatarNewsletter newsletter={newsletter} size={18} />
												<span className="truncate">{newsletter?.name}</span>
											</span>
										</TableCell>
										<TableCell>
											<BadgeStatus status={automation.status} />
										</TableCell>
										<TableCell className="hidden text-right tabular-nums sm:table-cell">{formatNumber(automation.inProgress)}</TableCell>
										<TableCell className="hidden text-right tabular-nums sm:table-cell">{formatNumber(automation.stats.entered)}</TableCell>
										<TableCell className="pr-2 text-right">
											<MenuAutomation automation={{ id: automation.id, name: automation.name, status: automation.status }} />
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
