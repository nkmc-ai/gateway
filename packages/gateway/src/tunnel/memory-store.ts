import type { TunnelRecord, TunnelStore } from "./types.js";

export class MemoryTunnelStore implements TunnelStore {
  private records = new Map<string, TunnelRecord>();

  async get(id: string): Promise<TunnelRecord | null> {
    return this.records.get(id) ?? null;
  }

  async getByAgent(agentId: string): Promise<TunnelRecord | null> {
    for (const record of this.records.values()) {
      if (record.agentId === agentId && record.status === "active") {
        return record;
      }
    }
    return null;
  }

  async put(record: TunnelRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(): Promise<TunnelRecord[]> {
    return Array.from(this.records.values());
  }
}
