CREATE TABLE `space_files` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `name` text NOT NULL DEFAULT '',
  `size` integer,
  `mime` text,
  `blob_key` text NOT NULL,
  `agent_access` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `agent_access` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `file_texts` (
  `blob_key` text PRIMARY KEY,
  `content` text NOT NULL
);
