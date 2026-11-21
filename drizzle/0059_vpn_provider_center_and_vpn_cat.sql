CREATE TABLE `vpncat_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v93', '代理多供应商中心 + VPN Cat', '代理改为多供应商中心：原 Pioneer 收进供应商图标、点进去是原界面（功能全不动）；新增 VPN Cat（16 国选择、免费/高速方案、出口检查），并如实说明其无公开 API 与账号体系、空间无法代建隧道、不会伪装成已连接。', strftime('%s','now') * 1000);
