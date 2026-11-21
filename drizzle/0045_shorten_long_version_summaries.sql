UPDATE `space_versions` SET `summary` = '网页智能体验证登录时落库官网账号身份并互相核对：同站两个智能体指向同一账号会报「账号冲突」并停发，防止串号。' WHERE `version` = 'v77';
--> statement-breakpoint
UPDATE `space_versions` SET `summary` = '豆包切换模型不再清掉官网对话续接记录，下一条回复在原对话里续发并带上新选型。' WHERE `version` = 'v78';
--> statement-breakpoint
UPDATE `space_versions` SET `summary` = '新增「设置 → 账号导入」：Chrome 扩展抓取已登录网站的 Cookie 等凭证，粘贴进空间后自动拆分保存到服务端并立即验证登录。' WHERE `version` = 'v79';
--> statement-breakpoint
UPDATE `space_versions` SET `summary` = '豆包聊天框工具栏里用不了的云电脑、项目、插件三个按钮已去掉，联网搜索、技能、模型选择保留。' WHERE `version` = 'v80';
