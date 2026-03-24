import type { FsBackend } from "../types.js";

interface Record {
  id: string;
  [key: string]: unknown;
}

/**
 * In-memory FsBackend for testing and prototyping.
 * Stores data as a map of collections, each collection is a map of id → record.
 */
export class MemoryBackend implements FsBackend {
  private collections = new Map<string, Map<string, Record>>();
  private nextId = 1;

  /** Pre-seed a collection with data */
  seed(collection: string, records: Record[]): void {
    const col = this.getOrCreateCollection(collection);
    for (const record of records) {
      col.set(record.id, { ...record });
    }
  }

  async list(path: string): Promise<string[]> {
    const { collection, id } = this.parsePath(path);

    // List all collections
    if (!collection) {
      return Array.from(this.collections.keys()).map((c) => c + "/");
    }

    // List records in a collection
    if (!id) {
      const col = this.collections.get(collection);
      if (!col) return [];
      return Array.from(col.keys()).map((k) => `${k}.json`);
    }

    // Can't list a single record
    return [];
  }

  async read(path: string): Promise<unknown> {
    const { collection, id } = this.parsePath(path);

    if (!collection) {
      throw new NotFoundError(path);
    }

    const col = this.collections.get(collection);
    if (!col) {
      throw new NotFoundError(path);
    }

    // Special paths
    if (id === "_schema") {
      return this.getSchema(collection);
    }
    if (id === "_count") {
      return { count: col.size };
    }

    if (!id) {
      // Reading a collection returns all records
      return Array.from(col.values());
    }

    const record = col.get(id);
    if (!record) {
      throw new NotFoundError(path);
    }
    return record;
  }

  async write(path: string, data: unknown): Promise<{ id: string }> {
    const { collection, id } = this.parsePath(path);

    if (!collection) {
      throw new Error("Cannot write to root");
    }

    const col = this.getOrCreateCollection(collection);
    const record = data as Record;

    if (id) {
      // Update existing record
      const existing = col.get(id);
      if (!existing) {
        throw new NotFoundError(path);
      }
      const updated = { ...existing, ...record, id };
      col.set(id, updated);
      return { id };
    }

    // Create new record
    const newId = record.id ?? String(this.nextId++);
    const newRecord = { ...record, id: newId };
    col.set(newId, newRecord);
    return { id: newId };
  }

  async remove(path: string): Promise<void> {
    const { collection, id } = this.parsePath(path);

    if (!collection || !id) {
      throw new Error("Cannot remove a collection, specify a record path");
    }

    const col = this.collections.get(collection);
    if (!col || !col.has(id)) {
      throw new NotFoundError(path);
    }
    col.delete(id);
  }

  async search(path: string, pattern: string): Promise<unknown[]> {
    const { collection } = this.parsePath(path);

    if (!collection) {
      throw new Error("grep requires a collection path");
    }

    const col = this.collections.get(collection);
    if (!col) return [];

    const results: unknown[] = [];
    for (const record of col.values()) {
      const json = JSON.stringify(record);
      if (json.includes(pattern)) {
        results.push(record);
      }
    }
    return results;
  }

  private parsePath(path: string): { collection?: string; id?: string } {
    // Remove leading slash, trailing slash, and .json extension
    const cleaned = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!cleaned) return {};

    const parts = cleaned.split("/");
    const collection = parts[0];
    let id = parts[1];

    // Strip .json extension from id
    if (id?.endsWith(".json")) {
      id = id.slice(0, -5);
    }

    return { collection, id };
  }

  private getOrCreateCollection(name: string): Map<string, Record> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map();
      this.collections.set(name, col);
    }
    return col;
  }

  private getSchema(collection: string): object {
    const col = this.collections.get(collection);
    if (!col || col.size === 0) {
      return { collection, fields: [] };
    }
    // Infer schema from first record
    const first = col.values().next().value!;
    const fields = Object.entries(first).map(([name, value]) => ({
      name,
      type: typeof value,
    }));
    return { collection, fields };
  }
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`Not found: ${path}`);
    this.name = "NotFoundError";
  }
}
