ALTER TABLE `browser_state` ADD COLUMN `custom_user_agent` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `browser_state` ADD COLUMN `cookies_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `browser_state` ADD COLUMN `ignore_cert_errors` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `browser_state` SET `custom_user_agent` = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', `cookies_enabled` = 1, `ignore_cert_errors` = 1 WHERE `id` = 1;
