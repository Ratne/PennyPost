// Automations: a trigger, then steps run top to bottom. Steps form runs ordered by position under
// (parentId, branch); a condition step owns a "yes" and a "no" run, and once the branch taken ends
// the flow carries on with the step after the condition. Shared by the builder, the store and the engine.
import { hasContent } from "./render-email.js";

const ID_PATTERN = /^[a-f0-9]{24}$/;
const MINUTE_MS = 60 * 1000;

export const STEP_TYPES = ["wait", "email", "webhook", "condition", "exit_automation"];
export const BRANCHES = ["yes", "no"];
export const TRIGGER_TYPES = ["tag_added"];
export const AUTOMATION_STATUSES = ["draft", "active", "paused"];
export const WAIT_UNITS = { minutes: MINUTE_MS, hours: 60 * MINUTE_MS, days: 24 * 60 * MINUTE_MS, weeks: 7 * 24 * 60 * MINUTE_MS };
export const MAX_WAIT_AMOUNT = 1000;
export const MAX_NAME_LENGTH = 80;
export const MAX_STEPS = 100;
export const MAX_WEBHOOK_HEADERS = 20;
export const MAX_WEBHOOK_BODY = 10_000;
export const WEBHOOK_PLACEHOLDERS = ["email", "firstName", "lastName", "phone", "contactId", "newsletter", "tags", "automation"];
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const RESERVED_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding"]);

function isId(value) {
	return typeof value === "string" && ID_PATTERN.test(value);
}

function text(value, max) {
	return typeof value === "string" ? value.slice(0, max) : "";
}

export function normalizeAutomationName(value) {
	return text(value, MAX_NAME_LENGTH).trim();
}

export function normalizeTriggerConfig(type, input) {
	const config = input && typeof input === "object" ? input : {};
	if (type === "tag_added") return isId(config.tagId) ? { tagId: config.tagId } : {};
	return {};
}

// Unknown keys and invalid values are dropped, so a stored config is always safe to run.
export function normalizeStepConfig(type, input) {
	const config = input && typeof input === "object" && !Array.isArray(input) ? input : {};
	switch (type) {
		case "wait": {
			if (config.mode === "until") {
				const at = new Date(config.at ?? NaN);
				return { mode: "until", at: Number.isFinite(at.getTime()) ? at.toISOString() : null };
			}
			const amount = Number(config.amount);
			return {
				mode: "delay",
				amount: Number.isInteger(amount) && amount > 0 ? Math.min(amount, MAX_WAIT_AMOUNT) : 1,
				unit: Object.hasOwn(WAIT_UNITS, config.unit) ? config.unit : "days",
			};
		}
		case "email":
			return {
				format: "rich",
				subject: text(config.subject, 200),
				previewText: text(config.previewText, 300),
				html: text(config.html, 400_000),
			};
		case "webhook":
			return {
				method: "POST",
				url: text(config.url, 2000).trim(),
				headers: (Array.isArray(config.headers) ? config.headers : [])
					.map((header) => ({ name: text(header?.name, 100).trim(), value: text(header?.value, 2000).replace(/[\r\n]/g, "") }))
					.filter(({ name }) => name)
					.slice(0, MAX_WEBHOOK_HEADERS),
				body: text(config.body, MAX_WEBHOOK_BODY),
			};
		case "condition":
			if (config.kind === "in_segment") return { kind: "in_segment", segmentId: isId(config.segmentId) ? config.segmentId : null };
			return { kind: "has_tag", tagId: isId(config.tagId) ? config.tagId : null };
		case "exit_automation":
			return { automationId: isId(config.automationId) ? config.automationId : null };
		default:
			return {};
	}
}

export function defaultStepConfig(type) {
	if (type === "webhook") {
		return normalizeStepConfig(type, {
			body: JSON.stringify({ email: "{{email}}", firstName: "{{firstName}}", tags: "{{tags}}" }, null, 2),
		});
	}
	return normalizeStepConfig(type, {});
}

function byPosition(a, b) {
	return a.position - b.position || String(a.id).localeCompare(String(b.id));
}

/** @param {any[]} steps @param {string | null} [parentId] @param {string | null} [branch] */
export function childrenOf(steps, parentId = null, branch = null) {
	return steps.filter((step) => (step.parentId ?? null) === parentId && (step.branch ?? null) === branch).sort(byPosition);
}

export function firstStep(steps) {
	return childrenOf(steps)[0] ?? null;
}

// The step that runs after `stepId` once it's done: the next one in its run, or the one after the
// condition the run belongs to. A condition passes the branch it took.
/** @param {any[]} steps @param {string} stepId @param {string | null} [branch] */
export function nextStep(steps, stepId, branch = null) {
	const step = steps.find(({ id }) => id === stepId);
	if (!step) return null;
	if (step.type === "condition" && branch) {
		const first = childrenOf(steps, step.id, branch)[0];
		if (first) return first;
	}
	let current = step;
	while (current) {
		const run = childrenOf(steps, current.parentId ?? null, current.branch ?? null);
		const following = run[run.findIndex(({ id }) => id === current.id) + 1];
		if (following) return following;
		current = current.parentId ? steps.find(({ id }) => id === current.parentId) : null;
	}
	return null;
}

