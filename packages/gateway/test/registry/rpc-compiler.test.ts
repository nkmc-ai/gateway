import { describe, it, expect } from "vitest";
import { compileRpcDef } from "../../src/registry/rpc-compiler.js";
import type { RpcManifestDef } from "../../src/onboard/types.js";

const ETH_RPC_DEF: RpcManifestDef = {
  url: "https://rpc.ankr.com/eth",
  convention: "evm",
  methods: [
    { rpcMethod: "eth_blockNumber", description: "Returns the latest block number", resource: "blocks", fsOp: "list" },
    { rpcMethod: "eth_getBlockByNumber", description: "Returns block by number", resource: "blocks", fsOp: "read" },
    { rpcMethod: "eth_getBalance", description: "Returns account balance in wei", resource: "balances", fsOp: "read" },
    { rpcMethod: "eth_gasPrice", description: "Returns current gas price in wei" },
    { rpcMethod: "net_version", description: "Returns the network ID" },
  ],
};

describe("compileRpcDef", () => {
  it("should create a ServiceRecord with RPC endpoints", () => {
    const { record } = compileRpcDef("rpc.ankr.com", ETH_RPC_DEF);
    expect(record.domain).toBe("rpc.ankr.com");
    expect(record.endpoints).toHaveLength(5);
    expect(record.endpoints[0]).toMatchObject({
      method: "RPC",
      path: "eth_blockNumber",
      description: "Returns the latest block number",
    });
  });

  it("should set source type to jsonrpc", () => {
    const { record } = compileRpcDef("rpc.ankr.com", ETH_RPC_DEF);
    expect(record.source?.type).toBe("jsonrpc");
    expect(record.source?.url).toBe("https://rpc.ankr.com/eth");
  });

  it("should populate rpc meta with resources", () => {
    const { record } = compileRpcDef("rpc.ankr.com", ETH_RPC_DEF);
    const rpc = record.source?.rpc;
    expect(rpc).toBeDefined();
    expect(rpc!.rpcUrl).toBe("https://rpc.ankr.com/eth");
    expect(rpc!.convention).toBe("evm");

    // Should have blocks, balances, plus inferred resources for gasPrice and net_version
    const blockRes = rpc!.resources.find((r) => r.name === "blocks");
    expect(blockRes).toBeDefined();
    expect(blockRes!.methods).toEqual({
      list: "eth_blockNumber",
      read: "eth_getBlockByNumber",
    });

    const balanceRes = rpc!.resources.find((r) => r.name === "balances");
    expect(balanceRes).toBeDefined();
    expect(balanceRes!.methods).toEqual({ read: "eth_getBalance" });
  });

  it("should infer resource names from method prefix when not specified", () => {
    const def: RpcManifestDef = {
      url: "https://example.com/rpc",
      methods: [
        { rpcMethod: "eth_getBlockByNumber", description: "Get block" },
        { rpcMethod: "eth_sendTransaction", description: "Send tx" },
      ],
    };
    const { record } = compileRpcDef("example.com", def);
    const rpc = record.source?.rpc;
    expect(rpc!.convention).toBe("raw");
    // eth_getBlockByNumber → "blocks", eth_sendTransaction → "transactions"
    const names = rpc!.resources.map((r) => r.name);
    expect(names).toContain("blocks");
    expect(names).toContain("transactions");
  });

  it("should generate skillMd with RPC Methods section", () => {
    const { skillMd } = compileRpcDef("rpc.ankr.com", ETH_RPC_DEF);
    expect(skillMd).toContain("# rpc.ankr.com");
    expect(skillMd).toContain("## RPC Methods");
    expect(skillMd).toContain("eth_blockNumber");
    expect(skillMd).toContain("eth_getBalance");
    expect(skillMd).toContain("Convention: evm");
  });

  it("should use custom version and isFirstParty", () => {
    const { record } = compileRpcDef("rpc.ankr.com", ETH_RPC_DEF, {
      version: "2.0",
      isFirstParty: true,
    });
    expect(record.version).toBe("2.0");
    expect(record.isFirstParty).toBe(true);
  });

  it("should set status active and isDefault true", () => {
    const { record } = compileRpcDef("rpc.ankr.com", ETH_RPC_DEF);
    expect(record.status).toBe("active");
    expect(record.isDefault).toBe(true);
  });

  it("should handle methods without resource or fsOp", () => {
    const def: RpcManifestDef = {
      url: "https://example.com/rpc",
      methods: [
        { rpcMethod: "net_version", description: "Network version" },
      ],
    };
    const { record } = compileRpcDef("example.com", def);
    expect(record.endpoints).toHaveLength(1);
    expect(record.endpoints[0]).toMatchObject({ method: "RPC", path: "net_version" });
    // "net_version" → action "version" → pluralized "versions"
    const rpc = record.source?.rpc;
    const res = rpc!.resources.find((r) => r.name === "versions");
    expect(res).toBeDefined();
    expect(res!.methods).toEqual({});
  });
});
