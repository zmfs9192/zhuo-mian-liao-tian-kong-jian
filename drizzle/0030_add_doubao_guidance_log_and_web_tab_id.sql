ALTER TABLE `web_remote_conversations` ADD COLUMN `web_tab_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `doubao_send_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`http_status` integer,
	`response_bytes` integer DEFAULT 0 NOT NULL,
	`error_code` integer,
	`error_msg` text DEFAULT '' NOT NULL,
	`has_verify` integer DEFAULT 0 NOT NULL,
	`has_shark` integer DEFAULT 0 NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`payload_count` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
