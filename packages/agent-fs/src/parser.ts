import type { FsCommand, FsOp, FsResult } from "./types.js";

const VALID_OPS = new Set<FsOp>(["ls", "cat", "write", "rm", "grep"]);

/**
 * Parse a raw command string into a structured FsCommand.
 *
 * Accepted formats:
 *   ls /path
 *   cat /path
 *   write /path '{"key":"value"}'
 *   write /path {"key":"value"}
 *   rm /path
 *   grep pattern /path
 */
export function parseCommand(input: string): FsResult {
  const trimmed = input.trim();

  // Strip optional "nk " prefix
  const normalized = trimmed.startsWith("nk ")
    ? trimmed.slice(3).trim()
    : trimmed;

  // Split into tokens: op, then the rest
  const spaceIdx = normalized.indexOf(" ");
  if (spaceIdx === -1) {
    return {
      ok: false,
      error: {
        code: "PARSE_ERROR",
        message: `Missing path: "${input}"`,
      },
    };
  }

  const op = normalized.slice(0, spaceIdx) as FsOp;
  if (!VALID_OPS.has(op)) {
    return {
      ok: false,
      error: {
        code: "PARSE_ERROR",
        message: `Unknown operation: "${op}". Valid: ls, cat, write, rm, grep`,
      },
    };
  }

  const rest = normalized.slice(spaceIdx + 1).trim();

  if (op === "grep") {
    return parseGrep(rest, input);
  }

  if (op === "write") {
    return parseWrite(rest, input);
  }

  // ls, cat, rm — just need a path
  const path = normalizePath(rest);
  if (!path) {
    return {
      ok: false,
      error: { code: "PARSE_ERROR", message: `Invalid path: "${rest}"` },
    };
  }

  return { ok: true, data: { op, path } satisfies FsCommand };
}

function parseGrep(rest: string, raw: string): FsResult {
  // grep "pattern" /path  OR  grep pattern /path
  let pattern: string;
  let pathPart: string;

  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quote = rest[0];
    const endQuote = rest.indexOf(quote, 1);
    if (endQuote === -1) {
      return {
        ok: false,
        error: { code: "PARSE_ERROR", message: `Unterminated quote in: "${raw}"` },
      };
    }
    pattern = rest.slice(1, endQuote);
    pathPart = rest.slice(endQuote + 1).trim();
  } else {
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx === -1) {
      return {
        ok: false,
        error: { code: "PARSE_ERROR", message: `grep requires pattern and path: "${raw}"` },
      };
    }
    pattern = rest.slice(0, spaceIdx);
    pathPart = rest.slice(spaceIdx + 1).trim();
  }

  const path = normalizePath(pathPart);
  if (!path) {
    return {
      ok: false,
      error: { code: "PARSE_ERROR", message: `Invalid path: "${pathPart}"` },
    };
  }

  return { ok: true, data: { op: "grep", path, pattern } satisfies FsCommand };
}

function parseWrite(rest: string, raw: string): FsResult {
  // write /path '{"key":"value"}'  OR  write /path {"key":"value"}
  // Find where path ends and data begins
  const pathMatch = rest.match(/^(\/\S+)\s+(.+)$/s);
  if (!pathMatch) {
    return {
      ok: false,
      error: { code: "PARSE_ERROR", message: `write requires path and data: "${raw}"` },
    };
  }

  const path = normalizePath(pathMatch[1]);
  if (!path) {
    return {
      ok: false,
      error: { code: "PARSE_ERROR", message: `Invalid path: "${pathMatch[1]}"` },
    };
  }

  let dataStr = pathMatch[2].trim();

  // Strip surrounding quotes if present
  if (
    (dataStr.startsWith("'") && dataStr.endsWith("'")) ||
    (dataStr.startsWith('"') && dataStr.endsWith('"'))
  ) {
    dataStr = dataStr.slice(1, -1);
  }

  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return {
      ok: false,
      error: { code: "PARSE_ERROR", message: `Invalid JSON data: ${dataStr}` },
    };
  }

  return { ok: true, data: { op: "write", path, data } satisfies FsCommand };
}

/** Normalize and validate a path. Returns null if invalid. */
function normalizePath(raw: string): string | null {
  if (!raw.startsWith("/")) return null;

  // Reject path traversal
  if (raw.includes("..")) return null;

  // Remove trailing .json for internal routing (keep it for the user-facing path)
  // Collapse double slashes
  const cleaned = raw.replace(/\/+/g, "/");

  return cleaned;
}
