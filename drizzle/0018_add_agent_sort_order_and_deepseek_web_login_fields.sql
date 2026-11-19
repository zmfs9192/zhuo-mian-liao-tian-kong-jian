ALTER TABLE `agents` ADD COLUMN `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `connection_type` text DEFAULT 'api' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_token` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_status` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_account` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_error` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `muse_settings` ADD COLUMN `sort_order` integer DEFAULT 0 NOT NULL;
