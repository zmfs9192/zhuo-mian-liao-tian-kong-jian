ALTER TABLE `user_profile` ADD COLUMN `menu_order` text DEFAULT '' NOT NULL;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v94', '画布一键恢复初始状态 + 菜单栏排序', '提示词无限画布新增「恢复初始状态」按钮：一键回到以画风与视觉风格为主的初始标签（画风/色彩/光线/构图/镜头/画质/负面，不含物品道具类）。左侧菜单栏固定占三分之二高度、内部可滚动，不再把最近聊天挤到底部；菜单项可长按拖动自定义排序，顺序保存在服务端。', strftime('%s','now') * 1000);
