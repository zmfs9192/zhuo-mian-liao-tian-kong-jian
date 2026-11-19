ALTER TABLE `pioneer_state` ADD COLUMN `global_mode` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `pioneer_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
