import { describe, expect, test } from 'bun:test';

import { createPlaybookRuntime } from '../src/hub/playbook-runtime';

describe('playbook runtime scheduler', () => {
  test('includes canonical native-chat messages in drone activity', () => {
    const runtime = createPlaybookRuntime({
      getFleetWorkflowStore: async () => {
        throw new Error('canonical workflow store unavailable in compatibility test');
      },
      hubLog: () => {},
      loadRegistry: async () => ({}),
      nowIso: () => new Date().toISOString(),
      updateRegistry: async (update: (registry: any) => void) => update({}),
    } as any);

    try {
      expect(
        runtime.summarizeDroneActivity(
          {
            createdAt: '2026-07-01T08:00:00.000Z',
            chats: {
              default: { id: 'native-thread', turns: [], pendingPrompts: [] },
            },
          },
          new Map([['native-thread', '2026-07-20T12:34:56.000Z']]),
        ),
      ).toEqual({
        lastActivityAt: '2026-07-20T12:34:56.000Z',
        lastMessageAt: '2026-07-20T12:34:56.000Z',
        lastActivityChat: 'default',
      });
    } finally {
      runtime.closePlaybookRuntime();
    }
  });

  test('runs an immediate queue cycle every time scheduler startup is requested', async () => {
    let registryReads = 0;
    const runtime = createPlaybookRuntime({
      getFleetWorkflowStore: async () => {
        throw new Error('canonical workflow store unavailable in compatibility test');
      },
      hubLog: () => {},
      loadRegistry: async () => {
        registryReads += 1;
        return {};
      },
      nowIso: () => new Date().toISOString(),
      updateRegistry: async (update: (registry: any) => void) => update({}),
    } as any);

    try {
      runtime.startPlaybookRunQueueScheduler();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(registryReads).toBe(1);

      runtime.startPlaybookRunQueueScheduler();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(registryReads).toBe(2);
    } finally {
      runtime.closePlaybookRuntime();
    }
  });
});
