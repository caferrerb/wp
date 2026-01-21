import { getDatabase } from '../database/connection.js';

export interface GroupInfo {
  id: number;
  group_jid: string;
  group_name: string | null;
  updated_at: string;
}

export class GroupService {
  private static instance: GroupService | null = null;

  static getInstance(): GroupService {
    if (!GroupService.instance) {
      GroupService.instance = new GroupService();
    }
    return GroupService.instance;
  }

  /**
   * Get group name from cache
   */
  getGroupName(groupJid: string): string | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT group_name FROM groups WHERE group_jid = ?');
    const row = stmt.get(groupJid) as { group_name: string | null } | undefined;
    return row?.group_name || null;
  }

  /**
   * Save or update group name in cache
   */
  saveGroupName(groupJid: string, groupName: string): void {
    const db = getDatabase();

    try {
      const stmt = db.prepare(`
        INSERT INTO groups (group_jid, group_name, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(group_jid) DO UPDATE SET
          group_name = excluded.group_name,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(groupJid, groupName);
    } catch (error) {
      console.error('[GroupService] Error saving group name:', error);
    }
  }

  /**
   * Check if group info needs refresh (older than 24 hours)
   */
  needsRefresh(groupJid: string): boolean {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT updated_at FROM groups
      WHERE group_jid = ?
      AND datetime(updated_at) > datetime('now', '-24 hours')
    `);
    const row = stmt.get(groupJid);
    return !row;
  }

  /**
   * Get all cached group names as a map
   */
  getAllGroupNames(): Map<string, string> {
    const db = getDatabase();
    const stmt = db.prepare('SELECT group_jid, group_name FROM groups WHERE group_name IS NOT NULL');
    const rows = stmt.all() as { group_jid: string; group_name: string }[];

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.group_jid, row.group_name);
    }
    return map;
  }
}

export const groupService = GroupService.getInstance();
