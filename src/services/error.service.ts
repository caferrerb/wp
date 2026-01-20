import { getDatabase } from '../database/connection.js';

export interface AppError {
  id: number;
  error_type: string;
  error_message: string;
  error_stack: string | null;
  location: string | null;
  context: string | null;
  created_at: string;
}

export interface CreateErrorParams {
  error_type: string;
  error_message: string;
  error_stack?: string;
  location?: string;
  context?: string | Record<string, unknown>;
}

export interface ErrorFilter {
  page?: number;
  limit?: number;
  error_type?: string;
  from?: string; // ISO date string
  to?: string;   // ISO date string
}

export class ErrorService {
  private static instance: ErrorService | null = null;

  static getInstance(): ErrorService {
    if (!ErrorService.instance) {
      ErrorService.instance = new ErrorService();
    }
    return ErrorService.instance;
  }

  logError(params: CreateErrorParams): AppError | null {
    const db = getDatabase();

    try {
      const contextStr = params.context
        ? (typeof params.context === 'string' ? params.context : JSON.stringify(params.context))
        : null;

      const stmt = db.prepare(`
        INSERT INTO errors (error_type, error_message, error_stack, location, context)
        VALUES (?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        params.error_type,
        params.error_message,
        params.error_stack || null,
        params.location || null,
        contextStr
      );

      return this.getErrorById(result.lastInsertRowid as number);
    } catch (error) {
      console.error('[ErrorService] Failed to log error to database:', error);
      return null;
    }
  }

  logFromException(error: unknown, location?: string, context?: Record<string, unknown>): AppError | null {
    const errorObj = error instanceof Error ? error : new Error(String(error));

    return this.logError({
      error_type: errorObj.name || 'Error',
      error_message: errorObj.message,
      error_stack: errorObj.stack,
      location,
      context,
    });
  }

  getErrorById(id: number): AppError | null {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM errors WHERE id = ?');
    const row = stmt.get(id) as AppError | undefined;
    return row || null;
  }

  getErrors(filter: ErrorFilter = {}): { errors: AppError[]; total: number } {
    const db = getDatabase();
    const { page = 1, limit = 50, error_type, from, to } = filter;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: (string | number)[] = [];

    if (error_type) {
      whereClause += ' AND error_type = ?';
      params.push(error_type);
    }

    if (from) {
      whereClause += ' AND created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND created_at <= ?';
      params.push(to);
    }

    // Get total count
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM errors WHERE ${whereClause}`);
    const countResult = countStmt.get(...params) as { count: number };
    const total = countResult.count;

    // Get errors
    const stmt = db.prepare(`
      SELECT * FROM errors
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(...params, limit, offset) as AppError[];

    return { errors: rows, total };
  }

  getErrorTypes(): string[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT DISTINCT error_type FROM errors ORDER BY error_type');
    const rows = stmt.all() as { error_type: string }[];
    return rows.map(r => r.error_type);
  }

  getErrorsToday(): AppError[] {
    const db = getDatabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDay = today.toISOString();

    const stmt = db.prepare(`
      SELECT * FROM errors
      WHERE created_at >= ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(startOfDay) as AppError[];

    return rows;
  }

  deleteOldErrors(daysToKeep: number = 30): number {
    const db = getDatabase();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const stmt = db.prepare('DELETE FROM errors WHERE created_at < ?');
    const result = stmt.run(cutoffDate.toISOString());

    return result.changes;
  }
}

// Export singleton instance for easy access
export const errorService = ErrorService.getInstance();
