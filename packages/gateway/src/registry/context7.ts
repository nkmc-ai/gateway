export interface Context7Options {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof globalThis.fetch;
}

export interface LibrarySearchResult {
  id: string;
  name: string;
  description?: string;
  totalSnippets?: number;
  trustScore?: number;
}

export class Context7Client {
  private apiKey?: string;
  private baseUrl: string;
  private fetchFn: typeof globalThis.fetch;

  constructor(options?: Context7Options) {
    this.apiKey = options?.apiKey;
    this.baseUrl = options?.baseUrl ?? "https://context7.com/api/v2";
    this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** Search for a library by name. Returns matching library entries. */
  async searchLibraries(libraryName: string, query?: string): Promise<LibrarySearchResult[]> {
    const params = new URLSearchParams({ libraryName });
    if (query) params.set("query", query);

    const resp = await this.fetchFn(`${this.baseUrl}/libs/search?${params}`, {
      headers: this.headers(),
    });
    if (!resp.ok) throw new Error(`Context7 search failed: ${resp.status}`);
    return resp.json() as Promise<LibrarySearchResult[]>;
  }

  /** Query documentation for a specific library. Returns documentation text. */
  async queryDocs(libraryId: string, query: string): Promise<string> {
    const params = new URLSearchParams({ libraryId, query, type: "txt" });

    const resp = await this.fetchFn(`${this.baseUrl}/context?${params}`, {
      headers: this.headers(),
    });
    if (!resp.ok) throw new Error(`Context7 query failed: ${resp.status}`);
    return resp.text();
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }
}
