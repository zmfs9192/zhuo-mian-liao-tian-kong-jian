CREATE TABLE `code_quick_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`language` text DEFAULT '' NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'chat' NOT NULL,
	`source_label` text DEFAULT '' NOT NULL,
	`message_id` integer,
	`block_index` integer DEFAULT -1 NOT NULL,
	`created_at` integer NOT NULL
);
