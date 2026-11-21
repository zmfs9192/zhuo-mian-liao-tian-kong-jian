CREATE TABLE toolkit_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT NOT NULL,
  run_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'external',
  blocker TEXT NOT NULL DEFAULT '',
  alt_note TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE toolkit_settings (
  id INTEGER PRIMARY KEY,
  mail_provider TEXT NOT NULL DEFAULT 'gptmail',
  gptmail_base TEXT NOT NULL DEFAULT 'https://mail.chatgpt.org.uk',
  gptmail_api_key TEXT NOT NULL DEFAULT '',
  npcmail_api_key TEXT NOT NULL DEFAULT '',
  npcmail_domain TEXT NOT NULL DEFAULT 'git-hub.email',
  proxy TEXT NOT NULL DEFAULT '',
  enable_oauth INTEGER NOT NULL DEFAULT 1,
  oauth_issuer TEXT NOT NULL DEFAULT 'https://auth.openai.com',
  oauth_client_id TEXT NOT NULL DEFAULT 'app_EMoamEEZ73f0CkXaXp7hrann',
  sub2api_url TEXT NOT NULL DEFAULT '',
  sub2api_token TEXT NOT NULL DEFAULT '',
  sub_api_key TEXT NOT NULL DEFAULT '',
  sub_plan TEXT NOT NULL DEFAULT 'team',
  addr_street TEXT NOT NULL DEFAULT '',
  addr_city TEXT NOT NULL DEFAULT '',
  addr_state TEXT NOT NULL DEFAULT '',
  addr_zip TEXT NOT NULL DEFAULT '',
  addr_country TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE toolkit_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  email_password TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'ChatGPT Team',
  oauth_status TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE toolkit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
