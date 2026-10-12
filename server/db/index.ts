import { env } from "cloudflare:workers";

type Row = Record<string, unknown>;
type Param = string | number | null | boolean | Date | undefined;

// D1 binds at most 100 parameters per statement; chunks of IN (...) lists stay well under it.
export const MAX_BOUND_PARAMS = 90;

export function getD1(): D1Database {
	return env.DB;
}

function bindable(value: Param) {
	if (value === undefined) return null;
	if (value instanceof Date) return value.getTime();
	if (typeof value === "boolean") return value ? 1 : 0;
	return value;
}

export function statement(query: string, params: Param[] = []) {
	return getD1()
		.prepare(query)
		.bind(...params.map(bindable));
}

export async function all<T = Row>(query: string, params: Param[] = []): Promise<T[]> {
	const { results } = await statement(query, params).all<T>();
	return results ?? [];
}

export async function first<T = Row>(query: string, params: Param[] = []): Promise<T | null> {
	return (await statement(query, params).first<T>()) ?? null;
}

export async function run(query: string, params: Param[] = []) {
	const result = await statement(query, params).run();
	return { changes: result.meta.changes ?? 0 };
}

export async function batch(statements: D1PreparedStatement[]) {
	if (statements.length === 0) return [];
	return getD1().batch(statements);
}

export function placeholders(count: number) {
	return Array.from({ length: count }, () => "?").join(", ");
}

export function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
	return chunks;
}

// 12 random bytes as hex: the same shape as a MongoDB ObjectId, which link tokens and validation expect.
export function newId() {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function now() {
	return Date.now();
}

function toDate(value: unknown) {
	if (value === null || value === undefined) return undefined;
	return new Date(Number(value));
}

function toBool(value: unknown) {
	return value === 1 || value === true;
}

function parseJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== "string") return (value as T) ?? fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function optional<T>(value: T | null | undefined) {
	return value === null ? undefined : value;
}

// Rows come back flat and snake_case; the app works with nested documents.
export function toNewsletter(row: Row | null) {
	if (!row) return null;
	return {
		_id: row.id as string,
		name: row.name as string,
		slug: row.slug as string,
		imageUrl: optional(row.image_url as string),
		emailLogoUrl: optional(row.email_logo_url as string),
		emailLogoWidth: optional(row.email_logo_width as number),
		fromName: optional(row.from_name as string),
		fromEmail: row.from_email as string,
		replyTo: optional(row.reply_to as string),
		footerMarkdown: optional(row.footer_markdown as string),
		archiveEnabled: toBool(row.archive_enabled),
		isHomepage: toBool(row.is_homepage),
		description: optional(row.description as string),
		socialLinks: parseJson<string[]>(row.social_links, []),
		author: { bio: optional(row.author_bio as string), imageUrl: optional(row.author_image_url as string) },
		requireConfirmation: toBool(row.require_confirmation),
		cleanup: {
			enabled: toBool(row.cleanup_enabled),
			issues: optional(row.cleanup_issues as number),
			days: optional(row.cleanup_days as number),
		},
		welcome: {
			enabled: toBool(row.welcome_enabled),
			subject: optional(row.welcome_subject as string),
			previewText: optional(row.welcome_preview_text as string),
			markdown: optional(row.welcome_markdown as string),
		},
		confirmation: {
			subject: optional(row.confirmation_subject as string),
			previewText: optional(row.confirmation_preview_text as string),
			markdown: optional(row.confirmation_markdown as string),
		},
		activeCount: row.active_count === undefined ? undefined : Number(row.active_count),
		createdAt: toDate(row.created_at),
		updatedAt: toDate(row.updated_at),
	};
}