// The step and everything under it, for deletes.
export function descendantIds(steps, stepId) {
	const ids = [stepId];
	for (let index = 0; index < ids.length; index++) {
		for (const step of steps) if (step.parentId === ids[index]) ids.push(step.id);
	}
	return ids;
}

// A date already past wakes the contact on the next tick.
export function getWakeAt(config, now = Date.now()) {
	const wait = normalizeStepConfig("wait", config);
	if (wait.mode === "until") return Math.max(now, wait.at ? new Date(wait.at).getTime() : now);
	return now + wait.amount * WAIT_UNITS[wait.unit];
}

// In a JSON body the values are escaped, so "{{firstName}}" stays a valid string whatever the name.
export function renderTemplate(template, vars, { json = false } = {}) {
	return String(template ?? "").replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key) => {
		if (!Object.hasOwn(vars, key)) return match;
		const value = String(vars[key] ?? "");
		return json ? JSON.stringify(value).slice(1, -1) : value.replace(/[\r\n]/g, "");
	});
}

export const SAMPLE_VARS = {
	email: "ada@example.com",
	firstName: "Ada",
	lastName: "Lovelace",
	phone: "+39 333 000 0000",
	contactId: "000000000000000000000000",
	newsletter: "Newsletter",
	tags: "customers, vip",
	automation: "Automation",
};

/** @returns {{ url: string, method: string, headers: Record<string, string>, body: string }} */
export function buildWebhookRequest(config, vars) {
	const webhook = normalizeStepConfig("webhook", config);
	/** @type {Record<string, string>} */
	const headers = {};
	for (const { name, value } of webhook.headers) {
		if (HEADER_NAME_PATTERN.test(name) && !RESERVED_HEADERS.has(name.toLowerCase())) headers[name] = renderTemplate(value, vars);
	}
	if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
	return { url: webhook.url, method: webhook.method, headers, body: renderTemplate(webhook.body, vars, { json: true }) };
}

function isHttpUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

export function getStepProblem(step, { automationId } = {}) {
	const config = normalizeStepConfig(step.type, step.config);
	switch (step.type) {
		case "wait":
			return config.mode === "until" && !config.at ? "Pick the date to wait until" : null;
		case "email":
			if (!config.subject.trim()) return "Add a subject to the email";
			return hasContent(config.html) ? null : "Add content to the email";
		case "webhook": {
			if (!isHttpUrl(config.url)) return "Add a webhook URL starting with https://";
			const invalid = config.headers.find(({ name }) => !HEADER_NAME_PATTERN.test(name) || RESERVED_HEADERS.has(name.toLowerCase()));
			if (invalid) return `The header “${invalid.name}” can't be sent`;
			if (!config.body.trim()) return null;
			try {
				JSON.parse(renderTemplate(config.body, SAMPLE_VARS, { json: true }));
				return null;
			} catch {
				return "The webhook body isn't valid JSON";
			}
		}
		case "condition":
			if (config.kind === "in_segment") return config.segmentId ? null : "Pick the segment the condition checks";
			return config.tagId ? null : "Pick the tag the condition checks";
		case "exit_automation":
			if (!config.automationId) return "Pick the automation to exit";
			return config.automationId === automationId ? "An automation can't exit itself" : null;
		default:
			return "Unknown step";
	}
}

// The steps in the order they're drawn, top to bottom, branches yes before no.
/** @param {any[]} steps @param {string | null} [parentId] @param {string | null} [branch] @returns {any[]} */
export function orderedSteps(steps, parentId = null, branch = null) {
	return childrenOf(steps, parentId, branch).flatMap((step) =>
		step.type === "condition" ? [step, ...orderedSteps(steps, step.id, "yes"), ...orderedSteps(steps, step.id, "no")] : [step]
	);
}

export function getActivationProblem(automation, steps) {
	if (automation.triggerType === "tag_added" && !normalizeTriggerConfig("tag_added", automation.triggerConfig).tagId) {
		return "Pick the tag that starts the automation";
	}
	if (steps.length === 0) return "Add a step";
	const ordered = orderedSteps(steps);
	for (const [index, step] of ordered.entries()) {
		const problem = getStepProblem(step, { automationId: automation.id });
		if (problem) return `Step ${index + 1}: ${problem}`;
	}
	return null;
}

export function describeWait(config) {
	const wait = normalizeStepConfig("wait", config);
	if (wait.mode === "until") {
		if (!wait.at) return "Wait until a date";
		const at = new Date(wait.at);
		return `Wait until ${at.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`;
	}
	const unit = wait.amount === 1 ? wait.unit.slice(0, -1) : wait.unit;
	return `Wait ${wait.amount} ${unit}`;
}
