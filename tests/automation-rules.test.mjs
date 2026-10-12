import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildWebhookRequest,
	descendantIds,
	firstStep,
	getActivationProblem,
	getStepProblem,
	getWakeAt,
	nextStep,
	normalizeStepConfig,
	orderedSteps,
	renderTemplate,
} from "../lib/automation-rules.js";

const id = (n) => String(n).padStart(24, "0");
const TAG = "a".repeat(24);

// 1 wait -> 2 condition [yes: 3 email, 4 webhook | no: 5 exit] -> 6 email
const STEPS = [
	{ id: id(6), parentId: null, branch: null, position: 2, type: "email", config: {} },
	{ id: id(1), parentId: null, branch: null, position: 0, type: "wait", config: {} },
	{ id: id(2), parentId: null, branch: null, position: 1, type: "condition", config: {} },
	{ id: id(4), parentId: id(2), branch: "yes", position: 1, type: "webhook", config: {} },
	{ id: id(3), parentId: id(2), branch: "yes", position: 0, type: "email", config: {} },
	{ id: id(5), parentId: id(2), branch: "no", position: 0, type: "exit_automation", config: {} },
];

test("the flow starts at the first root step and runs in position order", () => {
	assert.equal(firstStep(STEPS).id, id(1));
	assert.equal(nextStep(STEPS, id(1)).id, id(2));
	assert.equal(nextStep(STEPS, id(6)), null);
	assert.equal(firstStep([]), null);
});

test("a condition goes into the branch it took and joins after it", () => {
	assert.equal(nextStep(STEPS, id(2), "yes").id, id(3));
	assert.equal(nextStep(STEPS, id(3)).id, id(4));
	assert.equal(nextStep(STEPS, id(4)).id, id(6));
	assert.equal(nextStep(STEPS, id(2), "no").id, id(5));
	assert.equal(nextStep(STEPS, id(5)).id, id(6));
});

test("an empty branch goes straight to the step after the condition", () => {
	const steps = STEPS.filter((step) => step.id !== id(5));
	assert.equal(nextStep(steps, id(2), "no").id, id(6));
});

test("nested conditions join outward, level by level", () => {
	const steps = [
		{ id: id(1), parentId: null, branch: null, position: 0, type: "condition" },
		{ id: id(2), parentId: id(1), branch: "yes", position: 0, type: "condition" },
		{ id: id(3), parentId: id(2), branch: "no", position: 0, type: "email" },
		{ id: id(4), parentId: null, branch: null, position: 1, type: "email" },
	];
	assert.equal(nextStep(steps, id(3)).id, id(4));
	assert.equal(nextStep(steps, id(2), "yes").id, id(4));
});

test("ordered steps and descendants follow the drawing", () => {
	assert.deepEqual(
		orderedSteps(STEPS).map((step) => step.id),
		[1, 2, 3, 4, 5, 6].map(id)
	);
	assert.deepEqual(descendantIds(STEPS, id(2)).sort(), [2, 3, 4, 5].map(id));
});

test("waits add a delay or go until a fixed date", () => {
	const now = Date.parse("2026-10-11T10:00:00Z");
	assert.equal(getWakeAt({ mode: "delay", amount: 2, unit: "hours" }, now), now + 2 * 60 * 60 * 1000);
	assert.equal(getWakeAt({ mode: "delay", amount: 1, unit: "weeks" }, now), now + 7 * 24 * 60 * 60 * 1000);
	assert.equal(getWakeAt({ mode: "until", at: "2026-12-01T09:00:00Z" }, now), Date.parse("2026-12-01T09:00:00Z"));
	assert.equal(getWakeAt({ mode: "until", at: "2026-01-01T00:00:00Z" }, now), now);
	assert.equal(getWakeAt({ mode: "delay", amount: -3, unit: "years" }, now), now + 24 * 60 * 60 * 1000);
});

test("templates escape values inside JSON and keep unknown placeholders", () => {
	const vars = { firstName: 'Ada "the first"\n', email: "ada@example.com" };
	const body = renderTemplate('{"name": "{{firstName}}", "email": "{{ email }}", "x": "{{other}}"}', vars, { json: true });
	assert.deepEqual(JSON.parse(body), { name: 'Ada "the first"\n', email: "ada@example.com", x: "{{other}}" });
	assert.equal(renderTemplate("Bearer {{firstName}}", vars), 'Bearer Ada "the first"');
});

test("webhook requests get a JSON content type unless a header sets one", () => {
	const request = buildWebhookRequest(
		{ url: "https://example.com/hook", headers: [{ name: "X-Token", value: "{{email}}" }, { name: "Host", value: "evil" }], body: "{}" },
		{ email: "ada@example.com" }
	);
	assert.deepEqual(request.headers, { "X-Token": "ada@example.com", "Content-Type": "application/json" });
	assert.equal(request.method, "POST");
	const custom = buildWebhookRequest({ url: "https://example.com", headers: [{ name: "content-type", value: "text/plain" }] }, {});
	assert.deepEqual(custom.headers, { "content-type": "text/plain" });
});

test("step configs drop what they don't know", () => {
	assert.deepEqual(normalizeStepConfig("wait", { amount: "3", unit: "hours", extra: 1 }), { mode: "delay", amount: 3, unit: "hours" });
	assert.deepEqual(normalizeStepConfig("condition", { kind: "in_segment", segmentId: "nope" }), { kind: "in_segment", segmentId: null });
	assert.deepEqual(normalizeStepConfig("exit_automation", { automationId: TAG }), { automationId: TAG });
});

test("step problems explain what is missing", () => {
	assert.match(getStepProblem({ type: "webhook", config: { url: "ftp://x" } }), /URL/);
	assert.match(getStepProblem({ type: "webhook", config: { url: "https://x.com", body: "{bad" } }), /JSON/);
	assert.equal(getStepProblem({ type: "webhook", config: { url: "https://x.com", body: '{"id": "{{contactId}}"}' } }), null);
	assert.match(getStepProblem({ type: "email", config: { subject: "Hi", html: "<p></p>" } }), /content/);
	assert.equal(getStepProblem({ type: "email", config: { subject: "Hi", html: "<p>Hello</p>" } }), null);
	assert.match(getStepProblem({ type: "exit_automation", config: { automationId: TAG } }, { automationId: TAG }), /itself/);
});

test("an automation activates with a trigger tag and valid steps", () => {
	const automation = { id: id(9), triggerType: "tag_added", triggerConfig: {} };
	const wait = { id: id(1), parentId: null, branch: null, position: 0, type: "wait", config: { amount: 1, unit: "days" } };
	assert.match(getActivationProblem(automation, [wait]), /tag/);
	const ready = { ...automation, triggerConfig: { tagId: TAG } };
	assert.equal(getActivationProblem(ready, []), "Add a step");
	assert.equal(getActivationProblem(ready, [wait]), null);
	const email = { id: id(2), parentId: null, branch: null, position: 1, type: "email", config: {} };
	assert.equal(getActivationProblem(ready, [wait, email]), "Step 2: Add a subject to the email");
});
