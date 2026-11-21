ALTER TABLE `code_files` ADD COLUMN `path` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `code_files` ADD COLUMN `is_folder` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `code_files` SET `path` = `name` WHERE `path` = '';
--> statement-breakpoint
CREATE TABLE `code_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`language` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'save' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `code_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `code_ai_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`original_content` text DEFAULT '' NOT NULL,
	`proposed_content` text DEFAULT '' NOT NULL,
	`instruction` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'code-pane' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `code_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v88', '代码完整专业版', 'Monaco 编辑器、项目文件夹树与多标签、全文搜索、导入导出、运行与实时预览、AI 对比修改与版本历史。', strftime('%s','now') * 1000);
