import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import FormNewsletter from "@/components/FormNewsletter";
import HeaderPage from "@/components/HeaderPage";
import { CLEANUP_TOTALS_SQL } from "@/lib/cleanup";
import { requireSession } from "@/lib/auth";
import { isSendingEnabled } from "@/lib/config";
import { getNewsletter } from "@/lib/sending";
import { serialize } from "@/lib/serialize";
import { listSesDomains } from "@/lib/ses";
import { isObjectIdString } from "@/lib/validation";
import { first } from "@/server/db";

export const metadata = { title: "Newsletter" };

export default async function NewsletterPage({ params }) {
	const { id } = await params;
	const isNew = id === "new";
	if (!isNew && !isObjectIdString(id)) notFound();

	const [newsletter, domains, cleanupTotals, otherHomepage] = await Promise.all([
		isNew ? null : getNewsletter(id),
		listSesDomains(),
		isNew ? null : getCleanupTotals(id),
		first("SELECT name FROM newsletters WHERE is_homepage = 1 AND id != ?", [isNew ? "" : id]),
	]);
	if (!isNew && !newsletter) notFound();

	const verifiedDomains = Array.isArray(domains)
		? domains.filter(({ verified }) => verified).map(({ domain }) => domain)
		: null;

	return (
		<>
			<HeaderPage
				title={isNew ? "New newsletter" : newsletter.name}
				backHref="/newsletters"
				icon={newsletter && <AvatarNewsletter newsletter={newsletter} size={32} />}
			/>
			<FormNewsletter
				newsletter={newsletter ? serialize(newsletter) : null}
				verifiedDomains={verifiedDomains}
				isSendingEnabled={isSendingEnabled()}
				testEmail={(await requireSession()).email}
				cleanupTotals={cleanupTotals}
				otherHomepageName={otherHomepage?.name ?? null}
			/>
		</>
	);
}

async function getCleanupTotals(newsletterId) {
	const totals = await first(CLEANUP_TOTALS_SQL, [newsletterId]);
	return { waiting: totals?.waiting ?? 0, kept: totals?.kept ?? 0, dormant: totals?.dormant ?? 0 };
}
