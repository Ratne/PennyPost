import { NextResponse } from "next/server";
import { WRITES_PER_KEY, fail, getApiContact, readJson, requireApiKey, serializeContact } from "@/lib/api";
import { addTags, ensureTags, normalizeTagNames } from "@/lib/tags";
import { isPlainObject } from "@/lib/validation";

// Adds tags by name, creating the ones that don't exist yet: { "tags": ["vip", "webinar-2026"] }
export async function POST(request, { params }) {
	const { response } = await requireApiKey(request, WRITES_PER_KEY);
	if (response) return response;
	const contact = await getApiContact((await params).id);
	if (!contact) return fail(404, "Contact not found");

	const body = await readJson(request);
	if (!isPlainObject(body) || !Array.isArray(body.tags)) return fail(400, "tags must be a list of names");
	const names = normalizeTagNames(body.tags);
	if (names.length === 0) return fail(400, "tags must name at least one tag");

	const tags = await ensureTags(names);
	await addTags(
		[contact._id],
		tags.map(({ id }) => id),
		"api"
	);
	return NextResponse.json(serializeContact(await getApiContact(contact._id)));
}
