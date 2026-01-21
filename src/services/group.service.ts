import { getDatabase } from '../database/connection.js';

export interface GroupInfo {
  id: number;
  group_jid: string;
  group_name: string | null;
  profile_picture: string | null;
  updated_at: string;
}

export interface ContactInfo {
  id: number;
  contact_jid: string;
  contact_name: string | null;
  profile_picture: string | null;
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
   * Get group profile picture path from cache
   */
  getGroupProfilePicture(groupJid: string): string | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT profile_picture FROM groups WHERE group_jid = ?');
    const row = stmt.get(groupJid) as { profile_picture: string | null } | undefined;
    return row?.profile_picture || null;
  }

  /**
   * Save or update group info in cache
   */
  saveGroupInfo(groupJid: string, groupName: string, profilePicture?: string): void {
    const db = getDatabase();

    try {
      if (profilePicture) {
        const stmt = db.prepare(`
          INSERT INTO groups (group_jid, group_name, profile_picture, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(group_jid) DO UPDATE SET
            group_name = excluded.group_name,
            profile_picture = excluded.profile_picture,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(groupJid, groupName, profilePicture);
      } else {
        const stmt = db.prepare(`
          INSERT INTO groups (group_jid, group_name, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(group_jid) DO UPDATE SET
            group_name = excluded.group_name,
            updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(groupJid, groupName);
      }
    } catch (error) {
      console.error('[GroupService] Error saving group info:', error);
    }
  }

  /**
   * Save or update group name in cache (backwards compatibility)
   */
  saveGroupName(groupJid: string, groupName: string): void {
    this.saveGroupInfo(groupJid, groupName);
  }

  /**
   * Update only profile picture for a group
   */
  updateGroupProfilePicture(groupJid: string, profilePicture: string): void {
    const db = getDatabase();

    try {
      const stmt = db.prepare(`
        UPDATE groups SET profile_picture = ?, updated_at = CURRENT_TIMESTAMP
        WHERE group_jid = ?
      `);
      const result = stmt.run(profilePicture, groupJid);

      // If no row was updated, insert a new one
      if (result.changes === 0) {
        const insertStmt = db.prepare(`
          INSERT INTO groups (group_jid, profile_picture, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);
        insertStmt.run(groupJid, profilePicture);
      }
    } catch (error) {
      console.error('[GroupService] Error updating group profile picture:', error);
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

  /**
   * Get all cached group profile pictures as a map
   */
  getAllGroupProfilePictures(): Map<string, string> {
    const db = getDatabase();
    const stmt = db.prepare('SELECT group_jid, profile_picture FROM groups WHERE profile_picture IS NOT NULL');
    const rows = stmt.all() as { group_jid: string; profile_picture: string }[];

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.group_jid, row.profile_picture);
    }
    return map;
  }

  // ========== Contact Methods ==========

  /**
   * Get contact name from cache
   */
  getContactName(contactJid: string): string | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT contact_name FROM contacts WHERE contact_jid = ?');
    const row = stmt.get(contactJid) as { contact_name: string | null } | undefined;
    return row?.contact_name || null;
  }

  /**
   * Get contact profile picture path from cache
   */
  getContactProfilePicture(contactJid: string): string | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT profile_picture FROM contacts WHERE contact_jid = ?');
    const row = stmt.get(contactJid) as { profile_picture: string | null } | undefined;
    return row?.profile_picture || null;
  }

  /**
   * Save or update contact info in cache
   */
  saveContactInfo(contactJid: string, contactName?: string, profilePicture?: string): void {
    const db = getDatabase();

    try {
      const stmt = db.prepare(`
        INSERT INTO contacts (contact_jid, contact_name, profile_picture, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(contact_jid) DO UPDATE SET
          contact_name = COALESCE(excluded.contact_name, contacts.contact_name),
          profile_picture = COALESCE(excluded.profile_picture, contacts.profile_picture),
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(contactJid, contactName || null, profilePicture || null);
    } catch (error) {
      console.error('[GroupService] Error saving contact info:', error);
    }
  }

  /**
   * Update only profile picture for a contact
   */
  updateContactProfilePicture(contactJid: string, profilePicture: string): void {
    const db = getDatabase();

    try {
      const stmt = db.prepare(`
        UPDATE contacts SET profile_picture = ?, updated_at = CURRENT_TIMESTAMP
        WHERE contact_jid = ?
      `);
      const result = stmt.run(profilePicture, contactJid);

      // If no row was updated, insert a new one
      if (result.changes === 0) {
        const insertStmt = db.prepare(`
          INSERT INTO contacts (contact_jid, profile_picture, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);
        insertStmt.run(contactJid, profilePicture);
      }
    } catch (error) {
      console.error('[GroupService] Error updating contact profile picture:', error);
    }
  }

  /**
   * Check if contact info needs refresh (older than 24 hours)
   */
  contactNeedsRefresh(contactJid: string): boolean {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT updated_at FROM contacts
      WHERE contact_jid = ?
      AND datetime(updated_at) > datetime('now', '-24 hours')
    `);
    const row = stmt.get(contactJid);
    return !row;
  }

  /**
   * Get all cached contact profile pictures as a map
   */
  getAllContactProfilePictures(): Map<string, string> {
    const db = getDatabase();
    const stmt = db.prepare('SELECT contact_jid, profile_picture FROM contacts WHERE profile_picture IS NOT NULL');
    const rows = stmt.all() as { contact_jid: string; profile_picture: string }[];

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.contact_jid, row.profile_picture);
    }
    return map;
  }

  /**
   * Get profile picture for any JID (group or contact)
   */
  getProfilePicture(jid: string): string | null {
    if (jid.endsWith('@g.us')) {
      return this.getGroupProfilePicture(jid);
    } else {
      return this.getContactProfilePicture(jid);
    }
  }
}

export const groupService = GroupService.getInstance();
