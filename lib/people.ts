import { logActivity } from "@/lib/contact-activity";
import { normalizePersonFields } from "@/lib/person-fields";
import { tagsColumn } from "@/lib/tags";
import { MAX_BOUND_PARAMS, all, batch, chunk, first, newId, placeholders, run, statement, toContact } from "@/server/db";

export type Person = {
	_id: string;
	email: string;
	firstName?: string;
	lastName?: string;
	phone?: string;
	verification?: { state: string; reason?: string; verifiedAt?: Date };
	createdAt?: Date;
	updatedAt?: Date;
};

type PersonRow = Record<string, any>;

export function toPerson(row: PersonRow | null): Person | null {
	if (!row) return null;
	return {
		_id: row.id,
		email: row.email,
		firstName: row.first_name ?? undefined,
		lastName: row.last_name ?? undefined,
		phone: row.phone ?? undefined,
		verification: row.verification_state
			? {
					state: row.verification_state,
					reason: row.verification_reason ?? undefined,
					verifiedAt: row.verified_at ? new Date(row.verified_at) : undefined,
				}
			: undefined,
		createdAt: row.created_at ? new Date(row.created_at) : undefined,
		updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
	};
}

export async function getPerson(id: string) {
	return toPerson(await first("SELECT * FROM people WHERE id = ?", [id]));
}

export async function getPersonByEmail(email: string) {
	return toPerson(await first("SELECT * FROM people WHERE email = ?", [email]));
}

// Every address with a contact has a person; this creates the missing ones without touching the rest.
export async function ensurePeople(emails: string[]) {
	const unique = [...new Set(emails.filter(Boolean))];
	if (unique.length === 0) return;
	const now = Date.now();
	const statements = chunk(unique, Math.floor(MAX_BOUND_PARAMS / 4)).map((group) =>
		statement(
			`INSERT OR IGNORE INTO people (id, email, created_at, updated_at) VALUES ${group.map(() => "(?, ?, ?, ?)").join(", ")}`,
			group.flatMap((email) => [newId(), email, now, now])
		)
	);
	for (const group of chunk(statements, 50)) await batch(group);
}

type PersonFields = { firstName?: string; lastName?: string; phone?: string };

// Imports and the API add what they know: a missing or empty value never replaces a saved one.
export async function mergePeople(people: ({ email: string } & PersonFields)[]) {
	const withFields = people.filter(({ firstName, lastName, phone }) => firstName || lastName || phone);
	await ensurePeople(people.map(({ email }) => email));
	if (withFields.length === 0) return;
	const now = Date.now();
	const statements = withFields.map(({ email, firstName, lastName, phone }) =>
		statement(
			`UPDATE people SET first_name = COALESCE(NULLIF(?, ''), first_name), last_name = COALESCE(NULLIF(?, ''), last_name),
			 phone = COALESCE(NULLIF(?, ''), phone), updated_at = ? WHERE email = ?`,
			[firstName ?? "", lastName ?? "", phone ?? "", now, email]
		)
	);
	for (const group of chunk(statements, 50)) await batch(group);
}

const FIELD_COLUMNS: Record<keyof PersonFields, string> = { firstName: "first_name", lastName: "last_name", phone: "phone" };

