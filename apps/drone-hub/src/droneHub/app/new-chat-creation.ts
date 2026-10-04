import { chatAgentSupportsReasoning } from '@drone/assistant-chat';
import type { ChatAgentConfig } from '../../domain';
import type { DesktopNewDronePreferences } from './new-drone-preferences';

// Existing drones keep their repository preferences even if that repository
// is no longer registered in the new-drone picker.
export function newChatPreferencesRepoPath(drone: { repoPath?: string | null; repoAttached?: boolean | null }): string {
  return drone.repoAttached === false ? '' : String(drone.repoPath ?? '').trim();
}

export type NewChatConfiguration = {
  agent: ChatAgentConfig;
  model?: string;
  reasoning?: string;
  agentPermissionMode: 'read' | 'write' | 'execute';
  approvalPolicy?: 'ask' | 'auto' | 'none';
};

export function buildNewChatCreatePayload(input: {
  name: string;
  draft?: boolean;
  copyFromChat?: string;
  mode?: 'copy-config' | 'fork';
}): Record<string, unknown> {
  const copyFromChat = String(input.copyFromChat ?? '').trim();
  return {
    name: input.name,
    ...(copyFromChat ? { copyFromChat, mode: input.mode === 'fork' ? 'fork' : 'copy-config' } : {}),
    ...(input.draft === true ? { draft: true } : {}),
  };
}

export function buildNewChatConfiguration(
  preferences: DesktopNewDronePreferences,
  resolveAgent: (key: string) => ChatAgentConfig,
): NewChatConfiguration {
  return newChatConfigurationForAgent(resolveAgent(preferences.spawnAgentKey), {
    model: preferences.spawnModel,
    reasoning: preferences.spawnReasoning,
    permissionMode: preferences.spawnAgentPermissionMode,
    approvalPolicy: preferences.spawnApprovalPolicy,
  });
}

/** A new chat's settings for this agent, leaving out what the agent cannot take. */
export function newChatConfigurationForAgent(
  agent: ChatAgentConfig,
  settings: {
    model?: string | null;
    reasoning?: string | null;
    permissionMode: NewChatConfiguration['agentPermissionMode'];
    approvalPolicy: NonNullable<NewChatConfiguration['approvalPolicy']>;
  },
): NewChatConfiguration {
  const supportsAccessControls =
    agent.kind === 'native' ||
    (agent.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip'));
  const supportsApprovalPolicy =
    agent.kind === 'native' || (agent.kind === 'builtin' && agent.id === 'codex');
  const model = agent.kind === 'custom' ? '' : String(settings.model ?? '').trim();
  const reasoning = chatAgentSupportsReasoning(agent)
    ? String(settings.reasoning ?? '').trim()
    : '';
  const agentPermissionMode = supportsAccessControls
    ? settings.permissionMode
    : 'execute';
  const approvalPolicy =
    !supportsApprovalPolicy ||
    (settings.approvalPolicy === 'auto' &&
      !(agent.kind === 'builtin' && agent.id === 'codex'))
      ? 'ask'
      : settings.approvalPolicy;

  return {
    agent,
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    agentPermissionMode,
    // Even the default policy is rejected when explicitly sent for other agents.
    ...(supportsApprovalPolicy ? { approvalPolicy } : {}),
  };
}
