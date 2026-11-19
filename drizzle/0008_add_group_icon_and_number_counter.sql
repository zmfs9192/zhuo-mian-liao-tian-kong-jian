ALTER TABLE `conversations` ADD COLUMN `icon_color` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `conversations` ADD COLUMN `icon_glyph` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `group_number_counter` (
	`id` integer PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
INSERT INTO `group_number_counter` (`id`, `next_number`)
SELECT 1, COALESCE(MAX(CAST(substr(`title`, 3) AS integer)), 0) + 1
FROM `conversations`
WHERE `kind` = 'group'
	AND `title` LIKE '群聊%'
	AND substr(`title`, 3) <> ''
	AND substr(`title`, 3) NOT GLOB '*[^0-9]*';
