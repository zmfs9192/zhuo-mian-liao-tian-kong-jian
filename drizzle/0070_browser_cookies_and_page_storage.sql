CREATE TABLE `browser_cookies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text DEFAULT '' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`path` text DEFAULT '/' NOT NULL,
	`expires_at` integer,
	`secure` integer DEFAULT 0 NOT NULL,
	`http_only` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_cookies_domain_name_path` ON `browser_cookies` (`domain`, `name`, `path`);
--> statement-breakpoint
CREATE TABLE `browser_page_storage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_page_storage_origin_key` ON `browser_page_storage` (`origin`, `key`);
