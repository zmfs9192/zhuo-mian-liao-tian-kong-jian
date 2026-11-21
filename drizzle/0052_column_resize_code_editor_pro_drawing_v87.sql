ALTER TABLE `user_profile` ADD COLUMN `column_resize` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `rail_width` integer DEFAULT 264 NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profile` ADD COLUMN `list_width` integer DEFAULT 280 NOT NULL;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES
('v87', '窗口大小可拖动调整、代码编辑器、专业画笔与 Muse 实时作画', '设置里新增「窗口大小」页：开启后，电脑上菜单栏和智能体列表栏的右边缘会出现拖动条，拖动即可调整两栏宽度，宽度会保存下来，下次打开仍是调整后的大小，页里也能一键恢复默认宽度。代码区的编辑器换成 VS 风格：深色编辑面、语法高亮、行号、长行不再自动换行（改为横向滚动），Tab 缩进、回车自动保持缩进，底部有行列状态栏；代码列表的预览也不再折行。手绘画布升级为专业工具：画笔、马克笔、喷枪、橡皮、直线、矩形、椭圆、填充，颜色扩展到 14 色并可自定义取色，笔尖粗细和不透明度用滑杆连续调节，支持撤销与重做。画布上方新增「让 Muse 画」：输入想画的内容，Muse 会把图拆成一笔一画的线条，在画布上一笔一笔实时画出来，画完可以继续用画笔修改或直接保存。', 1795292400000);
