"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { countSegment, createSegment, deleteSegment, getSegment, updateSegment } from "@/lib/segment-store";
import { isObjectIdString } from "@/lib/validation";
import { first } from "@/server/db";

export async function previewSegment({ newsletterId, rules }) {
	await requireSession();
	if (!isObjectIdString(newsletterId)) return { error: "Pick a newsletter" };
	return countSegment(newsletterId, rules);
}

export async function saveSegment({ id, newsletterId, name, rules }) {
	await requireSession();
	let result;
	if (id) {
		if (!isObjectIdString(id) || !(await getSegment(id))) return { error: "Segment not found" };
		result = await updateSegment(id, { name, rules });
	} else {
		if (!isObjectIdString(newsletterId) || !(await first("SELECT 1 FROM newsletters WHERE id = ?", [newsletterId]))) {
			return { error: "Newsletter not found" };
		}
		result = await createSegment({ newsletterId, name, rules });
	}
	if (result.error) return { error: result.error };
	revalidatePath("/segments");
	revalidatePath("/campaigns", "layout");
	return { ok: true, id: result.segment._id };
}

export async function removeSegment(id) {
	await requireSession();
	if (!isObjectIdString(id)) return { error: "Invalid request" };
	const result = await deleteSegment(id);
	if (result.error) return { error: result.error };
	revalidatePath("/segments");
	revalidatePath("/campaigns", "layout");
	return { ok: true };
}
