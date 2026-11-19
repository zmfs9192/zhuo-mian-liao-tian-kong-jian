ALTER TABLE `agents` ADD COLUMN `web_mode` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_thinking` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_search` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `agents` SET `web_mode` = 'expert' WHERE `connection_type` = 'web' AND `provider` = 'deepseek' AND (lower(`model`) LIKE '%pro%' OR lower(`model`) LIKE '%expert%');
--> statement-breakpoint
UPDATE `agents` SET `web_mode` = 'default' WHERE `connection_type` = 'web' AND `provider` = 'deepseek' AND `web_mode` = '';
--> statement-breakpoint
UPDATE `agents` SET `web_thinking` = 1 WHERE `connection_type` = 'web' AND `provider` = 'deepseek' AND (lower(`model`) LIKE '%reasoner%' OR lower(`model`) LIKE '%r1%' OR lower(`model`) LIKE '%think%' OR lower(`model`) LIKE '%reason%');
--> statement-breakpoint
UPDATE `agents` SET `web_search` = 1 WHERE `connection_type` = 'web' AND `provider` = 'deepseek' AND lower(`model`) LIKE '%search%';
--> statement-breakpoint
UPDATE `agents` SET `web_mode` = 'fast' WHERE `connection_type` = 'web' AND `provider` = 'doubao' AND `web_mode` = '';
