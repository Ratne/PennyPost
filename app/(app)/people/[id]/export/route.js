import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { exportPerson } from "@/lib/people";
import { isObjectIdString } from "@/lib/validation";

export async function GET(_request, { params }) {
	if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const { id } = await params;
	const data = isObjectIdString(id) ? await exportPerson(id) : null;
	if (!data) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

	const filename = `contact-${data.person.email.replace(/[^a-z0-9.@_-]/gi, "_")}.json`;
	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}
