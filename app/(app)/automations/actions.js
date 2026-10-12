"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getActivationProblem, orderedSteps } from "@/lib/automation-rules";
import {
	addStep,
	createAutomation,
	deleteAutomation,
	deleteStep,
	getAutomation,
	getStep,
	getStepStats,
	listSteps,
	moveStep,
	setAutomationStatus,
	updateAutomation,
	updateStepConfig,
} from "@/lib/automations";
import { isSendingEnabled } from "@/lib/config";
import { getNewsletter, sendAutomationTestEmail } from "@/lib/sending";
import { getSendProblem } from "@/lib/sending-rules";
import { MAX_BODY_BYTES, isObjectIdString } from "@/lib/validation";

async function findAutomation(id) {
	await requireSession();
	return isObjectIdString(id) ? getAutomation(id) : null;
}

async function findStep(id) {
	await requireSession();
	return isObjectIdString(id) ? getStep(id) : null;
}

// What the builder redraws from after every change.
async function loadFlow(automationId) {
	const [automation, steps, stats] = await Promise.all([getAutomation(automationId), listSteps(automationId), getStepStats(automationId)]);
	return { automation, steps, stats };
}

function revalidate(id) {
	revalidatePath("/automations");
	revalidatePath(`/automations/${id}`);
}

export async function newAutomation({ newsletterId, name }) {
	await requireSession();
	const result = await createAutomation({ newsletterId, name });
	if (result.error) return { error: result.error };
	revalidatePath("/automations");
	redirect(`/automations/${result.automation.id}`);
}

export async function saveAutomation(id, { name, allowReentry, tagId } = {}) {
	const automation = await findAutomation(id);
	if (!automation) return { error: "Automation not found" };
	const result = await updateAutomation(id, {
		name,
		allowReentry,
		triggerConfig: tagId === undefined ? undefined : { tagId: tagId || undefined },
	});
	if (result.error) return { error: result.error };
	revalidate(id);
	return { ok: true, ...(await loadFlow(id)) };
}

// Emails are also rendered the way a send would, so one over the size limit can't go live.
async function getProblem(automation) {
	const steps = await listSteps(automation.id);
	const problem = getActivationProblem(automation, steps);
	if (problem) return problem;
	const newsletter = await getNewsletter(automation.newsletterId);
	for (const [index, step] of orderedSteps(steps).entries()) {
		if (step.type !== "email") continue;
		const sendProblem = getSendProblem({ campaign: step.config, newsletter });
		if (sendProblem) return `Step ${index + 1}: ${sendProblem}`;
	}
	return null;
}

export async function changeAutomationStatus(id, status) {
	const automation = await findAutomation(id);
	if (!automation) return { error: "Automation not found" };
	if (status === "active") {
		const problem = await getProblem(automation);
		if (problem) return { error: problem };
	}
	const result = await setAutomationStatus(id, status);
	if (result.error) return { error: result.error };
	revalidate(id);
	return { ok: true, ...(await loadFlow(id)) };
}

export async function removeAutomation(id) {
	const automation = await findAutomation(id);
	if (!automation) return { error: "Automation not found" };
	await deleteAutomation(id);
	revalidatePath("/automations");
	return { ok: true };
}

export async function addAutomationStep(automationId, { parentId = null, branch = null, index, type }) {
	const automation = await findAutomation(automationId);
	if (!automation) return { error: "Automation not found" };
	const result = await addStep(automationId, { parentId, branch, index, type });
	if (result.error) return { error: result.error };
	revalidate(automationId);
	return { ok: true, step: result.step, ...(await loadFlow(automationId)) };
}

export async function saveAutomationStep(stepId, config) {
	const step = await findStep(stepId);
	if (!step) return { error: "Step not found" };
	const result = await updateStepConfig(stepId, config);
	if (result.error) return { error: result.error };
	revalidate(step.automationId);
	return { ok: true, ...(await loadFlow(step.automationId)) };
}

export async function moveAutomationStep(stepId, direction) {
	const step = await findStep(stepId);
	if (!step) return { error: "Step not found" };
	await moveStep(stepId, direction === "up" ? "up" : "down");
	revalidate(step.automationId);
	return { ok: true, ...(await loadFlow(step.automationId)) };
}

export async function removeAutomationStep(stepId) {
	const step = await findStep(stepId);
	if (!step) return { error: "Step not found" };
	await deleteStep(stepId);
	revalidate(step.automationId);
	return { ok: true, ...(await loadFlow(step.automationId)) };
}

export async function saveAutomationEmail(stepId, values) {
	const step = await findStep(stepId);
	if (step?.type !== "email") return { error: "Email not found" };
	const body = String(values?.body ?? "");
	const bytes = Buffer.byteLength(body, "utf8");
	if (bytes > MAX_BODY_BYTES) {
		return { error: `The content is ${Math.ceil(bytes / 1000)} KB. The limit is ${MAX_BODY_BYTES / 1000} KB.` };
	}
	const result = await updateStepConfig(stepId, {
		subject: String(values?.subject ?? ""),
		previewText: String(values?.previewText ?? ""),
		html: body,
	});
	if (result.error) return { error: result.error };
	revalidatePath(`/automations/${step.automationId}`);
	return { ok: true };
}

export async function sendAutomationTest(stepId) {
	const step = await findStep(stepId);
	if (step?.type !== "email") return { error: "Email not found" };
	if (!isSendingEnabled()) return { error: "Sending is off" };
	const { email } = await requireSession();
	try {
		await sendAutomationTestEmail({ stepId, to: email });
		return { ok: true };
	} catch (error) {
		console.error("[automations] Test send failed:", error);
		return { error: error.message || "Sending failed" };
	}
}
