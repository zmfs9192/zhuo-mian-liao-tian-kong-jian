ALTER TABLE `user_profile` ADD COLUMN `theme_mode` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `font_scale` integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `code_wrap` integer DEFAULT 1 NOT NULL;
