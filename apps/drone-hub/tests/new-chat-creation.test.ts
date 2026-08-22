import { describe, expect, test } from 'bun:test';
import type { ChatAgentConfig } from '../src/domain';
import {
  buildNewChatConfiguration,
  buildNewChatCreatePayload,
} from '../src/droneHub/app/new-chat-creation';
import type { DesktopNewDronePreferences } from '../src/droneHub/app/new-drone-preferences';

const preferences: DesktopNewDronePreferences = {
  mode: 'with-chat',
  runtime: 'container',
  persistVolume: false,
  spawnAgentKey: 'builtin:codex',
  spawnModel: 'gpt-5.6',
  spawnReasoning: 'high',
  spawnAgentPermissionMode: 'write',
  spawnApprovalPolicy: 'none',
  repoBranchSource: 'host',
  repoCreateRemoteBranch: '',
};

function resolveAgent(key: string): ChatAgentConfig {
  if (key === 'builtin:codex') return { kind: 'builtin', id: 'codex' };
  if (key === 'builtin:cursor') return { kind: 'builtin', id: 'cursor' };
  if (key === 'native') return { kind: 'native' };
  return { kind: 'custom', id: 'custom', label: 'Custom', command: 'custom-agent' };
}

describe('new chat creation defaults', () => {
  test('creates ordinary chats independently and only copies explicit sources', () => {
    expect(buildNewChatCreatePayload({ name: 'review', draft: true })).toEqual({
      name: 'review',
      draft: true,
    });
    expect(
      buildNewChatCreatePayload({ name: 'fork', copyFromChat: 'default', mode: 'fork' }),
    ).toEqual({
      name: 'fork',
      copyFromChat: 'default',
      mode: 'fork',
    });
  });

  test('uses the same remembered agent settings as new-drone creation', () => {
    expect(buildNewChatConfiguration(preferences, resolveAgent)).toEqual({
      agent: { kind: 'builtin', id: 'codex' },
      model: 'gpt-5.6',
      reasoning: 'high',
      agentPermissionMode: 'write',
      approvalPolicy: 'none',
    });
  });

  test('normalizes settings unsupported by the selected agent', () => {
    expect(
      buildNewChatConfiguration(
        {
          ...preferences,
          spawnAgentKey: 'builtin:cursor',
          spawnApprovalPolicy: 'auto',
        },
        resolveAgent,
      ),
    ).toEqual({
      agent: { kind: 'builtin', id: 'cursor' },
      model: 'gpt-5.6',
      agentPermissionMode: 'execute',
      approvalPolicy: 'ask',
    });

    expect(
      buildNewChatConfiguration(
        { ...preferences, spawnAgentKey: 'custom:custom' },
        resolveAgent,
      ),
    ).toEqual({
      agent: { kind: 'custom', id: 'custom', label: 'Custom', command: 'custom-agent' },
      agentPermissionMode: 'execute',
      approvalPolicy: 'ask',
    });
  });
});
