import { enrollOnTagAdded } from "@/lib/automations";
import { findContactRefs, logActivities } from "@/lib/contact-activity";
import { MAX_BOUND_PARAMS, all, batch, chunk, first, newId, placeholders, run, statement } from "@/server/db";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_CONTACT, TAG_COLORS, normalizeTagName, normalizeTagNames } from "@/lib/tag-names";

export { MAX_TAG_LENGTH, MAX_TAGS_PER_CONTACT, TAG_COLORS, normalizeTagName, normalizeTagNames };
const ID_PATTERN = /^[a-f0-9]{24}$/;

export type Tag = { id: string; name: string; color: string | null; contacts?: number };

function normalizeColor(value: unknown) {
	return typeof value === "string" && TAG_COLORS.includes(value) ? value : null;
}

// The contact's tags as a JSON list, for SELECTs over contacts (read back by toContact).
export function tagsColumn(alias = "c") {
	return `(SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color))
		FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ${alias}.id) AS tags`;
}

export async function listTags({ newsletterId }: { newsletterId?: string } = {}): Promise<Tag[]> {
	const count = newsletterId
		? "(SELECT COUNT(*) FROM contact_tags ct JOIN contacts c ON c.id = ct.contact_id WHERE ct.tag_id = t.id AND c.newsletter_id = ?)"
		: "(SELECT COUNT(*) FROM contact_tags ct WHERE ct.tag_id = t.id)";
	return all<Tag>(`SELECT t.id, t.name, t.color, ${count} AS contacts FROM tags t ORDER BY t.name ASC`, newsletterId ? [newsletterId] : []);
}

export async function getTag(idOrName: string) {
	if (ID_PATTERN.test(idOrName)) {
		const byId = await first<Tag>("SELECT id, name, color FROM tags WHERE id = ?", [idOrName]);
		if (byId) return byId;
	}
	const name = normalizeTagName(idOrName);
	return name ? first<Tag>("SELECT id, name, color FROM tags WHERE name = ?", [name]) : null;
}

export async function createTag({ name, color }: { name: unknown; color?: unknown }) {
	const normalized = normalizeTagName(name);
	if (!normalized) return { error: "Name is required" };
	const existing = await getTag(normalized);
	if (existing) return { tag: existing, created: false };
	const tag = { id: newId(), name: normalized, color: normalizeColor(color) };
	await run("INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING", [
		tag.id,
		tag.name,
		tag.color,
		Date.now(),
	]);
	return { tag: (await getTag(normalized))!, created: true };
}

export async function updateTag(id: string, { name, color }: { name?: unknown; color?: unknown }) {
	const tag = await getTag(id);
	if (!tag) return { error: "Tag not found" };
	const normalized = name === undefined ? tag.name : normalizeTagName(name);
	if (!normalized) return { error: "Name is required" };
	const taken = normalized !== tag.name && (await getTag(normalized));
	if (taken) return { error: "Another tag has this name" };
	await run("UPDATE tags SET name = ?, color = ? WHERE id = ?", [normalized, color === undefined ? tag.color : normalizeColor(color), tag.id]);
	return { tag: (await getTag(tag.id))! };
}

// Segments keep the id in their rules; a deleted tag simply matches no one there.
export async function deleteTag(id: string) {
	const tag = await first<{ id: string; name: string }>("SELECT id, name FROM tags WHERE id = ?", [id]);
	if (!tag) return false;
	const removed = await all<TagPair>("DELETE FROM contact_tags WHERE tag_id = ? RETURNING contact_id, tag_id", [id]);
	await logTagChanges(removed, "tag_removed", "tag_deleted");
	const { changes } = await run("DELETE FROM tags WHERE id = ?", [id]);
	return changes > 0;
}

// Finds each tag by name, creating the missing ones.
export async function ensureTags(names: string[]) {
	const normalized = normalizeTagNames(names);
	if (normalized.length === 0) return [];
	const now = Date.now();
	for (const group of chunk(normalized, Math.floor(MAX_BOUND_PARAMS / 3))) {
		await run(
			`INSERT INTO tags (id, name, created_at) VALUES ${group.map(() => "(?, ?, ?)").join(", ")} ON CONFLICT(name) DO NOTHING`,
			group.flatMap((name) => [newId(), name, now])
		);
	}
	const tags: Tag[] = [];
	for (const group of chunk(normalized, MAX_BOUND_PARAMS)) {
		tags.push(...(await all<Tag>(`SELECT id, name, color FROM tags WHERE name IN (${placeholders(group.length)})`, group)));
	}
	return tags;
}

