// AES-GCM for secrets saved in the database (the Emailable key). The key comes from SESSION_SECRET
// through HKDF with its own info, so the database alone never reveals them. Changing SESSION_SECRET
// makes saved secrets unreadable: they have to be entered again.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = "v1";
const cache = new Map();

function toBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text) {
	return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

async function getKey(secret) {
	if (!secret) throw new Error("SESSION_SECRET is not set");
	if (!cache.has(secret)) {
		const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
		const key = crypto.subtle.deriveKey(
			{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode("mail-newsletter-settings-v1") },
			material,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"]
		);
		cache.clear();
		cache.set(secret, key);
	}
	return cache.get(secret);
}

// The setting's name is bound as additional data: a value copied onto another setting won't decrypt.
export async function sealSecret(plaintext, { secret, name }) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: encoder.encode(name) },
		await getKey(secret),
		encoder.encode(plaintext)
	);
	return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function openSecret(sealed, { secret, name }) {
	const [version, iv, ciphertext] = String(sealed ?? "").split(":");
	if (version !== VERSION || !iv || !ciphertext) return null;
	try {
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(name) },
			await getKey(secret),
			fromBase64(ciphertext)
		);
		return decoder.decode(plaintext);
	} catch {
		return null;
	}
}

// "••••a1b2": enough to tell keys apart, never enough to use one.
export function maskSecret(value) {
	const text = String(value ?? "");
	return text ? `••••${text.slice(-4)}` : "";
}
