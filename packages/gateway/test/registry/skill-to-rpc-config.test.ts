import { describe, it, expect } from "vitest";
import { skillToRpcConfig } from "../../src/registry/skill-to-config.js";
import type { RpcSourceMeta } from "../../src/registry/types.js";

const EVM_META: RpcSourceMeta = {
  rpcUrl: "https://rpc.ankr.com/eth",
  convention: "evm",
  resources: [
    {
      name: "blocks",
      methods: { list: "eth_blockNumber", read: "eth_getBlockByNumber" },
    },
    {
      name: "balances",
      methods: { read: "eth_getBalance" },
    },
  ],
};

const CRUD_META: RpcSourceMeta = {
  rpcUrl: "https://example.com/rpc",
  convention: "crud",
  resources: [
    {
      name: "users",
      idField: "id",
      methods: {
        list: "user.list",
        read: "user.get",
        create: "user.create",
        write: "user.update",
        remove: "user.delete",
      },
    },
  ],
};

const RAW_META: RpcSourceMeta = {
  rpcUrl: "https://example.com/rpc",
  convention: "raw",
  resources: [
    {
      name: "info",
      methods: { read: "getInfo" },
    },
  ],
};

describe("skillToRpcConfig", () => {
  it("should return resources matching meta input", () => {
    const { resources } = skillToRpcConfig(EVM_META);
    expect(resources).toHaveLength(2);
    expect(resources[0].name).toBe("blocks");
    expect(resources[1].name).toBe("balances");
  });

  it("should rebuild RPC methods with params callbacks", () => {
    const { resources } = skillToRpcConfig(EVM_META);
    const blocks = resources[0];
    expect(blocks.methods.list).toBeDefined();
    expect(blocks.methods.read).toBeDefined();
    expect(blocks.methods.list!.method).toBe("eth_blockNumber");
    expect(blocks.methods.read!.method).toBe("eth_getBlockByNumber");
  });

  it("should generate evm params for read (hex encoding)", () => {
    const { resources } = skillToRpcConfig(EVM_META);
    const blocks = resources[0];
    // numeric id → hex
    const params = blocks.methods.read!.params({ id: "100" });
    expect(params).toEqual(["0x64", "latest"]);
    // hex id stays as-is
    const params2 = blocks.methods.read!.params({ id: "0xabc" });
    expect(params2).toEqual(["0xabc", "latest"]);
  });

  it("should generate evm params for list (no params for eth_blockNumber)", () => {
    const { resources } = skillToRpcConfig(EVM_META);
    const blocks = resources[0];
    const params = blocks.methods.list!.params({});
    expect(params).toEqual([]);
  });

  it("should add evm transforms for blocks (hex block number → recent block list)", () => {
    const { resources } = skillToRpcConfig(EVM_META);
    const blocks = resources[0];
    expect(blocks.transform).toBeDefined();
    expect(blocks.transform!.list).toBeDefined();

    // eth_blockNumber returns a hex string → transform to last 10 block .json files
    const result = blocks.transform!.list!("0xa") as string[];
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("10.json");
    expect(result[9]).toBe("1.json");
  });

  it("should add evm transforms for balances", () => {
    const { resources } = skillToRpcConfig(EVM_META);
    const balances = resources[1];
    expect(balances.transform).toBeDefined();
    expect(balances.transform!.read).toBeDefined();

    const result = balances.transform!.read!("0xde0b6b3a7640000");
    expect(result).toEqual({ wei: "0xde0b6b3a7640000", raw: "0xde0b6b3a7640000" });
  });

  it("should generate crud params correctly", () => {
    const { resources } = skillToRpcConfig(CRUD_META);
    const users = resources[0];

    expect(users.methods.list!.params({})).toEqual([]);
    expect(users.methods.read!.params({ id: "123" })).toEqual(["123"]);
    expect(users.methods.create!.params({ data: { name: "test" } })).toEqual([{ name: "test" }]);
    expect(users.methods.write!.params({ id: "123", data: { name: "updated" } })).toEqual(["123", { name: "updated" }]);
    expect(users.methods.remove!.params({ id: "123" })).toEqual(["123"]);
  });

  it("should preserve idField from meta", () => {
    const { resources } = skillToRpcConfig(CRUD_META);
    expect(resources[0].idField).toBe("id");
  });

  it("should handle raw convention with pass-through params", () => {
    const { resources } = skillToRpcConfig(RAW_META);
    const info = resources[0];
    expect(info.methods.read!.method).toBe("getInfo");
    // With id
    expect(info.methods.read!.params({ id: "abc" })).toEqual(["abc"]);
    // With data
    expect(info.methods.read!.params({ data: { x: 1 } })).toEqual([{ x: 1 }]);
    // Empty
    expect(info.methods.read!.params({})).toEqual([]);
  });

  it("should not add transforms for non-evm conventions", () => {
    const { resources } = skillToRpcConfig(CRUD_META);
    expect(resources[0].transform).toBeUndefined();

    const { resources: rawResources } = skillToRpcConfig(RAW_META);
    expect(rawResources[0].transform).toBeUndefined();
  });
});
