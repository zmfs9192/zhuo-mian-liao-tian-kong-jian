CREATE TABLE `ledger_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'cash' NOT NULL,
	`initial_balance_cents` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `ledger_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`account_id` integer NOT NULL,
	`to_account_id` integer,
	`category_id` integer,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`occurred_on` text DEFAULT '' NOT NULL,
	`attachment_blob_key` text,
	`attachment_name` text DEFAULT '' NOT NULL,
	`recurring_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `ledger_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_id`) REFERENCES `ledger_recurring`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`month` text DEFAULT '' NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `ledger_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger_recurring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`account_id` integer NOT NULL,
	`category_id` integer,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`start_on` text DEFAULT '' NOT NULL,
	`next_on` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `ledger_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`seeded` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `space_versions` (`version`, `title`, `summary`, `created_at`) VALUES ('v92', '专业记账本', '左侧栏新增记账本：多账户、收入/支出/转账、可自定义分类与子分类、按月分类预算与超支提醒、定期收支、备注与附件、搜索筛选、月度年度报表、分类占比与趋势图、资产总览、CSV/Excel 导入导出；账目只存服务端，金额日期以实际输入为准。', strftime('%s','now') * 1000);
