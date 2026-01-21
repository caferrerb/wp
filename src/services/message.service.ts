import { getDatabase } from '../database/connection.js';
import { groupService } from './group.service.js';

export interface Message {
  id: number;
  remote_jid: string;
  sender_name: string | null;
  participant_jid: string | null;
  message_id: string;
  message_type: string;
  content: string | null;
  timestamp: number;
  is_group: boolean;
  is_from_me: boolean;
  media_path: string | null;
  media_mimetype: string | null;
  created_at: string;
}

export interface CreateMessageParams {
  remote_jid: string;
  sender_name?: string;
  participant_jid?: string;
  message_id: string;
  message_type: string;
  content?: string;
  timestamp: number;
  is_group?: boolean;
  is_from_me?: boolean;
  media_path?: string;
  media_mimetype?: string;
}

export interface MessageFilter {
  from?: number; // Unix timestamp
  to?: number;   // Unix timestamp
  page?: number;
  limit?: number;
  remoteJid?: string; // Filter by conversation
  searchText?: string; // Text search in message content
  sortOrder?: 'asc' | 'desc'; // Sort order for results (default: desc for search, asc for conversation)
}

export interface Conversation {
  remote_jid: string;
  sender_name: string | null;
  group_name: string | null;
  profile_picture: string | null;
  is_group: boolean;
  last_message: string | null;
  last_message_type: string;
  last_timestamp: number;
  unread_count: number;
}

export class MessageService {
  createMessage(params: CreateMessageParams): Message | null {
    const db = getDatabase();

    try {
      const stmt = db.prepare(`
        INSERT INTO messages (remote_jid, sender_name, participant_jid, message_id, message_type, content, timestamp, is_group, is_from_me, media_path, media_mimetype)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        params.remote_jid,
        params.sender_name || null,
        params.participant_jid || null,
        params.message_id,
        params.message_type,
        params.content || null,
        params.timestamp,
        params.is_group ? 1 : 0,
        params.is_from_me ? 1 : 0,
        params.media_path || null,
        params.media_mimetype || null
      );

      return this.getMessageById(result.lastInsertRowid as number);
    } catch (error: unknown) {
      // Duplicate message_id - ignore
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return null;
      }
      throw error;
    }
  }

  getMessageById(id: number): Message | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as Message | undefined;
    return row ? this.mapRow(row) : null;
  }

  getMessageByMessageId(messageId: string): Message | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM messages WHERE message_id = ?');
    const row = stmt.get(messageId) as Message | undefined;
    return row ? this.mapRow(row) : null;
  }

  getMessages(filter: MessageFilter = {}): { messages: Message[]; total: number; sortOrder: 'asc' | 'desc' } {
    const db = getDatabase();
    const { from, to, page = 1, limit = 50, remoteJid, searchText, sortOrder } = filter;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: (number | string)[] = [];

    if (remoteJid) {
      whereClause += ' AND remote_jid = ?';
      params.push(remoteJid);
    }

    if (from) {
      whereClause += ' AND timestamp >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND timestamp <= ?';
      params.push(to);
    }

    if (searchText) {
      whereClause += ' AND content LIKE ?';
      params.push(`%${searchText}%`);
    }

    // Get total count
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE ${whereClause}`);
    const countResult = countStmt.get(...params) as { count: number };
    const total = countResult.count;

    // Determine sort order:
    // - If explicitly provided, use it
    // - For conversation view (remoteJid without search): default to 'asc' (oldest first, like chat)
    // - For search results: default to 'desc' (newest first)
    const isConversationView = remoteJid && !searchText;
    const effectiveSortOrder = sortOrder || (isConversationView ? 'asc' : 'desc');
    const sqlOrder = effectiveSortOrder === 'asc' ? 'ASC' : 'DESC';

    const stmt = db.prepare(`
      SELECT * FROM messages
      WHERE ${whereClause}
      ORDER BY timestamp ${sqlOrder}
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(...params, limit, offset) as Message[];

    return {
      messages: rows.map(row => this.mapRow(row)),
      total,
      sortOrder: effectiveSortOrder,
    };
  }

  getConversations(): Conversation[] {
    const db = getDatabase();

    // Get basic conversation data
    const stmt = db.prepare(`
      SELECT
        remote_jid,
        MAX(is_group) as is_group,
        (SELECT content FROM messages m2 WHERE m2.remote_jid = m1.remote_jid ORDER BY timestamp DESC LIMIT 1) as last_message,
        (SELECT message_type FROM messages m2 WHERE m2.remote_jid = m1.remote_jid ORDER BY timestamp DESC LIMIT 1) as last_message_type,
        MAX(timestamp) as last_timestamp,
        COUNT(*) as unread_count
      FROM messages m1
      GROUP BY remote_jid
      ORDER BY last_timestamp DESC
    `);

    const rows = stmt.all() as Array<{
      remote_jid: string;
      is_group: number;
      last_message: string | null;
      last_message_type: string;
      last_timestamp: number;
      unread_count: number;
    }>;

    // Get all cached group names and profile pictures for efficiency
    const groupNames = groupService.getAllGroupNames();
    const groupPictures = groupService.getAllGroupProfilePictures();
    const contactPictures = groupService.getAllContactProfilePictures();

    // For each conversation, get the appropriate name and profile picture
    return rows.map(row => {
      const isGroup = Boolean(row.is_group);
      let senderName: string | null = null;
      let groupName: string | null = null;
      let profilePicture: string | null = null;

      if (isGroup) {
        // Get group name and picture from cache
        groupName = groupNames.get(row.remote_jid) || null;
        profilePicture = groupPictures.get(row.remote_jid) || null;
      } else {
        // For individual chats, get the sender_name from received messages
        const nameStmt = db.prepare(`
          SELECT sender_name FROM messages
          WHERE remote_jid = ? AND is_from_me = 0 AND sender_name IS NOT NULL AND sender_name != ''
          ORDER BY timestamp DESC
          LIMIT 1
        `);
        const nameRow = nameStmt.get(row.remote_jid) as { sender_name: string } | undefined;
        senderName = nameRow?.sender_name || null;
        profilePicture = contactPictures.get(row.remote_jid) || null;
      }

      return {
        remote_jid: row.remote_jid,
        sender_name: senderName,
        group_name: groupName,
        profile_picture: profilePicture,
        is_group: isGroup,
        last_message: row.last_message,
        last_message_type: row.last_message_type,
        last_timestamp: row.last_timestamp,
        unread_count: row.unread_count,
      };
    });
  }

  getLatestTimestamp(): number {
    const db = getDatabase();
    const stmt = db.prepare('SELECT MAX(timestamp) as latest FROM messages');
    const result = stmt.get() as { latest: number | null };
    return result.latest || 0;
  }

  getMessagesToday(): Message[] {
    const db = getDatabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = Math.floor(today.getTime() / 1000);

    const stmt = db.prepare(`
      SELECT * FROM messages
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
    `);
    const rows = stmt.all(startOfDay) as Message[];

    return rows.map(row => this.mapRow(row));
  }

  getAllMessages(): Message[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM messages ORDER BY timestamp DESC');
    const rows = stmt.all() as Message[];
    return rows.map(row => this.mapRow(row));
  }

  private mapRow(row: Message): Message {
    return {
      ...row,
      is_group: Boolean(row.is_group),
      is_from_me: Boolean(row.is_from_me),
    };
  }
}
