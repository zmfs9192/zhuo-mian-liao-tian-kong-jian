DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Muse',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  image_blob_key TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX messages_conversation_idx ON messages (conversation_id, id);
