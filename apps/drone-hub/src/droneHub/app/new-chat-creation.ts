import type { ChatAgentConfig } from '../../domain';
import type { DesktopNewDronePreferences } from './new-drone-preferences';

export type NewChatConfiguration = {
  agent: ChatAgentConfig;
  model?: string;
  reasoning?: string;
  agentPermissionMode: 'read' | 'write' | 'execute';
  approvalPolicy: 'ask' | 'auto' | 'none';
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
  const agent = resolveAgent(preferences.spawnAgentKey);
  const supportsAccessControls =
    agent.kind === 'native' ||
    (agent.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip'));
  const supportsApprovalPolicy =
    agent.kind === 'native' || (agent.kind === 'builtin' && agent.id === 'codex');
  const model = agent.kind === 'custom' ? '' : String(preferences.spawnModel ?? '').trim();
  const reasoning = supportsAccessControls
    ? String(preferences.spawnReasoning ?? '').trim()
    : '';
  const agentPermissionMode = supportsAccessControls
    ? preferences.spawnAgentPermissionMode
    : 'execute';
  const approvalPolicy =
    !supportsApprovalPolicy ||
    (preferences.spawnApprovalPolicy === 'auto' &&
      !(agent.kind === 'builtin' && agent.id === 'codex'))
      ? 'ask'
      : preferences.spawnApprovalPolicy;

  return {
    agent,
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    agentPermissionMode,
    approvalPolicy,
  };
}
