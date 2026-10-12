import { after } from "@/lib/background";
import { findContactRefs, logActivities } from "@/lib/contact-activity";
import {
	AUTOMATION_STATUSES,
	BRANCHES,
	MAX_STEPS,
	STEP_TYPES,
	childrenOf,
	defaultStepConfig,
	descendantIds,
	firstStep,
	normalizeAutomationName,
	normalizeStepConfig,
	normalizeTriggerConfig,
} from "@/lib/automation-rules";
import { runDueEnrollments } from "@/lib/automation-engine";
import { isObjectIdString } from "@/lib/validation";
import { MAX_BOUND_PARAMS, all, batch, chunk, first, newId, placeholders, run, statement } from "@/server/db";

type Row = Record<string, any>;

export type Automation = {
	id: string;
	newsletterId: string;
	name: string;
	status: "draft" | "active" | "paused";
	triggerType: "tag_added";
	triggerConfig: { tagId?: string };
	allowReentry: boolean;
	stats: { entered: number; completed: number };
	createdAt: number;
	updatedAt: number;
};

export type Step = {
	id: string;
	automationId: string;
	parentId: string | null;
	branch: "yes" | "no" | null;
	position: number;
	type: string;
	config: Record<string, any>;
};

function parseJson(value: unknown) {
	if (typeof value !== "string") return (value as Record<string, any>) ?? {};
	try {
		return JSON.parse(value) ?? {};
	} catch {
		return {};
	}
}

export function toAutomation(row: Row | null): Automation | null {
	if (!row) return null;
	return {
		id: row.id,
		newsletterId: row.newsletter_id,
		name: row.name,
		status: row.status,
		triggerType: row.trigger_type,
		triggerConfig: normalizeTriggerConfig(row.trigger_type, parseJson(row.trigger_config)),
		allowReentry: row.allow_reentry === 1 || row.allow_reentry === true,
		stats: { entered: Number(row.stats_entered ?? 0), completed: Number(row.stats_completed ?? 0) },
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
	};
}

export function toStep(row: Row | null): Step | null {
	if (!row) return null;
	return {
		id: row.id,
		automationId: row.automation_id,
		parentId: row.parent_id ?? null,
		branch: row.branch ?? null,
		position: Number(row.position ?? 0),
		type: row.type,
		config: normalizeStepConfig(row.type, parseJson(row.config)),
	};
}

export async function getAutomation(id: string) {
	if (!isObjectIdString(id)) return null;
	return toAutomation(await first("SELECT * FROM automations WHERE id = ?", [id]));
}

export async function listAutomations() {
	const rows = await all(
		`SELECT a.*, t.name AS tag_name,
			(SELECT COUNT(*) FROM automation_enrollments e WHERE e.automation_id = a.id AND e.status IN ('active', 'waiting')) AS in_progress,
			(SELECT COUNT(*) FROM automation_steps s WHERE s.automation_id = a.id) AS step_count
		 FROM automations a LEFT JOIN tags t ON t.id = json_extract(a.trigger_config, '$.tagId')
		 ORDER BY a.created_at DESC`
	);
	return rows.map((row) => ({
		...toAutomation(row)!,
		tagName: (row.tag_name as string | null) ?? null,
		inProgress: Number(row.in_progress ?? 0),
		stepCount: Number(row.step_count ?? 0),
	}));
}

// For the "exit another automation" step and its summaries.
export async function listAutomationOptions() {
	return all<{ id: string; name: string; status: string }>("SELECT id, name, status FROM automations ORDER BY name ASC");
}

export async function listSteps(automationId: string) {
	const rows = await all("SELECT * FROM automation_steps WHERE automation_id = ? ORDER BY position ASC", [automationId]);
	return rows.map((row) => toStep(row)!);
}

export async function getStep(id: string) {
	if (!isObjectIdString(id)) return null;
	return toStep(await first("SELECT * FROM automation_steps WHERE id = ?", [id]));
}

export type StepStats = { here: number; sent: number; opened: number; clicked: number };

// Contacts at each step right now (a wait counts the contacts waiting in it), and email engagement.
export async function getStepStats(automationId: string) {
	const [here, emails] = await Promise.all([
		all<{ step_id: string; count: number }>(
			`SELECT current_step_id AS step_id, COUNT(*) AS count FROM automation_enrollments
			 WHERE automation_id = ? AND status IN ('active', 'waiting') AND current_step_id IS NOT NULL GROUP BY current_step_id`,
			[automationId]
		),
		all<{ step_id: string; sent: number; opened: number; clicked: number }>(
			`SELECT m.step_id, COUNT(m.sent_at) AS sent, COUNT(m.opened_at) AS opened, COUNT(m.clicked_at) AS clicked
			 FROM messages m JOIN automation_steps s ON s.id = m.step_id
			 WHERE s.automation_id = ? AND m.kind = 'automation' GROUP BY m.step_id`,
			[automationId]
		),
	]);
	const stats: Record<string, StepStats> = {};
	const entry = (id: string) => (stats[id] ??= { here: 0, sent: 0, opened: 0, clicked: 0 });
	for (const row of here) entry(row.step_id).here = Number(row.count);
	for (const row of emails) Object.assign(entry(row.step_id), { sent: Number(row.sent), opened: Number(row.opened), clicked: Number(row.clicked) });
	return stats;
}

