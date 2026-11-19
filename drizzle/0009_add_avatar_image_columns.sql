ALTER TABLE `agents` ADD COLUMN `avatar_blob_key` text;
--> statement-breakpoint
ALTER TABLE `conversations` ADD COLUMN `avatar_blob_key` text;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `avatar_blob_key` text;
--> statement-breakpoint
ALTER TABLE `muse_settings` ADD COLUMN `avatar_blob_key` text;
