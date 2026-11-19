ALTER TABLE `agents` ADD COLUMN `web_model_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_menu_json` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_menu_at` integer;
