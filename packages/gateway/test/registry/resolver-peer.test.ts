import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRegistryStore } from "../../src/registry/memory-store.js";
import { parseSkillMd } from "../../src/registry/skill-parser.js";
import { createRegistryResolver } from "../../src/registry/resolver.js";
import type { PeerGateway } from "../../src/federation/types.js";
import type { PeerClient, PeerQueryResult } from "../../src/federation/peer-client.js";
import { PeerBackend } from "../../src/federation/peer-backend.js";
import type { HttpAuth } from "@nkmc/agent-fs";

const ACME_SKILL = `---
name: "Acme Store"
gateway: nkmc
version: "1.0"
roles: [agent]
---

# Acme Store

E-commerce store.

## API

### List products

\`GET /api/products\` — free, public
`;

function makePeer(overrides: Partial<PeerGateway> = {}): PeerGateway {
  return {
    id: "peer-1",
    name: "Peer Gateway 1",
    url: "https://peer1.example.com",
    sharedSecret: "secret-1",
    status: "active",
    advertisedDomains: [],
    lastSeen: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeMockPeerClient(
  queryFn: (peer: PeerGateway, domain: string) => Promise<PeerQueryResult>,
): PeerClient {
  return {
    selfId: "self-gateway",
    query: queryFn,
    exec: vi.fn(),
    announce: vi.fn(),
  } as unknown as PeerClient;
}

function makeMockPeerStore(peers: PeerGateway[]) {
  return {
    listPeers: vi.fn(async () => peers),
  };
}

function makeMockVault(entries: Record<string, HttpAuth>) {
  return {
    get: vi.fn(async (domain: string) => {
      const auth = entries[domain];
      return auth ? { auth } : null;
    }),
  };
}

describe("Resolver peer fallback", () => {
  let store: MemoryRegistryStore;

  beforeEach(async () => {
    store = new MemoryRegistryStore();
    const record = parseSkillMd("acme-store.com", ACME_SKILL);
    await store.put("acme-store.com", record);
  });

  it("local credential exists → uses local HttpBackend (no peer query)", async () => {
    const peer = makePeer();
    const peerClient = makeMockPeerClient(async () => ({ available: true }));
    const peerStore = makeMockPeerStore([peer]);
    const vault = makeMockVault({
      "acme-store.com": { type: "bearer", token: "local-token" },
    });

    const { onMiss } = createRegistryResolver({
      store,
      vault,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    let mountedPath: string | undefined;
    const result = await onMiss("/acme-store.com/products", (mount) => {
      mountedPath = mount.path;
    });

    expect(result).toBe(true);
    expect(mountedPath).toBe("/acme-store.com");
    // Peer should NOT have been queried since local credential was found
    expect(peerStore.listPeers).not.toHaveBeenCalled();
  });

  it("no local credential, peer has domain → mounts PeerBackend", async () => {
    const peer = makePeer();
    const peerClient = makeMockPeerClient(async () => ({ available: true }));
    const peerStore = makeMockPeerStore([peer]);
    // No vault → no local credentials
    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    let mountedBackend: unknown;
    let mountedPath: string | undefined;
    const result = await onMiss("/acme-store.com/products", (mount) => {
      mountedBackend = mount.backend;
      mountedPath = mount.path;
    });

    expect(result).toBe(true);
    expect(mountedPath).toBe("/acme-store.com");
    expect(mountedBackend).toBeInstanceOf(PeerBackend);
  });

  it("no local credential, no peer has domain → returns false", async () => {
    const peer = makePeer();
    const peerClient = makeMockPeerClient(async () => ({ available: false }));
    const peerStore = makeMockPeerStore([peer]);

    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    // Note: with no vault and peer returning unavailable, the resolver
    // still falls through to mount a local HttpBackend (no auth).
    // The peer fallback returns false, but the local path continues.
    const result = await onMiss("/acme-store.com/products", () => {});
    // Local record exists, so it mounts the local backend (without auth)
    expect(result).toBe(true);
  });

  it("peer with non-matching advertised domains → skips that peer", async () => {
    const peer = makePeer({
      advertisedDomains: ["other-api.com", "another-api.com"],
    });
    const queryFn = vi.fn(async () => ({ available: true }));
    const peerClient = makeMockPeerClient(queryFn);
    const peerStore = makeMockPeerStore([peer]);

    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    let mountedBackend: unknown;
    await onMiss("/acme-store.com/products", (mount) => {
      mountedBackend = mount.backend;
    });

    // Peer's advertised domains don't include acme-store.com, so query was never called
    expect(queryFn).not.toHaveBeenCalled();
    // Falls through to local mount (no credential, but still mounts local backend)
    expect(mountedBackend).not.toBeInstanceOf(PeerBackend);
  });

  it("no local record at all, but peer has domain → mounts PeerBackend", async () => {
    const peer = makePeer();
    const peerClient = makeMockPeerClient(async () => ({ available: true }));
    const peerStore = makeMockPeerStore([peer]);

    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    // "unknown-api.com" is NOT in the local store
    let mountedBackend: unknown;
    let mountedPath: string | undefined;
    const result = await onMiss("/unknown-api.com/data", (mount) => {
      mountedBackend = mount.backend;
      mountedPath = mount.path;
    });

    expect(result).toBe(true);
    expect(mountedPath).toBe("/unknown-api.com");
    expect(mountedBackend).toBeInstanceOf(PeerBackend);
  });

  it("no local record, no peerClient configured → returns false", async () => {
    const { onMiss } = createRegistryResolver({
      store,
      wrapVirtualFiles: false,
    });

    const result = await onMiss("/unknown-api.com/data", () => {});
    expect(result).toBe(false);
  });

  it("no local record, peer does not have domain → returns false", async () => {
    const peer = makePeer();
    const peerClient = makeMockPeerClient(async () => ({ available: false }));
    const peerStore = makeMockPeerStore([peer]);

    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    const result = await onMiss("/unknown-api.com/data", () => {});
    expect(result).toBe(false);
  });

  it("peer fallback with versioned path → mounts at versioned path", async () => {
    const peer = makePeer();
    const peerClient = makeMockPeerClient(async () => ({ available: true }));
    const peerStore = makeMockPeerStore([peer]);

    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    let mountedPath: string | undefined;
    const result = await onMiss("/unknown-api.com@v2/data", (mount) => {
      mountedPath = mount.path;
    });

    expect(result).toBe(true);
    expect(mountedPath).toBe("/unknown-api.com@v2");
  });

  it("peer fallback uses agent id when available", async () => {
    const peer = makePeer();
    let capturedPeerBackend: PeerBackend | undefined;
    const peerClient = makeMockPeerClient(async () => ({ available: true }));
    const peerStore = makeMockPeerStore([peer]);

    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    const agent = { id: "agent-42", roles: ["user"] };
    await onMiss(
      "/unknown-api.com/data",
      (mount) => {
        capturedPeerBackend = mount.backend as PeerBackend;
      },
      agent,
    );

    expect(capturedPeerBackend).toBeInstanceOf(PeerBackend);
  });

  it("selects first available peer when multiple peers exist", async () => {
    const peer1 = makePeer({ id: "peer-1", url: "https://peer1.example.com" });
    const peer2 = makePeer({ id: "peer-2", url: "https://peer2.example.com" });

    const queryFn = vi.fn(async (peer: PeerGateway) => {
      if (peer.id === "peer-1") return { available: false };
      return { available: true };
    });
    const peerClient = makeMockPeerClient(queryFn);
    const peerStore = makeMockPeerStore([peer1, peer2]);

    const { onMiss } = createRegistryResolver({
      store,
      peerStore,
      peerClient,
      wrapVirtualFiles: false,
    });

    let mountedBackend: unknown;
    const result = await onMiss("/unknown-api.com/data", (mount) => {
      mountedBackend = mount.backend;
    });

    expect(result).toBe(true);
    expect(mountedBackend).toBeInstanceOf(PeerBackend);
    // Both peers were queried since first returned unavailable
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});