// The profile form: what it sends is what's saved, empty fields included.
export async function updatePerson(id: string, input: PersonFields) {
	const person = await getPerson(id);
	if (!person) return { error: "Contact not found" };
	const { fields, error } = normalizePersonFields(input) as { fields?: PersonFields; error?: string };
	if (error || !fields) return { error: error ?? "Invalid fields" };

	const changed = (Object.keys(FIELD_COLUMNS) as (keyof PersonFields)[]).filter(
		(key) => fields[key] !== undefined && (fields[key] || "") !== (person[key] || "")
	);
	if (changed.length === 0) return { person };
	const now = Date.now();
	await run(
		`UPDATE people SET ${changed.map((key) => `${FIELD_COLUMNS[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
		[...changed.map((key) => fields[key] || null), now, id]
	);
	await logActivity({
		email: person.email,
		type: "profile_updated",
		data: Object.fromEntries(changed.map((key) => [key, { from: person[key] ?? null, to: fields[key] || null }])),
		occurredAt: now,
	});
	return { person: await getPerson(id) };
}

export async function saveVerification(email: string, { state, reason }: { state: string; reason?: string | null }) {
	const now = Date.now();
	await ensurePeople([email]);
	await run("UPDATE people SET verification_state = ?, verification_reason = ?, verified_at = ?, updated_at = ? WHERE email = ?", [
		state,
		reason ?? null,
		now,
		now,
		email,
	]);
}

export async function listPersonContacts(email: string) {
	const rows = await all(
		`SELECT c.*, n.name AS newsletter_name, n.image_url AS newsletter_image_url, ${tagsColumn("c")}
		 FROM contacts c JOIN newsletters n ON n.id = c.newsletter_id WHERE c.email = ? ORDER BY c.created_at ASC`,
		[email]
	);
	return rows.map((row) => ({
		...toContact(row)!,
		newsletter: { _id: row.newsletter_id as string, name: row.newsletter_name as string, imageUrl: (row.newsletter_image_url as string) ?? null },
	}));
}

export const TIMELINE_GROUPS: Record<string, string[]> = {
	email: ["email_sent", "email_delivered", "email_bounced", "email_complained", "opened", "clicked"],
	subscription: [
		"subscribed",
		"resubscribed",
		"confirmed",
		"unsubscribed",
		"reactivated",
		"dormant",
		"kept",
		"bounced",
		"complained",
		"imported",
		"verified",
	],
	tags: ["tag_added", "tag_removed"],
	profile: ["profile_updated"],
	automations: ["automation_entered", "automation_completed", "automation_exited"],
};

export type TimelineEvent = {
	id: string;
	type: string;
	occurredAt: number;
	newsletterId: string | null;
	campaignId: string | null;
	messageId: string | null;
	subject: string | null;
	kind: string | null;
	data: Record<string, any>;
};

const MESSAGE_EVENTS = [
	["sent_at", "email_sent"],
	["delivered_at", "email_delivered"],
	["bounced_at", "email_bounced"],
	["complained_at", "email_complained"],
] as const;

function parseData(value: unknown) {
	if (typeof value !== "string") return {};
	try {
		return JSON.parse(value) ?? {};
	} catch {
		return {};
	}
}

// Most recent first, `limit` at a time, from the history table and the messages sent to the address.
// Messages only know their first open and click: those count when the history has none for the message,
// which is the case for emails sent before every open was recorded.
export async function getPersonTimeline({
	email,
	newsletterId,
	group,
	before = Number.MAX_SAFE_INTEGER,
	limit = 50,
}: {
	email: string;
	newsletterId?: string | null;
	group?: string | null;
	before?: number;
	limit?: number;
}) {
	const types = group ? TIMELINE_GROUPS[group] : null;
	const activityTypes = types?.filter((type) => !type.startsWith("email_"));
	const wantsMessages = !types || types.some((type) => type.startsWith("email_") || type === "opened" || type === "clicked");

	const activityFilters = ["email = ?", "occurred_at < ?"];
	const activityParams: (string | number)[] = [email, before];
	if (newsletterId) {
		activityFilters.push("(newsletter_id = ? OR newsletter_id IS NULL)");
		activityParams.push(newsletterId);
	}
	if (activityTypes) {
		activityFilters.push(`type IN (${placeholders(activityTypes.length || 1)})`);
		activityParams.push(...(activityTypes.length ? activityTypes : ["-"]));
	}

	const messageFilters = ["m.email = ?", "m.sent_at IS NOT NULL", "m.sent_at < ?"];
	const messageParams: (string | number)[] = [email, before];
	if (newsletterId) {
		messageFilters.push("m.newsletter_id = ?");
		messageParams.push(newsletterId);
	}

	const [activityRows, messageRows] = await Promise.all([
		all<Record<string, any>>(
			`SELECT a.*, c.subject FROM contact_activity a LEFT JOIN campaigns c ON c.id = a.campaign_id
			 WHERE ${activityFilters.map((filter) => `a.${filter}`).join(" AND ")} ORDER BY a.occurred_at DESC LIMIT ?`,
			[...activityParams, limit]
		),
		wantsMessages
			? all<Record<string, any>>(
					`SELECT m.id, m.kind, m.campaign_id, m.newsletter_id, m.sent_at, m.delivered_at, m.bounced_at, m.complained_at,
						m.opened_at, m.clicked_at, COALESCE(c.subject, json_extract(s.config, '$.subject')) AS subject,
						EXISTS (SELECT 1 FROM contact_activity a WHERE a.message_id = m.id AND a.type IN ('opened', 'clicked')) AS has_engagement
					 FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id LEFT JOIN automation_steps s ON s.id = m.step_id
					 WHERE ${messageFilters.join(" AND ")} ORDER BY m.sent_at DESC LIMIT ?`,
					[...messageParams, limit]
				)
			: [],
	]);

	const events: TimelineEvent[] = activityRows.map((row) => ({
		id: row.id,
		type: row.type,
		occurredAt: Number(row.occurred_at),
		newsletterId: row.newsletter_id ?? null,
		campaignId: row.campaign_id ?? null,
		messageId: row.message_id ?? null,
		subject: row.subject ?? null,
		kind: null,
		data: parseData(row.data),
	}));

	for (const row of messageRows) {
		const base = {
			newsletterId: row.newsletter_id,
			campaignId: row.campaign_id ?? null,
			messageId: row.id,
			subject: row.subject ?? null,
			kind: row.kind,
			data: {},
		};
		const derived: [string, unknown][] = [...MESSAGE_EVENTS.map(([column, type]) => [type, row[column]] as [string, unknown])];
		if (!row.has_engagement) derived.push(["opened", row.opened_at], ["clicked", row.clicked_at]);
		for (const [type, at] of derived) {
			if (!at || Number(at) >= before || (types && !types.includes(type))) continue;
			events.push({ ...base, id: `${row.id}:${type}`, type, occurredAt: Number(at), data: type === "opened" || type === "clicked" ? { first: true } : {} });
		}
	}

	events.sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id));
	const page = events.slice(0, limit);
	const hasMore = events.length > limit || activityRows.length === limit || messageRows.length === limit;
	return { events: page, nextBefore: hasMore && page.length ? page.at(-1)!.occurredAt : null };
}

