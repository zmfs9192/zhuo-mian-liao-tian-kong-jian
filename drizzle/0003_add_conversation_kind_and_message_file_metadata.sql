ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'direct';
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN file_name TEXT;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN file_size INTEGER;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN file_mime TEXT;
