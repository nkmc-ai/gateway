import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function createExec(opts?: {
  timeout?: number;
}): (
  tool: string,
  args: string[],
  env: Record<string, string>,
) => Promise<ExecResult> {
  const timeout = opts?.timeout ?? 30_000;

  return (tool, args, env) => {
    return new Promise((resolve) => {
      const child = spawn(tool, args, {
        env: { ...process.env, ...env },
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data: Buffer) => {
        stdout += data;
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data;
      });

      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      child.on("error", (err) => {
        resolve({ stdout: "", stderr: err.message, exitCode: 1 });
      });
    });
  };
}
