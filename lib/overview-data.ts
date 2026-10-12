import { PERIOD_DAYS, buildHourlySeries, buildSubscriberSeries, periodDayKeys, splitPeriods } from "@/lib/overview-series";
import { hourIn, shiftDateKey, startOfDateKey, toDateKey } from "@/lib/time-zone";
import { all, first } from "@/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;
// 15-minute buckets: every timezone offset (including :30 and :45 ones) falls on a bucket boundary.
const BUCKET_MS = 15 * 60 * 1000;
export const STAT_KEYS = ["sent", "delivered", "opened", "clicked", "bounced", "complained"];
const IMPORT_SOURCES = ["import"];
// Imports write the unsubscribe time (and suppressions) as they create the contact, so a leave
// recorded within a minute of creation happened before the contact came here, at an unknown date.
const IMPORT_WINDOW_MS = 60_000;

// Counts of messages with each timestamp set.
export const MESSAGE_STATS_SQL = STAT_KEYS.map((key) => `SUM(CASE WHEN ${key}_at IS NOT NULL THEN 1 ELSE 0 END) AS ${key}`).join(", ");

type JoinRow = { subscribed_at: number | null; confirmed_at: number | null; source: string | null; created_at: number };

// The later of the two: a contact who subscribes again gets a new subscribedAt but keeps an old confirmedAt.
// Imported rows without a signup date got the import time: those contacts joined earlier, on an unknown
// day, so they count from the start of the chart rather than as a spike on the import day.
function joinedKey(contact: JoinRow, rangeStart: Date, timeZone: string) {
	const joined = new Date(Math.max(contact.subscribed_at ?? 0, contact.confirmed_at ?? 0));
	const isImportTime =
		IMPORT_SOURCES.includes(contact.source ?? "") && Math.abs((contact.subscribed_at ?? 0) - contact.created_at) < IMPORT_WINDOW_MS;
	return isImportTime || joined < rangeStart ? null : toDateKey(joined, timeZone);
}

function hasLeftHere(leftAt: number | null, contact: JoinRow) {
	return Boolean(leftAt) && leftAt! > contact.created_at + IMPORT_WINDOW_MS;
}

// Active subscribers at the end of each of the last 60 days. Active contacts count from the day they
// joined; contacts who left count until they left, when the date is known: unsubscribedAt, or the
// suppression a bounce or complaint created.
export async function getSubscriberHistory({ newsletterId, timeZone, now = new Date() }: { newsletterId: string; timeZone: string; now?: Date }) {
	const dayKeys = periodDayKeys(toDateKey(now, timeZone));
	const rangeStart = startOfDateKey(dayKeys[0], timeZone);
	const start = rangeStart.getTime();

	const [activeBefore, activeJoins, unsubscribes, suppressions] = await Promise.all([
		first<{ count: number }>(
			"SELECT COUNT(*) AS count FROM contacts WHERE newsletter_id = ? AND status = 'active' AND subscribed_at < ?",
			[newsletterId, start]
		),
		all<JoinRow>(
			"SELECT subscribed_at, confirmed_at, source, created_at FROM contacts WHERE newsletter_id = ? AND status = 'active' AND subscribed_at >= ?",
			[newsletterId, start]
		),
		all<JoinRow & { unsubscribed_at: number }>(
			`SELECT subscribed_at, confirmed_at, source, created_at, unsubscribed_at FROM contacts
			 WHERE newsletter_id = ? AND status IN ('unsubscribed', 'bounced', 'complained')
			   AND unsubscribed_at >= ? AND unsubscribed_at > created_at + ?`,
			[newsletterId, start, IMPORT_WINDOW_MS]
		),
		all<JoinRow & { unsubscribed_at: number | null; left_at: number }>(
			`SELECT c.subscribed_at, c.confirmed_at, c.source, c.created_at, c.unsubscribed_at, s.created_at AS left_at
			 FROM suppressions s JOIN contacts c ON c.email = s.email
			 WHERE s.reason IN ('bounce', 'complaint') AND (s.detail IS NULL OR s.detail != 'import') AND s.created_at >= ?
			   AND c.newsletter_id = ? AND c.status IN ('bounced', 'complained')`,
			[start, newsletterId]
		),
	]);

	let baseline = activeBefore?.count ?? 0;
	const joins: Record<string, number> = {};
	const leaves: Record<string, number> = {};
	function addLeaver(joined: string | null, leftKey: string) {
		if (joined) joins[joined] = (joins[joined] ?? 0) + 1;
		else baseline += 1;
		leaves[leftKey] = (leaves[leftKey] ?? 0) + 1;
	}

	for (const contact of activeJoins) {
		const key = joinedKey(contact, rangeStart, timeZone);
		if (key) joins[key] = (joins[key] ?? 0) + 1;
		else baseline += 1;
	}
	for (const contact of unsubscribes) addLeaver(joinedKey(contact, rangeStart, timeZone), toDateKey(new Date(contact.unsubscribed_at), timeZone));
	for (const contact of suppressions) {
		if (hasLeftHere(contact.unsubscribed_at, contact) || !hasLeftHere(contact.left_at, contact)) continue;
		addLeaver(joinedKey(contact, rangeStart, timeZone), toDateKey(new Date(contact.left_at), timeZone));
	}

	return splitPeriods(buildSubscriberSeries({ dayKeys, baseline, joins, leaves }));
}

