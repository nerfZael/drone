import type { AgentRunFileChangesBaseline } from './run-file-changes';

export type ProvisionedPromptHandoff = {
  droneId: string;
  chatName: string;
  promptId: string;
  droneEntry: any;
  createdAtMs: number;
  fileChangesBaseline?: AgentRunFileChangesBaseline;
};

export class ProvisionedPromptHandoffStore {
  private readonly handoffs = new Map<string, ProvisionedPromptHandoff>();

  constructor(
    private readonly nowMs: () => number = () => Date.now(),
    private readonly maxAgeMs = 15_000,
  ) {}

  private key(droneId: string, chatName: string, promptId: string): string {
    return `${droneId}\u0000${chatName}\u0000${promptId}`;
  }

  register(handoff: ProvisionedPromptHandoff): void {
    this.handoffs.set(this.key(handoff.droneId, handoff.chatName, handoff.promptId), handoff);
  }

  peekForChat(input: { droneId: string; chatName: string }): ProvisionedPromptHandoff | null {
    const prefix = `${input.droneId}\u0000${input.chatName}\u0000`;
    for (const [key, handoff] of this.handoffs) {
      if (!key.startsWith(prefix)) continue;
      if (this.nowMs() - handoff.createdAtMs > this.maxAgeMs) {
        this.handoffs.delete(key);
        continue;
      }
      return handoff;
    }
    return null;
  }

  take(input: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): ProvisionedPromptHandoff | null {
    const key = this.key(input.droneId, input.chatName, input.promptId);
    const handoff = this.handoffs.get(key) ?? null;
    this.handoffs.delete(key);
    if (!handoff || this.nowMs() - handoff.createdAtMs > this.maxAgeMs) return null;
    return handoff;
  }

  clear(): void {
    this.handoffs.clear();
  }
}
