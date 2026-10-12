import crypto from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import AvatarContact from "@/components/AvatarContact";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import BadgeTag from "@/components/BadgeTag";
import DialogDeletePerson from "@/components/DialogDeletePerson";
import FormPerson from "@/components/FormPerson";
import HeaderPage from "@/components/HeaderPage";
import ListActivity from "@/components/ListActivity";
import MenuContact from "@/components/MenuContact";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import { toNewsletterMap } from "@/lib/newsletters";
import { TIMELINE_GROUPS, getPerson, getPersonTimeline, listPersonContacts } from "@/lib/people";
import { displayName } from "@/lib/person-fields";
import { listTags } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { isObjectIdString } from "@/lib/validation";
import { all, toNewsletter } from "@/server/db";

const GROUP_LABELS = { email: "Emails", subscription: "Subscription", tags: "Tags", profile: "Profile" };
const VERIFICATION_LABELS = {
	deliverable: "Deliverable",
	risky: "Risky",
	unknown: "Unknown",
	undeliverable: "Undeliverable",
};

export async function generateMetadata({ params }) {
	const { id } = await params;
	const person = isObjectIdString(id) ? await getPerson(id) : null;
	return { title: person ? displayName(person) || person.email : "Contact" };
}

export default async function PersonPage({ params, searchParams }) {
	const { id } = await params;
	if (!isObjectIdString(id)) notFound();
	const person = await getPerson(id);
	if (!person) notFound();

	const query = await searchParams;
	const group = Object.hasOwn(TIMELINE_GROUPS, query.group) ? query.group : null;
	const newsletterId = isObjectIdString(query.newsletter) ? query.newsletter : null;
	const before = Number.parseInt(query.before, 10);

	const [contacts, newsletterRows, tags, timeline] = await Promise.all([
		listPersonContacts(person.email),
		all("SELECT * FROM newsletters ORDER BY created_at ASC"),
		listTags(),
		getPersonTimeline({
			email: person.email,
			newsletterId,
			group,
			before: Number.isFinite(before) && before > 0 ? before : undefined,
		}),
	]);
	const newsletterMap = toNewsletterMap(newsletterRows.map(toNewsletter));
	const tagOptions = tags.map(({ id: tagId, name, color }) => ({ id: tagId, name, color }));
	const name = displayName(person);

	function href(changes) {
		const next = new URLSearchParams(Object.entries({ group, newsletter: newsletterId }).filter(([, value]) => value));
		for (const [key, value] of Object.entries(changes)) {
			if (value) next.set(key, value);
			else next.delete(key);
		}
		return `/people/${person._id}${next.size ? `?${next}` : ""}`;
	}

	return (
		<>
			<HeaderPage
				title={name || person.email}
				backHref="/contacts"
				icon={<AvatarContact email={person.email} gravatarHash={gravatarHash(person.email)} size={32} />}
			>
				<Button asChild variant="outline">
					<a href={`/people/${person._id}/export`} download>
						<Download />
						Export
					</a>
				</Button>
				<DialogDeletePerson id={person._id} email={person.email} subscriptions={contacts.length} />
			</HeaderPage>

			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
				<div className="flex flex-col gap-6">
					<section className="rounded-xl bg-card shadow-border animate-enter">
						<h2 className="flex h-12 items-center px-4 text-sm font-medium">Profile</h2>
						<div className="border-t border-border/60">
							<FormPerson person={{ _id: person._id, email: person.email, firstName: person.firstName, lastName: person.lastName, phone: person.phone }} />
						</div>
						{person.verification && (
							<p className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm">
								<span className="text-muted-foreground">Address check</span>
								<span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
									{formatDate(person.verification.verifiedAt)}
									<BadgeStatus
										status={person.verification.state === "deliverable" ? "verified" : person.verification.state === "undeliverable" ? "failed" : "pending"}
										label={VERIFICATION_LABELS[person.verification.state] ?? person.verification.state}
									/>
								</span>
							</p>
						)}
					</section>

					<section style={{ "--stagger": 1 }} className="rounded-xl bg-card shadow-border animate-enter">
						<h2 className="flex h-12 items-center px-4 text-sm font-medium">Newsletters</h2>
						<ul className="divide-y divide-border/60 border-t border-border/60">
							{contacts.map((contact) => (
								<li key={contact._id} className="flex flex-col gap-2 px-4 py-3">
									<div className="flex items-center gap-2.5">
										<AvatarNewsletter newsletter={contact.newsletter} size={20} />
										<span className="min-w-0 flex-1 truncate text-sm font-medium">{contact.newsletter.name}</span>
										<BadgeStatus status={contact.status} />
										<MenuContact
											id={contact._id}
											email={contact.email}
											status={contact.status}
											tags={contact.tags ?? []}
											allTags={tagOptions}
										/>
									</div>
									<p className="text-xs text-muted-foreground tabular-nums">
										Since {formatDate(contact.subscribedAt ?? contact.createdAt)}
										{contact.source ? ` · ${contact.source}` : ""} · {formatNumber(contact.stats.sent)} sent ·{" "}
										{formatNumber(contact.stats.opens)} opens · {formatNumber(contact.stats.clicks)} clicks
									</p>
									{contact.tags?.length > 0 && (
										<span className="flex flex-wrap gap-1">
											{contact.tags.map((tag) => (
												<BadgeTag key={tag.id} tag={tag} href={`/contacts?tag=${tag.id}`} />
											))}
										</span>
									)}
								</li>
							))}
							{contacts.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No subscriptions</li>}
						</ul>
					</section>
				</div>

				<section style={{ "--stagger": 2 }} className="rounded-xl bg-card shadow-border animate-enter">
					<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
						<h2 className="text-sm font-medium">History</h2>
						<nav aria-label="Filter history" className="flex flex-wrap gap-1">
							{[null, ...Object.keys(GROUP_LABELS)].map((key) => (
								<FilterLink key={key ?? "all"} href={href({ group: key, before: null })} isActive={key === group}>
									{key ? GROUP_LABELS[key] : "All"}
								</FilterLink>
							))}
						</nav>
					</div>
					{contacts.length > 1 && (
						<nav aria-label="Filter by newsletter" className="flex flex-wrap gap-1 border-t border-border/60 px-4 py-2.5">
							<FilterLink href={href({ newsletter: null, before: null })} isActive={!newsletterId}>
								All newsletters
							</FilterLink>
							{contacts.map((contact) => (
								<FilterLink
									key={contact.newsletterId}
									href={href({ newsletter: contact.newsletterId, before: null })}
									isActive={contact.newsletterId === newsletterId}
								>
									{contact.newsletter.name}
								</FilterLink>
							))}
						</nav>
					)}
					<div className="border-t border-border/60">
						<ListActivity events={timeline.events} newsletterMap={newsletterMap} showNewsletter={!newsletterId && contacts.length > 1} />
					</div>
					{(timeline.nextBefore || Number.isFinite(before)) && (
						<div className="flex justify-end gap-2 border-t border-border/60 px-4 py-3">
							{Number.isFinite(before) && (
								<Button asChild variant="ghost" size="sm">
									<Link href={href({ before: null })} scroll={false}>
										Newest
									</Link>
								</Button>
							)}
							{timeline.nextBefore && (
								<Button asChild variant="outline" size="sm">
									<Link href={href({ before: String(timeline.nextBefore) })} scroll={false}>
										Older
									</Link>
								</Button>
							)}
						</div>
					)}
				</section>
			</div>
		</>
	);
}

function FilterLink({ href, isActive, children }) {
	return (
		<Link
			href={href}
			scroll={false}
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs transition-[color,background-color] duration-150",
				isActive ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
			)}
		>
			{children}
		</Link>
	);
}

function gravatarHash(email) {
	return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
