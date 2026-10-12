import { forContacts, logActivities, logActivity } from "@/lib/contact-activity";
import { mergePeople } from "@/lib/people";
import { all, first, newId, run, toContact, toNewsletter } from "@/server/db";

// Any sign of life starts the list cleanup count over (lib/cleanup.js withEngagement, in SQL).
export const ENGAGEMENT_SET = "ignored_issues = 0, last_engaged_at = MAX(COALESCE(last_engaged_at, 0), ?)";

const CHANGED = "RETURNING id, email, newsletter_id";
type ChangedRow = { id: string; email: string; newsletter_id: string };

// Newsletters in creation order with their active contacts.
export async function listNewslettersWithActiveCounts() {
	const rows = await all(
		`SELECT n.*, (SELECT COUNT(*) FROM contacts c WHERE c.newsletter_id = n.id AND c.status = 'active') AS active_count
		 FROM newsletters n ORDER BY n.created_at ASC`
	);
	return rows.map((row) => toNewsletter(row)!);
}

// Only an explicit resubscribe reverses an opt-out; bounces and complaints never reverse.
const REACTIVATABLE_STATUSES = ["unsubscribed", "dormant"];
const SUPPRESSED_STATUSES: Record<string, string> = { bounce: "bounced", complaint: "complained", manual: "unsubscribed" };

export async function findContact(newsletterId: string, email: string) {
	return toContact(await first("SELECT * FROM contacts WHERE newsletter_id = ? AND email = ?", [newsletterId, email]));
}

export async function getContactById(id: string) {
	return toContact(await first("SELECT * FROM contacts WHERE id = ?", [id]));
}

export async function upsertContact({
	newsletter,
	email,
	source,
	resubscribe,
	person,
}: {
	newsletter: any;
	email: string;
	source?: string;
	resubscribe?: boolean;
	person?: { firstName?: string; lastName?: string; phone?: string };
}) {
	const joinStatus = newsletter.requireConfirmation ? "pending" : "active";
	const suppression = await first<{ reason: string }>("SELECT reason FROM suppressions WHERE email = ?", [email]);
	const status = suppression ? (SUPPRESSED_STATUSES[suppression.reason] ?? "unsubscribed") : joinStatus;
	const now = Date.now();
	const { changes } = await run(
		`INSERT INTO contacts (id, newsletter_id, email, status, source, subscribed_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(newsletter_id, email) DO NOTHING`,
		[newId(), newsletter._id, email, status, source, now, now, now]
	);
	const created = changes > 0;
	await mergePeople([{ email, ...person }]);
	const contact = (await findContact(newsletter._id, email))!;
	const ref = { email, contactId: contact._id, newsletterId: newsletter._id, occurredAt: now };
	if (created) await logActivity({ ...ref, type: "subscribed", data: { source: source ?? null, status } });

	if (created || !resubscribe || suppression) return { contact, created };
	// Signing up again is a sign of life, and brings back a contact who left or went dormant.
	if (contact.status === "active") {
		await run(`UPDATE contacts SET ${ENGAGEMENT_SET}, updated_at = ? WHERE id = ?`, [now, now, contact._id]);
		return { contact, created };
	}
	if (!REACTIVATABLE_STATUSES.includes(contact.status)) return { contact, created };
	const { changes: reactivated } = await run(
		`UPDATE contacts SET status = ?, subscribed_at = ?, unsubscribed_at = NULL, ${ENGAGEMENT_SET}, updated_at = ?
		 WHERE id = ? AND status IN ('unsubscribed', 'dormant')`,
		[joinStatus, now, now, now, contact._id]
	);
	if (!reactivated) return { contact, created };
	await logActivity({ ...ref, type: "resubscribed", data: { source: source ?? null, from: contact.status, status: joinStatus } });
	return { contact: (await getContactById(contact._id))!, created };
}

// The click on the confirmation link. A contact that already confirmed stays as it is.
export async function confirmContact({ contactId, newsletterId }: { contactId: string; newsletterId: string }) {
	const now = Date.now();
	const changed = await all<ChangedRow>(
		`UPDATE contacts SET status = 'active', confirmed_at = ?, ${ENGAGEMENT_SET}, updated_at = ?
		 WHERE id = ? AND newsletter_id = ? AND status = 'pending' ${CHANGED}`,
		[now, now, now, contactId, newsletterId]
	);
	await logActivities(forContacts(changed, { type: "confirmed", occurredAt: now }));
	const contact = toContact(await first("SELECT * FROM contacts WHERE id = ? AND newsletter_id = ?", [contactId, newsletterId]));
	return { contact, confirmed: changed.length > 0 };
}

// The "Yes, keep sending it" click in the last-chance email. It also brings back a contact who went
// dormant; unsubscribes, bounces and complaints stay as they are.
export async function keepContact({ contactId, newsletterId }: { contactId: string; newsletterId: string }) {
	const contact = await first<{ id: string; email: string; status: string }>(
		"SELECT id, email, status FROM contacts WHERE id = ? AND newsletter_id = ?",
		[contactId, newsletterId]
	);
	if (!contact || !["active", "dormant"].includes(contact.status)) return null;
	if (contact.status === "dormant" && (await first("SELECT 1 FROM suppressions WHERE email = ?", [contact.email]))) return null;
	const now = Date.now();
	const changed = await all<ChangedRow>(
		`UPDATE contacts SET status = 'active', ${ENGAGEMENT_SET}, updated_at = ? WHERE id = ? AND status IN ('active', 'dormant') ${CHANGED}`,
		[now, now, contact.id]
	);
	await logActivities(forContacts(changed, { type: "kept", occurredAt: now, data: { from: contact.status } }));
	return changed.length ? getContactById(contact.id) : null;
}

// Pending, active and dormant contacts can leave; bounces and complaints already block sending.
export async function unsubscribeContact(id: string, source = "dashboard") {
	const now = Date.now();
	const changed = await all<ChangedRow>(
		`UPDATE contacts SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ?
		 WHERE id = ? AND status IN ('active', 'dormant', 'pending') ${CHANGED}`,
		[now, now, id]
	);
	await logActivities(forContacts(changed, { type: "unsubscribed", occurredAt: now, data: { source } }));
	return changed.length > 0;
}

// Back to active, starting the list cleanup over (or the next send would make them dormant again).
// `from` lists the statuses that may come back; a suppressed address (bounce, complaint, manual) never does.
export async function reactivateContact(id: string, from: string[] = ["dormant"]) {
	const allowed = from.filter((status) => REACTIVATABLE_STATUSES.includes(status) || status === "pending");
	if (allowed.length === 0) return false;
	const now = Date.now();
	const changed = await all<ChangedRow>(
		`UPDATE contacts SET status = 'active', unsubscribed_at = NULL, ${ENGAGEMENT_SET}, updated_at = ?
		 WHERE id = ? AND status IN (${allowed.map(() => "?").join(", ")})
		   AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = contacts.email) ${CHANGED}`,
		[now, now, id, ...allowed]
	);
	await logActivities(forContacts(changed, { type: "reactivated", occurredAt: now }));
	return changed.length > 0;
}

// Messages keep their copy of the address, so campaign stats stay right after a deletion. The
// contact's history goes with it; the person and their other newsletters stay.
export async function deleteContact(id: string) {
	const { changes } = await run("DELETE FROM contacts WHERE id = ?", [id]);
	if (changes) await run("DELETE FROM contact_activity WHERE contact_id = ?", [id]);
	return changes > 0;
}
