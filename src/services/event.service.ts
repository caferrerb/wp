import { getDatabase } from '../database/connection.js';

export interface AppEvent {
  id: number;
  event_type: string;
  remote_jid: string | null;
  message_id: string | null;
  details: string | null;
  created_at: string;
  chat_name?: string | null;
}

export interface CreateEventParams {
  event_type: string;
  remote_jid?: string;
  message_id?: string;
  details?: string | Record<string, unknown>;
}

export interface EventFilter {
  page?: number;
  limit?: number;
  event_type?: string;
  remote_jid?: string;
  from?: string;
  to?: string;
}

export class EventService {
  private static instance: EventService | null = null;

  static getInstance(): EventService {
    if (!EventService.instance) {
      EventService.instance = new EventService();
    }
    return EventService.instance;
  }

  logEvent(params: CreateEventParams): AppEvent | null {
    const db = getDatabase();

    try {
      const detailsStr = params.details
        ? (typeof params.details === 'string' ? params.details : JSON.stringify(params.details))
        : null;

      const stmt = db.prepare(`
        INSERT INTO events (event_type, remote_jid, message_id, details)
        VALUES (?, ?, ?, ?)
      `);

      const result = stmt.run(
        params.event_type,
        params.remote_jid || null,
        params.message_id || null,
        detailsStr
      );

      return this.getEventById(result.lastInsertRowid as number);
    } catch (error) {
      console.error('[EventService] Failed to log event to database:', error);
      return null;
    }
  }

  logMessageDelete(remoteJid: string, messageId: string, details?: Record<string, unknown>): AppEvent | null {
    return this.logEvent({
      event_type: 'message_delete',
      remote_jid: remoteJid,
      message_id: messageId,
      details,
    });
  }

  logChatDelete(remoteJid: string, details?: Record<string, unknown>): AppEvent | null {
    return this.logEvent({
      event_type: 'chat_delete',
      remote_jid: remoteJid,
      details,
    });
  }

  logAllMessagesDelete(remoteJid: string, details?: Record<string, unknown>): AppEvent | null {
    return this.logEvent({
      event_type: 'chat_clear',
      remote_jid: remoteJid,
      details,
    });
  }

  getEventById(id: number): AppEvent | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM events WHERE id = ?');
    const row = stmt.get(id) as AppEvent | undefined;
    return row || null;
  }

  /**
   * Get chat/contact name from messages table based on remote_jid
   * For groups: returns null (group metadata not stored)
   * For individual chats: returns the contact's push name from messages
   */
  private getChatName(remoteJid: string): string | null {
    const db = getDatabase();
    const isGroup = remoteJid.endsWith('@g.us');

    if (isGroup) {
      // For groups, we don't have group metadata stored
      // Return null to indicate it's a group without a known name
      return null;
    } else {
      // For individual chats, get sender_name from received messages
      const stmt = db.prepare(`
        SELECT sender_name FROM messages
        WHERE remote_jid = ? AND is_from_me = 0 AND sender_name IS NOT NULL AND sender_name != ''
        ORDER BY timestamp DESC
        LIMIT 1
      `);
      const row = stmt.get(remoteJid) as { sender_name: string } | undefined;
      return row?.sender_name || null;
    }
  }

  /**
   * Enrich events with chat names
   */
  private enrichEventsWithChatNames(events: AppEvent[]): AppEvent[] {
    const chatNameCache = new Map<string, string | null>();

    return events.map(event => {
      if (!event.remote_jid) return event;

      if (!chatNameCache.has(event.remote_jid)) {
        chatNameCache.set(event.remote_jid, this.getChatName(event.remote_jid));
      }

      return {
        ...event,
        chat_name: chatNameCache.get(event.remote_jid) || null,
      };
    });
  }

  getEvents(filter: EventFilter = {}): { events: AppEvent[]; total: number } {
    const db = getDatabase();
    const { page = 1, limit = 50, event_type, remote_jid, from, to } = filter;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: (string | number)[] = [];

    if (event_type) {
      whereClause += ' AND event_type = ?';
      params.push(event_type);
    }

    if (remote_jid) {
      whereClause += ' AND remote_jid = ?';
      params.push(remote_jid);
    }

    if (from) {
      whereClause += ' AND created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND created_at <= ?';
      params.push(to);
    }

    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM events WHERE ${whereClause}`);
    const countResult = countStmt.get(...params) as { count: number };
    const total = countResult.count;

    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(...params, limit, offset) as AppEvent[];

    // Enrich events with chat names
    const enrichedEvents = this.enrichEventsWithChatNames(rows);

    return { events: enrichedEvents, total };
  }

  getEventTypes(): string[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT DISTINCT event_type FROM events ORDER BY event_type');
    const rows = stmt.all() as { event_type: string }[];
    return rows.map(r => r.event_type);
  }

  getEventsToday(): AppEvent[] {
    const db = getDatabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.toISOString();

    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE created_at >= ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(startOfDay) as AppEvent[];

    return rows;
  }

  getEventsByChat(remoteJid: string): AppEvent[] {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE remote_jid = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(remoteJid) as AppEvent[];
    return rows;
  }
}

export const eventService = EventService.getInstance();
