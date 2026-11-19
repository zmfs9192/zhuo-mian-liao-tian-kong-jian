CREATE TABLE `web_remote_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`agent_id` integer NOT NULL,
	`provider` text DEFAULT 'doubao' NOT NULL,
	`remote_conversation_id` text DEFAULT '' NOT NULL,
	`local_conversation_id` text DEFAULT '' NOT NULL,
	`last_section_id` text DEFAULT '' NOT NULL,
	`last_message_index` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
