export interface MeterRecord {
  id: string;
  timestamp: number;
  domain: string;
  version: string;
  endpoint: string;
  agentId: string;
  developerId?: string;
  cost: number;
  currency: string;
}

export interface MeterQuery {
  domain?: string;
  agentId?: string;
  developerId?: string;
  from?: number;
  to?: number;
}

export interface MeterStore {
  record(entry: MeterRecord): Promise<void>;
  query(filter: MeterQuery): Promise<MeterRecord[]>;
  sum(filter: MeterQuery): Promise<{ total: number; currency: string }>;
}
