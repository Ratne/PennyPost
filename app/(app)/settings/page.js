import FormSettings from "@/components/FormSettings";
import HeaderPage from "@/components/HeaderPage";
import { getSettingsView } from "@/lib/settings";

export const metadata = { title: "Settings" };

// SESSION_SECRET, the SES keys and SES_SNS_TOPIC_ARN aren't here on purpose: they stay Cloudflare secrets.
export default async function SettingsPage() {
	const { fields, emailable } = await getSettingsView();
	return (
		<>
			<HeaderPage title="Settings" />
			<div className="max-w-2xl">
				<FormSettings fields={fields} emailable={emailable} />
			</div>
		</>
	);
}
