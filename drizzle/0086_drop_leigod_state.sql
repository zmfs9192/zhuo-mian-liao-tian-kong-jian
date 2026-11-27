DROP TABLE IF EXISTS `leigod_state`;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v139', '取消雷神加速器', '雷神加速器已整个取消：代理中心的雷神入口、登录面板、服务端接口与 leigod_state 表全部删除。Pioneer 与虚拟位置不受影响。', strftime('%s','now') * 1000);
