ALTER TABLE `newsletters` ADD `is_homepage` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `newsletters_homepage_unique` ON `newsletters` (`is_homepage`) WHERE `is_homepage` = 1;
