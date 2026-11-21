ALTER TABLE `user_profile` ADD COLUMN `gesture_pinch_zoom` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `gesture_double_tap_zoom` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `gesture_two_finger_swipe` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `gesture_long_press_menu` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `gesture_three_finger_swipe` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `prompt_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`label` text DEFAULT '' NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `prompt_tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prompt_tree_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`seeded` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v89', '提示词标签无限画布 + 更多手势', '创作改为提示词标签无限画布：内置完整专业标签库，单击展开分支网状树、双击修改，选用标签自动组装提示词；设置手势页新增双指捏合缩放、双击缩放、双指滑切对话、长按菜单、三指滑切分区五个独立开关。', strftime('%s','now') * 1000);
