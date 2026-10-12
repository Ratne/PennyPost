import crypto from "node:crypto";
import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SlidersHorizontal, Users, X } from "lucide-react";
import AvatarContact from "@/components/AvatarContact";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import BadgeTag from "@/components/BadgeTag";
import BarBulkTags from "@/components/BarBulkTags";
import DialogImportContacts from "@/components/DialogImportContacts";
import FilterContacts from "@/components/FilterContacts";
import HeaderPage from "@/components/HeaderPage";
import MenuContact from "@/components/MenuContact";
import ProviderSelection, { CheckboxAll, CheckboxRow } from "@/components/ProviderSelection";
import StateEmpty from "@/components/StateEmpty";
import TextEmpty from "@/components/TextEmpty";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { PERSON_COLUMNS, toPersonFields } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { displayName } from "@/lib/person-fields";
import { toNewsletterMap, toNewsletterOptions } from "@/lib/newsletters";
import { getSegment } from "@/lib/segment-store";
import { compileSegmentRules } from "@/lib/segments";
import { CONTACT_STATUSES } from "@/lib/statuses";
import { listTags, tagsColumn } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { isObjectIdString } from "@/lib/validation";
import { all, toContact, toNewsletter } from "@/server/db";

export const metadata = { title: "Contacts" };

const PAGE_SIZE = 50;

