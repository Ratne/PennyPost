"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeEmail, changePassword, createAdmin, deleteAdmin, getAdmin, signOutEverywhere } from "@/lib/admins";
import { notifyActivity } from "@/lib/alerts";
import { endSession, requireSession, startSession } from "@/lib/auth";
import { removeEmailableApiKey, saveEmailableApiKey, saveSettings } from "@/lib/settings";
import { isObjectIdString } from "@/lib/validation";

function done(result, path) {
	if (result.error) return { error: result.error };
	revalidatePath(path);
	return { ok: true };
}

export async function saveOperationalSettings(values) {
	const { email } = await requireSession();
	const result = await saveSettings(values ?? {});
	if (!result.error) await notifyActivity(["Settings changed", `By ${email}`]);
	revalidatePath("/", "layout");
	return done(result, "/settings");
}

export async function saveEmailableKey(key) {
	const { email } = await requireSession();
	const result = await saveEmailableApiKey(key);
	if (!result.error) await notifyActivity(["Emailable key saved", `By ${email}`]);
	return done(result, "/settings");
}

export async function removeEmailableKey() {
	const { email } = await requireSession();
	await removeEmailableApiKey();
	await notifyActivity(["Emailable key removed", `By ${email}`]);
	return done({}, "/settings");
}

export async function addAdmin({ email, password }) {
	const session = await requireSession();
	const result = await createAdmin({ email, password });
	if (!result.error) await notifyActivity([`Admin added: ${String(email).trim().toLowerCase()}`, `By ${session.email}`]);
	return done(result, "/settings/admins");
}

export async function removeAdmin(id) {
	const session = await requireSession();
	if (!isObjectIdString(id)) return { error: "Admin not found" };
	const admin = await getAdmin(id);
	const result = await deleteAdmin(id, session.adminId);
	if (!result.error) await notifyActivity([`Admin removed: ${admin?.email}`, `By ${session.email}`]);
	return done(result, "/settings/admins");
}

export async function updateMyEmail({ email, currentPassword }) {
	const session = await requireSession();
	const result = await changeEmail(session.adminId, { email, currentPassword });
	if (!result.error) await notifyActivity(["Admin email changed", `${session.email} is now ${String(email).trim().toLowerCase()}`]);
	return done(result, "/settings/admins");
}

// The password change ends every other session; this browser gets a new one.
export async function updateMyPassword({ password, currentPassword }) {
	const session = await requireSession();
	const result = await changePassword(session.adminId, { password, currentPassword });
	if (result.error) return { error: result.error };
	const admin = await getAdmin(session.adminId);
	if (admin) await startSession(admin);
	await notifyActivity(["Admin password changed", session.email], { withUserAgent: true });
	return done(result, "/settings/admins");
}

export async function signOutAllSessions() {
	const session = await requireSession();
	await signOutEverywhere(session.adminId);
	await endSession();
	redirect("/login");
}
