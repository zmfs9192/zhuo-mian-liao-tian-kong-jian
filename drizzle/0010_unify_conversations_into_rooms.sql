ALTER TABLE `conversations` ADD COLUMN `title_auto` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
INSERT INTO `group_members` (`conversation_id`, `agent_id`, `enabled`, `created_at`)
SELECT c.`id`, c.`agent_id`, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `conversations` c
WHERE c.`kind` = 'direct' AND c.`member_based` = 0
  AND NOT EXISTS (
    SELECT 1 FROM `group_members` gm
    WHERE gm.`conversation_id` = c.`id` AND gm.`agent_id` IS c.`agent_id`
  );
--> statement-breakpoint
UPDATE `conversations` SET `member_based` = 1 WHERE `kind` = 'direct' AND `member_based` = 0;
--> statement-breakpoint
UPDATE `conversations` SET `title_auto` = 0 WHERE `kind` = 'group' AND `title` NOT GLOB '群聊[0-9]*';
