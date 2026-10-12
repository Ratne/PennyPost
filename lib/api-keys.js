import "server-only";
import { hashApiKey, readBearerToken, shouldTouchLastUsed } from "@/lib/api-key-tokens";
import { first, run } from "@/server/db";

export { generateApiKey, hashApiKey } from "@/lib/api-key-tokens";

export async function authenticateRequest(request) {
	const key = readBearerToken(request.headers.get("authorization"));
	if (!key) return null;

	const row = await first("SELECT id, name, prefix, last_used_at FROM api_keys WHERE hash = ? AND revoked_at IS NULL", [
		hashApiKey(key),
	]);
	if (!row) return null;
	const apiKey = { _id: row.id, name: row.name, prefix: row.prefix, lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null };

	const now = Date.now();
	if (shouldTouchLastUsed(apiKey.lastUsedAt, now)) {
		await run("UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?", [now, now, apiKey._id]).catch((error) =>
			console.error("[api-keys] Could not update lastUsedAt:", error.message)
		);
	}
	return apiKey;
}
