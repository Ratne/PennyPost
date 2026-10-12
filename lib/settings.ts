import { readSetting, setSettingOverrides } from "@/lib/config";
import { maskSecret, openSecret, sealSecret } from "@/lib/secret-box";
import { EMAILABLE_KEY_SETTING, SETTING_FIELDS, SETTING_NAMES, validateEmailableKey, validateSettings } from "@/lib/setting-rules";
import { all, batch, first, run, statement } from "@/server/db";

// Each Worker instance reads the table at most this often; a save reloads it right away there.
const CACHE_MS = 15_000;
const STATE = Symbol.for("mail-newsletter.settings-cache");

type CacheState = { loadedAt: number; values: Record<string, string>; loading?: Promise<void> };

function state(): CacheState {
	const global = globalThis as any;
	global[STATE] ??= { loadedAt: 0, values: {} };
	return global[STATE];
}

// Called at the start of every request (proxy.js), queue batch and cron tick. A database error keeps
// the last values: settings never take the app down.
export async function loadSettings({ force = false } = {}) {
	const current = state();
	if (!force && Date.now() - current.loadedAt < CACHE_MS) return;
	if (!force && current.loading) return current.loading;
	current.loading = (async () => {
		try {
			const rows = await all<{ key: string; value: string | null }>(
				`SELECT key, value FROM settings WHERE key IN (${SETTING_NAMES.map(() => "?").join(", ")})`,
				SETTING_NAMES
			);
			current.values = Object.fromEntries(rows.filter(({ value }) => value).map(({ key, value }) => [key, value!]));
			setSettingOverrides(current.values);
		} catch (error: any) {
			console.error("[settings] Could not load:", error?.message);
		} finally {
			current.loadedAt = Date.now();
			current.loading = undefined;
		}
	})();
	return current.loading;
}

export async function getSettingsView() {
	await loadSettings({ force: true });
	const saved = state().values;
	const emailable = await getEmailableApiKey();
	return {
		fields: SETTING_FIELDS.map(({ name, label, kind, placeholder }) => ({
			name,
			label,
			kind,
			placeholder,
			saved: saved[name] ?? "",
			env: process.env[name] ?? "",
			effective: readSetting(name) ?? "",
		})),
		emailable: emailable ? { isSet: true, masked: maskSecret(emailable.key), source: emailable.source } : { isSet: false },
	};
}

export async function saveSettings(input: Record<string, unknown>) {
	const { values, error } = validateSettings(input) as { values?: Record<string, string>; error?: string };
	if (error || !values) return { error: error ?? "Invalid settings" };
	const now = Date.now();
	await batch(
		Object.entries(values).map(([key, value]) =>
			value
				? statement(
						"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
						[key, value, now]
					)
				: statement("DELETE FROM settings WHERE key = ?", [key])
		)
	);
	await loadSettings({ force: true });
	return { ok: true };
}

// The key is kept encrypted (lib/secret-box.js). EMAILABLE_API_KEY in the environment works too.
export async function getEmailableApiKey() {
	const row = await first<{ value: string }>("SELECT value FROM settings WHERE key = ?", [EMAILABLE_KEY_SETTING]).catch(() => null);
	if (row?.value) {
		const key = await openSecret(row.value, { secret: process.env.SESSION_SECRET, name: EMAILABLE_KEY_SETTING });
		if (key) return { key, source: "dashboard" as const };
		console.error("[settings] The saved Emailable key can't be decrypted: SESSION_SECRET changed. Enter it again.");
	}
	const fromEnv = process.env.EMAILABLE_API_KEY;
	return fromEnv ? { key: fromEnv, source: "environment" as const } : null;
}

export async function saveEmailableApiKey(value: unknown) {
	const { key, error } = validateEmailableKey(value) as { key?: string; error?: string };
	if (error || !key) return { error: error ?? "Invalid key" };
	const sealed = await sealSecret(key, { secret: process.env.SESSION_SECRET, name: EMAILABLE_KEY_SETTING });
	await run(
		"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
		[EMAILABLE_KEY_SETTING, sealed, Date.now()]
	);
	return { ok: true };
}

export async function removeEmailableApiKey() {
	await run("DELETE FROM settings WHERE key = ?", [EMAILABLE_KEY_SETTING]);
	return { ok: true };
}
