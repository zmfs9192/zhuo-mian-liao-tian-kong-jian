ALTER TABLE `virtual_location_state` ADD COLUMN `gkey_enc` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `virtual_location_state` ADD COLUMN `gkey_last4` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `virtual_location_state` ADD COLUMN `gkey_status` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `virtual_location_state` ADD COLUMN `gkey_error` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `virtual_location_state` ADD COLUMN `gkey_checked_at` integer;
