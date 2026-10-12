import assert from "node:assert/strict";
import { test } from "node:test";
import { compileSegmentRules, describeSegmentRules, isEmptySegment, normalizeSegmentRules } from "../lib/segments.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.UTC(2026, 9, 10);
const DAY = 24 * 60 * 60 * 1000;

test("normalizes rules and drops invalid values", () => {
	const rules = normalizeSegmentRules({
		tagsAny: [A, A.toUpperCase(), "nope", "x'; DROP TABLE contacts;--"],
		statuses: ["active", "hacker"],
		openedWithinDays: "30",
		clickedWithinDays: -1,
		subscribedAfter: "not a date",
		source: "  website ",
		extra: "ignored",
	});
	assert.deepEqual(rules, { tagsAny: [A], statuses: ["active"], openedWithinDays: 30, source: "website" });
	assert.equal(isEmptySegment({ nothing: true }), true);
	assert.equal(isEmptySegment({ tagsAll: [B] }), false);
});

test("compiles to parameterized SQL", () => {
	const { sql, params } = compileSegmentRules(
		{ tagsAny: [A], tagsAll: [A, B], tagsNone: [B], statuses: ["active"], openedWithinDays: 7, notOpenedForDays: 90, source: "api" },
		{ now: NOW }
	);
	assert.match(sql, /EXISTS \(SELECT 1 FROM contact_tags ct WHERE ct\.contact_id = c\.id AND ct\.tag_id IN \(\?\)\)/);
	assert.match(sql, /COUNT\(DISTINCT ct\.tag_id\).*= \?/);
	assert.match(sql, /NOT EXISTS/);
	assert.match(sql, /c\.status IN \(\?\)/);
	assert.match(sql, /\(c\.last_open_at IS NULL OR c\.last_open_at < \?\)/);
	assert.deepEqual(params, [A, A, B, 2, B, "active", NOW - 7 * DAY, NOW - 90 * DAY, "api"]);
	assert.equal((sql.match(/\?/g) ?? []).length, params.length);
});

test("an empty segment matches everyone, and sends ignore statuses", () => {
	assert.deepEqual(compileSegmentRules({}), { sql: "1 = 1", params: [] });
	assert.deepEqual(compileSegmentRules({ statuses: ["dormant"] }, { ignoreStatuses: true }), { sql: "1 = 1", params: [] });
});

test("describes rules with tag names", () => {
	const names = new Map([[A, "vip"], [B, "trial"]]);
	assert.equal(describeSegmentRules({ tagsAny: [A], tagsNone: [B] }, names), "any of: vip · none of: trial");
	assert.equal(describeSegmentRules({}), "Everyone");
});
