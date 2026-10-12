import { NextResponse } from "next/server";
import { READS_PER_KEY, WRITES_PER_KEY, fail, findNewsletterBySlug, readJson, requireApiKey } from "@/lib/api";
import { TAG_COLORS, createTag, listTags } from "@/lib/tags";
import { isPlainObject } from "@/lib/validation";

function serializeTag({ id, name, color, contacts }) {
	return { id, name, color: color ?? null, ...(contacts !== undefined && { contacts: Number(contacts) }) };
}

// Every tag with its contact count; ?newsletter= counts that newsletter's contacts only.
export async function GET(request) {
	const { response } = await requireApiKey(request, READS_PER_KEY);
	if (response) return response;

	const slug = new URL(request.url).searchParams.get("newsletter");
	const newsletter = slug ? await findNewsletterBySlug(slug) : null;
	if (slug && !newsletter) return fail(404, "Newsletter not found");

	const tags = await listTags({ newsletterId: newsletter?._id });
	return NextResponse.json({ tags: tags.map(serializeTag) });
}

export async function POST(request) {
	const { response } = await requireApiKey(request, WRITES_PER_KEY);
	if (response) return response;

	const body = await readJson(request);
	if (!isPlainObject(body)) return fail(400, "Send a JSON object");
	if (body.color !== undefined && !TAG_COLORS.includes(body.color)) return fail(400, `color must be one of ${TAG_COLORS.join(", ")}`);

	const result = await createTag({ name: body.name, color: body.color });
	if (result.error) return fail(400, result.error);
	return NextResponse.json(serializeTag(result.tag), { status: result.created ? 201 : 200 });
}