// Everything kept about one address, for an access request (GDPR article 15).
export async function exportPerson(id: string) {
	const person = await getPerson(id);
	if (!person) return null;
	const [contacts, activity, messages, suppression] = await Promise.all([
		listPersonContacts(person.email),
		all("SELECT type, newsletter_id, campaign_id, message_id, data, occurred_at FROM contact_activity WHERE email = ? ORDER BY occurred_at ASC", [
			person.email,
		]),
		all(
			`SELECT m.kind, m.newsletter_id, m.campaign_id, COALESCE(c.subject, json_extract(s.config, '$.subject')) AS subject, m.status,
				m.sent_at, m.delivered_at, m.opened_at, m.clicked_at, m.bounced_at, m.complained_at
			 FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id LEFT JOIN automation_steps s ON s.id = m.step_id
			 WHERE m.email = ? ORDER BY m.created_at ASC`,
			[person.email]
		),
		first("SELECT reason, created_at FROM suppressions WHERE email = ?", [person.email]),
	]);
	const iso = (value: unknown) => (value ? new Date(Number(value)).toISOString() : null);
	return {
		exportedAt: new Date().toISOString(),
		person: {
			email: person.email,
			firstName: person.firstName ?? null,
			lastName: person.lastName ?? null,
			phone: person.phone ?? null,
			verification: person.verification ?? null,
			createdAt: person.createdAt?.toISOString() ?? null,
		},
		subscriptions: contacts.map((contact) => ({
			newsletter: contact.newsletter.name,
			status: contact.status,
			source: contact.source ?? null,
			subscribedAt: contact.subscribedAt?.toISOString() ?? null,
			confirmedAt: contact.confirmedAt?.toISOString() ?? null,
			unsubscribedAt: contact.unsubscribedAt?.toISOString() ?? null,
			tags: (contact.tags ?? []).map(({ name }) => name),
		})),
		emails: messages.map((row: any) => ({
			kind: row.kind,
			subject: row.subject ?? null,
			status: row.status,
			sentAt: iso(row.sent_at),
			deliveredAt: iso(row.delivered_at),
			firstOpenedAt: iso(row.opened_at),
			firstClickedAt: iso(row.clicked_at),
			bouncedAt: iso(row.bounced_at),
			complainedAt: iso(row.complained_at),
		})),
		activity: activity.map((row: any) => ({ type: row.type, occurredAt: iso(row.occurred_at), data: parseData(row.data) })),
		suppression: suppression ? { reason: (suppression as any).reason, since: iso((suppression as any).created_at) } : null,
	};
}

// Erasure (GDPR article 17): the address's contacts, history and profile go. Sent messages keep their
// copy of the address only as long as campaign stats need it, so they're anonymized instead. The
// suppression stays, so an address that bounced or complained is never emailed again.
export async function deletePerson(id: string) {
	const person = await getPerson(id);
	if (!person) return false;
	await batch([
		statement("DELETE FROM contacts WHERE email = ?", [person.email]),
		statement("DELETE FROM contact_activity WHERE email = ?", [person.email]),
		statement("UPDATE messages SET email = ?, contact_id = NULL WHERE email = ?", [`deleted-${person._id}@invalid`, person.email]),
		statement("DELETE FROM people WHERE id = ?", [person._id]),
	]);
	return true;
}
