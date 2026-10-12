import {
	DUMMY_PASSWORD_HASH,
	LOGIN_CODE_TTL_MS,
	MAX_LOGIN_CODE_ATTEMPTS,
	generateLoginCode,
	getPasswordProblem,
	hashLoginCode,
	hashPassword,
	isLoginCodeMatch,
	verifyPassword,
} from "@/lib/passwords";
import { normalizeEmail } from "@/lib/validation";
import { all, batch, first, newId, run, statement } from "@/server/db";

export type Admin = { id: string; email: string; sessionVersion: number; lastLoginAt: Date | null; createdAt: Date };

type AdminRow = { id: string; email: string; password_hash: string; session_version: number; last_login_at: number | null; created_at: number };

function toAdmin(row: AdminRow | null): Admin | null {
	if (!row) return null;
	return {
		id: row.id,
		email: row.email,
		sessionVersion: Number(row.session_version),
		lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
		createdAt: new Date(row.created_at),
	};
}

export async function listAdmins() {
	const rows = await all<AdminRow>("SELECT * FROM admins ORDER BY created_at ASC");
	return rows.map((row) => toAdmin(row)!);
}

export async function getAdmin(id: string) {
	return toAdmin(await first<AdminRow>("SELECT * FROM admins WHERE id = ?", [id]));
}

// Alerts go to every admin; before the first login, to ADMIN_EMAIL.
export async function listAdminEmails() {
	const rows = await all<{ email: string }>("SELECT email FROM admins ORDER BY created_at ASC").catch(() => []);
	if (rows.length > 0) return rows.map(({ email }) => email);
	const fallback = normalizeEmail(process.env.ADMIN_EMAIL);
	return fallback ? [fallback] : [];
}

// The first admin comes from ADMIN_EMAIL and ADMIN_PASSWORD, once: after that the variables are ignored
// and can be deleted. The WHERE NOT EXISTS keeps two simultaneous first logins from adding it twice.
export async function seedFirstAdmin() {
	if (await first("SELECT 1 FROM admins LIMIT 1")) return;
	const email = normalizeEmail(process.env.ADMIN_EMAIL);
	const password = process.env.ADMIN_PASSWORD ?? "";
	if (!email || getPasswordProblem(password)) return;
	const now = Date.now();
	await run(
		`INSERT INTO admins (id, email, password_hash, session_version, created_at, updated_at)
		 SELECT ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)`,
		[newId(), email, await hashPassword(password), now, now]
	);
}

// Same work whether or not the email belongs to an admin, so timing doesn't tell them apart.
export async function verifyCredentials(email: unknown, password: unknown) {
	await seedFirstAdmin();
	const normalized = normalizeEmail(email);
	const row = normalized ? await first<AdminRow>("SELECT * FROM admins WHERE email = ?", [normalized]) : null;
	const isMatch = await verifyPassword(String(password ?? ""), row?.password_hash ?? DUMMY_PASSWORD_HASH);
	return row && isMatch ? toAdmin(row) : null;
}

function getCodeSecret() {
	const secret = process.env.SESSION_SECRET;
	if (!secret) throw new Error("SESSION_SECRET is not set");
	return secret;
}

// A new code replaces any earlier one still open for the admin.
export async function createLoginChallenge(adminId: string) {
	const id = newId();
	const code = generateLoginCode();
	const now = Date.now();
	await batch([
		statement("UPDATE login_challenges SET used_at = ? WHERE admin_id = ? AND used_at IS NULL", [now, adminId]),
		statement("INSERT INTO login_challenges (id, admin_id, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)", [
			id,
			adminId,
			await hashLoginCode(code, id, getCodeSecret()),
			now + LOGIN_CODE_TTL_MS,
			now,
		]),
	]);
	return { id, code, expiresAt: now + LOGIN_CODE_TTL_MS };
}

export type ChallengeResult = { admin: Admin } | { error: "expired" } | { error: "wrong"; attemptsLeft: number };

