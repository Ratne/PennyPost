import { env } from "cloudflare:workers";
import { logActivity } from "@/lib/contact-activity";
import { buildWebhookRequest, getWakeAt, nextStep, normalizeStepConfig } from "@/lib/automation-rules";
import { type Automation, type Step, listSteps, toAutomation } from "@/lib/automations";
import { isSendingEnabled } from "@/lib/config";
import { mailboxProvider } from "@/lib/providers";
import { compileSegmentRules } from "@/lib/segments";
import { getNewsletter } from "@/lib/sending";
import { getSendProblem } from "@/lib/sending-rules";
import { all, first, newId, run } from "@/server/db";

// A run claims an enrollment by pushing wake_at this far ahead: if the worker dies halfway, the
// enrollment is picked up again once it passes, from the last step recorded.
const LEASE_MS = 5 * 60 * 1000;
// Sending switched off: emails wait for it instead of piling up in the queue.
const SENDING_OFF_RETRY_MS = 5 * 60 * 1000;
const MAX_PER_RUN = 200;
const MAX_STEPS_PER_RUN = 50;
const WEBHOOK_TIMEOUT_MS = 10_000;

type Enrollment = {
	id: string;
	automation_id: string;
	contact_id: string;
	status: "active" | "waiting";
	current_step_id: string | null;
	wake_at: number;
	entered_at: number;
};

type Contact = {
	id: string;
	email: string;
	status: string;
	newsletter_id: string;
	first_name: string | null;
	last_name: string | null;
	phone: string | null;
};

type Flow = { automation: Automation; steps: Step[]; newsletter: any };

type Outcome = { next: string | null } | { waitUntil: number } | { retryAt: number };

// Runs on the minutely cron and right after contacts enter. Two runs at once can't take the same
// enrollment: the claim only matches the wake_at it read.
export async function runDueEnrollments(now = Date.now(), { automationId }: { automationId?: string } = {}) {
	const due = await all<Enrollment>(
		`SELECT e.* FROM automation_enrollments e JOIN automations a ON a.id = e.automation_id
		 WHERE e.status IN ('active', 'waiting') AND e.wake_at <= ? AND a.status = 'active' ${automationId ? "AND a.id = ?" : ""}
		 ORDER BY e.wake_at ASC LIMIT ?`,
		automationId ? [now, automationId, MAX_PER_RUN] : [now, MAX_PER_RUN]
	);
	const flows = new Map<string, Promise<Flow | null>>();
	let processed = 0;
	for (const enrollment of due) {
		if (!flows.has(enrollment.automation_id)) flows.set(enrollment.automation_id, loadFlow(enrollment.automation_id));
		const flow = await flows.get(enrollment.automation_id)!;
		if (!flow) continue;
		try {
			if (await runEnrollment(enrollment, flow)) processed++;
		} catch (error: any) {
			console.error(`[automations] Enrollment ${enrollment.id} failed:`, error?.message ?? error);
		}
	}
	if (processed > 0) console.info(`[automations] ${JSON.stringify({ due: due.length, processed })}`);
	return { due: due.length, processed };
}

async function loadFlow(automationId: string): Promise<Flow | null> {
	const automation = toAutomation(await first("SELECT * FROM automations WHERE id = ?", [automationId]));
	if (!automation) return null;
	const [steps, newsletter] = await Promise.all([listSteps(automationId), getNewsletter(automation.newsletterId)]);
	return { automation, steps, newsletter };
}

