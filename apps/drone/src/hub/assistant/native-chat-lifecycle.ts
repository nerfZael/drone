import type { HubAssistantService } from '../assistant';
import type { BlipAssistantHost } from './blip-assistant-host';

export type NativeChatIdentity = {
  id: string;
  droneId: string;
  chatName: string;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  agentPermissionMode?: string;
  approvalPolicy?: string;
};

export class NativeChatLifecycle {
  constructor(
    private readonly assistantService: HubAssistantService,
    private readonly blipAssistantHost: BlipAssistantHost,
  ) {}

  ensure(input: NativeChatIdentity) {
    return this.assistantService.ensureNativeThread({
      ...input,
      title: input.chatName,
    });
  }

  async clone(input: NativeChatIdentity & {
    sourceId: string;
    sourceChatName: string;
    sourceProvider?: string;
    sourceModel?: string;
    sourceThinkingLevel?: string;
  }): Promise<void> {
    await this.ensure({
      id: input.sourceId,
      droneId: input.droneId,
      chatName: input.sourceChatName,
      provider: input.sourceProvider,
      model: input.sourceModel,
      thinkingLevel: input.sourceThinkingLevel,
    });
    await this.assistantService.cloneNativeThread({
      sourceId: input.sourceId,
      id: input.id,
      droneId: input.droneId,
      chatName: input.chatName,
    });
    try {
      await this.blipAssistantHost.cloneThread(input.sourceId, input.id);
    } catch (error) {
      await this.assistantService.deleteThread(input.id).catch(() => {});
      throw error;
    }
  }

  rename(input: Pick<NativeChatIdentity, 'id' | 'droneId' | 'chatName'>) {
    return this.ensure(input);
  }

  async delete(id: string): Promise<void> {
    await Promise.all([
      this.blipAssistantHost.deleteThread(id),
      this.assistantService.deleteThread(id),
    ]);
  }

  async deleteMany(ids: Iterable<string>): Promise<void> {
    for (const id of ids) await this.delete(id);
  }
}
