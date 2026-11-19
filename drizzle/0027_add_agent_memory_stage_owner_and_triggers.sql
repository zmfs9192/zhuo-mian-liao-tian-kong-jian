ALTER TABLE `agents` ADD COLUMN `memory` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `muse_settings` ADD COLUMN `memory` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `conversations` ADD COLUMN `stage_owner` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `agent_triggers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `agent_id` integer REFERENCES `agents`(`id`),
  `conversation_id` integer NOT NULL REFERENCES `conversations`(`id`),
  `kind` text DEFAULT 'schedule' NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `instruction` text DEFAULT '' NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `interval_minutes` integer DEFAULT 60 NOT NULL,
  `event_type` text DEFAULT '' NOT NULL,
  `last_run_at` integer,
  `last_status` text DEFAULT '' NOT NULL,
  `last_error` text DEFAULT '' NOT NULL,
  `created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
