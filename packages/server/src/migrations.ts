/**
 * Embedded migration SQL statements.
 * These are copied from migrations/ (repo root) and kept in sync manually.
 * Each migration is idempotent (uses IF NOT EXISTS patterns).
 */

export const migrations: { name: string; sql: string }[] = [
  {
    name: "0001_init",
    sql: `
-- Services registry
CREATE TABLE IF NOT EXISTS services (
  domain TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  roles TEXT,
  skill_md TEXT NOT NULL,
  endpoints TEXT,
  is_first_party INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  is_default INTEGER DEFAULT 1,
  source TEXT,
  sunset_date INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (domain, version)
);

CREATE INDEX IF NOT EXISTS idx_services_default ON services(domain, is_default);

-- Credentials vault
CREATE TABLE IF NOT EXISTS credentials (
  domain TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'pool',
  developer_id TEXT NOT NULL DEFAULT '',
  auth_encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (domain, scope, developer_id)
);

-- Metering records
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
);

CREATE INDEX IF NOT EXISTS idx_meter_domain ON meter_records(domain, timestamp);
CREATE INDEX IF NOT EXISTS idx_meter_agent ON meter_records(agent_id, timestamp);

-- Domain verification challenges
CREATE TABLE IF NOT EXISTS domain_challenges (
  domain TEXT PRIMARY KEY,
  challenge_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  expires_at INTEGER NOT NULL
);

-- Developer-Agent binding
CREATE TABLE IF NOT EXISTS developer_agents (
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_da_agent ON developer_agents(agent_id);

-- Claim tokens (for agent-first onboarding)
CREATE TABLE IF NOT EXISTS claim_tokens (
  token TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    name: "0002_auth_mode",
    sql: `ALTER TABLE services ADD COLUMN auth_mode TEXT`,
  },
  {
    name: "0003_federation",
    sql: `
-- Federation: peer gateways and lending rules

CREATE TABLE IF NOT EXISTS peers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  shared_secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  advertised_domains TEXT NOT NULL DEFAULT '[]',
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lending_rules (
  domain TEXT PRIMARY KEY,
  allow INTEGER NOT NULL DEFAULT 1,
  peers TEXT NOT NULL DEFAULT '"*"',
  pricing TEXT NOT NULL DEFAULT '{"mode":"free"}',
  rate_limit TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
];
