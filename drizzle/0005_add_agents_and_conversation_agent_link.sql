CREATE TABLE `agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#5d6a82' NOT NULL,
	`glyph` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`provider` text DEFAULT 'custom' NOT NULL,
	`api_base` text DEFAULT '' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`max_tokens` integer DEFAULT 4096 NOT NULL,
	`thinking` text DEFAULT '默认' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD COLUMN `agent_id` integer REFERENCES `agents`(`id`);
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `agent_id` integer;
