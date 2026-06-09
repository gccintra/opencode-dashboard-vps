/**
 * Vitest adapter: wraps better-sqlite3 to match the bun:sqlite API subset
 * used by this project. Used only during testing — production uses bun:sqlite.
 */
import BetterSqlite3 from 'better-sqlite3';

// better-sqlite3 returns undefined for no row; bun:sqlite returns null
function toRow(value: Record<string, unknown> | undefined): Record<string, unknown> | null {
  return value === undefined ? null : value;
}

class Statement {
  constructor(private stmt: BetterSqlite3.Statement) {}

  get(...params: unknown[]): Record<string, unknown> | null {
    return toRow(this.stmt.get(...params) as Record<string, unknown> | undefined);
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.stmt.all(...params) as Record<string, unknown>[];
  }
}

export class Database {
  private db: BetterSqlite3.Database;

  constructor(path: string, _options?: Record<string, unknown>) {
    this.db = new BetterSqlite3(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  run(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...params);
  }

  close(): void {
    this.db.close();
  }
}
