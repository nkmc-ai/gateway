import type { ManifestEntry } from "./types.js";

const APIS_GURU_LIST = "https://api.apis.guru/v2/list.json";

export interface ApisGuruOptions {
  /** Max number of APIs to return */
  limit?: number;
  /** Filter by keyword in API title/description */
  filter?: string;
  /** Custom fetch function */
  fetchFn?: typeof globalThis.fetch;
}

interface ApisGuruEntry {
  preferred: string;
  versions: Record<string, {
    swaggerUrl?: string;
    openapiVer?: string;
    info?: { title?: string; description?: string; "x-logo"?: { url?: string } };
  }>;
}

/**
 * Discover APIs from the apis.guru public directory.
 * Returns ManifestEntry[] ready for the onboard pipeline.
 */
export async function discoverFromApisGuru(options?: ApisGuruOptions): Promise<ManifestEntry[]> {
  const fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
  const limit = options?.limit ?? 100;
  const filter = options?.filter?.toLowerCase();

  const resp = await fetchFn(APIS_GURU_LIST);
  if (!resp.ok) throw new Error(`apis.guru fetch failed: ${resp.status}`);
  const catalog = (await resp.json()) as Record<string, ApisGuruEntry>;

  const entries: ManifestEntry[] = [];

  for (const [key, api] of Object.entries(catalog)) {
    if (entries.length >= limit) break;

    const version = api.versions[api.preferred];
    if (!version?.swaggerUrl) continue;

    const title = version.info?.title ?? key;
    const desc = version.info?.description ?? "";

    // Filter by keyword if provided
    if (filter) {
      const text = `${key} ${title} ${desc}`.toLowerCase();
      if (!text.includes(filter)) continue;
    }

    // Extract domain from the key (format: "domain.com:version" or "domain.com")
    const domain = key.split(":")[0];

    entries.push({
      domain,
      specUrl: version.swaggerUrl,
      tags: ["apis-guru", "public"],
    });
  }

  return entries;
}
