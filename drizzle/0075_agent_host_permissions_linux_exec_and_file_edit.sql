ALTER TABLE `agents` ADD COLUMN `can_exec_linux` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `can_edit_files` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `muse_settings` ADD COLUMN `can_exec_linux` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `muse_settings` ADD COLUMN `can_edit_files` integer DEFAULT 0 NOT NULL;
