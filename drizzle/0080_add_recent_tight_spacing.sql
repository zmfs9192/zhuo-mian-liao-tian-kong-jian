ALTER TABLE `user_profile` ADD COLUMN `recent_tight` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v133', '最近聊天栏与菜单栏分开：独立间距、独立缩放、单独隐藏', '最近聊天栏不再跟菜单栏一起调整：设置「间距」页新增「最近聊天紧凑间距」开关，只管最近聊天栏的行距，菜单的「菜单图标贴紧」只管菜单栏，互不影响；两栏的双指缩放分开，在哪一栏捏合只缩放哪一栏，各自的大小分别记住；侧边栏顶部有「隐藏菜单栏」按钮、最近聊天标题旁有「隐藏最近聊天栏」按钮，点一下单独隐藏一栏，再点同一按钮显示回来，隐藏状态退出再进保持。', strftime('%s','now') * 1000);
