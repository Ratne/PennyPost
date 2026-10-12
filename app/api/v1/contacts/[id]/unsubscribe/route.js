import { NextResponse } from "next/server";
import { WRITES_PER_KEY, fail, getApiContact, requireApiKey, serializeContact } from "@/lib/api";
import { unsubscribeContact } from "@/lib/contacts";

// Already unsubscribed, bounced or complained contacts come back unchanged.
export async function POST(request, { params }) {
	const { response } = await requireApiKey(request, WRITES_PER_KEY);
	if (response) return response;
	const contact = await getApiContact((await params).id);
	if (!contact) return fail(404, "Contact not found");
	await unsubscribeContact(contact._id, "api");
	return NextResponse.json(serializeContact(await getApiContact(contact._id)));
}
