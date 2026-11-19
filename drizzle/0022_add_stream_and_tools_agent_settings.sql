ALTER TABLE `agents` ADD COLUMN `stream_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `tool_mode` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `streaming` integer DEFAULT 0 NOT NULL;
