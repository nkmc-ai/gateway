import type { D1Database } from "../d1/types.js";
import type { MeterRecord, MeterQuery, MeterStore } from "./types.js";

const CREATE_METER_RECORDS = `
CREATE TABLE IF NOT EXISTS meter_records (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  domain TEXT NOT NULL,
  version TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  developer_id TEXT,
  cost REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDC'
)`;

const CREATE_METER_INDEX_DOMAIN = `
CREATE INDEX IF NOT EXISTS idx_meter_domain ON meter_records(domain, timestamp)`;

const CREATE_METER_INDEX_AGENT = `
CREATE INDEX IF NOT EXISTS idx_meter_agent ON meter_records(agent_id, timestamp)`;

interface MeterRow {
  id: string;
  timestamp: number;
  domain: string;
  version: string;
  endpoint: string;
  agent_id: string;
  developer_id: string | null;
  cost: number;
  currency: string;
}

export class D1MeterStore implements MeterStore {
  constructor(private db: D1Database) {}

  async initSchema(): Promise<void> {
    await this.db.exec(CREATE_METER_RECORDS);
    await this.db.exec(CREATE_METER_INDEX_DOMAIN);
    await this.db.exec(CREATE_METER_INDEX_AGENT);
  }

  async record(entry: MeterRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO meter_records (id, timestamp, domain, version, endpoint, agent_id, developer_id, cost, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.id,
        entry.timestamp,
        entry.domain,
        entry.version,
        entry.endpoint,
        entry.agentId,
        entry.developerId ?? null,
        entry.cost,
        entry.currency,
      )
      .run();
  }

  async query(filter: MeterQuery): Promise<MeterRecord[]> {
    const { sql, bindings } = this.buildQuery("SELECT *", filter);
    const { results } = await this.db.prepare(sql).bind(...bindings).all<MeterRow>();
    return results.map(rowToRecord);
  }

  async sum(filter: MeterQuery): Promise<{ total: number; currency: string }> {
    const { sql, bindings } = this.buildQuery("SELECT COALESCE(SUM(cost), 0) as total, COALESCE(MIN(currency), 'USDC') as currency", filter);
    const row = await this.db.prepare(sql).bind(...bindings).first<{ total: number; currency: string }>();
    return { total: row?.total ?? 0, currency: row?.currency ?? "USDC" };
  }

  private buildQuery(select: string, filter: MeterQuery): { sql: string; bindings: unknown[] } {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (filter.domain) {
      conditions.push("domain = ?");
      bindings.push(filter.domain);
    }
    if (filter.agentId) {
      conditions.push("agent_id = ?");
      bindings.push(filter.agentId);
    }
    if (filter.developerId) {
      conditions.push("developer_id = ?");
      bindings.push(filter.developerId);
    }
    if (filter.from) {
      conditions.push("timestamp >= ?");
      bindings.push(filter.from);
    }
    if (filter.to) {
      conditions.push("timestamp <= ?");
      bindings.push(filter.to);
    }

    let sql = `${select} FROM meter_records`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY timestamp DESC";

    return { sql, bindings };
  }
}

function rowToRecord(row: MeterRow): MeterRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    domain: row.domain,
    version: row.version,
    endpoint: row.endpoint,
    agentId: row.agent_id,
    ...(row.developer_id ? { developerId: row.developer_id } : {}),
    cost: row.cost,
    currency: row.currency,
  };
}
