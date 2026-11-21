UPDATE `space_versions` SET `summary` = '豆包发送顺序调换：带模型选择包的请求改为第一条发出，plain 只作回退，模型切换真正生效。' WHERE `version` = 'v75';
--> statement-breakpoint
UPDATE `space_versions` SET `summary` = '豆包发送记录落库「实际发出的选择」，诊断面板按落库事实显示本次选择与命中第几条。' WHERE `version` = 'v76';