function emptyStats() {
	return Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
}

// Issues and welcome emails of the last 30 days and the 30 days before.
export async function getEmailStats({ newsletterId, now = new Date() }: { newsletterId: string; now?: Date }) {
	const since = now.getTime() - PERIOD_DAYS * DAY_MS;
	const previousSince = now.getTime() - 2 * PERIOD_DAYS * DAY_MS;
	const period = (column: string) => `CASE WHEN ${column} >= ${since} THEN 'current' ELSE 'previous' END`;

	const [campaignRows, welcomeRows] = await Promise.all([
		all<Record<string, any>>(
			`SELECT ${period("COALESCE(started_at, sent_at)")} AS period, ${STAT_KEYS.map((key) => `SUM(stats_${key}) AS ${key}`).join(", ")}
			 FROM campaigns WHERE newsletter_id = ? AND COALESCE(started_at, sent_at) >= ? GROUP BY period`,
			[newsletterId, previousSince]
		),
		all<Record<string, any>>(
			`SELECT ${period("created_at")} AS period, ${MESSAGE_STATS_SQL}
			 FROM messages WHERE kind = 'welcome' AND newsletter_id = ? AND created_at >= ? GROUP BY period`,
			[newsletterId, previousSince]
		),
	]);

	const totals: Record<string, Record<string, number>> = { current: emptyStats(), previous: emptyStats() };
	for (const row of [...campaignRows, ...welcomeRows]) {
		for (const key of STAT_KEYS) totals[row.period][key] += Number(row[key]) || 0;
	}
	return totals;
}

// Every email SES accepted for the newsletter (issues, welcome, confirmation and test emails), by hour
// of today and yesterday.
export async function getHourlySends({ newsletterId, timeZone, now = new Date() }: { newsletterId: string; timeZone: string; now?: Date }) {
	const todayKey = toDateKey(now, timeZone);
	const since = startOfDateKey(shiftDateKey(todayKey, -1), timeZone);
	const buckets = await all<{ bucket: number; count: number }>(
		`SELECT sent_at / ${BUCKET_MS} AS bucket, COUNT(*) AS count FROM messages
		 WHERE newsletter_id = ? AND sent_at >= ? GROUP BY bucket`,
		[newsletterId, since.getTime()]
	);
	const grouped = new Map<string, { day: string; hour: number; count: number }>();
	for (const { bucket, count } of buckets) {
		const at = new Date(Math.floor(bucket) * BUCKET_MS);
		const day = toDateKey(at, timeZone);
		const hour = hourIn(at, timeZone);
		const key = `${day}:${hour}`;
		const row = grouped.get(key) ?? { day, hour, count: 0 };
		row.count += count;
		grouped.set(key, row);
	}
	return buildHourlySeries({ rows: [...grouped.values()], todayKey, currentHour: hourIn(now, timeZone) });
}

export const DELIVERY_DAYS = 90;
// SES puts accounts under review around a 5% bounce rate or a 0.1% complaint rate; half of each is the warning.
const BOUNCE_LIMITS = { degraded: 0.02, down: 0.05 };
const COMPLAINT_LIMITS = { degraded: 0.0005, down: 0.001 };

type DeliveryLevel = "up" | "degraded" | "down" | "none";

// One entry per UTC day of the last 90, oldest first: the share of sent emails that didn't bounce,
// and a level from the bounce and complaint rates.
export async function getDeliveryDays({ newsletterId, now = new Date() }: { newsletterId: string; now?: Date }) {
	const today = Math.floor(now.getTime() / DAY_MS);
	const firstDay = today - DELIVERY_DAYS + 1;
	const rows = await all<{ day: number; sent: number; bounced: number; complained: number }>(
		`SELECT sent_at / ${DAY_MS} AS day, COUNT(*) AS sent,
			SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
			SUM(CASE WHEN complained_at IS NOT NULL THEN 1 ELSE 0 END) AS complained
		 FROM messages WHERE newsletter_id = ? AND sent_at >= ? GROUP BY day`,
		[newsletterId, firstDay * DAY_MS]
	);
	const byDay = new Map(rows.map((row) => [Number(row.day), row]));

	return Array.from({ length: DELIVERY_DAYS }, (_, index) => {
		const day = firstDay + index;
		const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
		const row = byDay.get(day);
		const sent = Number(row?.sent) || 0;
		if (!sent) return { date, status: "none" as DeliveryLevel };

		const bounced = Number(row!.bounced) || 0;
		const complained = Number(row!.complained) || 0;
		const bounceRate = bounced / sent;
		const complaintRate = complained / sent;
		const status: DeliveryLevel =
			bounceRate >= BOUNCE_LIMITS.down || complaintRate >= COMPLAINT_LIMITS.down
				? "down"
				: bounceRate >= BOUNCE_LIMITS.degraded || complaintRate >= COMPLAINT_LIMITS.degraded
					? "degraded"
					: "up";
		const incidents = [
			{ title: `${sent.toLocaleString("en-US")} sent` },
			...(bounced ? [{ title: `${bounced.toLocaleString("en-US")} bounced`, status: "degraded" as const }] : []),
			...(complained ? [{ title: `${complained.toLocaleString("en-US")} complaints`, status: "down" as const }] : []),
		];
		return { date, status, uptime: (1 - bounceRate) * 100, incidents };
	});
}
