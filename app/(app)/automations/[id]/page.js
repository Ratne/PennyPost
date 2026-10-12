import { notFound } from "next/navigation";
import BuilderAutomation from "@/components/BuilderAutomation";
import { countEnrollments, getAutomation, getStepStats, listAutomationOptions, listSteps } from "@/lib/automations";
import { toNewsletterOptions } from "@/lib/newsletters";
import { listSegments } from "@/lib/segment-store";
import { getNewsletter } from "@/lib/sending";
import { listTags } from "@/lib/tags";

export async function generateMetadata({ params }) {
	const automation = await getAutomation((await params).id);
	return { title: automation?.name ?? "Automation" };
}

export default async function AutomationPage({ params }) {
	const automation = await getAutomation((await params).id);
	if (!automation) notFound();
	const [newsletter, steps, stats, enrollments, tags, segments, automations] = await Promise.all([
		getNewsletter(automation.newsletterId),
		listSteps(automation.id),
		getStepStats(automation.id),
		countEnrollments(automation.id),
		listTags({ newsletterId: automation.newsletterId }),
		listSegments(automation.newsletterId),
		listAutomationOptions(),
	]);
	if (!newsletter) notFound();

	return (
		<BuilderAutomation
			initialFlow={{ automation, steps, stats }}
			newsletter={toNewsletterOptions([newsletter])[0]}
			enrollments={enrollments}
			tags={tags.map(({ id, name, color, contacts }) => ({ id, name, color, contacts }))}
			segments={segments.map(({ _id, name }) => ({ id: _id, name }))}
			automations={automations.filter(({ id }) => id !== automation.id)}
		/>
	);
}
