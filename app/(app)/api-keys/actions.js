"use server";

import { revalidatePath } from "next/cache";
import { notifyActivity } from "@/lib/alerts";
import { generateApiKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/config";
import { isObjectIdString } from "@/lib/validation";
import { newId, run } from "@/server/db";

export async function createApiKey(_state, formData) {
	await requireSession();
	const name = String(formData.get("name") ?? "")
		.trim()
		.slice(0, 60);
	if (!name) return { error: "Name is required" };

	const { key, prefix, hash } = generateApiKey();
	const now = Date.now();
	await run("INSERT INTO api_keys (id, name, prefix, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
		newId(),
		name,
		prefix,
		hash,
		now,
		now,
	]);
	await notifyActivity([`API key created: ${name}`, `${getAppUrl()}/api-keys`]);

	revalidatePath("/api-keys");
	return { key };
}

export async function revokeApiKey(id) {
	await requireSession();
	if (!isObjectIdString(id)) return { error: "Key not found" };

	const now = Date.now();
	await run("UPDATE api_keys SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL", [now, now, id]);

	revalidatePath("/api-keys");
	return { ok: true };
}
