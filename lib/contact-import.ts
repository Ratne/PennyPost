import { type ActivityType, forContacts, logActivities } from "@/lib/contact-activity";
import { SUPPRESSION_REASONS, getContactInserts, getStatusChanges } from "@/lib/contact-import-plan";
import { sanitizeImportRow } from "@/lib/csv-import";
import { mergePeople } from "@/lib/people";
import { addTags, ensureTags } from "@/lib/tags";
import { MAX_BOUND_PARAMS, all, batch, chunk, newId, placeholders, statement } from "@/server/db";

const INSERT_COLUMNS = 12;

async function findIds(newsletterId: string, emails: string[]) {
	const ids = new Map<string, string>();
	for (const group of chunk(emails, MAX_BOUND_PARAMS - 1)) {
		const rows = await all<{ id: string; email: string }>(
			`SELECT id, email FROM contacts WHERE newsletter_id = ? AND email IN (${placeholders(group.length)})`,
			[newsletterId, ...group]
		);
		for (const { id, email } of rows) ids.set(email, id);
	}
	return ids;
}

async function runAll(statements: D1PreparedStatement[]) {
	const results: D1Result[] = [];
	for (const group of chunk(statements, 50)) results.push(...(await batch(group)));
	return results;
}

// Never deletes and never moves a contact back to a weaker status: an unsubscribe, bounce or
// complaint always wins. `tags` go on every row, on top of the file's own tags column.
export async function importContactRows({
	newsletterId,
	rows,
	source = "import",
	tags = [],
}: {
	newsletterId: string;
	rows: unknown[];
	source?: string;
	tags?: string[];
}) {
	const contacts = [...new Map(rows.map(sanitizeImportRow).filter(Boolean).map((row: any) => [row.email, row])).values()] as any[];
	if (contacts.length === 0) return { created: 0, existing: 0, invalid: rows.length };

	const emails = contacts.map(({ email }) => email);
	const existing = await findIds(newsletterId, emails);
	const now = Date.now();

	// Existing contacts keep everything but get the file's engagement figures, when it has some.
	const inserts: any[] = getContactInserts({ contacts, source, now });
	await runAll(
		chunk(inserts, Math.floor(MAX_BOUND_PARAMS / INSERT_COLUMNS)).map((group) =>
			statement(
				`INSERT INTO contacts (id, newsletter_id, email, status, source, subscribed_at, unsubscribed_at,
					imported_emails_received, imported_open_rate, imported_click_rate, created_at, updated_at)
				 VALUES ${group.map(() => `(${placeholders(INSERT_COLUMNS)})`).join(", ")}
				 ON CONFLICT(newsletter_id, email) DO UPDATE SET
					imported_emails_received = COALESCE(excluded.imported_emails_received, contacts.imported_emails_received),
					imported_open_rate = COALESCE(excluded.imported_open_rate, contacts.imported_open_rate),
					imported_click_rate = COALESCE(excluded.imported_click_rate, contacts.imported_click_rate)`,
				group.flatMap((row) => [
					newId(),
					newsletterId,
					row.email,
					row.status,
					row.source,
					row.subscribedAt,
					row.unsubscribedAt,
					row.emailsReceived,
					row.openRate,
					row.clickRate,
					now,
					now,
				])
			)
		)
	);

	await mergePeople(contacts.map(({ email, firstName, lastName, phone }) => ({ email, firstName, lastName, phone })));
	const ids = await findIds(newsletterId, emails);
	await logActivities(
		inserts
			.filter((row) => !existing.has(row.email) && ids.has(row.email))
			.map((row) => ({
				email: row.email,
				contactId: ids.get(row.email),
				newsletterId,
				type: "imported" as const,
				data: { source, status: row.status },
				occurredAt: now,
			}))
	);

	const changes = getStatusChanges(contacts);
	for (const { status, emails: changed, replaces } of changes) {
		const perStatement = MAX_BOUND_PARAMS - replaces.length - 3;
		const results = await runAll(
			chunk(changed, perStatement).map((group) =>
				statement(
					`UPDATE contacts SET status = ?, ${status === "unsubscribed" ? "unsubscribed_at = ?," : ""} updated_at = ?
					 WHERE newsletter_id = ? AND email IN (${placeholders(group.length)}) AND status IN (${placeholders(replaces.length)})
					 RETURNING id, email, newsletter_id`,
					[status, ...(status === "unsubscribed" ? [now] : []), now, newsletterId, ...group, ...replaces]
				)
			)
		);
		const updated = results.flatMap((result) => (result.results ?? []) as { id: string; email: string; newsletter_id: string }[]);
		await logActivities(forContacts(updated, { type: status as ActivityType, occurredAt: now, data: { source } }));
	}

	const suppressed = changes.flatMap(({ status, emails: changed }) =>
		SUPPRESSION_REASONS[status as keyof typeof SUPPRESSION_REASONS]
			? changed.map((email) => [email, SUPPRESSION_REASONS[status as keyof typeof SUPPRESSION_REASONS]])
			: []
	);
	await runAll(
		chunk(suppressed, Math.floor(MAX_BOUND_PARAMS / 5)).map((group) =>
			statement(
				`INSERT OR IGNORE INTO suppressions (email, reason, detail, created_at, updated_at) VALUES ${group.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
				group.flatMap(([email, reason]) => [email, reason, source, now, now])
			)
		)
	);

	const wantsTags = tags.length > 0 || contacts.some((contact) => contact.tags?.length > 0);
	if (wantsTags) {
		const allNames = [...new Set([...tags, ...contacts.flatMap((contact) => contact.tags ?? [])])];
		const tagIds = new Map((await ensureTags(allNames)).map(({ id, name }) => [name, id]));
		const shared = tags.map((name) => tagIds.get(name)).filter(Boolean) as string[];
		if (shared.length > 0) await addTags([...ids.values()], shared, "import");
		for (const contact of contacts) {
			const own = (contact.tags ?? []).map((name: string) => tagIds.get(name)).filter(Boolean);
			const id = ids.get(contact.email);
			if (id && own.length > 0) await addTags([id], own, "import");
		}
	}

	const created = emails.filter((email) => !existing.has(email)).length;
	return { created, existing: contacts.length - created, invalid: rows.length - contacts.length };
}
