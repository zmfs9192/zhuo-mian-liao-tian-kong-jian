ALTER TABLE `browser_capture` ADD COLUMN `req_headers` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `browser_capture` ADD COLUMN `res_headers` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `browser_capture` ADD COLUMN `req_body` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `browser_capture` ADD COLUMN `res_body` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `browser_capture` ADD COLUMN `timings` text DEFAULT '' NOT NULL;
