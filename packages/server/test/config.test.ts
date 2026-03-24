import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";

/**
 * Save and restore env vars touched by loadConfig() so tests are isolated.
 */
const ENV_KEYS = [
  "NKMC_PORT",
  "NKMC_HOST",
  "NKMC_DATA_DIR",
  "NKMC_ADMIN_TOKEN",
  "NKMC_ENCRYPTION_KEY",
  "NKMC_GATEWAY_PRIVATE_KEY",
  "NKMC_GATEWAY_PUBLIC_KEY",
] as const;

describe("loadConfig()", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const v = saved.get(key);
      if (v === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = v;
      }
    }
  });

  it("returns sensible defaults when no env vars or config file are present", () => {
    const cfg = loadConfig();
    expect(cfg.port).toBe(9090);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.dataDir).toMatch(/\.nkmc[/\\]server$/);
    expect(cfg.adminToken).toBeUndefined();
  });

  it("NKMC_PORT overrides default port", () => {
    process.env.NKMC_PORT = "4321";
    const cfg = loadConfig();
    expect(cfg.port).toBe(4321);
  });

  it("NKMC_DATA_DIR overrides default data directory", () => {
    const tmp = join(tmpdir(), `nkmc-test-${randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
    try {
      process.env.NKMC_DATA_DIR = tmp;
      const cfg = loadConfig();
      expect(cfg.dataDir).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("NKMC_ADMIN_TOKEN env var is picked up", () => {
    process.env.NKMC_ADMIN_TOKEN = "super-secret";
    const cfg = loadConfig();
    expect(cfg.adminToken).toBe("super-secret");
  });

  it("reads values from config.json when env vars are absent", () => {
    const tmp = join(tmpdir(), `nkmc-test-${randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
    try {
      writeFileSync(
        join(tmp, "config.json"),
        JSON.stringify({ port: "7777", adminToken: "from-file" }),
      );
      process.env.NKMC_DATA_DIR = tmp;
      const cfg = loadConfig();
      expect(cfg.port).toBe(7777);
      expect(cfg.adminToken).toBe("from-file");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("env vars take precedence over config.json values", () => {
    const tmp = join(tmpdir(), `nkmc-test-${randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
    try {
      writeFileSync(
        join(tmp, "config.json"),
        JSON.stringify({ port: "7777", adminToken: "from-file" }),
      );
      process.env.NKMC_DATA_DIR = tmp;
      process.env.NKMC_PORT = "8888";
      process.env.NKMC_ADMIN_TOKEN = "from-env";
      const cfg = loadConfig();
      expect(cfg.port).toBe(8888);
      expect(cfg.adminToken).toBe("from-env");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignores a malformed config.json", () => {
    const tmp = join(tmpdir(), `nkmc-test-${randomUUID()}`);
    mkdirSync(tmp, { recursive: true });
    try {
      writeFileSync(join(tmp, "config.json"), "NOT VALID JSON {{{");
      process.env.NKMC_DATA_DIR = tmp;
      const cfg = loadConfig();
      // Should fall back to defaults without throwing
      expect(cfg.port).toBe(9090);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
