import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

  test('uses one immediate draft flow for the shortcut and drone context menu', () => {
    const modelSource = readFileSync(
      new URL('../src/use-drone-hub-app-model.tsx', import.meta.url),
      'utf8',
    );
    const draftCreator = modelSource.slice(
      modelSource.indexOf('const createDraftDroneChat'),
      modelSource.indexOf('const createDroneChatFromShortcut'),
    );
    expect(draftCreator).toContain('createUntitledDroneChat(drone, {');
    expect(draftCreator).toContain('draft: true');
    expect(draftCreator).toContain('selectDroneChat(drone.id, chatName)');

    const shortcutCreator = modelSource.slice(
      modelSource.indexOf('const createDroneChatFromShortcut'),
      modelSource.indexOf('const cloneDroneChatFromShortcut'),
    );
    expect(shortcutCreator).toContain('createDraftDroneChat(currentDrone)');

    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/use-sidebar-interactions.ts', import.meta.url),
      'utf8',
    );
    const contextMenuCreator = sidebarSource.slice(
      sidebarSource.indexOf('const openDroneChatCreate'),
      sidebarSource.indexOf('const startRenameDroneChat'),
    );
    expect(contextMenuCreator).toContain('onCreateDraftDroneChat(drone)');
    expect(contextMenuCreator).not.toContain("mode: 'create'");
  });

  test('keeps remembered configuration visible on the new draft', () => {
    const modelSource = readFileSync(
      new URL('../src/use-drone-hub-app-model.tsx', import.meta.url),
      'utf8',
    );
    const createFlow = modelSource.slice(
      modelSource.indexOf('const createDroneChat ='),
      modelSource.indexOf('const createUntitledDroneChat'),
    );
    expect(createFlow).toContain('resolveCompanionDroneCreationPreferences({');
    expect(createFlow).toContain('rememberStartupSeed([{ id: droneId, name: drone.name }]');
    expect(createFlow).toContain('reasoning: configuration.reasoning ?? null');
    expect(createFlow).toContain('approvalPolicy: configuration.approvalPolicy');

    const rememberedSettingsSync = modelSource.slice(
      modelSource.indexOf("const droneId = String(selectedDrone ?? '').trim();", modelSource.indexOf('lastSyncedCanvasRepoContextRef')),
      modelSource.indexOf('const selectedChatUsesDroneBusyStatus'),
    );
    expect(rememberedSettingsSync).toContain(
      "spawnReasoning: String(effectiveChatInfo.reasoning ?? '').trim()",
    );
    expect(rememberedSettingsSync).toContain(
      "spawnApprovalPolicy: effectiveChatInfo.approvalPolicy ?? 'ask'",
    );
  });
});
