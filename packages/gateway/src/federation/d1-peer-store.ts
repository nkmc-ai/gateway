import type { D1Database } from "../d1/types.js";
import type { PeerGateway, LendingRule, PeerStore } from "./types.js";

interface PeerRow {
  id: string;
  name: string;
  url: string;
  shared_secret: string;
  status: string;
  advertised_domains: string;
  last_seen: number;
  created_at: number;
}

interface LendingRuleRow {
  domain: string;
  allow: number;
  peers: string;
  pricing: string;
  rate_limit: string | null;
  created_at: number;
  updated_at: number;
}

function rowToPeer(row: PeerRow): PeerGateway {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    sharedSecret: row.shared_secret,
    status: row.status as PeerGateway["status"],
    advertisedDomains: JSON.parse(row.advertised_domains),
    lastSeen: row.last_seen,
    createdAt: row.created_at,
  };
}

function rowToRule(row: LendingRuleRow): LendingRule {
  return {
    domain: row.domain,
    allow: row.allow === 1,
    peers: JSON.parse(row.peers),
    pricing: JSON.parse(row.pricing),
    ...(row.rate_limit ? { rateLimit: JSON.parse(row.rate_limit) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1PeerStore implements PeerStore {
  constructor(private db: D1Database) {}

  async initSchema(): Promise<void> {
    await this.db.exec(`
CREATE TABLE IF NOT EXISTS peers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  shared_secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  advertised_domains TEXT NOT NULL DEFAULT '[]',
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)`);
    await this.db.exec(`
CREATE TABLE IF NOT EXISTS lending_rules (
  domain TEXT PRIMARY KEY,
  allow INTEGER NOT NULL DEFAULT 1,
  peers TEXT NOT NULL DEFAULT '"*"',
  pricing TEXT NOT NULL DEFAULT '{"mode":"free"}',
  rate_limit TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);
  }

  async getPeer(id: string): Promise<PeerGateway | null> {
    const row = await this.db
      .prepare("SELECT * FROM peers WHERE id = ?")
      .bind(id)
      .first<PeerRow>();
    return row ? rowToPeer(row) : null;
  }

  async putPeer(peer: PeerGateway): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO peers (id, name, url, shared_secret, status, advertised_domains, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        peer.id,
        peer.name,
        peer.url,
        peer.sharedSecret,
        peer.status,
        JSON.stringify(peer.advertisedDomains),
        peer.lastSeen,
        peer.createdAt,
      )
      .run();
  }

  async deletePeer(id: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM peers WHERE id = ?")
      .bind(id)
      .run();
  }

  async listPeers(): Promise<PeerGateway[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM peers WHERE status = 'active'")
      .all<PeerRow>();
    return results.map(rowToPeer);
  }

  async updateLastSeen(id: string, timestamp: number): Promise<void> {
    await this.db
      .prepare("UPDATE peers SET last_seen = ? WHERE id = ?")
      .bind(timestamp, id)
      .run();
  }

  async getRule(domain: string): Promise<LendingRule | null> {
    const row = await this.db
      .prepare("SELECT * FROM lending_rules WHERE domain = ?")
      .bind(domain)
      .first<LendingRuleRow>();
    return row ? rowToRule(row) : null;
  }

  async putRule(rule: LendingRule): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO lending_rules (domain, allow, peers, pricing, rate_limit, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        rule.domain,
        rule.allow ? 1 : 0,
        JSON.stringify(rule.peers),
        JSON.stringify(rule.pricing),
        rule.rateLimit ? JSON.stringify(rule.rateLimit) : null,
        rule.createdAt,
        rule.updatedAt,
      )
      .run();
  }

  async deleteRule(domain: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM lending_rules WHERE domain = ?")
      .bind(domain)
      .run();
  }

  async listRules(): Promise<LendingRule[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM lending_rules")
      .all<LendingRuleRow>();
    return results.map(rowToRule);
  }
}