export function toContact(row: Row | null) {
	if (!row) return null;
	const imported =
		row.imported_emails_received != null || row.imported_open_rate != null || row.imported_click_rate != null
			? {
					emailsReceived: optional(row.imported_emails_received as number),
					openRate: optional(row.imported_open_rate as number),
					clickRate: optional(row.imported_click_rate as number),
				}
			: undefined;
	return {
		_id: row.id as string,
		newsletterId: row.newsletter_id as string,
		email: row.email as string,
		status: row.status as string,
		source: optional(row.source as string),
		subscribedAt: toDate(row.subscribed_at),
		confirmedAt: toDate(row.confirmed_at),
		unsubscribedAt: toDate(row.unsubscribed_at),
		lastSentAt: toDate(row.last_sent_at),
		lastOpenAt: toDate(row.last_open_at),
		lastClickAt: toDate(row.last_click_at),
		ignoredIssues: optional(row.ignored_issues as number),
		lastEngagedAt: toDate(row.last_engaged_at),
		lastChanceAt: toDate(row.last_chance_at),
		stats: {
			sent: Number(row.stats_sent ?? 0),
			opens: Number(row.stats_opens ?? 0),
			clicks: Number(row.stats_clicks ?? 0),
		},
		imported,
		tags: row.tags === undefined ? undefined : parseTagList(row.tags),
		createdAt: toDate(row.created_at),
		updatedAt: toDate(row.updated_at),
	};
}

function parseTagList(value: unknown) {
	return parseJson<{ id: string; name: string; color: string | null }[] | null>(value, [])?.filter(Boolean) ?? [];
}

const CAMPAIGN_STATS = ["recipients", "sent", "delivered", "bounced", "complained", "opened", "clicked", "unsubscribed", "failed"];
const LAST_CHANCE_STATS = ["recipients", "sent", "delivered", "bounced", "complained", "failed", "dormant"];

export function toCampaign(row: Row | null) {
	if (!row) return null;
	return {
		_id: row.id as string,
		newsletterId: row.newsletter_id as string,
		subject: (row.subject as string) ?? "",
		previewText: (row.preview_text as string) ?? "",
		format: (row.format as string) ?? "rich",
		markdown: (row.markdown as string) ?? "",
		html: (row.html as string) ?? "",
		status: row.status as string,
		audienceLimit: optional(row.audience_limit as number),
		segmentId: optional(row.segment_id as string),
		source: (row.source as string) ?? "dashboard",
		scheduledAt: toDate(row.scheduled_at),
		startedAt: toDate(row.started_at),
		sentAt: toDate(row.sent_at),
		testSentAt: toDate(row.test_sent_at),
		archiveSlug: optional(row.archive_slug as string),
		thumbnailUrl: optional(row.thumbnail_url as string),
		archiveListed: row.archive_listed === undefined ? true : toBool(row.archive_listed),
		archivePinned: toBool(row.archive_pinned),
		webViews: Number(row.web_views ?? 0),
		stats: Object.fromEntries(CAMPAIGN_STATS.map((key) => [key, Number(row[`stats_${key}`] ?? 0)])),
		lastChance: Object.fromEntries(LAST_CHANCE_STATS.map((key) => [key, Number(row[`last_chance_${key}`] ?? 0)])),
		createdAt: toDate(row.created_at),
		updatedAt: toDate(row.updated_at),
	};
}

export function toMessage(row: Row | null) {
	if (!row) return null;
	return {
		_id: row.id as string,
		kind: row.kind as string,
		campaignId: optional(row.campaign_id as string),
		stepId: optional(row.step_id as string),
		newsletterId: row.newsletter_id as string,
		contactId: optional(row.contact_id as string),
		email: row.email as string,
		provider: optional(row.provider as string),
		status: row.status as string,
		sesMessageId: optional(row.ses_message_id as string),
		error: optional(row.error as string),
		sentAt: toDate(row.sent_at),
		deliveredAt: toDate(row.delivered_at),
		openedAt: toDate(row.opened_at),
		clickedAt: toDate(row.clicked_at),
		bouncedAt: toDate(row.bounced_at),
		complainedAt: toDate(row.complained_at),
		createdAt: toDate(row.created_at),
	};
}

export type Newsletter = NonNullable<ReturnType<typeof toNewsletter>>;
export type Contact = NonNullable<ReturnType<typeof toContact>>;
export type Campaign = NonNullable<ReturnType<typeof toCampaign>>;
export type Message = NonNullable<ReturnType<typeof toMessage>>;

// "stats.sent" / "lastChance.sent" (nested paths) as campaign columns.
export function campaignStatColumn(path: string) {
	const [group, key] = path.split(".");
	const prefix = group === "lastChance" ? "last_chance" : "stats";
	const column = `${prefix}_${key}`;
	if (!/^[a-z_]+$/.test(column)) throw new Error(`Invalid stat ${path}`);
	return column;
}
