CREATE TABLE `workspace_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
