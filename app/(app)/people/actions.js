"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { deletePerson, updatePerson } from "@/lib/people";
import { isObjectIdString } from "@/lib/validation";

export async function savePerson(id, { firstName, lastName, phone }) {
	await requireSession();
	if (!isObjectIdString(id)) return { error: "Contact not found" };
	const result = await updatePerson(id, {
		firstName: String(firstName ?? ""),
		lastName: String(lastName ?? ""),
		phone: String(phone ?? ""),
	});
	if (result.error) return { error: result.error };
	revalidatePath(`/people/${id}`);
	revalidatePath("/contacts");
	return { ok: true };
}

// Erasure: every subscription, the history and the profile. The suppression list keeps the address.
export async function removePerson(id) {
	await requireSession();
	if (!isObjectIdString(id) || !(await deletePerson(id))) return { error: "Contact not found" };
	revalidatePath("/contacts");
	return { ok: true };
}
