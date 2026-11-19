ALTER TABLE `agents` ADD COLUMN `web_model` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_reasoning` text DEFAULT '' NOT NULL;
