CREATE TABLE `leigod_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_label` text DEFAULT '' NOT NULL,
	`token_enc` text DEFAULT '' NOT NULL,
	`last_info_json` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hongguo_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`genre` text DEFAULT '其他' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`progress` text DEFAULT '' NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	`monitor_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
