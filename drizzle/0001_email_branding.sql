ALTER TABLE `newsletters` ADD `email_logo_url` text;--> statement-breakpoint
ALTER TABLE `newsletters` ADD `email_logo_width` integer;--> statement-breakpoint
ALTER TABLE `newsletters` RENAME COLUMN `postal_address` TO `footer_markdown`;
