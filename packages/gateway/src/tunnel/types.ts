export interface TunnelRecord {
  id: string;
  agentId: string;
  tunnelId: string; // Cloudflare tunnel ID
  publicUrl: string; // https://{id}.tunnel.example.com
  status: "active" | "deleted";
  createdAt: number;
  /** Domains this gateway has credentials for (for discovery) */
  advertisedDomains: string[];
  /** Display name for the gateway */
  gatewayName?: string;
  /** Last heartbeat timestamp (ms since epoch) */
  lastSeen: number;
}

export interface TunnelStore {
  get(id: string): Promise<TunnelRecord | null>;
  getByAgent(agentId: string): Promise<TunnelRecord | null>;
  put(record: TunnelRecord): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<TunnelRecord[]>;
}

/** Interface for Cloudflare Tunnel API operations */
export interface TunnelProvider {
  create(name: string, hostname: string): Promise<{ tunnelId: string; tunnelToken: string }>;
  delete(tunnelId: string): Promise<void>;
}
