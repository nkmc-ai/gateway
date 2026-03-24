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
