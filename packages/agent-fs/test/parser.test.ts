import { describe, it, expect } from "vitest";
import { parseCommand } from "../src/parser.js";
import type { FsCommand } from "../src/types.js";

describe("parseCommand", () => {
  it("should parse ls command", () => {
    const result = parseCommand("ls /db/users/");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ op: "ls", path: "/db/users/" });
  });

  it("should parse cat command", () => {
    const result = parseCommand("cat /db/users/42.json");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ op: "cat", path: "/db/users/42.json" });
  });

  it("should parse rm command", () => {
    const result = parseCommand("rm /db/users/42.json");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ op: "rm", path: "/db/users/42.json" });
  });

  it("should parse write command with JSON data", () => {
    const result = parseCommand('write /db/users/ \'{"name":"Alice"}\'');
    expect(result.ok).toBe(true);
    const cmd = result.data as FsCommand;
    expect(cmd.op).toBe("write");
    expect(cmd.path).toBe("/db/users/");
    expect(cmd.data).toEqual({ name: "Alice" });
  });

  it("should parse write command without quotes around JSON", () => {
    const result = parseCommand('write /db/users/ {"name":"Bob"}');
    expect(result.ok).toBe(true);
    const cmd = result.data as FsCommand;
    expect(cmd.data).toEqual({ name: "Bob" });
  });

  it("should parse grep command with quoted pattern", () => {
    const result = parseCommand('grep "active" /db/users/');
    expect(result.ok).toBe(true);
    const cmd = result.data as FsCommand;
    expect(cmd.op).toBe("grep");
    expect(cmd.pattern).toBe("active");
    expect(cmd.path).toBe("/db/users/");
  });

  it("should parse grep command with unquoted pattern", () => {
    const result = parseCommand("grep active /db/users/");
    expect(result.ok).toBe(true);
    const cmd = result.data as FsCommand;
    expect(cmd.pattern).toBe("active");
  });

  it("should strip nk prefix", () => {
    const result = parseCommand("nk ls /db/users/");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ op: "ls", path: "/db/users/" });
  });

  it("should reject unknown operations", () => {
    const result = parseCommand("exec /bin/sh");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARSE_ERROR");
    }
  });

  it("should reject path traversal", () => {
    const result = parseCommand("cat /../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARSE_ERROR");
    }
  });

  it("should reject missing path", () => {
    const result = parseCommand("ls");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARSE_ERROR");
    }
  });

  it("should reject invalid JSON in write", () => {
    const result = parseCommand("write /db/users/ not-json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARSE_ERROR");
    }
  });

  it("should handle paths with query params", () => {
    const result = parseCommand("ls /db/users/?sort=name");
    expect(result.ok).toBe(true);
    const cmd = result.data as FsCommand;
    expect(cmd.path).toBe("/db/users/?sort=name");
  });
});
