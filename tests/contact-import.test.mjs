import assert from "node:assert/strict";
import { test } from "node:test";
import { getContactInserts, getStatusChanges } from "../lib/contact-import-plan.js";

const subscribedAt = new Date("2026-10-08T09:00:00.000Z");

// Rows as sanitizeImportRow hands them over, one per status a CSV file can map to.
const contacts = [
	{ email: "new@example.com", status: "active", subscribedAt, openRate: 0.5 },
	{ email: "left@example.com", status: "unsubscribed" },
	{ email: "left-too@example.com", status: "unsubscribed" },
	{ email: "bounced@example.com", status: "bounced" },
	{ email: "cold@example.com", status: "dormant", emailsReceived: 9, openRate: 0, clickRate: 0 },
];

test("rows add the contacts a newsletter doesn't have and only make statuses stricter", () => {
	const now = Date.parse("2026-10-09T10:00:00.000Z");
	const rows = getContactInserts({ contacts, source: "import", now });
	assert.equal(rows.length, contacts.length);
	assert.deepEqual(rows[0], {
		email: "new@example.com",
		status: "active",
		source: "import",
		subscribedAt: subscribedAt.getTime(),
		unsubscribedAt: null,
		emailsReceived: null,
		openRate: 0.5,
		clickRate: null,
	});
	assert.equal(rows[1].unsubscribedAt, now);
	assert.equal(rows[1].subscribedAt, now);

	assert.deepEqual(getStatusChanges(contacts), [
		{ status: "unsubscribed", emails: ["left@example.com", "left-too@example.com"], replaces: ["active", "dormant"] },
		{ status: "bounced", emails: ["bounced@example.com"], replaces: ["active", "dormant", "unsubscribed"] },
		{ status: "dormant", emails: ["cold@example.com"], replaces: ["active"] },
	]);
});

test("existing contacts never become active and contacts waiting to confirm stay as they are", () => {
	for (const row of getContactInserts({ contacts, source: "import" })) {
		assert.equal(row.unsubscribedAt === null, row.status !== "unsubscribed");
	}
	for (const { status, replaces } of getStatusChanges(contacts)) {
		assert.notEqual(status, "active");
		assert.equal(replaces.includes("pending"), false);
	}
});
