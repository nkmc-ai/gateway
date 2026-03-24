// packages/gateway/src/registry/skill-parser.ts
import { parse as parseYaml } from "yaml";
import type { ServiceRecord, EndpointRecord, EndpointPricing } from "./types.js";

export interface ParseOptions {
  isFirstParty?: boolean;
}

export function parseSkillMd(
  domain: string,
  raw: string,
  options?: ParseOptions,
): ServiceRecord {
  const { frontmatter, body } = extractFrontmatter(raw);
  const parsed = (parseYaml(frontmatter) as {
    name?: string;
    version?: string;
    roles?: string[];
  }) ?? {};

  const description = extractDescription(body);
  const endpoints = extractEndpoints(body);
  const now = Date.now();

  return {
    domain,
    name: parsed.name ?? domain,
    description,
    version: parsed.version ?? "0.0",
    roles: parsed.roles ?? ["agent"],
    skillMd: raw,
    endpoints,
    isFirstParty: options?.isFirstParty ?? false,
    createdAt: now,
    updatedAt: now,
    status: "active",
    isDefault: true,
  };
}

export function parsePricingAnnotation(text: string): EndpointPricing | undefined {
  // Matches patterns like "0.05 USDC / call", "0.1 USDC / byte"
  const match = text.match(
    /(\d+(?:\.\d+)?)\s+(\w+)\s*\/\s*(call|byte|minute|次)/i,
  );
  if (!match) return undefined;
  return {
    cost: parseFloat(match[1]),
    currency: match[2].toUpperCase(),
    per: match[3] === "次" ? "call" : (match[3].toLowerCase() as "call" | "byte" | "minute"),
  };
}

function extractFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: raw };
  return { frontmatter: match[1], body: match[2] };
}

function extractDescription(body: string): string {
  const lines = body.split("\n");
  let foundTitle = false;
  const descLines: string[] = [];

  for (const line of lines) {
    if (!foundTitle) {
      if (line.startsWith("# ")) foundTitle = true;
      continue;
    }
    if (line.startsWith("## ")) break;
    const trimmed = line.trim();
    if (trimmed === "" && descLines.length > 0) break;
    if (trimmed !== "") descLines.push(trimmed);
  }

  return descLines.join(" ");
}

function extractEndpoints(body: string): EndpointRecord[] {
  const endpoints: EndpointRecord[] = [];
  const lines = body.split("\n");

  let inApiSection = false;
  let currentHeading: string | null = null;

  for (const line of lines) {
    if (line.startsWith("## API")) {
      inApiSection = true;
      continue;
    }
    if (inApiSection && line.startsWith("## ") && !line.startsWith("## API")) {
      break;
    }
    if (!inApiSection) continue;

    if (line.startsWith("### ")) {
      currentHeading = line.slice(4).trim();
      continue;
    }

    const endpointMatch = line.match(/^`(GET|POST|PUT|PATCH|DELETE)\s+(\S+)`/);
    if (endpointMatch && currentHeading) {
      const afterBacktick = line.slice(line.indexOf("`", 1) + 1).trim();
      const pricing = afterBacktick.startsWith("—")
        ? parsePricingAnnotation(afterBacktick.slice(1).trim())
        : undefined;

      endpoints.push({
        method: endpointMatch[1],
        path: endpointMatch[2],
        description: currentHeading,
        ...(pricing ? { pricing } : {}),
      });
      currentHeading = null;
    }
  }

  return endpoints;
}