type TagPair = { contact_id: string; tag_id: string };

// The tag's name is copied into each event, so the history still reads right after a rename or a deletion.
async function logTagChanges(pairs: TagPair[], type: "tag_added" | "tag_removed", source: string) {
	if (pairs.length === 0) return;
	const now = Date.now();
	const [contacts, names] = await Promise.all([
		findContactRefs(pairs.map(({ contact_id }) => contact_id)),
		tagNames([...new Set(pairs.map(({ tag_id }) => tag_id))]),
	]);
	await logActivities(
		pairs.flatMap(({ contact_id, tag_id }) => {
			const contact = contacts.get(contact_id);
			if (!contact) return [];
			return [
				{
					email: contact.email,
					contactId: contact.id,
					newsletterId: contact.newsletterId,
					type,
					data: { tagId: tag_id, tag: names.get(tag_id) ?? null, source },
					occurredAt: now,
				},
			];
		})
	);
}

async function tagNames(ids: string[]) {
	const names = new Map<string, string>();
	for (const group of chunk(ids, MAX_BOUND_PARAMS)) {
		const rows = await all<{ id: string; name: string }>(`SELECT id, name FROM tags WHERE id IN (${placeholders(group.length)})`, group);
		for (const row of rows) names.set(row.id, row.name);
	}
	return names;
}

export async function addTags(contactIds: string[], tagIds: string[], source = "dashboard") {
	const pairs = contactIds.flatMap((contactId) => tagIds.map((tagId) => [contactId, tagId]));
	if (pairs.length === 0) return 0;
	const now = Date.now();
	const statements = chunk(pairs, Math.floor(MAX_BOUND_PARAMS / 3)).map((group) =>
		statement(
			`INSERT OR IGNORE INTO contact_tags (contact_id, tag_id, created_at) VALUES ${group.map(() => "(?, ?, ?)").join(", ")}
			 RETURNING contact_id, tag_id`,
			group.flatMap(([contactId, tagId]) => [contactId, tagId, now])
		)
	);
	const added: TagPair[] = [];
	for (const group of chunk(statements, 50)) {
		for (const result of await batch(group)) added.push(...((result.results ?? []) as TagPair[]));
	}
	await logTagChanges(added, "tag_added", source);
	try {
		await enrollOnTagAdded(added);
	} catch (error: any) {
		console.error("[automations] Enrollment failed:", error?.message);
	}
	return added.length;
}

export async function removeTags(contactIds: string[], tagIds: string[], source = "dashboard") {
	if (contactIds.length === 0 || tagIds.length === 0) return 0;
	const removed: TagPair[] = [];
	const contactsPerStatement = Math.max(1, MAX_BOUND_PARAMS - tagIds.length);
	for (const group of chunk(contactIds, contactsPerStatement)) {
		removed.push(
			...(await all<TagPair>(
				`DELETE FROM contact_tags WHERE contact_id IN (${placeholders(group.length)}) AND tag_id IN (${placeholders(tagIds.length)})
				 RETURNING contact_id, tag_id`,
				[...group, ...tagIds]
			))
		);
	}
	await logTagChanges(removed, "tag_removed", source);
	return removed.length;
}

// Replaces a contact's tags with exactly these names.
export async function setContactTags(contactId: string, names: string[], source = "dashboard") {
	const tags = await ensureTags(names);
	const ids = tags.map(({ id }) => id);
	const removed = await all<TagPair>(
		`DELETE FROM contact_tags WHERE contact_id = ? ${ids.length > 0 ? `AND tag_id NOT IN (${placeholders(ids.length)})` : ""}
		 RETURNING contact_id, tag_id`,
		[contactId, ...ids]
	);
	await logTagChanges(removed, "tag_removed", source);
	await addTags([contactId], ids, source);
	return tags;
}

export async function getContactTags(contactId: string) {
	return all<Tag>(
		"SELECT t.id, t.name, t.color FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ? ORDER BY t.name",
		[contactId]
	);
}
