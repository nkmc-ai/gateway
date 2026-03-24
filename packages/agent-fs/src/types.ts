/** The 5 filesystem operations */
export type FsOp = "ls" | "cat" | "write" | "rm" | "grep";

/** A parsed command from the LLM */
export interface FsCommand {
  op: FsOp;
  path: string;
  data?: unknown;
  pattern?: string;
}

/** Result of a filesystem operation */
export type FsResult =
  | { ok: true; data: unknown }
  | { ok: false; error: FsError };

/** Error types */
export type FsError =
  | { code: "PARSE_ERROR"; message: string }
  | { code: "INVALID_PATH"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "PERMISSION_DENIED"; message: string }
  | { code: "NO_MOUNT"; message: string }
  | { code: "BACKEND_ERROR"; message: string };

/** Agent identity context passed through the call chain */
export interface AgentContext {
  id: string;
  roles: string[];
}

/** Access role for permissions */
export type AccessRole = "public" | "agent" | "premium" | "admin" | string;

/** Mount point configuration — maps a virtual path to a backend */
export interface Mount {
  path: string;
  backend: FsBackend;
  permissions?: {
    read?: AccessRole[];
    write?: AccessRole[];
  };
}

/** The interface every backend must implement */
export interface FsBackend {
  list(path: string): Promise<string[]>;
  read(path: string): Promise<unknown>;
  write(path: string, data: unknown): Promise<{ id: string }>;
  remove(path: string): Promise<void>;
  search(path: string, pattern: string): Promise<unknown[]>;
}
