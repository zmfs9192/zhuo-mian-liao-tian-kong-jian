CREATE TABLE `browser_capture` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cap_id` text DEFAULT '' NOT NULL,
	`ts` integer DEFAULT 0 NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'document' NOT NULL,
	`status` integer DEFAULT 0 NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`content_type` text DEFAULT '' NOT NULL
);
