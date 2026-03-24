import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import {
  RpcBackend,
  JsonRpcTransport,
  RpcError,
  type RpcResource,
} from "../src/backends/rpc.js";

// --- Hex utilities ---

function toHex(value: string | number): string {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  return "0x" + n.toString(16);
}

function fromHex(hex: string): number {
  return parseInt(hex, 16);
}

// --- Mock JSON-RPC server ---

const mockBlocks: Record<string, object> = {};
for (let i = 0; i <= 16; i++) {
  mockBlocks[toHex(i)] = {
    number: toHex(i),
    hash: `0x${"ab".repeat(16)}${i.toString(16).padStart(4, "0")}`,
    transactions: [],
  };
}

function handleRpcMethod(
  method: string,
  params: unknown[],
): { result?: unknown; error?: { code: number; message: string } } {
  switch (method) {
    case "eth_blockNumber":
      return { result: "0x10" }; // 16

    case "eth_getBlockByNumber": {
      const blockNum = params[0] as string;
      const block = mockBlocks[blockNum];
      return { result: block ?? null };
    }

    case "eth_getTransactionReceipt": {
      const txHash = params[0] as string;
      if (txHash === "0x0000") return { result: null };
      return {
        result: {
          transactionHash: txHash,
          blockNumber: "0x10",
          status: "0x1",
          gasUsed: "0x5208",
        },
      };
    }

    case "eth_getBalance":
      return { result: "0xde0b6b3a7640000" }; // 1 ETH in wei

    case "eth_getCode": {
      const addr = params[0] as string;
      if (addr === "0xeoa") return { result: "0x" };
      return { result: "0x6060604052" };
    }

    case "eth_chainId":
      return { result: "0x1" };

    default:
      return { error: { code: -32601, message: "Method not found" } };
  }
}

let server: Server;
let baseUrl: string;

function createMockRpcServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        const body = JSON.parse(raw);

        // Batch request
        if (Array.isArray(body)) {
          const results = body.map((req: { id: number; method: string; params: unknown[] }) => {
            const { result, error } = handleRpcMethod(req.method, req.params ?? []);
            if (error) {
              return { jsonrpc: "2.0", id: req.id, error };
            }
            return { jsonrpc: "2.0", id: req.id, result };
          });
          res.writeHead(200);
          res.end(JSON.stringify(results));
          return;
        }

        // Single request
        const { result, error } = handleRpcMethod(body.method, body.params ?? []);
        if (error) {
          res.writeHead(200);
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      });
    });

    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://localhost:${port}` });
    });
  });
}

// --- EVM Resource configuration ---

function createEvmResources(): RpcResource[] {
  return [
    {
      name: "blocks",
      idField: "number",
      methods: {
        read: {
          method: "eth_getBlockByNumber",
          params: (ctx) => [toHex(ctx.id!), false],
        },
        list: {
          method: "eth_blockNumber",
          params: () => [],
        },
      },
      transform: {
        list: (result) => {
          const latest = fromHex(result as string);
          return Array.from({ length: 10 }, (_, i) => `${latest - i}.json`);
        },
        read: (data) => ({
          ...(data as object),
          _number: fromHex((data as { number: string }).number),
        }),
      },
    },
    {
      name: "txs",
      idField: "hash",
      methods: {
        read: {
          method: "eth_getTransactionReceipt",
          params: (ctx) => [ctx.id!],
        },
      },
    },
    {
      name: "balances",
      methods: {
        read: {
          method: "eth_getBalance",
          params: (ctx) => [ctx.id!, "latest"],
        },
      },
      transform: {
        read: (data) => ({
          balance: data,
          balanceWei: fromHex(data as string),
          balanceEth: fromHex(data as string) / 1e18,
        }),
      },
    },
    {
      name: "code",
      methods: {
        read: {
          method: "eth_getCode",
          params: (ctx) => [ctx.id!, "latest"],
        },
      },
      transform: {
        read: (data) => ({
          code: data,
          isContract: (data as string) !== "0x",
        }),
      },
    },
    {
      name: "chain",
      methods: {
        read: {
          method: "eth_chainId",
          params: () => [],
        },
      },
      transform: {
        read: (data) => ({
          chainId: data,
          chainIdDecimal: fromHex(data as string),
        }),
      },
    },
  ];
}

// --- Tests ---

