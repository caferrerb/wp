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
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN participant_jid TEXT`);
  } catch {
    // Column already exists
  }

  // Create errors table for logging application errors
  db.exec(`
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_type TEXT NOT NULL,
      error_message TEXT NOT NULL,
      error_stack TEXT,
      location TEXT,
      context TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_errors_created_at ON errors(created_at);
    CREATE INDEX IF NOT EXISTS idx_errors_error_type ON errors(error_type);
  `);

  // Create events table for tracking WhatsApp events (deletes, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      remote_jid TEXT,
      message_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_remote_jid ON events(remote_jid);
  `);

  console.log('Database migrations completed');
}
