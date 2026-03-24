import type { AgentContext, FsBackend, FsError, Mount } from "./types.js";

export interface ResolvedMount {
  mount: Mount;
  /** The path relative to the mount point (e.g. "/users/42.json") */
  relativePath: string;
}

export class MountResolver {
  private mounts: Mount[] = [];

  /** Optional async callback invoked when resolve() finds no matching mount.
   *  Should return true if a new mount was added. */
  onMiss?: (path: string, agent?: AgentContext) => Promise<boolean>;

  /** Register a mount point */
  add(mount: Mount): void {
    // Ensure path starts with / and has no trailing slash
    const normalized = mount.path.replace(/\/+$/, "") || "/";
    this.mounts.push({ ...mount, path: normalized });
    // Sort by path length descending so longer (more specific) mounts match first
    this.mounts.sort((a, b) => b.path.length - a.path.length);
  }

  /** Resolve a virtual path to a mount and its relative path */
  resolve(virtualPath: string): ResolvedMount | null {
    for (const mount of this.mounts) {
      if (
        virtualPath === mount.path ||
        virtualPath.startsWith(mount.path + "/")
      ) {
        const relativePath = virtualPath.slice(mount.path.length) || "/";
        return { mount, relativePath };
      }
    }
    return null;
  }

  /** Async resolve: tries sync resolve first, then calls onMiss if set. */
  async resolveAsync(virtualPath: string, agent?: AgentContext): Promise<ResolvedMount | null> {
    const result = this.resolve(virtualPath);
    if (result) return result;

    if (this.onMiss) {
      const added = await this.onMiss(virtualPath, agent);
      if (added) {
        return this.resolve(virtualPath);
      }
    }

    return null;
  }

  /** Check if a role has permission for an operation on a mount */
  checkPermission(
    mount: Mount,
    op: "read" | "write",
    roles: string[],
  ): FsError | null {
    const allowed = mount.permissions?.[op];
    // No permissions defined = open access
    if (!allowed) return null;

    const hasRole = roles.some((r) => allowed.includes(r));
    if (!hasRole) {
      return {
        code: "PERMISSION_DENIED",
        message: `Requires one of [${allowed.join(", ")}] for ${op} on ${mount.path}`,
      };
    }
    return null;
  }

  /** List all registered mount paths (used by "ls /") */
  listMounts(): string[] {
    return this.mounts.map((m) => m.path);
  }

  /** Get the backend for a mount path */
  getBackend(mountPath: string): FsBackend | undefined {
    const mount = this.mounts.find((m) => m.path === mountPath);
    return mount?.backend;
  }
}
