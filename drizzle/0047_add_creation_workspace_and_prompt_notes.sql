CREATE TABLE `creation_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer REFERENCES `agents`(`id`),
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creation_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`agent_id` integer REFERENCES `agents`(`id`),
	`content` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`params_json` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creation_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer NOT NULL REFERENCES `creation_messages`(`id`),
	`blob_key` text NOT NULL,
	`mime` text DEFAULT 'image/png' NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creation_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`ratio` text DEFAULT '1:1' NOT NULL,
	`size_tier` integer DEFAULT 1024 NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`quality` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`negative_prompt` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES
('v82', '新增「创作」', '智能体名单下方新增「创作」：自己添加智能体（默认无），在聊天框里写提示词、选比例/尺寸/张数等生成设置，添加的智能体各用自己的图片接口生成图片；右侧可划开提示词记录，手动记下提示词随时取用。', 1795192800000);
