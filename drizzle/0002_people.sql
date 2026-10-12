CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`phone` text,
	`verification_state` text,
	`verification_reason` text,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_email_unique` ON `people` (`email`);--> statement-breakpoint
CREATE INDEX `people_last_name` ON `people` (`last_name`);--> statement-breakpoint
CREATE INDEX `people_first_name` ON `people` (`first_name`);--> statement-breakpoint
CREATE TABLE `contact_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`newsletter_id` text,
	`contact_id` text,
	`campaign_id` text,
	`message_id` text,
	`type` text NOT NULL,
	`data` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contact_activity_email_occurred` ON `contact_activity` (`email`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `contact_activity_contact` ON `contact_activity` (`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_activity_type_occurred` ON `contact_activity` (`type`,`occurred_at`);--> statement-breakpoint
INSERT INTO `people` (`id`, `email`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(12))), `email`, MIN(`created_at`), MIN(`created_at`) FROM `contacts` GROUP BY `email`;--> statement-breakpoint
INSERT INTO `contact_activity` (`id`, `email`, `newsletter_id`, `contact_id`, `type`, `data`, `occurred_at`)
SELECT lower(hex(randomblob(12))), `email`, `newsletter_id`, `id`, 'subscribed', json_object('source', `source`, 'backfilled', 1), `subscribed_at`
FROM `contacts` WHERE `subscribed_at` IS NOT NULL;--> statement-breakpoint
INSERT INTO `contact_activity` (`id`, `email`, `newsletter_id`, `contact_id`, `type`, `data`, `occurred_at`)
SELECT lower(hex(randomblob(12))), `email`, `newsletter_id`, `id`, 'confirmed', json_object('backfilled', 1), `confirmed_at`
FROM `contacts` WHERE `confirmed_at` IS NOT NULL;--> statement-breakpoint
INSERT INTO `contact_activity` (`id`, `email`, `newsletter_id`, `contact_id`, `type`, `data`, `occurred_at`)
SELECT lower(hex(randomblob(12))), `email`, `newsletter_id`, `id`, 'unsubscribed', json_object('backfilled', 1), `unsubscribed_at`
FROM `contacts` WHERE `unsubscribed_at` IS NOT NULL;--> statement-breakpoint
INSERT INTO `contact_activity` (`id`, `email`, `newsletter_id`, `contact_id`, `type`, `data`, `occurred_at`)
SELECT lower(hex(randomblob(12))), c.`email`, c.`newsletter_id`, c.`id`, 'tag_added',
	json_object('tagId', t.`id`, 'tag', t.`name`, 'backfilled', 1), ct.`created_at`
FROM `contact_tags` ct JOIN `contacts` c ON c.`id` = ct.`contact_id` JOIN `tags` t ON t.`id` = ct.`tag_id`;
