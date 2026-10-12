import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-keys";
import { MAX_NAME_LENGTH, normalizePersonFields, splitFullName } from "@/lib/person-fields";
import { isRateLimited } from "@/lib/rate-limit";
import { tagsColumn } from "@/lib/tags";
import { first, toContact, toNewsletter } from "@/server/db";

export const READS_PER_KEY = { name: "api-read", limit: 600, window: "1 h" };
export const WRITES_PER_KEY = { name: "api-write", limit: 600, window: "1 h" };

export function fail(status: number, error: string) {
	return NextResponse.json({ error }, { status });
}

type Limit = { name: string; limit: number; window: string };

// The key behind the request, or the response to send back instead.
export async function requireApiKey(request: Request, limit: Limit) {
	const apiKey = await authenticateRequest(request);
	if (!apiKey) return { response: fail(401, "Invalid API key") };
	if (await isRateLimited({ ...limit, key: String(apiKey._id) })) return { response: fail(429, "Too many requests") };
	return { apiKey };
}

export async function readJson(request: Request) {
	return request.json().catch(() => null);
}

export async function findNewsletterBySlug(slug: unknown) {
	if (typeof slug !== "string" || !slug.trim()) return null;
	return toNewsletter(await first("SELECT * FROM newsletters WHERE slug = ?", [slug.trim().toLowerCase()]));
}

export async function getApiContact(id: string) {
	if (!/^[a-f0-9]{24}$/.test(String(id))) return null;
	const row = await first(
		`SELECT c.*, n.slug AS newsletter_slug, ${PERSON_COLUMNS}, ${tagsColumn("c")}
		 FROM contacts c JOIN newsletters n ON n.id = c.newsletter_id LEFT JOIN people p ON p.email = c.email WHERE c.id = ?`,
		[id]
	);
	return row ? { ...toContact(row)!, ...toPersonFields(row), newsletterSlug: row.newsletter_slug as string } : null;
}

// For SELECTs over contacts c LEFT JOIN people p ON p.email = c.email.
export const PERSON_COLUMNS = "p.id AS person_id, p.first_name AS person_first_name, p.last_name AS person_last_name, p.phone AS person_phone";

export function toPersonFields(row: Record<string, unknown>) {
	return {
		personId: (row.person_id as string) ?? null,
		firstName: (row.person_first_name as string) ?? null,
		lastName: (row.person_last_name as string) ?? null,
		phone: (row.person_phone as string) ?? null,
	};
}

const PERSON_KEYS = ["firstName", "lastName", "phone"] as const;

// firstName, lastName and phone, or a single "name" split on its first space.
export function readPersonInput(body: Record<string, unknown>) {
	for (const key of [...PERSON_KEYS, "name"]) {
		if (body[key] !== undefined && body[key] !== null && typeof body[key] !== "string") return { error: `${key} must be a string` };
	}
	for (const key of ["firstName", "lastName", "name"]) {
		if (typeof body[key] === "string" && (body[key] as string).length > MAX_NAME_LENGTH * (key === "name" ? 2 : 1)) {
			return { error: `${key} is too long` };
		}
	}
	const fromName = typeof body.name === "string" && body.firstName === undefined && body.lastName === undefined ? splitFullName(body.name) : {};
	const result = normalizePersonFields({
		firstName: (body.firstName as string | undefined) ?? (fromName as any).firstName,
		lastName: (body.lastName as string | undefined) ?? (fromName as any).lastName,
		phone: body.phone as string | undefined,
	}) as { fields?: Record<string, string>; error?: string };
	return result;
}

function iso(date?: Date) {
	return date ? date.toISOString() : null;
}

export function serializeContact(contact: any) {
	return {
		id: String(contact._id),
		newsletter: contact.newsletterSlug ?? null,
		email: contact.email,
		firstName: contact.firstName ?? null,
		lastName: contact.lastName ?? null,
		phone: contact.phone ?? null,
		status: contact.status,
		source: contact.source ?? null,
		tags: (contact.tags ?? []).map(({ name }: { name: string }) => name),
		subscribedAt: iso(contact.subscribedAt),
		confirmedAt: iso(contact.confirmedAt),
		unsubscribedAt: iso(contact.unsubscribedAt),
		lastOpenAt: iso(contact.lastOpenAt),
		lastClickAt: iso(contact.lastClickAt),
		stats: contact.stats,
		createdAt: iso(contact.createdAt),
	};
}

export function encodeCursor(createdAt: number, id: string) {
	return btoa(`${createdAt}:${id}`).replace(/=+$/, "");
}

export function decodeCursor(value: string | null) {
	if (!value) return null;
	try {
		const [createdAt, id] = atob(value).split(":");
		const time = Number(createdAt);
		return Number.isFinite(time) && /^[a-f0-9]{24}$/.test(id) ? { createdAt: time, id } : null;
	} catch {
		return null;
	}
}
