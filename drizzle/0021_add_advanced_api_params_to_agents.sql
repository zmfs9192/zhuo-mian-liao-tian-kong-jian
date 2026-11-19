ALTER TABLE `agents` ADD COLUMN `top_p` real;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `frequency_penalty` real;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `presence_penalty` real;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `seed` integer;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `stop_sequences` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `response_format` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `max_completion_tokens` integer;
