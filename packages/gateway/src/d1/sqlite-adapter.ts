import type Database from "better-sqlite3";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1RunResult,
} from "./types.js";

class BoundStatement implements D1PreparedStatement {
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

/**
 * Wraps a better-sqlite3 Database instance to implement the D1Database interface.
 * This allows all existing D1-based stores (RegistryStore, CredentialVault, MeterStore)
 * to work with a local SQLite database for standalone deployments.
 */
export function createSqliteD1(db: Database.Database): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      return new BoundStatement(db, sql);
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
  };
}
