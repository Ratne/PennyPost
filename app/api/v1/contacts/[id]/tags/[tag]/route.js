import { NextResponse } from "next/server";
import { WRITES_PER_KEY, fail, getApiContact, requireApiKey, serializeContact } from "@/lib/api";
import { getTag, removeTags } from "@/lib/tags";

// The tag can be named by id or by name (URL-encoded).
export async function DELETE(request, { params }) {
	const { response } = await requireApiKey(request, WRITES_PER_KEY);
	if (response) return response;
	const { id, tag: tagRef } = await params;
	const contact = await getApiContact(id);
	if (!contact) return fail(404, "Contact not found");

	let name = tagRef;
	try {
		name = decodeURIComponent(tagRef);
	} catch {}
	const tag = await getTag(name);
	if (tag) await removeTags([contact._id], [tag.id], "api");
	return NextResponse.json(serializeContact(await getApiContact(contact._id)));
}
