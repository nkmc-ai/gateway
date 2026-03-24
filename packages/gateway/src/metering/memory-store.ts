import type { MeterRecord, MeterQuery, MeterStore } from "./types.js";

export class MemoryMeterStore implements MeterStore {
  private records: MeterRecord[] = [];

  async record(entry: MeterRecord): Promise<void> {
    this.records.push(entry);
  }

  async query(filter: MeterQuery): Promise<MeterRecord[]> {
    return this.records.filter((r) => this.matches(r, filter));
  }

  async sum(filter: MeterQuery): Promise<{ total: number; currency: string }> {
    const matched = this.records.filter((r) => this.matches(r, filter));
    const total = matched.reduce((acc, r) => acc + r.cost, 0);
    const currency = matched[0]?.currency ?? "USDC";
    return { total, currency };
  }

  private matches(record: MeterRecord, filter: MeterQuery): boolean {
    if (filter.domain && record.domain !== filter.domain) return false;
    if (filter.agentId && record.agentId !== filter.agentId) return false;
    if (filter.developerId && record.developerId !== filter.developerId) return false;
    if (filter.from && record.timestamp < filter.from) return false;
    if (filter.to && record.timestamp > filter.to) return false;
    return true;
  }
}
