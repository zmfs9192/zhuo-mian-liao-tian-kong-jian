ALTER TABLE `agents` ADD COLUMN `web_import_json` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD COLUMN `web_import_at` integer;
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES
('v79', 'Chrome 扩展 + 账号导入页', '新增「设置 → 账号导入」：配套 Chrome 扩展在目标网站登录后一键抓取该站的全部登录数据——全部 Cookie（含普通网页读不到的 HttpOnly）、localStorage、sessionStorage、浏览器 UA，以及 ChatGPT 的会话 accessToken——导出为 JSON；空间的导入页粘贴或选文件后自动识别是哪个网站、按各站的凭证格式拆分（千问拆 token / Cookie / UA，Gemini 取 __Secure-1PSID 与 1PSIDTS，豆包取完整 Cookie 并尝试恢复 device_id，DeepSeek 取本地存储令牌，Claude 取 sessionKey，Kimi / 智谱取本地存储 JWT，其余 Cookie 型站点取完整 Cookie），选定对应智能体后保存到服务端并立即向官网验证登录，账号冲突按既有身份守卫报告。扩展的四个文件（manifest / popup / background / 说明）可直接在导入页逐个下载，扩展本身不联网、不上传，数据只经用户手动粘贴进空间；抓到的凭证与整包原始数据只存服务端、任何接口都不回显。没有扩展时，导入页也接受直接粘贴的 Cookie / 令牌 / 千问整段凭证 JSON，按所选智能体的站点拆分保存。', 1795189901129);