export async function countEnrollments(automationId: string) {
	const rows = await all<{ status: string; count: number }>(
		"SELECT status, COUNT(*) AS count FROM automation_enrollments WHERE automation_id = ? GROUP BY status",
		[automationId]
	);
	return Object.fromEntries(rows.map(({ status, count }) => [status, Number(count)])) as Record<string, number>;
}

export async function createAutomation({ newsletterId, name }: { newsletterId: string; name: unknown }) {
	const normalized = normalizeAutomationName(name) || "Untitled automation";
	if (!isObjectIdString(newsletterId) || !(await first("SELECT 1 FROM newsletters WHERE id = ?", [newsletterId]))) {
		return { error: "Newsletter not found" };
	}
	const id = newId();
	const now = Date.now();
	await run("INSERT INTO automations (id, newsletter_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [id, newsletterId, normalized, now, now]);
	return { automation: (await getAutomation(id))! };
}

export async function updateAutomation(
	id: string,
	{ name, allowReentry, triggerConfig }: { name?: unknown; allowReentry?: unknown; triggerConfig?: unknown }
) {
	const automation = await getAutomation(id);
	if (!automation) return { error: "Automation not found" };
	const nextName = name === undefined ? automation.name : normalizeAutomationName(name);
	if (!nextName) return { error: "Name is required" };
	const nextTrigger = triggerConfig === undefined ? automation.triggerConfig : normalizeTriggerConfig(automation.triggerType, triggerConfig);
	if (automation.status === "active" && !nextTrigger.tagId) return { error: "Pause the automation before removing its trigger" };
	await run("UPDATE automations SET name = ?, allow_reentry = ?, trigger_config = ?, updated_at = ? WHERE id = ?", [
		nextName,
		allowReentry === undefined ? automation.allowReentry : Boolean(allowReentry),
		JSON.stringify(nextTrigger),
		Date.now(),
		id,
	]);
	return { automation: (await getAutomation(id))! };
}

// Activation is checked by the caller (app/(app)/automations/actions.js), which can render emails.
export async function setAutomationStatus(id: string, status: string) {
	if (!AUTOMATION_STATUSES.includes(status) || status === "draft") return { error: "Invalid status" };
	await run("UPDATE automations SET status = ?, updated_at = ? WHERE id = ?", [status, Date.now(), id]);
	if (status === "active") after(() => runDueEnrollments(Date.now(), { automationId: id }));
	return { automation: (await getAutomation(id))! };
}

// Its enrollments and steps go with it; emails already sent keep their messages.
export async function deleteAutomation(id: string) {
	const { changes } = await run("DELETE FROM automations WHERE id = ?", [id]);
	if (changes) await run("DELETE FROM automation_steps WHERE automation_id = ?", [id]);
	return changes > 0;
}

function renumber(steps: Step[]) {
	return steps.map((step, position) => statement("UPDATE automation_steps SET position = ? WHERE id = ?", [position, step.id]));
}

export async function addStep(
	automationId: string,
	{ parentId = null, branch = null, index, type }: { parentId?: string | null; branch?: string | null; index?: number; type: string }
) {
	if (!STEP_TYPES.includes(type)) return { error: "Unknown step" };
	const steps = await listSteps(automationId);
	if (steps.length >= MAX_STEPS) return { error: `An automation has at most ${MAX_STEPS} steps` };
	if (parentId) {
		const parent = steps.find(({ id }) => id === parentId);
		if (parent?.type !== "condition" || !BRANCHES.includes(String(branch))) return { error: "That branch no longer exists" };
	} else {
		branch = null;
	}
	const runSteps = childrenOf(steps, parentId, branch) as Step[];
	const at = Number.isInteger(index) ? Math.max(0, Math.min(Number(index), runSteps.length)) : runSteps.length;
	const step: Step = { id: newId(), automationId, parentId, branch: branch as Step["branch"], position: at, type, config: defaultStepConfig(type) };
	const now = Date.now();
	await batch([
		statement(
			`INSERT INTO automation_steps (id, automation_id, parent_id, branch, position, type, config, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[step.id, automationId, parentId, branch, at, type, JSON.stringify(step.config), now, now]
		),
		...renumber([...runSteps.slice(0, at), step, ...runSteps.slice(at)]),
		statement("UPDATE automations SET updated_at = ? WHERE id = ?", [now, automationId]),
	]);
	return { step };
}

export async function updateStepConfig(stepId: string, config: unknown) {
	const step = await getStep(stepId);
	if (!step) return { error: "Step not found" };
	const normalized = normalizeStepConfig(step.type, config);
	const now = Date.now();
	await batch([
		statement("UPDATE automation_steps SET config = ?, updated_at = ? WHERE id = ?", [JSON.stringify(normalized), now, stepId]),
		statement("UPDATE automations SET updated_at = ? WHERE id = ?", [now, step.automationId]),
	]);
	return { step: { ...step, config: normalized } };
}

export async function moveStep(stepId: string, direction: "up" | "down") {
	const step = await getStep(stepId);
	if (!step) return { error: "Step not found" };
	const runSteps = childrenOf(await listSteps(step.automationId), step.parentId, step.branch) as Step[];
	const from = runSteps.findIndex(({ id }) => id === stepId);
	const to = direction === "up" ? from - 1 : from + 1;
	if (to < 0 || to >= runSteps.length) return { step };
	[runSteps[from], runSteps[to]] = [runSteps[to], runSteps[from]];
	await batch(renumber(runSteps));
	return { step };
}

// A condition goes with both its branches. Contacts sitting on a removed step leave the automation
// the next time it runs for them (lib/automation-engine.ts).
export async function deleteStep(stepId: string) {
	const step = await getStep(stepId);
	if (!step) return { error: "Step not found" };
	const steps = await listSteps(step.automationId);
	const ids = descendantIds(steps, stepId);
	const remaining = (childrenOf(steps, step.parentId, step.branch) as Step[]).filter(({ id }) => id !== stepId);
	await batch([
		...chunk(ids, MAX_BOUND_PARAMS).map((group) => statement(`DELETE FROM automation_steps WHERE id IN (${placeholders(group.length)})`, group)),
		...renumber(remaining),
		statement("UPDATE automations SET updated_at = ? WHERE id = ?", [Date.now(), step.automationId]),
	]);
	return { ok: true };
}

type TagPair = { contact_id: string; tag_id: string };

// Contacts that just got a tag enter every active automation of their newsletter it starts. Without
// re-entry a contact goes through an automation once; with it, once at a time.
export async function enrollOnTagAdded(pairs: TagPair[]) {
	if (pairs.length === 0) return 0;
	const tagIds = [...new Set(pairs.map(({ tag_id }) => tag_id))];
	const automations: Automation[] = [];
	for (const group of chunk(tagIds, MAX_BOUND_PARAMS)) {
		const rows = await all(
			`SELECT * FROM automations WHERE status = 'active' AND trigger_type = 'tag_added'
			 AND json_extract(trigger_config, '$.tagId') IN (${placeholders(group.length)})`,
			group
		);
		automations.push(...rows.map((row) => toAutomation(row)!));
	}
	if (automations.length === 0) return 0;

	const contacts = await findContactRefs(pairs.map(({ contact_id }) => contact_id));
	let entered = 0;
	for (const automation of automations) {
		const contactIds = [
			...new Set(
				pairs
					.filter(({ tag_id, contact_id }) => tag_id === automation.triggerConfig.tagId && contacts.get(contact_id)?.newsletterId === automation.newsletterId)
					.map(({ contact_id }) => contact_id)
			),
		];
		if (contactIds.length > 0) entered += await enroll(automation, contactIds, contacts);
	}
	if (entered > 0) after(() => runDueEnrollments());
	return entered;
}

async function enroll(automation: Automation, contactIds: string[], contacts: Awaited<ReturnType<typeof findContactRefs>>) {
	const blocking = automation.allowReentry ? "AND status IN ('active', 'waiting')" : "";
	const inside = new Set<string>();
	for (const group of chunk(contactIds, MAX_BOUND_PARAMS - 1)) {
		const rows = await all<{ contact_id: string }>(
			`SELECT DISTINCT contact_id FROM automation_enrollments WHERE automation_id = ? ${blocking} AND contact_id IN (${placeholders(group.length)})`,
			[automation.id, ...group]
		);
		for (const row of rows) inside.add(row.contact_id);
	}
	const entering = contactIds.filter((id) => !inside.has(id));
	if (entering.length === 0) return 0;

	const start = firstStep(await listSteps(automation.id));
	const now = Date.now();
	const columns = 7;
	await batch([
		...chunk(entering, Math.floor(MAX_BOUND_PARAMS / columns)).map((group) =>
			statement(
				`INSERT INTO automation_enrollments (id, automation_id, contact_id, status, current_step_id, wake_at, entered_at, updated_at)
				 VALUES ${group.map(() => "(?, ?, ?, 'active', ?, ?, ?, ?)").join(", ")}`,
				group.flatMap((contactId) => [newId(), automation.id, contactId, start?.id ?? null, now, now, now])
			)
		),
		statement("UPDATE automations SET stats_entered = stats_entered + ? WHERE id = ?", [entering.length, automation.id]),
	]);
	await logActivities(
		entering.flatMap((contactId) => {
			const contact = contacts.get(contactId);
			if (!contact) return [];
			return [
				{
					email: contact.email,
					contactId,
					newsletterId: contact.newsletterId,
					type: "automation_entered" as const,
					data: { automationId: automation.id, automation: automation.name },
					occurredAt: now,
				},
			];
		})
	);
	return entering.length;
}
