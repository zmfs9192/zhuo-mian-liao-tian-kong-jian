CREATE TABLE `free_proxies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`protocol` text DEFAULT 'http' NOT NULL,
	`host` text DEFAULT '' NOT NULL,
	`port` integer DEFAULT 0 NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`country_code` text DEFAULT '' NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`anonymity` text DEFAULT '' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`sources` text DEFAULT '' NOT NULL,
	`last_checked_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `free_proxy_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`active_key` text DEFAULT '' NOT NULL,
	`refreshed_at` integer DEFAULT 0 NOT NULL,
	`tested_count` integer DEFAULT 0 NOT NULL,
	`passed_count` integer DEFAULT 0 NOT NULL
);
