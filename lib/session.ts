import { verifySessionToken } from "@/lib/session-token";
import { first } from "@/server/db";

export type Session = { adminId: string; email: string; version: number };

// A valid signature isn't enough: the admin must still exist with the same session version.
export async function verifySession(token: string | undefined | null): Promise<Session | null> {
	const payload = await verifySessionToken(token);
	if (!payload) return null;
	const admin = await first<{ email: string; session_version: number }>("SELECT email, session_version FROM admins WHERE id = ?", [
		payload.adminId,
	]).catch(() => null);
	if (!admin || Number(admin.session_version) !== payload.version) return null;
	return { adminId: payload.adminId, email: admin.email, version: payload.version };
}
