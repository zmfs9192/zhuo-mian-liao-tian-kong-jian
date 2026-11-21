CREATE TABLE `browser_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`visited_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `browser_bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `browser_downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v90', '空间内置浏览器', '左侧栏新增浏览器：多标签、地址栏、前进后退、刷新、历史、收藏、下载一应俱全，并设为空间默认浏览器——聊天、文件等处的所有网页链接都在空间浏览器新标签页打开，站内点击不跳出空间；网站拒绝抓取或返回错误时在浏览器内如实说明。', strftime('%s','now') * 1000);
