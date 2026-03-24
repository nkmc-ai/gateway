export interface PeerGateway {
  id: string;
  name: string;
  url: string;
  sharedSecret: string;
  status: "active" | "inactive";
  advertisedDomains: string[];
  lastSeen: number;
  createdAt: number;
}

export interface LendingRule {
  domain: string;
  allow: boolean;
  peers: string[] | "*";
  pricing: {
    mode: "free" | "per-request" | "per-token";
    amount?: number;
  };
  rateLimit?: {
    requests: number;
    window: "minute" | "hour" | "day";
  };
  createdAt: number;
  updatedAt: number;
}

export interface PeerStore {
  getPeer(id: string): Promise<PeerGateway | null>;
  putPeer(peer: PeerGateway): Promise<void>;
  deletePeer(id: string): Promise<void>;
  listPeers(): Promise<PeerGateway[]>;
  updateLastSeen(id: string, timestamp: number): Promise<void>;

  getRule(domain: string): Promise<LendingRule | null>;
  putRule(rule: LendingRule): Promise<void>;
  deleteRule(domain: string): Promise<void>;
  listRules(): Promise<LendingRule[]>;
}
