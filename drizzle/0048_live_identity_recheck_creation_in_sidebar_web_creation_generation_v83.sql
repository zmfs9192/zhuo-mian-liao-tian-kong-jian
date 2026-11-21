ALTER TABLE `agents` ADD COLUMN `web_checked_at` integer;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_account_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES
('v83', '创作移入左侧栏 · 账号冲突改为实时复核', '「创作」移到左侧栏智能体下方，智能体列表下不再列全部对话；创作的生成设置收进对话框下方的按钮、点开在新页面里改；网页版智能体在创作里也能通过官网聊天生成图片和视频；账号冲突改为每次实时向官网复核（豆包按每个智能体自己的 Cookie 向官网账号接口取回它自己的账号 ID），只有当次查到确实是同一个账号才拦，查不到不算冲突，设置里能看到每个智能体本次查到的账号 ID、显示名、检查时间和 Cookie 字段数。', 1795195800000);
