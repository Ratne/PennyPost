import { NextResponse } from "next/server";
import { READS_PER_KEY, WRITES_PER_KEY, fail, getApiContact, readJson, readPersonInput, requireApiKey, serializeContact } from "@/lib/api";
import { deleteContact, reactivateContact, unsubscribeContact } from "@/lib/contacts";
import { ensurePeople, getPersonByEmail, updatePerson } from "@/lib/people";
import { setContactTags } from "@/lib/tags";
import { isPlainObject } from "@/lib/validation";
import { run } from "@/server/db";

const MAX_SOURCE_LENGTH = 100;

export async function GET(request, { params }) {
	const { response } = await requireApiKey(request, READS_PER_KEY);
	if (response) return response;
	const contact = await getApiContact((await params).id);
	return contact ? NextResponse.json(serializeContact(contact)) : fail(404, "Contact not found");
}

// Changes status ("active" or "unsubscribed"), source or the whole tag list. Bounced, complained and
// suppressed addresses can never become active again through the API.
export async function PATCH(request, { params }) {
	const { response } = await requireApiKey(request, WRITES_PER_KEY);
	if (response) return response;
	const contact = await getApiContact((await params).id);
	if (!contact) return fail(404, "Contact not found");

	const body = await readJson(request);
	if (!isPlainObject(body)) return fail(400, "Send a JSON object");
	const { status, source, tags } = body;
	if (status !== undefined && !["active", "unsubscribed"].includes(status)) return fail(400, 'status must be "active" or "unsubscribed"');
	if (source !== undefined && (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH)) {
		return fail(400, `source must be a string of at most ${MAX_SOURCE_LENGTH} characters`);
	}
	if (tags !== undefined && !Array.isArray(tags)) return fail(400, "tags must be a list of names");
	const person = readPersonInput(body);
	if (person.error) return fail(400, person.error);

	if (status && status !== contact.status) {
		const changed =
			status === "unsubscribed" ? await unsubscribeContact(contact._id, "api") : await reactivateContact(contact._id, ["unsubscribed", "dormant", "pending"]);
		if (!changed) return fail(409, `A ${contact.status} contact can't become ${status}`);
	}
	if (source !== undefined) {
		await run("UPDATE contacts SET source = ?, updated_at = ? WHERE id = ?", [source.trim() || null, Date.now(), contact._id]);
	}
	if (tags !== undefined) await setContactTags(contact._id, tags, "api");
	if (Object.keys(person.fields).length > 0) {
		await ensurePeople([contact.email]);
		const saved = await getPersonByEmail(contact.email);
		if (saved) await updatePerson(saved._id, person.fields);
	}

	return NextResponse.json(serializeContact(await getApiContact(contact._id)));
}

export async function DELETE(request, { params }) {
	const { response } = await requireApiKey(request, WRITES_PER_KEY);
	if (response) return response;
	const deleted = await deleteContact((await params).id);
	return deleted ? new Response(null, { status: 204 }) : fail(404, "Contact not found");
}
