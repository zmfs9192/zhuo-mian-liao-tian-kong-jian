CREATE TABLE `vault_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`domain` text DEFAULT '' NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`password_enc` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'website' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`auto_save` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now') * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v95', '浏览器媒体工具栏与后台播放 + 密码本', '内置浏览器新增媒体工具栏：网页里检测到视频/音频时可播放暂停、拖进度、调音量与倍速、画中画与全屏，并可开启后台播放——切标签、切到聊天或其他分区时视频继续播放，空间底部有迷你播放条可暂停或返回浏览器。新增「密码本」：密码经服务端 AES-256-GCM 加密保存（密钥只在服务端文件里），可手动添加，也可在浏览器里输入账号密码时经确认后自动保存；按类型（网站/邮箱/社交/金融/购物/工作/游戏/其他）分组排序，支持搜索、收藏、显示/复制、在浏览器中打开与一键填充到当前网页的登录框。', strftime('%s','now') * 1000);