// Each try spends an attempt before the code is compared, in one statement, so parallel guesses can't
// get past the limit. A code works once; the third wrong try ends it.
export async function verifyLoginChallenge(challengeId: string, code: string): Promise<ChallengeResult> {
	const now = Date.now();
	const challenge = await first<{ admin_id: string; code_hash: string; attempts: number }>(
		`UPDATE login_challenges SET attempts = attempts + 1
		 WHERE id = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?
		 RETURNING admin_id, code_hash, attempts`,
		[challengeId, now, MAX_LOGIN_CODE_ATTEMPTS]
	);
	if (!challenge) return { error: "expired" };

	if (!(await isLoginCodeMatch(code, challengeId, getCodeSecret(), challenge.code_hash))) {
		const attemptsLeft = MAX_LOGIN_CODE_ATTEMPTS - Number(challenge.attempts);
		if (attemptsLeft <= 0) await run("UPDATE login_challenges SET used_at = ? WHERE id = ?", [now, challengeId]);
		return attemptsLeft > 0 ? { error: "wrong", attemptsLeft } : { error: "expired" };
	}
	const { changes } = await run("UPDATE login_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL", [now, challengeId]);
	if (!changes) return { error: "expired" };
	await run("UPDATE admins SET last_login_at = ? WHERE id = ?", [now, challenge.admin_id]);
	const admin = await getAdmin(challenge.admin_id);
	return admin ? { admin } : { error: "expired" };
}

export async function getChallengeAdmin(challengeId: string) {
	const row = await first<{ email: string }>(
		`SELECT a.email FROM login_challenges l JOIN admins a ON a.id = l.admin_id
		 WHERE l.id = ? AND l.used_at IS NULL AND l.expires_at > ?`,
		[challengeId, Date.now()]
	);
	return row?.email ?? null;
}

export async function createAdmin({ email, password }: { email: unknown; password: unknown }) {
	const normalized = normalizeEmail(email);
	if (!normalized) return { error: "Enter a valid email" };
	const problem = getPasswordProblem(password);
	if (problem) return { error: problem };
	const now = Date.now();
	const { changes } = await run(
		`INSERT INTO admins (id, email, password_hash, session_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
		 ON CONFLICT(email) DO NOTHING`,
		[newId(), normalized, await hashPassword(String(password)), now, now]
	);
	return changes ? { ok: true } : { error: "That email is already an admin" };
}

// Never yourself (that's how the last admin stays) and never the last one.
export async function deleteAdmin(id: string, currentAdminId: string) {
	if (id === currentAdminId) return { error: "You can't remove yourself" };
	const { changes } = await run("DELETE FROM admins WHERE id = ? AND (SELECT COUNT(*) FROM admins) > 1", [id]);
	return changes ? { ok: true } : { error: "Admin not found" };
}

async function checkCurrentPassword(adminId: string, password: unknown) {
	const row = await first<AdminRow>("SELECT * FROM admins WHERE id = ?", [adminId]);
	const isMatch = await verifyPassword(String(password ?? ""), row?.password_hash ?? DUMMY_PASSWORD_HASH);
	return row && isMatch ? row : null;
}

export async function changeEmail(adminId: string, { email, currentPassword }: { email: unknown; currentPassword: unknown }) {
	const normalized = normalizeEmail(email);
	if (!normalized) return { error: "Enter a valid email" };
	if (!(await checkCurrentPassword(adminId, currentPassword))) return { error: "Current password is wrong" };
	if (await first("SELECT 1 FROM admins WHERE email = ? AND id != ?", [normalized, adminId])) {
		return { error: "That email is already an admin" };
	}
	await run("UPDATE admins SET email = ?, updated_at = ? WHERE id = ?", [normalized, Date.now(), adminId]);
	return { ok: true };
}

// Signs out the admin's other sessions; the caller starts a new one for this browser.
export async function changePassword(adminId: string, { password, currentPassword }: { password: unknown; currentPassword: unknown }) {
	const problem = getPasswordProblem(password);
	if (problem) return { error: problem };
	if (!(await checkCurrentPassword(adminId, currentPassword))) return { error: "Current password is wrong" };
	await run("UPDATE admins SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?", [
		await hashPassword(String(password)),
		Date.now(),
		adminId,
	]);
	return { ok: true };
}

export async function signOutEverywhere(adminId: string) {
	await run("UPDATE admins SET session_version = session_version + 1, updated_at = ? WHERE id = ?", [Date.now(), adminId]);
}