export default async function ContactsPage({ searchParams }) {
	const params = await searchParams;
	const newsletterId = isObjectIdString(params.newsletter) ? params.newsletter : null;
	const tagId = isObjectIdString(params.tag) ? params.tag : null;
	const segmentId = isObjectIdString(params.segment) ? params.segment : null;
	const status = CONTACT_STATUSES.includes(params.status) ? params.status : null;
	const query = typeof params.q === "string" ? params.q.trim().toLowerCase().slice(0, 254) : "";
	const page = Math.max(1, Number.parseInt(params.page, 10) || 1);

	const [newsletterRows, tags, segment] = await Promise.all([
		all("SELECT * FROM newsletters ORDER BY created_at ASC"),
		listTags({ newsletterId }),
		segmentId ? getSegment(segmentId) : null,
	]);
	const newsletters = newsletterRows.map(toNewsletter);
	const tagOptions = tags.map(({ id, name, color, contacts }) => ({ id, name, color, contacts }));
	const newsletterOptions = toNewsletterOptions(newsletters);
	const newsletterMap = toNewsletterMap(newsletters);

	const clauses = [];
	const values = [];
	if (newsletterId) {
		clauses.push("c.newsletter_id = ?");
		values.push(newsletterId);
	}
	if (query) {
		// A prefix range uses the email index; names match from the start of the first name, last name or both.
		const prefix = `${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
		clauses.push(
			`(c.email >= ? AND c.email < ? OR p.first_name LIKE ? ESCAPE '\\' OR p.last_name LIKE ? ESCAPE '\\'
			  OR (p.first_name || ' ' || p.last_name) LIKE ? ESCAPE '\\')`
		);
		values.push(query, `${query}\uffff`, prefix, prefix, prefix);
	}
	if (tagId) {
		clauses.push("EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ?)");
		values.push(tagId);
	}
	if (segment) {
		const filter = compileSegmentRules(segment.rules, { ignoreStatuses: true });
		clauses.push("c.newsletter_id = ?", filter.sql);
		values.push(segment.newsletterId, ...filter.params);
	}
	const where = clauses.length > 0 ? clauses.join(" AND ") : "1 = 1";

	const from = `contacts c${query ? " LEFT JOIN people p ON p.email = c.email" : ""}`;
	const [statusRows, contactRows] = await Promise.all([
		all(`SELECT c.status, COUNT(*) AS count FROM ${from} WHERE ${where} GROUP BY c.status`, values),
		all(
			`SELECT c.*, ${PERSON_COLUMNS}, ${tagsColumn("c")} FROM contacts c LEFT JOIN people p ON p.email = c.email
			 WHERE ${where} ${status ? "AND c.status = ?" : ""}
			 ORDER BY c.subscribed_at DESC, c.id DESC LIMIT ? OFFSET ?`,
			[...values, ...(status ? [status] : []), PAGE_SIZE, (page - 1) * PAGE_SIZE]
		),
	]);
	const contacts = contactRows.map((row) => ({ ...toContact(row), ...toPersonFields(row) }));
	const counts = Object.fromEntries(statusRows.map((row) => [row.status, row.count]));
	const totalAll = statusRows.reduce((sum, row) => sum + row.count, 0);
	const total = status ? counts[status] || 0 : totalAll;
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

	function href(changes) {
		const next = new URLSearchParams(
			Object.entries({ newsletter: newsletterId, tag: tagId, segment: segmentId, status, q: query, page }).filter(([, value]) => value)
		);
		for (const [key, value] of Object.entries(changes)) {
			if (value) next.set(key, value);
			else next.delete(key);
		}
		if (next.get("page") === "1") next.delete("page");
		return `/contacts${next.size ? `?${next}` : ""}`;
	}

	return (
		<>
			<HeaderPage title="Contacts">
				<DialogImportContacts newsletters={newsletterOptions} defaultNewsletterId={newsletterId} tags={tagOptions} />
			</HeaderPage>

			<div className="flex flex-col gap-4">
				<Suspense fallback={<Skeleton className="h-9 w-full rounded-lg" />}>
					<FilterContacts newsletters={newsletterOptions} tags={tagOptions} />
				</Suspense>

				{segment && (
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						<SlidersHorizontal className="size-4" />
						Segment
						<Link href={`/segments/${segment._id}`} className="font-medium text-foreground hover:underline">
							{segment.name}
						</Link>
						<Link
							href={href({ segment: null, page: null })}
							aria-label="Clear segment filter"
							className="grid size-6 place-items-center rounded-full hover:bg-muted hover:text-foreground"
						>
							<X className="size-3.5" />
						</Link>
					</p>
				)}

				<nav
					aria-label="Status"
					className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 animate-enter [scrollbar-width:none]"
				>
					{[null, ...CONTACT_STATUSES].map((key) => {
						const isActive = key === status;
						return (
							<Link
								key={key ?? "all"}
								href={href({ status: key, page: null })}
								scroll={false}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm transition-[color,background-color,box-shadow] duration-150",
									isActive
										? "bg-foreground text-background"
										: "text-muted-foreground hover:bg-muted hover:text-foreground"
								)}
							>
								{key ? key.charAt(0).toUpperCase() + key.slice(1) : "All"}
								<span className={cn("text-xs tabular-nums", isActive ? "opacity-70" : "opacity-60")}>
									{formatNumber(key ? counts[key] || 0 : totalAll)}
								</span>
							</Link>
						);
					})}
				</nav>

				{contacts.length === 0 ? (
					<StateEmpty icon={Users} title={totalAll ? "No contacts match" : "No contacts yet"} />
				) : (
					<ProviderSelection ids={contacts.map((contact) => contact._id.toString())}>
						<div style={{ "--stagger": 1 }} className="overflow-hidden rounded-xl shadow-border animate-enter">
							<Table>
								<TableHeader>
									<TableRow className="hover:bg-transparent">
										<TableHead className="w-10 pr-0 pl-4">
											<CheckboxAll />
										</TableHead>
										<TableHead>Email</TableHead>
										<TableHead>Status</TableHead>
										{!newsletterId && <TableHead className="hidden md:table-cell">Newsletter</TableHead>}
										<TableHead className="hidden text-right lg:table-cell">Opens</TableHead>
										<TableHead className="hidden text-right lg:table-cell">Clicks</TableHead>
										<TableHead className="hidden text-right sm:table-cell">Added</TableHead>
										<TableHead className="w-12 pr-2" />
									</TableRow>
								</TableHeader>
								<TableBody>
									{contacts.map((contact) => (
										<TableRow key={contact._id.toString()} className="tabular-nums">
											<TableCell className="w-10 pr-0 pl-4">
												<CheckboxRow id={contact._id.toString()} label={`Select ${contact.email}`} />
											</TableCell>
											<TableCell className="max-w-0 py-2.5 font-medium sm:w-2/5">
												<span className="flex min-w-0 items-center gap-2.5">
													<AvatarContact
														email={contact.email}
														gravatarHash={gravatarHash(contact.email)}
														size={26}
													/>
													<span className="flex min-w-0 flex-col">
														{contact.personId ? (
															<Link href={`/people/${contact.personId}`} className="truncate hover:underline">
																{contact.email}
															</Link>
														) : (
															<span className="truncate">{contact.email}</span>
														)}
														{displayName(contact) && (
															<span className="truncate text-xs font-normal text-muted-foreground">{displayName(contact)}</span>
														)}
													</span>
													{contact.tags?.length > 0 && (
														<span className="hidden shrink-0 items-center gap-1 xl:flex">
															{contact.tags.slice(0, 3).map((tag) => (
																<BadgeTag key={tag.id} tag={tag} href={href({ tag: tag.id, page: null })} />
															))}
															{contact.tags.length > 3 && (
																<span className="text-xs text-muted-foreground">+{contact.tags.length - 3}</span>
															)}
														</span>
													)}
												</span>
											</TableCell>
											<TableCell>
												<BadgeStatus status={contact.status} />
											</TableCell>
											{!newsletterId && (
												<TableCell className="hidden text-muted-foreground md:table-cell">
													<span className="flex items-center gap-2">
														<AvatarNewsletter newsletter={newsletterMap[contact.newsletterId.toString()]} size={18} />
														<span className="truncate">{newsletterMap[contact.newsletterId.toString()]?.name}</span>
													</span>
												</TableCell>
											)}
											<TableCell className="hidden text-right lg:table-cell">
												{engagement(contact, "opens", "openRate")}
											</TableCell>
											<TableCell className="hidden text-right lg:table-cell">
												{engagement(contact, "clicks", "clickRate")}
											</TableCell>
											<TableCell className="hidden text-right text-muted-foreground sm:table-cell">
												{formatDate(contact.subscribedAt) ?? <TextEmpty />}
											</TableCell>
											<TableCell className="pr-2 text-right">
												<MenuContact
													id={contact._id.toString()}
													email={contact.email}
													status={contact.status}
													tags={contact.tags ?? []}
													allTags={tagOptions}
												/>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<BarBulkTags tags={tagOptions} />
					</ProviderSelection>
				)}

				{pageCount > 1 && (
					<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground tabular-nums">
						<span>
							{formatNumber((page - 1) * PAGE_SIZE + 1)}–{formatNumber(Math.min(page * PAGE_SIZE, total))} of{" "}
							{formatNumber(total)}
						</span>
						<div className="flex gap-1">
							<PageLink href={href({ page: page - 1 })} isDisabled={page <= 1} label="Previous">
								<ChevronLeft />
							</PageLink>
							<PageLink href={href({ page: page + 1 })} isDisabled={page >= pageCount} label="Next">
								<ChevronRight />
							</PageLink>
						</div>
					</div>
				)}
			</div>
		</>
	);
}

function PageLink({ href, isDisabled, label, children }) {
	if (isDisabled) {
		return (
			<Button variant="outline" size="icon" disabled aria-label={label}>
				{children}
			</Button>
		);
	}
	return (
		<Button asChild variant="outline" size="icon">
			<Link href={href} scroll={false} aria-label={label}>
				{children}
			</Link>
		</Button>
	);
}

function gravatarHash(email) {
	return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function engagement(contact, statKey, importedKey) {
	if (contact.stats?.[statKey]) return formatNumber(contact.stats[statKey]);
	const rate = contact.imported?.[importedKey];
	return rate === undefined || rate === null ? <TextEmpty /> : `${Math.round(rate * 100)}%`;
}
