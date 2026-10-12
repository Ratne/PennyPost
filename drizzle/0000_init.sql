CREATE TABLE `alerts` (
	`key` text PRIMARY KEY NOT NULL,
	`title` text,
	`last_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`newsletter_id` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`preview_text` text DEFAULT '' NOT NULL,
	`format` text DEFAULT 'rich' NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`html` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`audience_limit` integer,
	`segment_id` text,
	`source` text DEFAULT 'dashboard' NOT NULL,
	`scheduled_at` integer,
	`started_at` integer,
	`sent_at` integer,
	`test_sent_at` integer,
	`archive_slug` text,
	`thumbnail_url` text,
	`archive_listed` integer DEFAULT true NOT NULL,
	`archive_pinned` integer DEFAULT false NOT NULL,
	`web_views` integer DEFAULT 0 NOT NULL,
	`stats_recipients` integer DEFAULT 0 NOT NULL,
	`stats_sent` integer DEFAULT 0 NOT NULL,
	`stats_delivered` integer DEFAULT 0 NOT NULL,
	`stats_bounced` integer DEFAULT 0 NOT NULL,
	`stats_complained` integer DEFAULT 0 NOT NULL,
	`stats_opened` integer DEFAULT 0 NOT NULL,
	`stats_clicked` integer DEFAULT 0 NOT NULL,
	`stats_unsubscribed` integer DEFAULT 0 NOT NULL,
	`stats_failed` integer DEFAULT 0 NOT NULL,
	`last_chance_recipients` integer DEFAULT 0 NOT NULL,
	`last_chance_sent` integer DEFAULT 0 NOT NULL,
	`last_chance_delivered` integer DEFAULT 0 NOT NULL,
	`last_chance_bounced` integer DEFAULT 0 NOT NULL,
	`last_chance_complained` integer DEFAULT 0 NOT NULL,
	`last_chance_failed` integer DEFAULT 0 NOT NULL,
	`last_chance_dormant` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`newsletter_id`) REFERENCES `newsletters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_archive_slug_unique` ON `campaigns` (`archive_slug`);--> statement-breakpoint
CREATE INDEX `campaigns_newsletter_created` ON `campaigns` (`newsletter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `campaigns_status_scheduled` ON `campaigns` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `campaigns_started` ON `campaigns` (`started_at`);--> statement-breakpoint
CREATE TABLE `contact_tags` (
	`contact_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`contact_id`, `tag_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_tags_tag` ON `contact_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`newsletter_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text,
	`subscribed_at` integer,
	`confirmed_at` integer,
	`unsubscribed_at` integer,
	`last_sent_at` integer,
	`last_open_at` integer,
	`last_click_at` integer,
	`ignored_issues` integer,
	`last_engaged_at` integer,
	`last_chance_at` integer,
	`stats_sent` integer DEFAULT 0 NOT NULL,
	`stats_opens` integer DEFAULT 0 NOT NULL,
	`stats_clicks` integer DEFAULT 0 NOT NULL,
	`imported_emails_received` integer,
	`imported_open_rate` real,
	`imported_click_rate` real,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`newsletter_id`) REFERENCES `newsletters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_newsletter_email` ON `contacts` (`newsletter_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_newsletter_status` ON `contacts` (`newsletter_id`,`status`);--> statement-breakpoint
CREATE INDEX `contacts_email` ON `contacts` (`email`);--> statement-breakpoint
CREATE INDEX `contacts_subscribed` ON `contacts` (`subscribed_at`,`id`);--> statement-breakpoint
CREATE INDEX `contacts_status_subscribed` ON `contacts` (`status`,`subscribed_at`);--> statement-breakpoint
CREATE INDEX `contacts_newsletter_subscribed` ON `contacts` (`newsletter_id`,`subscribed_at`);--> statement-breakpoint
CREATE INDEX `contacts_newsletter_last_chance` ON `contacts` (`newsletter_id`,`last_chance_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`ses_message_id` text,
	`message_id` text,
	`campaign_id` text,
	`email` text,
	`occurred_at` integer NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_campaign_type` ON `events` (`campaign_id`,`type`);--> statement-breakpoint
CREATE INDEX `events_ses_message_id` ON `events` (`ses_message_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`campaign_id` text,
	`newsletter_id` text NOT NULL,
	`contact_id` text,
	`email` text NOT NULL,
	`provider` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`ses_message_id` text,
	`error` text,
	`sent_at` integer,
	`delivered_at` integer,
	`opened_at` integer,
	`clicked_at` integer,
	`bounced_at` integer,
	`complained_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_campaign_contact_kind` ON `messages` (`campaign_id`,`contact_id`,`kind`) WHERE kind IN ('campaign', 'last-chance');--> statement-breakpoint
CREATE INDEX `messages_ses_message_id` ON `messages` (`ses_message_id`);--> statement-breakpoint
CREATE INDEX `messages_kind_created` ON `messages` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_newsletter_sent` ON `messages` (`newsletter_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `messages_campaign_status` ON `messages` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `messages_contact_kind` ON `messages` (`contact_id`,`kind`);--> statement-breakpoint
CREATE TABLE `newsletters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`image_url` text,
	`from_name` text,
	`from_email` text NOT NULL,
	`reply_to` text,
	`postal_address` text,
	`archive_enabled` integer DEFAULT false NOT NULL,
	`description` text,
	`social_links` text DEFAULT '[]' NOT NULL,
	`author_bio` text,
	`author_image_url` text,
	`require_confirmation` integer DEFAULT false NOT NULL,
	`cleanup_enabled` integer DEFAULT false NOT NULL,
	`cleanup_issues` integer,
	`cleanup_days` integer,
	`welcome_enabled` integer DEFAULT false NOT NULL,
	`welcome_subject` text,
	`welcome_preview_text` text,
	`welcome_markdown` text,
	`confirmation_subject` text,
	`confirmation_preview_text` text,
	`confirmation_markdown` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `newsletters_slug_unique` ON `newsletters` (`slug`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`newsletter_id` text NOT NULL,
	`name` text NOT NULL,
	`rules` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`newsletter_id`) REFERENCES `newsletters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segments_newsletter` ON `segments` (`newsletter_id`);--> statement-breakpoint
CREATE TABLE `suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);