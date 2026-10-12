import { STATUS_RANK } from "./csv-import.js";

export const SUPPRESSION_REASONS = { bounced: "bounce", complained: "complaint" };

function weakerStatuses(status) {
	return Object.keys(STATUS_RANK).filter((key) => STATUS_RANK[key] < STATUS_RANK[status]);
}

// One row per contact: new contacts take the file's status, existing ones keep theirs and only get the
// imported engagement figures (see importContactRows).
export function getContactInserts({ contacts, source, now = Date.now() }) {
	return contacts.map(({ email, status, subscribedAt, emailsReceived, openRate, clickRate }) => ({
		email,
		status,
		source,
		subscribedAt: subscribedAt ? new Date(subscribedAt).getTime() : now,
		unsubscribedAt: status === "unsubscribed" ? now : null,
		emailsReceived: emailsReceived ?? null,
		openRate: openRate ?? null,
		clickRate: clickRate ?? null,
	}));
}

// Each status the rows move existing contacts to, with the weaker statuses it replaces. Nothing moves a
// contact to active, and pending has no rank, so a contact waiting to confirm stays as it is.
export function getStatusChanges(contacts) {
	return Object.entries(Object.groupBy(contacts, ({ status }) => status))
		.filter(([status]) => status !== "active")
		.map(([status, group]) => ({
			status,
			emails: group.map(({ email }) => email),
			replaces: weakerStatuses(status),
		}));
}
