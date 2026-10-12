import { compileSegmentRules, describeSegmentRules, normalizeSegmentRules } from "@/lib/segments";
import { listTags } from "@/lib/tags";
import { all, first, newId, run } from "@/server/db";

export const MAX_SEGMENT_NAME_LENGTH = 60;
const ID_PATTERN = /^[a-f0-9]{24}$/;

export type Segment = { _id: string; newsletterId: string; name: string; rules: Record<string, any>; createdAt: Date; updatedAt: Date };

function toSegment(row: any): Segment | null {
	if (!row) return null;
	let rules = {};
	try {
		rules = normalizeSegmentRules(JSON.parse(row.rules || "{}"));
	} catch {}
	return {
		_id: row.id,
		newsletterId: row.newsletter_id,
		name: row.name,
		rules,
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
	};
}

export async function listSegments(newsletterId?: string) {
	const rows = await all(
		`SELECT * FROM segments ${newsletterId ? "WHERE newsletter_id = ?" : ""} ORDER BY name ASC`,
		newsletterId ? [newsletterId] : []
	);
	return rows.map((row) => toSegment(row)!);
}

export async function getSegment(id: string) {
	return ID_PATTERN.test(String(id)) ? toSegment(await first("SELECT * FROM segments WHERE id = ?", [id])) : null;
}

// For the API: a segment of the newsletter, by id or by name.
export async function findSegment(newsletterId: string, idOrName: string) {
	if (ID_PATTERN.test(idOrName)) {
		const segment = toSegment(await first("SELECT * FROM segments WHERE id = ? AND newsletter_id = ?", [idOrName, newsletterId]));
		if (segment) return segment;
	}
	return toSegment(await first("SELECT * FROM segments WHERE newsletter_id = ? AND name = ? COLLATE NOCASE", [newsletterId, idOrName]));
}

function readName(value: unknown) {
	const name = typeof value === "string" ? value.trim().slice(0, MAX_SEGMENT_NAME_LENGTH) : "";
	return name || null;
}

export async function createSegment({ newsletterId, name, rules }: { newsletterId: string; name: unknown; rules: unknown }) {
	const segmentName = readName(name);
	if (!segmentName) return { error: "Name is required" };
	const id = newId();
	const now = Date.now();
	await run("INSERT INTO segments (id, newsletter_id, name, rules, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
		id,
		newsletterId,
		segmentName,
		JSON.stringify(normalizeSegmentRules(rules)),
		now,
		now,
	]);
	return { segment: (await getSegment(id))! };
}

export async function updateSegment(id: string, { name, rules }: { name: unknown; rules: unknown }) {
	const segmentName = readName(name);
	if (!segmentName) return { error: "Name is required" };
	const { changes } = await run("UPDATE segments SET name = ?, rules = ?, updated_at = ? WHERE id = ?", [
		segmentName,
		JSON.stringify(normalizeSegmentRules(rules)),
		Date.now(),
		id,
	]);
	return changes ? { segment: (await getSegment(id))! } : { error: "Segment not found" };
}

// Drafts that pointed at it go back to everyone (the foreign key sets segment_id to NULL), but a
// segment can't be deleted under a campaign that is going out.
export async function deleteSegment(id: string) {
	const busy = await first("SELECT 1 FROM campaigns WHERE segment_id = ? AND status IN ('scheduled', 'sending', 'paused')", [id]);
	if (busy) return { error: "A scheduled or sending campaign uses this segment" };
	await run("DELETE FROM segments WHERE id = ?", [id]);
	return { ok: true };
}

// Contacts matching the rules, every status unless the rules pick some, and how many of them a send
// would reach (active and unsuppressed).
export async function countSegment(newsletterId: string, rules: unknown) {
	const filter = compileSegmentRules(rules);
	const audience = compileSegmentRules(rules, { ignoreStatuses: true });
	const [matching, reachable] = await Promise.all([
		first<{ count: number }>(`SELECT COUNT(*) AS count FROM contacts c WHERE c.newsletter_id = ? AND ${filter.sql}`, [
			newsletterId,
			...filter.params,
		]),
		first<{ count: number }>(
			`SELECT COUNT(*) AS count FROM contacts c WHERE c.newsletter_id = ? AND c.status = 'active'
			 AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = c.email) AND ${audience.sql}`,
			[newsletterId, ...audience.params]
		),
	]);
	return { matching: matching?.count ?? 0, reachable: reachable?.count ?? 0 };
}

export async function describeSegments(segments: Segment[]) {
	const tags = await listTags();
	const names = new Map(tags.map(({ id, name }) => [id, name]));
	return segments.map((segment) => ({ ...segment, summary: describeSegmentRules(segment.rules, names) }));
}
