CREATE TABLE `browser_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`device_mode` text DEFAULT 'desktop' NOT NULL,
	`updated_at` integer NOT NULL
);
