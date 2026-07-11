import { describe, expect, test } from 'bun:test';

import { summarizeAssistantChatIdle } from '../src/hub/assistant';
import { loadRegistry, updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

async function seedChat(input?: { pendingPrompts?: any[]; turns?: any[] }): Promise<void> {
  const now = new Date().toISOString();
  await updateRegistry((reg: any) => {
    reg.drones = reg.drones ?? {};
    reg.drones['drone-a'] = {
      id: 'drone-a',
      name: 'Drone A',
      createdAt: now,
      chats: {
        default: {
          createdAt: now,
          turns: input?.turns ?? [],
          pendingPrompts: input?.pendingPrompts ?? [],
        },
      },
    };
  });
}

describe('chat idle status used by the MCP service', () => {
  test('reports a completed agent turn as idle', async () => {
    await withTempDroneDataDir('assistant-chat-idle-status-', async () => {
      await seedChat({ turns: [{ id: 'turn-1', prompt: 'work', ok: true, output: 'done', at: new Date().toISOString() }] });
      const status = summarizeAssistantChatIdle(await loadRegistry(), { droneId: 'drone-a', chatName: 'default' });
      expect(status.idle).toBe(true);
      expect(status.reason).toBe('latest_agent_message');
    });
  });

  test('reports queued user work as active', async () => {
    await withTempDroneDataDir('assistant-chat-active-status-', async () => {
      await seedChat({ pendingPrompts: [{ id: 'prompt-1', prompt: 'work', state: 'queued', at: new Date().toISOString() }] });
      const status = summarizeAssistantChatIdle(await loadRegistry(), { droneId: 'drone-a', chatName: 'default' });
      expect(status.idle).toBe(false);
      expect(status.queuedUserMessages).toBe(1);
    });
  });

  test('can require the target chat to exist', async () => {
    await withTempDroneDataDir('assistant-chat-missing-status-', async () => {
      await expect(() => summarizeAssistantChatIdle({}, { droneId: 'missing', chatName: 'default' }, { requireChat: true })).toThrow();
    });
  });
});
