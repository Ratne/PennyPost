CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`newsletter_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`trigger_type` text DEFAULT 'tag_added' NOT NULL,
	`trigger_config` text DEFAULT '{}' NOT NULL,
	`allow_reentry` integer DEFAULT false NOT NULL,
	`stats_entered` integer DEFAULT 0 NOT NULL,
	`stats_completed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`newsletter_id`) REFERENCES `newsletters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automations_newsletter` ON `automations` (`newsletter_id`);--> statement-breakpoint
CREATE INDEX `automations_status_trigger` ON `automations` (`status`,`trigger_type`);--> statement-breakpoint
CREATE TABLE `automation_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`parent_id` text,
	`branch` text,
	`position` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_steps_automation` ON `automation_steps` (`automation_id`,`parent_id`,`branch`,`position`);--> statement-breakpoint
CREATE TABLE `automation_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_step_id` text,
	`wake_at` integer,
	`entered_at` integer NOT NULL,
	`finished_at` integer,
	`exit_reason` text,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_enrollments_due` ON `automation_enrollments` (`status`,`wake_at`);--> statement-breakpoint
CREATE INDEX `automation_enrollments_automation_contact` ON `automation_enrollments` (`automation_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `automation_enrollments_contact` ON `automation_enrollments` (`contact_id`);--> statement-breakpoint
CREATE TABLE `automation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`enrollment_id` text,
	`automation_id` text NOT NULL,
	`step_id` text,
	`contact_id` text,
	`status` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_logs_automation_created` ON `automation_logs` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_logs_step` ON `automation_logs` (`step_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `step_id` text;--> statement-breakpoint
CREATE INDEX `messages_step_status` ON `messages` (`step_id`,`status`);
