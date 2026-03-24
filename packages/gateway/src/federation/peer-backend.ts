import type { FsBackend } from "@nkmc/agent-fs";
import type { PeerClient, PeerExecResult } from "./peer-client.js";
import type { PeerGateway } from "./types.js";

/**
 * An FsBackend that delegates filesystem operations to a peer gateway.
 * Used when the local gateway doesn't have credentials for a domain
 * but a federated peer does.
 */
export class PeerBackend implements FsBackend {
  constructor(
    private client: PeerClient,
    private peer: PeerGateway,
    private agentId: string,
  ) {}

  async list(path: string): Promise<string[]> {
    const result = await this.execOnPeer(`ls ${path}`);
    return (result.data as string[]) ?? [];
  }

  async read(path: string): Promise<unknown> {
    const result = await this.execOnPeer(`cat ${path}`);
    return result.data;
  }

  async write(path: string, data: unknown): Promise<{ id: string }> {
    const result = await this.execOnPeer(
      `write ${path} ${JSON.stringify(data)}`,
    );
    return (result.data as { id: string }) ?? { id: "" };
  }

  async remove(path: string): Promise<void> {
    await this.execOnPeer(`rm ${path}`);
  }

  async search(path: string, pattern: string): Promise<unknown[]> {
    const result = await this.execOnPeer(`grep ${pattern} ${path}`);
    return (result.data as unknown[]) ?? [];
  }

  private async execOnPeer(command: string): Promise<PeerExecResult> {
    const result = await this.client.exec(this.peer, {
      command,
      agentId: this.agentId,
    });

    if (!result.ok) {
      if (result.paymentRequired) {
        throw new Error(
          `Payment required: ${result.paymentRequired.price} ${result.paymentRequired.currency}`,
        );
      }
      throw new Error(result.error ?? "Peer execution failed");
    }

    return result;
  }
}
