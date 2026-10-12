import { notFound } from "next/navigation";
import FormAutomationEmail from "@/components/FormAutomationEmail";
import { requireSession } from "@/lib/auth";
import { getAutomation, getStep } from "@/lib/automations";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { getNewsletter } from "@/lib/sending";
import { serialize } from "@/lib/serialize";

export const metadata = { title: "Automation email" };

export default async function AutomationEmailPage({ params }) {
	const { id, stepId } = await params;
	const [automation, step] = await Promise.all([getAutomation(id), getStep(stepId)]);
	if (!automation || step?.type !== "email" || step.automationId !== automation.id) notFound();
	const newsletter = await getNewsletter(automation.newsletterId);
	if (!newsletter) notFound();

	return (
		<FormAutomationEmail
			automation={{ id: automation.id, name: automation.name }}
			step={{ id: step.id, ...step.config }}
			newsletter={serialize(newsletter)}
			isSendingEnabled={isSendingEnabled()}
			testEmail={(await requireSession()).email}
			appUrl={getAppUrl()}
		/>
	);
}
