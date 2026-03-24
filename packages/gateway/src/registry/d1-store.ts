import type { D1Database } from "../d1/types.js";
import type {
  RegistryStore,
  RegistryStats,
  SearchResult,
  ServiceRecord,
  ServiceSummary,
  VersionSummary,
} from "./types.js";

const CREATE_SERVICES = `
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
  auth_mode TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (domain, version)
)`;

const CREATE_SERVICES_DEFAULT_INDEX = `
CREATE INDEX IF NOT EXISTS idx_services_default ON services(domain, is_default)`;

const CREATE_DOMAIN_CHALLENGES = `
CREATE TABLE IF NOT EXISTS domain_challenges (
  domain TEXT PRIMARY KEY,
  challenge_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  expires_at INTEGER NOT NULL
)`;

interface ServiceRow {
  domain: string;
  version: string;
  name: string;
  description: string;
  roles: string;
  skill_md: string;
  endpoints: string;
  is_first_party: number;
  status: string;
  is_default: number;
  source: string | null;
  sunset_date: number | null;
  auth_mode: string | null;
  created_at: number;
  updated_at: number;
}

function rowToRecord(row: ServiceRow): ServiceRecord {
  return {
    domain: row.domain,
    name: row.name,
    description: row.description,
    version: row.version,
    roles: JSON.parse(row.roles),
    skillMd: row.skill_md,
    endpoints: JSON.parse(row.endpoints),
    isFirstParty: row.is_first_party === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as ServiceRecord["status"],
    isDefault: row.is_default === 1,
    ...(row.source ? { source: JSON.parse(row.source) } : {}),
    ...(row.sunset_date ? { sunsetDate: row.sunset_date } : {}),
    ...(row.auth_mode ? { authMode: row.auth_mode as ServiceRecord["authMode"] } : {}),
  };
}

function toSummary(row: ServiceRow): ServiceSummary {
  return {
    domain: row.domain,
    name: row.name,
    description: row.description,
    isFirstParty: row.is_first_party === 1,
  };
}

export class D1RegistryStore implements RegistryStore {
  constructor(private db: D1Database) {}

  async initSchema(): Promise<void> {
    await this.db.exec(CREATE_SERVICES);
    await this.db.exec(CREATE_SERVICES_DEFAULT_INDEX);
    await this.db.exec(CREATE_DOMAIN_CHALLENGES);
  }

  async get(domain: string): Promise<ServiceRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM services WHERE domain = ? AND is_default = 1")
      .bind(domain)
      .first<ServiceRow>();

    return row ? rowToRecord(row) : null;
  }

  async getVersion(domain: string, version: string): Promise<ServiceRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM services WHERE domain = ? AND version = ?")
      .bind(domain, version)
      .first<ServiceRow>();

    return row ? rowToRecord(row) : null;
  }

  async listVersions(domain: string): Promise<VersionSummary[]> {
    const { results } = await this.db
      .prepare(
        "SELECT version, status, is_default, created_at, updated_at FROM services WHERE domain = ? ORDER BY created_at DESC",
      )
      .bind(domain)
      .all<ServiceRow>();

    return results.map((row) => ({
      version: row.version,
      status: row.status as ServiceRecord["status"],
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Max endpoints JSON size before stripping verbose fields (parameters, requestBody, responses). */
  static readonly ENDPOINTS_SIZE_LIMIT = 800_000; // ~800 KB, well under D1's ~1 MB per-value limit

  async put(domain: string, record: ServiceRecord): Promise<void> {
    let endpointsJson = JSON.stringify(record.endpoints);

    // Only strip verbose fields when the full JSON exceeds the size limit.
    // Small APIs keep parameters/requestBody/responses for the explore detail page.
    if (endpointsJson.length > D1RegistryStore.ENDPOINTS_SIZE_LIMIT) {
      const slim = record.endpoints.map(({ method, path, description, price, pricing }) => ({
        method,
        path,
        description,
        ...(price ? { price } : {}),
        ...(pricing ? { pricing } : {}),
      }));
      endpointsJson = JSON.stringify(slim);
    }

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO services
         (domain, version, name, description, roles, skill_md, endpoints, is_first_party, status, is_default, source, sunset_date, auth_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        domain,
        record.version,
        record.name,
        record.description,
        JSON.stringify(record.roles),
        record.skillMd,
        endpointsJson,
        record.isFirstParty ? 1 : 0,
        record.status,
        record.isDefault ? 1 : 0,
        record.source ? JSON.stringify(record.source) : null,
        record.sunsetDate ?? null,
        record.authMode ?? null,
        record.createdAt,
        record.updatedAt,
      )
      .run();
  }

  async delete(domain: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM services WHERE domain = ?")
      .bind(domain)
      .run();
  }

  async list(): Promise<ServiceSummary[]> {
    const { results } = await this.db
      .prepare("SELECT domain, name, description, is_first_party FROM services WHERE is_default = 1")
      .all<ServiceRow>();

    return results.map(toSummary);
  }

  async search(query: string): Promise<SearchResult[]> {
    const pattern = `%${query}%`;
    const { results: rows } = await this.db
      .prepare(
        `SELECT * FROM services
         WHERE is_default = 1 AND (name LIKE ? OR description LIKE ? OR endpoints LIKE ?)`,
      )
      .bind(pattern, pattern, pattern)
      .all<ServiceRow>();

    const q = query.toLowerCase();
    return rows.map((row) => {
      const endpoints = JSON.parse(row.endpoints) as Array<{
        method: string;
        path: string;
        description: string;
      }>;
      const matched = endpoints.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q) ||
          e.path.toLowerCase().includes(q),
      );
      return {
        ...toSummary(row),
        matchedEndpoints: matched.map((e) => ({
          method: e.method,
          path: e.path,
          description: e.description,
        })),
      };
    });
  }

  async stats(): Promise<RegistryStats> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) as service_count, COALESCE(SUM(json_array_length(endpoints)), 0) as endpoint_count
         FROM services WHERE is_default = 1`,
      )
      .first<{ service_count: number; endpoint_count: number }>();

    return {
      serviceCount: row?.service_count ?? 0,
      endpointCount: row?.endpoint_count ?? 0,
    };
  }
}
