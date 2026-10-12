const EMAIL_KINDS = {
	welcome: "the welcome email",
	confirmation: "the confirmation email",
	"last-chance": "the last-chance email",
	automation: "an automation email",
	test: "a test email",
};

const SOURCES = {
	dashboard: "from the dashboard",
	api: "through the API",
	import: "by an import",
	one_click: "with the one-click link in their mail app",
	unsubscribe_page: "on the unsubscribe page",
	tag_deleted: "when the tag was deleted",
	website: "on the website",
};

const PROFILE_FIELDS = { firstName: "first name", lastName: "last name", phone: "phone" };

const VERIFICATION_STATES = {
	deliverable: "deliverable",
	risky: "risky",
	unknown: "unknown",
	undeliverable: "undeliverable",
};

function quoted(text) {
	return `“${text}”`;
}

function emailName(event) {
	if (event.subject) return quoted(event.subject);
	return EMAIL_KINDS[event.kind] ?? "an email";
}

function sourceText(source) {
	if (!source) return null;
	return SOURCES[source] ?? `from ${source}`;
}

function join(...parts) {
	return parts.filter(Boolean).join(" ");
}

// What the contact page's timeline says about one event: a sentence and, sometimes, a detail line.
export function describeActivity(event) {
	const data = event.data ?? {};
	switch (event.type) {
		case "email_sent":
			return { title: `Sent ${emailName(event)}` };
		case "email_delivered":
			return { title: `${capitalize(emailName(event))} was delivered` };
		case "email_bounced":
			return { title: `${capitalize(emailName(event))} bounced` };
		case "email_complained":
			return { title: `Marked ${emailName(event)} as spam` };
		case "opened":
			return {
				title: `Opened ${emailName(event)}`,
				detail: data.automatic
					? "Likely a mail server or privacy proxy loading images, not a person"
					: data.first
						? "First open only: earlier emails don't record every open"
						: null,
			};
		case "clicked":
			return {
				title: `Clicked a link in ${emailName(event)}`,
				detail: data.url ?? (data.first ? "First click only: earlier emails don't record every click" : null),
			};
		case "subscribed":
			return { title: join("Subscribed", sourceText(data.source)), detail: data.status === "pending" ? "Waiting for confirmation" : null };
		case "resubscribed":
			return { title: join("Subscribed again", sourceText(data.source)), detail: data.from ? `Was ${data.from}` : null };
		case "confirmed":
			return { title: "Confirmed the subscription" };
		case "unsubscribed":
			return { title: join("Unsubscribed", sourceText(data.source)) };
		case "reactivated":
			return { title: "Reactivated" };
		case "dormant":
			return { title: "Became dormant", detail: "Ignored the last-chance email after several issues" };
		case "kept":
			return { title: "Asked to keep receiving the newsletter" };
		case "bounced":
			return { title: "Stopped after a hard bounce", detail: data.detail ?? null };
		case "complained":
			return { title: "Stopped after a spam complaint", detail: data.detail ?? null };
		case "imported":
			return { title: join("Imported", sourceText(data.source === "import" ? null : data.source)), detail: data.status ? `As ${data.status}` : null };
		case "tag_added":
			return { title: `Tag ${quoted(data.tag ?? "deleted tag")} added`, detail: sourceText(data.source) };
		case "tag_removed":
			return { title: `Tag ${quoted(data.tag ?? "deleted tag")} removed`, detail: sourceText(data.source) };
		case "profile_updated": {
			const fields = Object.keys(data)
				.map((key) => PROFILE_FIELDS[key])
				.filter(Boolean);
			return { title: fields.length ? `Changed ${listText(fields)}` : "Profile updated" };
		}
		case "verified":
			return {
				title: `Address checked: ${VERIFICATION_STATES[data.state] ?? data.state ?? "unknown"}`,
				detail: data.reason ? data.reason.replaceAll("_", " ") : null,
			};
		case "automation_entered":
			return { title: `Entered the automation ${quoted(data.automation ?? "deleted automation")}` };
		case "automation_completed":
			return { title: `Finished the automation ${quoted(data.automation ?? "deleted automation")}` };
		case "automation_exited":
			return { title: `Left the automation ${quoted(data.automation ?? "deleted automation")}`, detail: data.reason ?? null };
		default:
			return { title: capitalize(String(event.type).replaceAll("_", " ")) };
	}
}

function capitalize(text) {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function listText(items) {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
