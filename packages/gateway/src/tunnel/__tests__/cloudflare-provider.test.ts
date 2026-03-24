import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareTunnelProvider } from "../cloudflare-provider.js";

const CF_API = "https://api.cloudflare.com/client/v4";

const ACCOUNT_ID = "acct-123";
const API_TOKEN = "cf-api-token";
const TUNNEL_DOMAIN = "tunnel.example.com";
const ZONE_ID = "zone-456";

function cfOk<T>(result: T): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], result }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function cfError(code: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, errors: [{ code, message }], result: null }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

describe("CloudflareTunnelProvider", () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockFetch.mockReset();
  });

  function createProvider(): CloudflareTunnelProvider {
    return new CloudflareTunnelProvider(
      ACCOUNT_ID,
      API_TOKEN,
      TUNNEL_DOMAIN,
      ZONE_ID,
    );
  }

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe("create()", () => {
    it("calls correct CF API endpoints in order and returns tunnelId + tunnelToken", async () => {
      const tunnelId = "tun-abc-123";
      const tunnelToken = "eyJ0b2tlbiI6InRlc3QifQ==";

      // 1. Create tunnel
      mockFetch.mockResolvedValueOnce(cfOk({ id: tunnelId }));
      // 2. Create DNS CNAME
      mockFetch.mockResolvedValueOnce(cfOk({ id: "dns-rec-1" }));
      // 3. Configure tunnel ingress
      mockFetch.mockResolvedValueOnce(cfOk({}));
      // 4. Get tunnel token
      mockFetch.mockResolvedValueOnce(cfOk(tunnelToken));

      const provider = createProvider();
      const result = await provider.create("nkmc-agent-1", "a1.tunnel.example.com");

      expect(result).toEqual({ tunnelId, tunnelToken });

      // Verify call order
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Call 1: Create tunnel
      const [url1, opts1] = mockFetch.mock.calls[0];
      expect(url1).toBe(`${CF_API}/accounts/${ACCOUNT_ID}/cfd_tunnel`);
      expect(opts1?.method).toBe("POST");
      const body1 = JSON.parse(opts1?.body as string);
      expect(body1.name).toBe("nkmc-agent-1");
      expect(body1.tunnel_secret).toBeDefined();
      expect(opts1?.headers).toMatchObject({
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      });

      // Call 2: Create DNS CNAME
      const [url2, opts2] = mockFetch.mock.calls[1];
      expect(url2).toBe(`${CF_API}/zones/${ZONE_ID}/dns_records`);
      expect(opts2?.method).toBe("POST");
      const body2 = JSON.parse(opts2?.body as string);
      expect(body2).toEqual({
        type: "CNAME",
        name: "a1.tunnel.example.com",
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
      });

      // Call 3: Configure tunnel ingress
      const [url3, opts3] = mockFetch.mock.calls[2];
      expect(url3).toBe(
        `${CF_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`,
      );
      expect(opts3?.method).toBe("PUT");
      const body3 = JSON.parse(opts3?.body as string);
      expect(body3.config.ingress).toEqual([
        { hostname: "a1.tunnel.example.com", service: "http://localhost:9090" },
        { service: "http_status:404" },
      ]);

      // Call 4: Get tunnel token
      const [url4] = mockFetch.mock.calls[3];
      expect(url4).toBe(
        `${CF_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
      );
    });

    it("cleans up tunnel on DNS creation failure", async () => {
      const tunnelId = "tun-cleanup-1";

      // 1. Create tunnel succeeds
      mockFetch.mockResolvedValueOnce(cfOk({ id: tunnelId }));
      // 2. DNS creation fails
      mockFetch.mockResolvedValueOnce(cfError(1003, "DNS record already exists"));
      // 3. Cleanup: cascade delete
      mockFetch.mockResolvedValueOnce(cfOk({}));

      const provider = createProvider();

      await expect(
        provider.create("nkmc-cleanup", "c1.tunnel.example.com"),
      ).rejects.toThrow("Cloudflare API error: DNS record already exists");

      // Verify cleanup was called
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [cleanupUrl, cleanupOpts] = mockFetch.mock.calls[2];
      expect(cleanupUrl).toBe(
        `${CF_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}?cascade=true`,
      );
      expect(cleanupOpts?.method).toBe("DELETE");
    });

    it("cleans up tunnel on ingress config failure", async () => {
      const tunnelId = "tun-cleanup-2";

      // 1. Create tunnel succeeds
      mockFetch.mockResolvedValueOnce(cfOk({ id: tunnelId }));
      // 2. DNS creation succeeds
      mockFetch.mockResolvedValueOnce(cfOk({ id: "dns-1" }));
      // 3. Ingress config fails
      mockFetch.mockResolvedValueOnce(cfError(1004, "Invalid config"));
      // 4. Cleanup: cascade delete
      mockFetch.mockResolvedValueOnce(cfOk({}));

      const provider = createProvider();

      await expect(
        provider.create("nkmc-cleanup-2", "c2.tunnel.example.com"),
      ).rejects.toThrow("Cloudflare API error: Invalid config");

      // Verify cleanup cascade delete
      expect(mockFetch).toHaveBeenCalledTimes(4);
      const [cleanupUrl, cleanupOpts] = mockFetch.mock.calls[3];
      expect(cleanupUrl).toBe(
        `${CF_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}?cascade=true`,
      );
      expect(cleanupOpts?.method).toBe("DELETE");
    });

    it("still throws original error if cleanup also fails", async () => {
      const tunnelId = "tun-cleanup-3";

      // 1. Create tunnel succeeds
      mockFetch.mockResolvedValueOnce(cfOk({ id: tunnelId }));
      // 2. DNS creation fails
      mockFetch.mockResolvedValueOnce(cfError(1003, "DNS conflict"));
      // 3. Cleanup also fails
      mockFetch.mockResolvedValueOnce(cfError(9999, "Internal error"));

      const provider = createProvider();

      // Should throw the original error, not the cleanup error
      await expect(
        provider.create("nkmc-fail", "f1.tunnel.example.com"),
      ).rejects.toThrow("Cloudflare API error: DNS conflict");
    });
  });

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------

  describe("delete()", () => {
    it("calls cascade delete endpoint", async () => {
      const tunnelId = "tun-del-1";

      // 1. List DNS records -> no matching records
      mockFetch.mockResolvedValueOnce(cfOk([]));
      // 2. Cascade delete
      mockFetch.mockResolvedValueOnce(cfOk({}));

      const provider = createProvider();
      await provider.delete(tunnelId);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify cascade delete call
      const [delUrl, delOpts] = mockFetch.mock.calls[1];
      expect(delUrl).toBe(
        `${CF_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}?cascade=true`,
      );
      expect(delOpts?.method).toBe("DELETE");
    });

    it("cleans up DNS records before deleting tunnel", async () => {
      const tunnelId = "tun-del-dns";

      // 1. List DNS records -> 2 matching records
      mockFetch.mockResolvedValueOnce(
        cfOk([
          { id: "dns-rec-a", content: `${tunnelId}.cfargotunnel.com` },
          { id: "dns-rec-b", content: `${tunnelId}.cfargotunnel.com` },
        ]),
      );
      // 2. Delete DNS record A
      mockFetch.mockResolvedValueOnce(cfOk({}));
      // 3. Delete DNS record B
      mockFetch.mockResolvedValueOnce(cfOk({}));
      // 4. Cascade delete tunnel
      mockFetch.mockResolvedValueOnce(cfOk({}));

      const provider = createProvider();
      await provider.delete(tunnelId);

      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify DNS lookup
      const [listUrl] = mockFetch.mock.calls[0];
      expect(listUrl).toBe(
        `${CF_API}/zones/${ZONE_ID}/dns_records?type=CNAME&content=${tunnelId}.cfargotunnel.com`,
      );

      // Verify DNS deletes
      const [dnsDelUrlA] = mockFetch.mock.calls[1];
      expect(dnsDelUrlA).toBe(`${CF_API}/zones/${ZONE_ID}/dns_records/dns-rec-a`);

      const [dnsDelUrlB] = mockFetch.mock.calls[2];
      expect(dnsDelUrlB).toBe(`${CF_API}/zones/${ZONE_ID}/dns_records/dns-rec-b`);

      // Verify tunnel cascade delete
      const [tunDelUrl] = mockFetch.mock.calls[3];
      expect(tunDelUrl).toBe(
        `${CF_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}?cascade=true`,
      );
    });
  });
});
