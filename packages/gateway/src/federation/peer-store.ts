import type { PeerGateway, LendingRule, PeerStore } from "./types.js";

export class MemoryPeerStore implements PeerStore {
  private peers = new Map<string, PeerGateway>();
  private rules = new Map<string, LendingRule>();

  async getPeer(id: string): Promise<PeerGateway | null> {
    return this.peers.get(id) ?? null;
  }

  async putPeer(peer: PeerGateway): Promise<void> {
    this.peers.set(peer.id, peer);
  }

  async deletePeer(id: string): Promise<void> {
    this.peers.delete(id);
  }

  async listPeers(): Promise<PeerGateway[]> {
    return Array.from(this.peers.values()).filter((p) => p.status === "active");
  }

  async updateLastSeen(id: string, timestamp: number): Promise<void> {
    const peer = this.peers.get(id);
    if (peer) {
      peer.lastSeen = timestamp;
    }
  }

  async getRule(domain: string): Promise<LendingRule | null> {
    return this.rules.get(domain) ?? null;
  }

  async putRule(rule: LendingRule): Promise<void> {
    this.rules.set(rule.domain, rule);
  }

  async deleteRule(domain: string): Promise<void> {
    this.rules.delete(domain);
  }

  async listRules(): Promise<LendingRule[]> {
    return Array.from(this.rules.values());
  }
}
