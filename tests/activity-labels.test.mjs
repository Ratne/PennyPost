import assert from "node:assert/strict";
import { test } from "node:test";
import { describeActivity } from "../lib/activity-labels.js";

test("subscription events say where they came from", () => {
	assert.deepEqual(describeActivity({ type: "subscribed", data: { source: "website", status: "pending" } }), {
		title: "Subscribed on the website",
		detail: "Waiting for confirmation",
	});
	assert.equal(describeActivity({ type: "unsubscribed", data: { source: "one_click" } }).title, "Unsubscribed with the one-click link in their mail app");
	assert.equal(describeActivity({ type: "unsubscribed", data: { source: "zapier" } }).title, "Unsubscribed from zapier");
	assert.equal(describeActivity({ type: "resubscribed", data: { source: "api", from: "unsubscribed" } }).detail, "Was unsubscribed");
});

test("email events name the campaign, or the kind of email", () => {
	assert.equal(describeActivity({ type: "email_sent", subject: "Issue 12" }).title, "Sent “Issue 12”");
	assert.equal(describeActivity({ type: "email_delivered", kind: "welcome" }).title, "The welcome email was delivered");
	assert.equal(describeActivity({ type: "email_bounced" }).title, "An email bounced");
});

test("opens and clicks explain machine opens and first-only records", () => {
	assert.match(describeActivity({ type: "opened", subject: "Hi", data: { automatic: true } }).detail, /privacy proxy/);
	assert.match(describeActivity({ type: "opened", subject: "Hi", data: { first: true } }).detail, /First open only/);
	assert.equal(describeActivity({ type: "clicked", subject: "Hi", data: { url: "https://example.com/a" } }).detail, "https://example.com/a");
});

test("tag events keep the tag's name, even after it's deleted", () => {
	assert.deepEqual(describeActivity({ type: "tag_added", data: { tag: "vip", source: "import" } }), {
		title: "Tag “vip” added",
		detail: "by an import",
	});
	assert.equal(describeActivity({ type: "tag_removed", data: { source: "tag_deleted" } }).title, "Tag “deleted tag” removed");
});

test("profile changes list the fields", () => {
	assert.equal(
		describeActivity({ type: "profile_updated", data: { firstName: {}, lastName: {}, phone: {} } }).title,
		"Changed first name, last name and phone"
	);
	assert.equal(describeActivity({ type: "profile_updated", data: {} }).title, "Profile updated");
});

test("address checks show the state and a readable reason", () => {
	assert.deepEqual(describeActivity({ type: "verified", data: { state: "risky", reason: "accept_all" } }), {
		title: "Address checked: risky",
		detail: "accept all",
	});
});

test("unknown types still read as a sentence", () => {
	assert.equal(describeActivity({ type: "something_new" }).title, "Something new");
});
