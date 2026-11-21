CREATE TABLE `code_quick_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_message_id` integer DEFAULT 0 NOT NULL,
	`last_block_index` integer DEFAULT -1 NOT NULL
);
