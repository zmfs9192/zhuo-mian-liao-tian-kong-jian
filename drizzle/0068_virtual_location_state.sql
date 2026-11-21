CREATE TABLE `virtual_location_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`lat` real,
	`lon` real,
	`recent_json` text DEFAULT '[]' NOT NULL,
	`exit_ip` text DEFAULT '' NOT NULL,
	`exit_country` text DEFAULT '' NOT NULL,
	`exit_city` text DEFAULT '' NOT NULL,
	`exit_lat` real,
	`exit_lon` real,
	`exit_measured_at` integer,
	`exit_error` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
