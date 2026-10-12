import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Ids are 24 hex characters, the format signed into email links.
const id = () => text("id").primaryKey();
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const counter = (name: string) => integer(name).notNull().default(0);
const flag = (name: string, value = false) => integer(name, { mode: "boolean" }).notNull().default(value);
const createdAt = () => timestamp("created_at").notNull().default(sql`(unixepoch('subsec') * 1000)`);
const updatedAt = () => timestamp("updated_at").notNull().default(sql`(unixepoch('subsec') * 1000)`);

export const newsletters = sqliteTable("newsletters", {
	id: id(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	imageUrl: text("image_url"),
	emailLogoUrl: text("email_logo_url"),
	emailLogoWidth: integer("email_logo_width"),
	fromName: text("from_name"),
	fromEmail: text("from_email").notNull(),
	replyTo: text("reply_to"),
	footerMarkdown: text("footer_markdown"),
	archiveEnabled: flag("archive_enabled"),
	// At most one: the partial unique index in 0004_homepage.sql enforces it.
	isHomepage: flag("is_homepage"),
	description: text("description"),
	socialLinks: text("social_links", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
	authorBio: text("author_bio"),
	authorImageUrl: text("author_image_url"),
	requireConfirmation: flag("require_confirmation"),
	cleanupEnabled: flag("cleanup_enabled"),
	cleanupIssues: integer("cleanup_issues"),
	cleanupDays: integer("cleanup_days"),
	welcomeEnabled: flag("welcome_enabled"),
	welcomeSubject: text("welcome_subject"),
	welcomePreviewText: text("welcome_preview_text"),
	welcomeMarkdown: text("welcome_markdown"),
	confirmationSubject: text("confirmation_subject"),
	confirmationPreviewText: text("confirmation_preview_text"),
	confirmationMarkdown: text("confirmation_markdown"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const contacts = sqliteTable(
	"contacts",
	{
		id: id(),
		newsletterId: text("newsletter_id")
			.notNull()
			.references(() => newsletters.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		status: text("status", {
			enum: ["active", "pending", "unsubscribed", "bounced", "complained", "dormant"],
		})
			.notNull()
			.default("active"),
		source: text("source"),
		subscribedAt: timestamp("subscribed_at"),
		confirmedAt: timestamp("confirmed_at"),
		unsubscribedAt: timestamp("unsubscribed_at"),
		lastSentAt: timestamp("last_sent_at"),
		lastOpenAt: timestamp("last_open_at"),
		lastClickAt: timestamp("last_click_at"),
		ignoredIssues: integer("ignored_issues"),
		lastEngagedAt: timestamp("last_engaged_at"),
		lastChanceAt: timestamp("last_chance_at"),
		statsSent: counter("stats_sent"),
		statsOpens: counter("stats_opens"),
		statsClicks: counter("stats_clicks"),
		importedEmailsReceived: integer("imported_emails_received"),
		importedOpenRate: real("imported_open_rate"),
		importedClickRate: real("imported_click_rate"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex("contacts_newsletter_email").on(table.newsletterId, table.email),
		index("contacts_newsletter_status").on(table.newsletterId, table.status),
		index("contacts_email").on(table.email),
		index("contacts_subscribed").on(table.subscribedAt, table.id),
		index("contacts_status_subscribed").on(table.status, table.subscribedAt),
		index("contacts_newsletter_subscribed").on(table.newsletterId, table.subscribedAt),
		index("contacts_newsletter_last_chance").on(table.newsletterId, table.lastChanceAt),
	]
);

export const segments = sqliteTable(
	"segments",
	{
		id: id(),
		newsletterId: text("newsletter_id")
			.notNull()
			.references(() => newsletters.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		rules: text("rules", { mode: "json" }).notNull().default(sql`'{}'`),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [index("segments_newsletter").on(table.newsletterId)]
);

export const campaigns = sqliteTable(
	"campaigns",
	{
		id: id(),
		newsletterId: text("newsletter_id")
			.notNull()
			.references(() => newsletters.id, { onDelete: "cascade" }),
		subject: text("subject").notNull().default(""),
		previewText: text("preview_text").notNull().default(""),
		format: text("format", { enum: ["markdown", "html", "rich"] }).notNull().default("rich"),
		markdown: text("markdown").notNull().default(""),
		html: text("html").notNull().default(""),
		status: text("status", { enum: ["draft", "scheduled", "sending", "paused", "sent", "canceled"] })
			.notNull()
			.default("draft"),
		audienceLimit: integer("audience_limit"),
		segmentId: text("segment_id").references(() => segments.id, { onDelete: "set null" }),
		source: text("source").notNull().default("dashboard"),
		scheduledAt: timestamp("scheduled_at"),
		startedAt: timestamp("started_at"),
		sentAt: timestamp("sent_at"),
		testSentAt: timestamp("test_sent_at"),
		archiveSlug: text("archive_slug").unique(),
		thumbnailUrl: text("thumbnail_url"),
		archiveListed: flag("archive_listed", true),
		archivePinned: flag("archive_pinned"),
		webViews: counter("web_views"),
		statsRecipients: counter("stats_recipients"),
		statsSent: counter("stats_sent"),
		statsDelivered: counter("stats_delivered"),
		statsBounced: counter("stats_bounced"),
		statsComplained: counter("stats_complained"),
		statsOpened: counter("stats_opened"),
		statsClicked: counter("stats_clicked"),
		statsUnsubscribed: counter("stats_unsubscribed"),
		statsFailed: counter("stats_failed"),
		lastChanceRecipients: counter("last_chance_recipients"),
		lastChanceSent: counter("last_chance_sent"),
		lastChanceDelivered: counter("last_chance_delivered"),
		lastChanceBounced: counter("last_chance_bounced"),
		lastChanceComplained: counter("last_chance_complained"),
		lastChanceFailed: counter("last_chance_failed"),
		lastChanceDormant: counter("last_chance_dormant"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		index("campaigns_newsletter_created").on(table.newsletterId, table.createdAt),
		index("campaigns_status_scheduled").on(table.status, table.scheduledAt),
		index("campaigns_started").on(table.startedAt),
	]
);

export const messages = sqliteTable(
	"messages",
	{
		id: id(),
		kind: text("kind", { enum: ["campaign", "last-chance", "welcome", "confirmation", "automation", "test"] }).notNull(),
		campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
		// Automation emails: the step whose content they carry.
		stepId: text("step_id"),
		newsletterId: text("newsletter_id").notNull(),
		contactId: text("contact_id"),
		email: text("email").notNull(),
		provider: text("provider"),
		status: text("status", {
			enum: ["queued", "sent", "delivered", "bounced", "complained", "failed", "suppressed"],
		})
			.notNull()
			.default("queued"),
		sesMessageId: text("ses_message_id"),
		error: text("error"),
		sentAt: timestamp("sent_at"),
		deliveredAt: timestamp("delivered_at"),
		openedAt: timestamp("opened_at"),
		clickedAt: timestamp("clicked_at"),
		bouncedAt: timestamp("bounced_at"),
		complainedAt: timestamp("complained_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		// One issue and at most one last-chance email per contact per campaign, even when a batch is retried.
		uniqueIndex("messages_campaign_contact_kind")
			.on(table.campaignId, table.contactId, table.kind)
			.where(sql`kind IN ('campaign', 'last-chance')`),
		index("messages_ses_message_id").on(table.sesMessageId),
		index("messages_kind_created").on(table.kind, table.createdAt),
		index("messages_newsletter_sent").on(table.newsletterId, table.sentAt),
		index("messages_campaign_status").on(table.campaignId, table.status),
		index("messages_contact_kind").on(table.contactId, table.kind),
		index("messages_step_status").on(table.stepId, table.status),
	]
);

// Global: an address that bounced or complained is never emailed again from any newsletter.
export const suppressions = sqliteTable("suppressions", {
	email: text("email").primaryKey(),
	reason: text("reason", { enum: ["bounce", "complaint", "manual"] }).notNull(),
	detail: text("detail"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

// Only problem events (bounces, complaints, rejects, delays, rendering failures); deliveries and
// engagement live on messages.
export const events = sqliteTable(
	"events",
	{
		id: id(),
		type: text("type").notNull(),
		sesMessageId: text("ses_message_id"),
		messageId: text("message_id"),
		campaignId: text("campaign_id"),
		email: text("email"),
		occurredAt: timestamp("occurred_at").notNull(),
		data: text("data", { mode: "json" }),
		createdAt: createdAt(),
	},
	(table) => [
		index("events_campaign_type").on(table.campaignId, table.type),
		index("events_ses_message_id").on(table.sesMessageId),
	]
);

export const apiKeys = sqliteTable("api_keys", {
	id: id(),
	name: text("name").notNull(),
	prefix: text("prefix").notNull(),
	hash: text("hash").notNull().unique(),
	lastUsedAt: timestamp("last_used_at"),
	revokedAt: timestamp("revoked_at"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

// One row per alert kind: lastSentAt enforces the cooldown between repeated alerts.
export const alerts = sqliteTable("alerts", {
	key: text("key").primaryKey(),
	title: text("title"),
	lastSentAt: timestamp("last_sent_at"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

// One per email address, shared by every newsletter that address subscribes to (contacts join on email).
export const people = sqliteTable(
	"people",
	{
		id: id(),
		email: text("email").notNull().unique(),
		firstName: text("first_name"),
		lastName: text("last_name"),
		phone: text("phone"),
		verificationState: text("verification_state"),
		verificationReason: text("verification_reason"),
		verifiedAt: timestamp("verified_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [index("people_last_name").on(table.lastName), index("people_first_name").on(table.firstName)]
);

// A contact's history. Sends and deliveries aren't copied here: the timeline reads them from messages.
export const contactActivity = sqliteTable(
	"contact_activity",
	{
		id: id(),
		email: text("email").notNull(),
		newsletterId: text("newsletter_id"),
		contactId: text("contact_id"),
		campaignId: text("campaign_id"),
		messageId: text("message_id"),
		type: text("type").notNull(),
		data: text("data", { mode: "json" }),
		occurredAt: timestamp("occurred_at").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		index("contact_activity_email_occurred").on(table.email, table.occurredAt),
		index("contact_activity_contact").on(table.contactId),
		index("contact_activity_type_occurred").on(table.type, table.occurredAt),
	]
);

// The first one comes from ADMIN_EMAIL and ADMIN_PASSWORD on the first login (lib/admins.ts).
export const admins = sqliteTable("admins", {
	id: id(),
	email: text("email").notNull().unique(),
	passwordHash: text("password_hash").notNull(),
	// Raising it signs out every session of the admin.
	sessionVersion: integer("session_version").notNull().default(1),
	lastLoginAt: timestamp("last_login_at"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

// The emailed code that completes a login after the password. Only its hash is stored.
export const loginChallenges = sqliteTable(
	"login_challenges",
	{
		id: id(),
		adminId: text("admin_id")
			.notNull()
			.references(() => admins.id, { onDelete: "cascade" }),
		codeHash: text("code_hash").notNull(),
		attempts: counter("attempts"),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: createdAt(),
	},
	(table) => [index("login_challenges_admin").on(table.adminId)]
);

// Operational settings edited in the dashboard; an unset key falls back to the environment variable.
export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value"),
	updatedAt: updatedAt(),
});

export const tags = sqliteTable("tags", {
	id: id(),
	name: text("name").notNull().unique(),
	color: text("color"),
	createdAt: createdAt(),
});

export const contactTags = sqliteTable(
	"contact_tags",
	{
		contactId: text("contact_id")
			.notNull()
			.references(() => contacts.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [primaryKey({ columns: [table.contactId, table.tagId] }), index("contact_tags_tag").on(table.tagId)]
);

// A flow a contact walks through, from top to bottom, once its trigger fires.
export const automations = sqliteTable(
	"automations",
	{
		id: id(),
		newsletterId: text("newsletter_id")
			.notNull()
			.references(() => newsletters.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		status: text("status", { enum: ["draft", "active", "paused"] }).notNull().default("draft"),
		triggerType: text("trigger_type", { enum: ["tag_added"] }).notNull().default("tag_added"),
		triggerConfig: text("trigger_config", { mode: "json" }).notNull().default(sql`'{}'`),
		allowReentry: flag("allow_reentry"),
		statsEntered: counter("stats_entered"),
		statsCompleted: counter("stats_completed"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		index("automations_newsletter").on(table.newsletterId),
		index("automations_status_trigger").on(table.status, table.triggerType),
	]
);

// Linear runs ordered by position under (parent_id, branch); a condition step is the parent of its
// yes and no runs, and the flow carries on after it once a branch ends.
export const automationSteps = sqliteTable(
	"automation_steps",
	{
		id: id(),
		automationId: text("automation_id")
			.notNull()
			.references(() => automations.id, { onDelete: "cascade" }),
		parentId: text("parent_id"),
		branch: text("branch", { enum: ["yes", "no"] }),
		position: integer("position").notNull().default(0),
		type: text("type", { enum: ["wait", "email", "webhook", "exit_automation", "condition"] }).notNull(),
		config: text("config", { mode: "json" }).notNull().default(sql`'{}'`),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [index("automation_steps_automation").on(table.automationId, table.parentId, table.branch, table.position)]
);

export const automationEnrollments = sqliteTable(
	"automation_enrollments",
	{
		id: id(),
		automationId: text("automation_id")
			.notNull()
			.references(() => automations.id, { onDelete: "cascade" }),
		contactId: text("contact_id")
			.notNull()
			.references(() => contacts.id, { onDelete: "cascade" }),
		status: text("status", { enum: ["active", "waiting", "completed", "exited", "failed"] }).notNull().default("active"),
		// The next step to run.
		currentStepId: text("current_step_id"),
		wakeAt: timestamp("wake_at"),
		enteredAt: timestamp("entered_at").notNull(),
		finishedAt: timestamp("finished_at"),
		exitReason: text("exit_reason"),
		updatedAt: updatedAt(),
	},
	(table) => [
		index("automation_enrollments_due").on(table.status, table.wakeAt),
		index("automation_enrollments_automation_contact").on(table.automationId, table.contactId),
		index("automation_enrollments_contact").on(table.contactId),
	]
);

export const automationLogs = sqliteTable(
	"automation_logs",
	{
		id: id(),
		enrollmentId: text("enrollment_id"),
		automationId: text("automation_id")
			.notNull()
			.references(() => automations.id, { onDelete: "cascade" }),
		stepId: text("step_id"),
		contactId: text("contact_id"),
		status: text("status", { enum: ["ok", "skipped", "failed"] }).notNull(),
		detail: text("detail"),
		createdAt: createdAt(),
	},
	(table) => [
		index("automation_logs_automation_created").on(table.automationId, table.createdAt),
		index("automation_logs_step").on(table.stepId),
	]
);
