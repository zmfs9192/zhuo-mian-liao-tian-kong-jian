CREATE TABLE `doubao_pending_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`agent_id` integer NOT NULL,
	`remote_conversation_id` text DEFAULT '' NOT NULL,
	`baseline_ids` text DEFAULT '[]' NOT NULL,
	`baseline_last_assistant_id` text DEFAULT '' NOT NULL,
	`baseline_last_assistant_media` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`checks` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