async function runEnrollment(enrollment: Enrollment, flow: Flow) {
	const claim = await run(
		"UPDATE automation_enrollments SET status = 'active', wake_at = ?, updated_at = ? WHERE id = ? AND status = ? AND wake_at = ?",
		[Date.now() + LEASE_MS, Date.now(), enrollment.id, enrollment.status, enrollment.wake_at]
	);
	if (!claim.changes) return false;

	const contact = await first<Contact>(
		`SELECT c.id, c.email, c.status, c.newsletter_id, p.first_name, p.last_name, p.phone
		 FROM contacts c LEFT JOIN people p ON p.email = c.email WHERE c.id = ?`,
		[enrollment.contact_id]
	);
	if (!contact) {
		await finish(enrollment, flow, null, "exited", "contact deleted");
		return true;
	}

	let stepId = enrollment.current_step_id;
	// A waiting contact sits on its wait step: once woken, that step is done.
	if (enrollment.status === "waiting" && stepId) {
		if (!flow.steps.some(({ id }) => id === stepId)) return finish(enrollment, flow, contact, "exited", "step removed");
		stepId = nextStep(flow.steps, stepId)?.id ?? null;
	}

	for (let count = 0; count < MAX_STEPS_PER_RUN; count++) {
		if (!stepId) return finish(enrollment, flow, contact, "completed", null);
		const step = flow.steps.find(({ id }) => id === stepId);
		if (!step) return finish(enrollment, flow, contact, "exited", "step removed");

		const outcome = await runStep(step, { enrollment, flow, contact });
		if ("waitUntil" in outcome) {
			await run(
				"UPDATE automation_enrollments SET status = 'waiting', current_step_id = ?, wake_at = ?, updated_at = ? WHERE id = ? AND status = 'active'",
				[step.id, outcome.waitUntil, Date.now(), enrollment.id]
			);
			return true;
		}
		if ("retryAt" in outcome) {
			await run("UPDATE automation_enrollments SET current_step_id = ?, wake_at = ?, updated_at = ? WHERE id = ? AND status = 'active'", [
				step.id,
				outcome.retryAt,
				Date.now(),
				enrollment.id,
			]);
			return true;
		}
		stepId = outcome.next;
		// An exit step in another automation can close this enrollment while it runs.
		const progress = await run(
			"UPDATE automation_enrollments SET current_step_id = ?, wake_at = ?, updated_at = ? WHERE id = ? AND status = 'active'",
			[stepId, Date.now() + LEASE_MS, Date.now(), enrollment.id]
		);
		if (!progress.changes) return true;
	}
	// Far more steps than a flow should run in one go: carry on at the next tick.
	await run("UPDATE automation_enrollments SET wake_at = ?, updated_at = ? WHERE id = ? AND status = 'active'", [Date.now(), Date.now(), enrollment.id]);
	return true;
}

async function finish(enrollment: Enrollment, flow: Flow, contact: Contact | null, status: "completed" | "exited", reason: string | null) {
	const now = Date.now();
	const { changes } = await run(
		`UPDATE automation_enrollments SET status = ?, current_step_id = NULL, wake_at = NULL, finished_at = ?, exit_reason = ?, updated_at = ?
		 WHERE id = ? AND status = 'active'`,
		[status, now, reason, now, enrollment.id]
	);
	if (!changes) return true;
	if (status === "completed") await run("UPDATE automations SET stats_completed = stats_completed + 1 WHERE id = ?", [flow.automation.id]);
	if (contact) {
		await logActivity({
			email: contact.email,
			contactId: contact.id,
			newsletterId: contact.newsletter_id,
			type: status === "completed" ? "automation_completed" : "automation_exited",
			data: { automationId: flow.automation.id, automation: flow.automation.name, ...(reason && { reason }) },
			occurredAt: now,
		});
	}
	return true;
}

type Context = { enrollment: Enrollment; flow: Flow; contact: Contact };

async function log({ enrollment, flow, contact }: Context, step: Step, status: "ok" | "skipped" | "failed", detail: string | null = null) {
	await run(
		"INSERT INTO automation_logs (id, enrollment_id, automation_id, step_id, contact_id, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		[newId(), enrollment.id, flow.automation.id, step.id, contact.id, status, detail?.slice(0, 500) ?? null, Date.now()]
	);
}

async function runStep(step: Step, context: Context): Promise<Outcome> {
	const after = () => ({ next: nextStep(context.flow.steps, step.id)?.id ?? null });
	switch (step.type) {
		case "wait": {
			const wakeAt = getWakeAt(step.config);
			if (wakeAt <= Date.now()) return after();
			return { waitUntil: wakeAt };
		}
		case "email":
			return runEmail(step, context, after);
		case "webhook":
			await runWebhook(step, context);
			return after();
		case "exit_automation":
			await runExit(step, context);
			return after();
		case "condition": {
			const matches = await checkCondition(step, context);
			await log(context, step, "ok", matches ? "yes" : "no");
			return { next: nextStep(context.flow.steps, step.id, matches ? "yes" : "no")?.id ?? null };
		}
		default:
			await log(context, step, "skipped", `Unknown step ${step.type}`);
			return after();
	}
}

