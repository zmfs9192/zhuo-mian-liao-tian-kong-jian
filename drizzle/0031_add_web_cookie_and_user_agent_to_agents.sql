ALTER TABLE `agents` ADD COLUMN `web_cookie` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_user_agent` text DEFAULT '' NOT NULL;
