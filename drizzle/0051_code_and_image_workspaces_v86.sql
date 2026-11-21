CREATE TABLE `code_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`language` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`agent_access` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `image_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`original_blob_key` text NOT NULL,
	`mime` text DEFAULT 'image/png' NOT NULL,
	`width` integer,
	`height` integer,
	`rows` integer DEFAULT 1 NOT NULL,
	`cols` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `image_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`row` integer NOT NULL,
	`col` integer NOT NULL,
	`blob_key` text NOT NULL,
	`mime` text DEFAULT 'image/png' NOT NULL,
	`edited` integer DEFAULT 0 NOT NULL,
	`edit_agent` text DEFAULT '' NOT NULL,
	`edit_instruction` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `image_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES
('v86', '左侧栏新增代码与图像两个工作区', '左侧窄栏在创作下面依次新增「代码」和「图像」：代码区可以新建、编辑、保存多份代码，每份代码有自己的「允许智能体阅读/修改」开关（默认关），打开后这份代码会随聊天发给智能体阅读，你明确要求修改时智能体能把改好的内容保存回来。图像区可以上传图片或用画布手绘保存，按你选的行列把一张图切成多份；指定智能体修图时只把选中的那一份发给它，其余份不上传、不改动，原图一直保留，修好的只替换对应位置。', 1795202400000);
