CREATE TABLE `skill_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`skill_id` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`size` integer,
	`mime` text,
	`content` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
