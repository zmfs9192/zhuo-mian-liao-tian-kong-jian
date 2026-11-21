ALTER TABLE `user_profile` ADD COLUMN `menu_tight` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v132', '菜单图标贴紧开关（设置 → 间距）', '设置里新增「间距」页，带「菜单图标贴紧」开关：开启后侧边栏菜单改按图标自身宽度排布，相邻图标只隔约 4px 贴紧排列，不再被均分撑满整栏、边缘不再留大片空白；关闭恢复原来的均分排布。开关保存在服务端，退出再进保持。', strftime('%s','now') * 1000);
