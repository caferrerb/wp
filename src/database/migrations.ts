import { getDatabase } from './connection.js';

export function runMigrations(): void {
  const db = getDatabase();

  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_jid TEXT NOT NULL,
      sender_name TEXT,
      message_id TEXT UNIQUE NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT,
      timestamp INTEGER NOT NULL,
      is_group INTEGER DEFAULT 0,
      media_path TEXT,
      media_mimetype TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_remote_jid ON messages(remote_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
  `);

  // Add media columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN media_path TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN media_mimetype TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN is_from_me INTEGER DEFAULT 0`);
  } catch {
    // Column already exists
  }

  console.log('Database migrations completed');
}
