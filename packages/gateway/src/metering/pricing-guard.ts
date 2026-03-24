import type { EndpointPricing, ServiceRecord } from "../registry/types.js";
import type { MeterStore, MeterRecord } from "./types.js";

export function lookupPricing(
  record: ServiceRecord,
  method: string,
  path: string,
): EndpointPricing | null {
  // Find matching endpoint with pricing
  for (const ep of record.endpoints) {
    if (ep.method.toUpperCase() !== method.toUpperCase()) continue;
    if (matchPath(ep.path, path)) {
      return ep.pricing ?? null;
    }
  }
  return null;
}

export function checkAccess(record: ServiceRecord): { allowed: boolean; reason?: string } {
  if (record.status === "sunset") {
    return { allowed: false, reason: "Service has been sunset" };
  }
  if (record.sunsetDate && record.sunsetDate < Date.now()) {
    return { allowed: false, reason: "Service sunset date has passed" };
  }
  return { allowed: true };
}

export async function meter(
  store: MeterStore,
  opts: {
    domain: string;
    version: string;
    endpoint: string;
    agentId: string;
    developerId?: string;
    pricing: EndpointPricing;
  },
): Promise<MeterRecord> {
  const entry: MeterRecord = {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    domain: opts.domain,
    version: opts.version,
    endpoint: opts.endpoint,
    agentId: opts.agentId,
    developerId: opts.developerId,
    cost: opts.pricing.cost,
    currency: opts.pricing.currency,
  };
  await store.record(entry);
  return entry;
}

function matchPath(pattern: string, actual: string): boolean {
  // Support :param pattern matching
  const patternParts = pattern.split("/").filter(Boolean);
  const actualParts = actual.split("/").filter(Boolean);

  if (patternParts.length !== actualParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) continue; // wildcard
    if (patternParts[i] !== actualParts[i]) return false;
  }

  return true;
}
