import type { PeerGateway } from "./types.js";

export interface PeerQueryResult {
  available: boolean;
  pricing?: { mode: string; amount?: number };
}

export interface PeerExecResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  paymentRequired?: {
    price: number;
    currency: string;
    payTo: string;
    network: string;
  };
}

/**
 * Client for communicating with peer gateways in the federation.
 * Each method sends authenticated HTTP requests to the peer's URL.
 */
export class PeerClient {
  constructor(private selfId: string) {}

  /**
   * Query a peer to check if it has credentials for a domain
   * and its lending rules allow access.
   */
  async query(peer: PeerGateway, domain: string): Promise<PeerQueryResult> {
    try {
      const res = await fetch(`${peer.url}/federation/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peer-Id": this.selfId,
          Authorization: `Bearer ${peer.sharedSecret}`,
        },
        body: JSON.stringify({ domain }),
      });

      if (!res.ok) {
        return { available: false };
      }

      const body = (await res.json()) as {
        available: boolean;
        pricing?: { mode: string; amount?: number };
      };
      return {
        available: body.available,
        ...(body.pricing ? { pricing: body.pricing } : {}),
      };
    } catch {
      return { available: false };
    }
  }

  /**
   * Execute a command on a peer gateway on behalf of an agent.
   * Handles 402 Payment Required responses with X-402-* headers.
   */
  async exec(
    peer: PeerGateway,
    request: { command: string; agentId: string },
  ): Promise<PeerExecResult> {
    try {
      const res = await fetch(`${peer.url}/federation/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peer-Id": this.selfId,
          Authorization: `Bearer ${peer.sharedSecret}`,
        },
        body: JSON.stringify(request),
      });

      if (res.status === 402) {
        return {
          ok: false,
          paymentRequired: {
            price: Number(res.headers.get("X-402-Price") ?? "0"),
            currency: res.headers.get("X-402-Currency") ?? "USD",
            payTo: res.headers.get("X-402-Pay-To") ?? "",
            network: res.headers.get("X-402-Network") ?? "",
          },
        };
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      }

      const body = (await res.json()) as { data?: unknown };
      return { ok: true, data: body.data };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Announce our available domains to a peer gateway.
   */
  async announce(peer: PeerGateway, domains: string[]): Promise<void> {
    await fetch(`${peer.url}/federation/announce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Peer-Id": this.selfId,
        Authorization: `Bearer ${peer.sharedSecret}`,
      },
      body: JSON.stringify({ domains }),
    });
  }
}