// The email goes through the send queue like any other; a contact who can't receive it moves on.
async function runEmail(step: Step, context: Context, after: () => Outcome): Promise<Outcome> {
	const { contact, enrollment, flow } = context;
	if (contact.status !== "active") {
		await log(context, step, "skipped", `Contact is ${contact.status}`);
		return after();
	}
	if (await first("SELECT 1 FROM suppressions WHERE email = ?", [contact.email])) {
		await log(context, step, "skipped", "Address is suppressed");
		return after();
	}
	const config = normalizeStepConfig("email", step.config);
	const problem = getSendProblem({ campaign: config, newsletter: flow.newsletter });
	if (problem) {
		await log(context, step, "failed", problem);
		return after();
	}
	if (!isSendingEnabled()) return { retryAt: Date.now() + SENDING_OFF_RETRY_MS };

	// A run that stopped after queueing doesn't send it twice.
	const existing = await first(
		"SELECT 1 FROM messages WHERE kind = 'automation' AND step_id = ? AND contact_id = ? AND created_at >= ? LIMIT 1",
		[step.id, contact.id, enrollment.entered_at]
	);
	if (!existing) {
		const id = newId();
		await run(
			"INSERT INTO messages (id, kind, step_id, newsletter_id, contact_id, email, provider, created_at) VALUES (?, 'automation', ?, ?, ?, ?, ?, ?)",
			[id, step.id, flow.automation.newsletterId, contact.id, contact.email, mailboxProvider(contact.email), Date.now()]
		);
		await env.SEND_QUEUE.send({ messageIds: [id] });
	}
	await log(context, step, "ok", existing ? "Already queued" : "Queued");
	return after();
}

async function getTagNames(contactId: string) {
	const rows = await all<{ name: string }>(
		"SELECT t.name FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ? ORDER BY t.name",
		[contactId]
	);
	return rows.map(({ name }) => name).join(", ");
}

// A failed call is logged and the flow goes on: the receiving end is outside our control.
async function runWebhook(step: Step, context: Context) {
	const { contact, flow } = context;
	const request = buildWebhookRequest(step.config, {
		email: contact.email,
		firstName: contact.first_name ?? "",
		lastName: contact.last_name ?? "",
		phone: contact.phone ?? "",
		contactId: contact.id,
		newsletter: flow.newsletter?.name ?? "",
		tags: await getTagNames(contact.id),
		automation: flow.automation.name,
	});
	try {
		const response = await fetch(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body || undefined,
			redirect: "manual",
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
		});
		await response.body?.cancel();
		await log(context, step, response.ok ? "ok" : "failed", `HTTP ${response.status}`);
	} catch (error: any) {
		await log(context, step, "failed", error?.name === "TimeoutError" ? "Timed out" : String(error?.message ?? error));
	}
}

async function runExit(step: Step, context: Context) {
	const { automationId } = normalizeStepConfig("exit_automation", step.config);
	const target = automationId ? await first<{ id: string; name: string }>("SELECT id, name FROM automations WHERE id = ?", [automationId]) : null;
	if (!target) return log(context, step, "skipped", "The automation no longer exists");

	const now = Date.now();
	const reason = `Exited by “${context.flow.automation.name}”`;
	const exited = await all<{ id: string }>(
		`UPDATE automation_enrollments SET status = 'exited', current_step_id = NULL, wake_at = NULL, finished_at = ?, exit_reason = ?, updated_at = ?
		 WHERE automation_id = ? AND contact_id = ? AND status IN ('active', 'waiting') RETURNING id`,
		[now, reason, now, target.id, context.contact.id]
	);
	if (exited.length > 0) {
		await logActivity({
			email: context.contact.email,
			contactId: context.contact.id,
			newsletterId: context.contact.newsletter_id,
			type: "automation_exited",
			data: { automationId: target.id, automation: target.name, reason },
			occurredAt: now,
		});
	}
	await log(context, step, exited.length > 0 ? "ok" : "skipped", exited.length > 0 ? `Left “${target.name}”` : `Wasn't in “${target.name}”`);
}

async function checkCondition(step: Step, { contact }: Context) {
	const config = normalizeStepConfig("condition", step.config);
	if (config.kind === "has_tag") {
		if (!config.tagId) return false;
		return Boolean(await first("SELECT 1 FROM contact_tags WHERE contact_id = ? AND tag_id = ?", [contact.id, config.tagId]));
	}
	const segment = config.segmentId ? await first<{ rules: string }>("SELECT rules FROM segments WHERE id = ?", [config.segmentId]) : null;
	if (!segment) return false;
	let rules = {};
	try {
		rules = JSON.parse(segment.rules || "{}");
	} catch {}
	const filter = compileSegmentRules(rules);
	return Boolean(await first(`SELECT 1 FROM contacts c WHERE c.id = ? AND ${filter.sql}`, [contact.id, ...filter.params]));
}

export async function pruneAutomationLogs(now = Date.now()) {
	await run("DELETE FROM automation_logs WHERE created_at < ?", [now - 90 * 24 * 60 * 60 * 1000]);
}
