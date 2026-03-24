import { describe, it, expect } from "vitest";
import { createExec } from "../src/exec.js";

describe("createExec()", () => {
  const exec = createExec({ timeout: 10_000 });

  it("executes a simple command and returns stdout", async () => {
    const result = await exec("echo", ["hello"], {});
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("injects env vars into the spawned process", async () => {
    const result = await exec(
      "node",
      ["-e", "process.stdout.write(process.env.TEST_VAR)"],
      { TEST_VAR: "injected-value" },
    );
    expect(result.stdout).toBe("injected-value");
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode=0 on success", async () => {
    const result = await exec("node", ["-e", "process.exit(0)"], {});
    expect(result.exitCode).toBe(0);
  });

  it("returns non-zero exitCode on failure", async () => {
    const result = await exec("node", ["-e", "process.exit(42)"], {});
    expect(result.exitCode).toBe(42);
  });

  it("captures stderr output", async () => {
    const result = await exec(
      "node",
      ["-e", 'process.stderr.write("oops")'],
      {},
    );
    expect(result.stderr).toBe("oops");
  });

  it("captures both stdout and stderr together", async () => {
    const result = await exec(
      "node",
      ["-e", 'process.stdout.write("out"); process.stderr.write("err")'],
      {},
    );
    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
    expect(result.exitCode).toBe(0);
  });

  it("returns error when command does not exist", async () => {
    const result = await exec("nonexistent-binary-xyz", [], {});
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
