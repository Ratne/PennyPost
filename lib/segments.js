// Segments: saved rules over a newsletter's contacts (tags, status, engagement, signup date, source).
// One compiler turns them into SQL, so the preview count, the contacts list and the audience of a send
// always agree on who is in.

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[a-f0-9]{24}$/;
export const SEGMENT_STATUSES = ["active", "pending", "unsubscribed", "bounced", "complained", "dormant"];
const MAX_TAGS_PER_RULE = 50;
const MAX_DAYS = 3650;
const MAX_SOURCE_LENGTH = 100;

function tagIds(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map((id) => String(id).toLowerCase()).filter((id) => ID_PATTERN.test(id)))].slice(0, MAX_TAGS_PER_RULE);
}

function days(value) {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 && number <= MAX_DAYS ? number : undefined;
}

function date(value) {
	if (!value) return undefined;
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

// Unknown keys and invalid values are dropped: a segment is always safe to compile.
export function normalizeSegmentRules(input) {
	const rules = input && typeof input === "object" && !Array.isArray(input) ? input : {};
	const normalized = {
		tagsAny: tagIds(rules.tagsAny),
		tagsAll: tagIds(rules.tagsAll),
		tagsNone: tagIds(rules.tagsNone),
		statuses: Array.isArray(rules.statuses) ? [...new Set(rules.statuses.filter((status) => SEGMENT_STATUSES.includes(status)))] : [],
		openedWithinDays: days(rules.openedWithinDays),
		clickedWithinDays: days(rules.clickedWithinDays),
		notOpenedForDays: days(rules.notOpenedForDays),
		subscribedAfter: date(rules.subscribedAfter),
		subscribedBefore: date(rules.subscribedBefore),
		source: typeof rules.source === "string" && rules.source.trim() ? rules.source.trim().slice(0, MAX_SOURCE_LENGTH) : undefined,
	};
	return Object.fromEntries(
		Object.entries(normalized).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined))
	);
}

export function isEmptySegment(rules) {
	return Object.keys(normalizeSegmentRules(rules)).length === 0;
}

function list(count) {
	return Array.from({ length: count }, () => "?").join(", ");
}

// Returns a WHERE fragment over the contacts alias and its parameters. Statuses are left to the caller
// when `ignoreStatuses` is set: a send always goes to active contacts only.
export function compileSegmentRules(input, { alias = "c", now = Date.now(), ignoreStatuses = false } = {}) {
	const rules = normalizeSegmentRules(input);
	const clauses = [];
	const params = [];
	const tagged = (ids) => `SELECT 1 FROM contact_tags ct WHERE ct.contact_id = ${alias}.id AND ct.tag_id IN (${list(ids.length)})`;

	if (rules.tagsAny) {
		clauses.push(`EXISTS (${tagged(rules.tagsAny)})`);
		params.push(...rules.tagsAny);
	}
	if (rules.tagsAll) {
		clauses.push(
			`(SELECT COUNT(DISTINCT ct.tag_id) FROM contact_tags ct WHERE ct.contact_id = ${alias}.id AND ct.tag_id IN (${list(rules.tagsAll.length)})) = ?`
		);
		params.push(...rules.tagsAll, rules.tagsAll.length);
	}
	if (rules.tagsNone) {
		clauses.push(`NOT EXISTS (${tagged(rules.tagsNone)})`);
		params.push(...rules.tagsNone);
	}
	if (rules.statuses && !ignoreStatuses) {
		clauses.push(`${alias}.status IN (${list(rules.statuses.length)})`);
		params.push(...rules.statuses);
	}
	if (rules.openedWithinDays) {
		clauses.push(`${alias}.last_open_at >= ?`);
		params.push(now - rules.openedWithinDays * DAY_MS);
	}
	if (rules.clickedWithinDays) {
		clauses.push(`${alias}.last_click_at >= ?`);
		params.push(now - rules.clickedWithinDays * DAY_MS);
	}
	if (rules.notOpenedForDays) {
		clauses.push(`(${alias}.last_open_at IS NULL OR ${alias}.last_open_at < ?)`);
		params.push(now - rules.notOpenedForDays * DAY_MS);
	}
	if (rules.subscribedAfter) {
		clauses.push(`${alias}.subscribed_at >= ?`);
		params.push(new Date(rules.subscribedAfter).getTime());
	}
	if (rules.subscribedBefore) {
		clauses.push(`${alias}.subscribed_at < ?`);
		params.push(new Date(rules.subscribedBefore).getTime());
	}
	if (rules.source) {
		clauses.push(`${alias}.source = ?`);
		params.push(rules.source);
	}
	return { sql: clauses.length > 0 ? clauses.join(" AND ") : "1 = 1", params };
}

// Human summary for lists and the send dialog.
export function describeSegmentRules(input, tagNames = new Map()) {
	const rules = normalizeSegmentRules(input);
	const names = (ids) => ids.map((id) => tagNames.get(id) ?? "?").join(", ");
	const parts = [];
	if (rules.tagsAny) parts.push(`any of: ${names(rules.tagsAny)}`);
	if (rules.tagsAll) parts.push(`all of: ${names(rules.tagsAll)}`);
	if (rules.tagsNone) parts.push(`none of: ${names(rules.tagsNone)}`);
	if (rules.statuses) parts.push(`status: ${rules.statuses.join(", ")}`);
	if (rules.openedWithinDays) parts.push(`opened in the last ${rules.openedWithinDays} days`);
	if (rules.clickedWithinDays) parts.push(`clicked in the last ${rules.clickedWithinDays} days`);
	if (rules.notOpenedForDays) parts.push(`no open for ${rules.notOpenedForDays} days`);
	if (rules.subscribedAfter) parts.push(`joined after ${rules.subscribedAfter.slice(0, 10)}`);
	if (rules.subscribedBefore) parts.push(`joined before ${rules.subscribedBefore.slice(0, 10)}`);
	if (rules.source) parts.push(`source: ${rules.source}`);
	return parts.length > 0 ? parts.join(" · ") : "Everyone";
}
