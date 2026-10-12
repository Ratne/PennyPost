"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { importContactRows } from "@/lib/contact-import";
import { deleteContact, reactivateContact, unsubscribeContact } from "@/lib/contacts";
import { MAX_IMPORT_ROWS_PER_REQUEST, normalizeTags } from "@/lib/csv-import";
import { addTags, createTag, deleteTag, ensureTags, removeTags, setContactTags, updateTag } from "@/lib/tags";
import { isObjectIdString } from "@/lib/validation";
import { first } from "@/server/db";

const MAX_BULK_CONTACTS = 500;

export async function importContacts({ newsletterId, rows, tags }) {
	await requireSession();
	if (!isObjectIdString(newsletterId)) return { error: "Newsletter not found" };
	if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS_PER_REQUEST) return { error: "Too many rows" };
	if (!(await first("SELECT 1 FROM newsletters WHERE id = ?", [newsletterId]))) return { error: "Newsletter not found" };

	const result = await importContactRows({ newsletterId, rows, tags: normalizeTags(tags ?? []) });
	revalidatePath("/contacts");
	revalidatePath("/people/[id]", "page");
	return result;
}

// Reactivation only applies to dormant contacts here; unsubscribes, bounces and complaints are final.
export async function setContactStatus(id, status) {
	await requireSession();
	if (!isObjectIdString(id) || !["active", "unsubscribed"].includes(status)) {
		return { error: "Invalid request" };
	}
	const changed = status === "active" ? await reactivateContact(id, ["dormant"]) : await unsubscribeContact(id);

	revalidatePath("/contacts");
	revalidatePath("/people/[id]", "page");
	return changed ? { ok: true } : { error: "Status cannot change" };
}

export async function removeContact(id) {
	await requireSession();
	if (!isObjectIdString(id)) return { error: "Invalid request" };
	await deleteContact(id);
	revalidatePath("/contacts");
	revalidatePath("/people/[id]", "page");
	return { ok: true };
}

function contactIds(ids) {
	return Array.isArray(ids) ? [...new Set(ids.filter(isObjectIdString))].slice(0, MAX_BULK_CONTACTS) : [];
}

export async function saveContactTags(id, names) {
	await requireSession();
	if (!isObjectIdString(id)) return { error: "Invalid request" };
	const tags = await setContactTags(id, normalizeTags(names ?? []));
	revalidatePath("/contacts");
	revalidatePath("/people/[id]", "page");
	return { ok: true, tags };
}

// Adds (or removes) tags by name on the selected contacts; adding creates the missing tags.
export async function tagContacts({ ids, names, remove = false }) {
	await requireSession();
	const contacts = contactIds(ids);
	const tagNames = normalizeTags(names ?? []);
	if (contacts.length === 0 || tagNames.length === 0) return { error: "Pick contacts and at least one tag" };

	const tags = await ensureTags(tagNames);
	const tagIds = tags.map(({ id }) => id);
	const changed = remove ? await removeTags(contacts, tagIds) : await addTags(contacts, tagIds);
	revalidatePath("/contacts");
	revalidatePath("/people/[id]", "page");
	return { ok: true, changed };
}

export async function saveTag({ id, name, color }) {
	await requireSession();
	const result = id ? await updateTag(id, { name, color }) : await createTag({ name, color });
	if (result.error) return { error: result.error };
	revalidatePath("/contacts");
	revalidatePath("/people/[id]", "page");
	revalidatePath("/tags");
	revalidatePath("/segments");
	return { ok: true, tag: result.tag };
}

export async function removeTag(id) {
	await requireSession();
	if (!isObjectIdString(id)) return { error: "Invalid request" };
	await deleteTag(id);
	revalidatePath("/contacts");
	revalidatePath("/people/[id]", "page");
	revalidatePath("/tags");
	revalidatePath("/segments");
	return { ok: true };
}