describe("RpcBackend (EVM)", () => {
  let backend: RpcBackend;
  let transport: JsonRpcTransport;

  beforeAll(async () => {
    const mock = await createMockRpcServer();
    server = mock.server;
    baseUrl = mock.baseUrl;

    transport = new JsonRpcTransport({ url: baseUrl });
    backend = new RpcBackend({
      transport,
      resources: createEvmResources(),
    });
  });

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  // 1. Root listing
  it("should list all resources at root", async () => {
    const result = await backend.list("/");
    expect(result).toContain("blocks/");
    expect(result).toContain("txs/");
    expect(result).toContain("balances/");
    expect(result).toContain("code/");
    expect(result).toContain("chain/");
  });

  // 2. Blocks list
  it("should list recent blocks", async () => {
    const result = await backend.list("/blocks/");
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("16.json");
    expect(result[9]).toBe("7.json");
  });

  // 3. Block read
  it("should read a block by number", async () => {
    const result = (await backend.read("/blocks/16.json")) as {
      number: string;
      _number: number;
    };
    expect(result._number).toBe(16);
    expect(result.number).toBe("0x10");
  });

  // 4. Block not found
  it("should throw NotFoundError for non-existent block", async () => {
    await expect(backend.read("/blocks/999.json")).rejects.toThrow("Not found");
  });

  // 5. Transaction read
  it("should read a transaction receipt", async () => {
    const result = (await backend.read("/txs/0xabc.json")) as {
      transactionHash: string;
      status: string;
    };
    expect(result.transactionHash).toBe("0xabc");
    expect(result.status).toBe("0x1");
  });

  // 6. Transaction not found
  it("should throw NotFoundError for non-existent transaction", async () => {
    await expect(backend.read("/txs/0x0000.json")).rejects.toThrow("Not found");
  });

  // 7. No list method
  it("should return empty array for resources without list method", async () => {
    const result = await backend.list("/txs/");
    expect(result).toEqual([]);
  });

  // 8. Balance read
  it("should read balance with ETH conversion", async () => {
    const result = (await backend.read("/balances/0xdead.json")) as {
      balanceEth: number;
    };
    expect(result.balanceEth).toBe(1);
  });

  // 9. Contract code
  it("should detect contract code", async () => {
    const result = (await backend.read("/code/0xcontract.json")) as {
      isContract: boolean;
    };
    expect(result.isContract).toBe(true);
  });

  // 10. EOA detection
  it("should detect EOA (no code)", async () => {
    const result = (await backend.read("/code/0xeoa.json")) as {
      isContract: boolean;
    };
    expect(result.isContract).toBe(false);
  });

  // 11. Chain info
  it("should read chain info", async () => {
    const result = (await backend.read("/chain/info.json")) as {
      chainIdDecimal: number;
    };
    expect(result.chainIdDecimal).toBe(1);
  });

  // 12. Unknown resource
  it("should throw NotFoundError for unknown resource", async () => {
    await expect(backend.read("/unknown/1.json")).rejects.toThrow("Not found");
  });

  // 13. RPC error
  it("should throw RpcError for unknown RPC method", async () => {
    await expect(
      transport.call("eth_nonExistent", []),
    ).rejects.toThrow(RpcError);
  });

  // 14. Search fallback
  it("should search blocks via client-side filter", async () => {
    // eth_blockNumber returns "0x10" which contains "0x1"
    const results = await backend.search("/blocks/", "0x1");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // 15. AgentFs integration
  describe("integration with AgentFs", async () => {
    const { AgentFs } = await import("../src/agent-fs.js");

    it("should work as a mount in AgentFs", async () => {
      const agentFs = new AgentFs({
        mounts: [{ path: "/eth", backend }],
      });

      const lsRoot = await agentFs.execute("ls /");
      expect(lsRoot.ok).toBe(true);
      if (lsRoot.ok) {
        expect(lsRoot.data).toContain("eth/");
      }

      const lsEth = await agentFs.execute("ls /eth/");
      expect(lsEth.ok).toBe(true);
      if (lsEth.ok) {
        expect(lsEth.data).toContain("blocks/");
      }

      const catBlock = await agentFs.execute("cat /eth/blocks/16.json");
      expect(catBlock.ok).toBe(true);
      if (catBlock.ok) {
        expect((catBlock.data as { _number: number })._number).toBe(16);
      }

      const catBalance = await agentFs.execute(
        "cat /eth/balances/0xdead.json",
      );
      expect(catBalance.ok).toBe(true);
      if (catBalance.ok) {
        expect((catBalance.data as { balanceEth: number }).balanceEth).toBe(1);
      }
    });
  });

  // Batch transport test
  describe("JsonRpcTransport batch", () => {
    it("should handle batch requests", async () => {
      const results = await transport.batch!([
        { method: "eth_chainId", params: [] },
        { method: "eth_blockNumber", params: [] },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0]).toBe("0x1");
      expect(results[1]).toBe("0x10");
    });
  });
});
