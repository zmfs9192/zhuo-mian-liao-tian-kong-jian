CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`glyph` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#b9bec7' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `group_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL REFERENCES `conversations`(`id`),
	`agent_id` integer REFERENCES `agents`(`id`),
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `group_members` (`conversation_id`, `agent_id`) SELECT `id`, NULL FROM `conversations` WHERE `kind` = 'group';
