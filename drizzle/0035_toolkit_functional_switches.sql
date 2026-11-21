ALTER TABLE `toolkit_settings` ADD COLUMN `oauth_required` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `oauth_redirect_uri` text DEFAULT 'http://localhost:1455/auth/callback' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `enable_team_invite` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `team_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `team_account_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `team_auth_token` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `team_session_token` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `team_max_invites` integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `team_invite_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `enable_sub2api` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `enable_cpa_upload` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `upload_api_url` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `upload_api_token` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `reg_use_uk_tunnel` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `otp_resend_on_timeout` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_settings` ADD COLUMN `otp_wait_seconds` integer DEFAULT 120 NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_accounts` ADD COLUMN `oauth_access_token` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_accounts` ADD COLUMN `oauth_refresh_token` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `toolkit_accounts` ADD COLUMN `oauth_id_token` text DEFAULT '' NOT NULL;
