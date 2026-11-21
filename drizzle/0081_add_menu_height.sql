ALTER TABLE `user_profile` ADD COLUMN `menu_height` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v134', '每栏边缘长按拖动调宽高、最近聊天紧贴菜单栏下方', '侧边栏里菜单栏和最近聊天栏之间新增一条分界拖动条：长按约半秒后上下拖动即可调整菜单栏高度，菜单栏右边缘调宽、列表栏右边缘调宽照旧，全部长按拖动、松手自动保存。最近聊天栏不再用固定像素高度定位：它改为紧贴在当前菜单栏正下方、在流式排版里占满菜单栏以下到设置栏以上的剩余高度——菜单被缩放、改高、隐藏或重新展开，最近聊天都只出现在当前菜单栏下方，不再停在某个写死的坐标上。设置「窗口大小」页新增菜单栏高度显示，一键重置布局会把菜单高度恢复自动。', strftime('%s','now') * 1000);
