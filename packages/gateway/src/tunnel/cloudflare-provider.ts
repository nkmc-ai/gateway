import type { TunnelProvider } from "./types.js";

const CF_API = "https://api.cloudflare.com/client/v4";

interface CfApiResponse<T = unknown> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

export class CloudflareTunnelProvider implements TunnelProvider {
  constructor(
    private accountId: string,
    private apiToken: string,
    private tunnelDomain: string, // e.g. "tunnel.example.com"
    private zoneId: string, // Cloudflare zone ID for DNS records
  ) {}

  async create(
    name: string,
    hostname: string,
  ): Promise<{ tunnelId: string; tunnelToken: string }> {
    // 1. Generate a random tunnel secret (32 bytes, base64-encoded)
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const tunnelSecret = btoa(String.fromCharCode(...secretBytes));

    // 2. Create tunnel via CF API
    const tunnelRes = await this.cfFetch<{ id: string }>(
      `/accounts/${this.accountId}/cfd_tunnel`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          tunnel_secret: tunnelSecret,
        }),
      },
    );
    const tunnelId = tunnelRes.id;

    try {
      // 3. Create DNS CNAME record: hostname -> tunnelId.cfargotunnel.com
      await this.cfFetch(`/zones/${this.zoneId}/dns_records`, {
        method: "POST",
        body: JSON.stringify({
          type: "CNAME",
          name: hostname,
          content: `${tunnelId}.cfargotunnel.com`,
          proxied: true,
        }),
      });

      // 4. Create tunnel ingress config
      await this.cfFetch(
        `/accounts/${this.accountId}/cfd_tunnel/${tunnelId}/configurations`,
        {
          method: "PUT",
          body: JSON.stringify({
            config: {
              ingress: [
                { hostname, service: "http://localhost:9090" },
                { service: "http_status:404" },
              ],
            },
          }),
        },
      );

      // 5. Get tunnel token
      const tokenRes = await this.cfFetch<string>(
        `/accounts/${this.accountId}/cfd_tunnel/${tunnelId}/token`,
      );

      return { tunnelId, tunnelToken: tokenRes };
    } catch (err) {
      // Clean up tunnel if subsequent steps fail
      await this.cfFetch(
        `/accounts/${this.accountId}/cfd_tunnel/${tunnelId}?cascade=true`,
        { method: "DELETE" },
      ).catch(() => {}); // best-effort cleanup
      throw err;
    }
  }

  async delete(tunnelId: string): Promise<void> {
    // 1. Clean up DNS records pointing to this tunnel
    const dnsRecords = await this.cfFetch<Array<{ id: string; content: string }>>(
      `/zones/${this.zoneId}/dns_records?type=CNAME&content=${tunnelId}.cfargotunnel.com`,
    );
    for (const record of dnsRecords) {
      await this.cfFetch(`/zones/${this.zoneId}/dns_records/${record.id}`, {
        method: "DELETE",
      });
    }

    // 2. Delete tunnel with cascade (cleans up connections)
    await this.cfFetch(
      `/accounts/${this.accountId}/cfd_tunnel/${tunnelId}?cascade=true`,
      { method: "DELETE" },
    );
  }

  private async cfFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    const data = (await res.json()) as CfApiResponse<T>;
    if (!data.success) {
      const msg = data.errors.map((e) => e.message).join(", ");
      throw new Error(`Cloudflare API error: ${msg}`);
    }

    return data.result;
  }
}
