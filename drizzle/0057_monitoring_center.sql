CREATE TABLE `monitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`frequency_minutes` integer DEFAULT 1440 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`last_checked_at` integer,
	`last_status` text DEFAULT '' NOT NULL,
	`last_value_num` real,
	`last_value_text` text DEFAULT '' NOT NULL,
	`last_source` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitor_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monitor_id` integer NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`value_num` real,
	`value_text` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `monitor_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monitor_id` integer NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`is_read` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v91', '专业监控中心', '左侧栏新增监控：商品价格、股票、红果短剧更新、网页变化、汇率与加密货币、航班酒店价格、应用版本、票务有货、社交账号更新九类监控，可设频率与提醒阈值，带历史曲线、来源与站内提醒；只显示真实查到的数据，查不到如实显示。', strftime('%s','now') * 1000);
