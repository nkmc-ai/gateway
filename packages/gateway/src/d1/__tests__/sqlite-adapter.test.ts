import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSqliteD1 } from "../sqlite-adapter.js";
import type { D1Database } from "../types.js";

describe("createSqliteD1", () => {
  let raw: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    raw = new Database(":memory:");
    db = createSqliteD1(raw);
  });

  afterEach(() => {
    raw.close();
  });

  it("exec creates table", async () => {
    await db.exec(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    );
    // verify table exists by inserting a row via the raw db
    const info = raw.prepare("INSERT INTO t (name) VALUES (?)").run("hello");
    expect(info.changes).toBe(1);
  });

  it("prepare/bind/run inserts row", async () => {
    await db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)");
    const result = await db.prepare("INSERT INTO items (val) VALUES (?)").bind("foo").run();
    expect(result.success).toBe(true);
    expect(result.changes).toBe(1);
    expect(result.lastRowId).toBeGreaterThan(0);
  });

  it("prepare/bind/first reads single row", async () => {
    await db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)");
    await db.prepare("INSERT INTO kv (k, v) VALUES (?, ?)").bind("a", "1").run();
    await db.prepare("INSERT INTO kv (k, v) VALUES (?, ?)").bind("b", "2").run();

    const row = await db.prepare("SELECT * FROM kv WHERE k = ?").bind("a").first<{ k: string; v: string }>();
    expect(row).toEqual({ k: "a", v: "1" });
  });

  it("prepare/bind/all reads multiple rows", async () => {
    await db.exec("CREATE TABLE nums (n INTEGER)");
    await db.prepare("INSERT INTO nums (n) VALUES (?)").bind(10).run();
    await db.prepare("INSERT INTO nums (n) VALUES (?)").bind(20).run();
    await db.prepare("INSERT INTO nums (n) VALUES (?)").bind(30).run();

    const result = await db.prepare("SELECT * FROM nums ORDER BY n").bind().all<{ n: number }>();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([{ n: 10 }, { n: 20 }, { n: 30 }]);
  });

  it("first returns null for no match", async () => {
    await db.exec("CREATE TABLE empty (id INTEGER PRIMARY KEY)");
    const row = await db.prepare("SELECT * FROM empty WHERE id = ?").bind(999).first();
    expect(row).toBeNull();
  });

  it("exec handles multiple statements", async () => {
    await db.exec(`
      CREATE TABLE a (id INTEGER PRIMARY KEY);
      CREATE TABLE b (id INTEGER PRIMARY KEY);
    `);
    // verify both tables exist
    await db.prepare("INSERT INTO a (id) VALUES (?)").bind(1).run();
    await db.prepare("INSERT INTO b (id) VALUES (?)").bind(1).run();
    const rowA = await db.prepare("SELECT * FROM a WHERE id = ?").bind(1).first();
    const rowB = await db.prepare("SELECT * FROM b WHERE id = ?").bind(1).first();
    expect(rowA).toEqual({ id: 1 });
    expect(rowB).toEqual({ id: 1 });
  });
});
