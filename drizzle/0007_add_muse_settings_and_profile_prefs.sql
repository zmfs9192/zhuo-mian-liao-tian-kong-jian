CREATE TABLE `muse_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Muse' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#2f6bff' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`thinking` text DEFAULT '默认' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `show_time` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `sound_on` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `conversations` ADD COLUMN `member_based` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `group_members` ADD COLUMN `enabled` integer DEFAULT 1 NOT NULL;
