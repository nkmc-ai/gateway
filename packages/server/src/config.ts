import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  adminToken?: string;
  encryptionKey?: string;
  gatewayPrivateKey?: string;
  gatewayPublicKey?: string;
}

const DEFAULT_DATA_DIR = join(homedir(), ".nkmc", "server");

export function loadConfig(): ServerConfig {
  const dataDir = process.env.NKMC_DATA_DIR ?? DEFAULT_DATA_DIR;

  // Load config file if it exists
  const configPath = join(dataDir, "config.json");
  let fileConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // Ignore malformed config files
    }
  }

  function get(envKey: string, fileKey: string): string | undefined {
    return process.env[envKey] ?? (fileConfig[fileKey] as string | undefined);
  }

  return {
    port: parseInt(process.env.NKMC_PORT ?? (fileConfig.port as string | undefined) ?? "9090", 10),
    host: process.env.NKMC_HOST ?? (fileConfig.host as string | undefined) ?? "0.0.0.0",
    dataDir,
    adminToken: get("NKMC_ADMIN_TOKEN", "adminToken"),
    encryptionKey: get("NKMC_ENCRYPTION_KEY", "encryptionKey"),
    gatewayPrivateKey: get("NKMC_GATEWAY_PRIVATE_KEY", "gatewayPrivateKey"),
    gatewayPublicKey: get("NKMC_GATEWAY_PUBLIC_KEY", "gatewayPublicKey"),
  };
}
