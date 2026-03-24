import Database from "better-sqlite3";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1RunResult,
} from "../d1/types.js";

class SqlitePreparedStatement implements D1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private db: Database.Database,
    private sql: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params) as T[];
    return { results: rows, success: true };
  }

  async run(): Promise<D1RunResult> {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.params);
    return {
      success: true,
      changes: info.changes,
      lastRowId: Number(info.lastInsertRowid),
    };
  }
}

export class SqliteD1 implements D1Database {
  private db: Database.Database;

  constructor(path?: string) {
    this.db = new Database(path ?? ":memory:");
    this.db.pragma("journal_mode = WAL");
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqlitePreparedStatement(this.db, sql);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}
