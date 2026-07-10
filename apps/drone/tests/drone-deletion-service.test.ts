import { afterEach, describe, expect, test } from 'bun:test';

import { loadRegistry, updateRegistry } from '../src/host/registry';
import { permanentlyDeleteCanonicalDrone } from '../src/hub/drone-deletion-service';
import {
  archiveChatInStore,
  importArchivedChatsFromRegistry,
  importDroneChatsFromRegistry,
  listArchivedChatsFromStore,
  listChatsFromStore,
  resetTranscriptStoreForTests,
  upsertChatInStore,
  upsertPendingPromptInStore,
  upsertTranscriptTurnInStore,
} from '../src/hub/transcript-store';
import { withTempDroneDataDir } from './test-helpers';

function chat(title: string, includeState = false) {
  return {
    createdAt: '2026-07-10T09:00:00.000Z',
    title,
    agent: { kind: 'builtin', id: 'codex' },
    turns: includeState
      ? [{ id: 'turn-1', at: '2026-07-10T09:00:01.000Z', prompt: 'inspect', ok: true, output: 'done' }]
      : [],
    pendingPrompts: includeState
      ? [{ id: 'prompt-1', at: '2026-07-10T09:00:02.000Z', prompt: 'continue', state: 'queued' }]
      : [],
  };
}

afterEach(async () => {
  await resetTranscriptStoreForTests();
});

describe('permanent drone deletion Bun compatibility fallback', () => {
  test('deletes a real lifecycle and all in-memory chat state before tombstoning the drone', async () => {
    await withTempDroneDataDir('drone-delete-real-', async () => {
      const droneId = 'bun-delete-real';
      await updateRegistry((registry: any) => {
        registry.drones = {
          [droneId]: { id: droneId, name: droneId, runtime: 'container' },
        };
      });
      await upsertChatInStore({ droneId, chatName: 'default', chatEntry: chat('active', true) });
      await upsertChatInStore({ droneId, chatName: 'review', chatEntry: chat('review') });
      await archiveChatInStore({
        droneId,
        chatName: 'review',
        archivedAt: '2026-07-10T09:02:00.000Z',
        deleteAt: '2026-07-11T09:02:00.000Z',
        archiveRetention: '1d',
      });

      const result = await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'real' });
      expect(result).toMatchObject({
        available: true,
        removedLifecycle: true,
        alreadyDeleted: false,
        activeChatsDeleted: 1,
        turnsDeleted: 1,
        archivedChatsDeleted: 1,
        promptsDeleted: 1,
      });
      expect((await loadRegistry()).drones?.[droneId]).toBeUndefined();
      expect(listChatsFromStore({ droneId }).chats).toEqual([]);
      expect(listArchivedChatsFromStore({ droneId }).archivedChats).toEqual([]);

      await importDroneChatsFromRegistry({ droneId, chats: { default: chat('stale active') } });
      await importArchivedChatsFromRegistry({
        droneId,
        archivedChats: {
          review: {
            ...chat('stale archived'),
            archivedAt: '2026-07-10T09:02:00.000Z',
            deleteAt: '2026-07-11T09:02:00.000Z',
            archiveRetention: '1d',
          },
        },
      });
      expect(listChatsFromStore({ droneId }).chats).toEqual([]);
      expect(listArchivedChatsFromStore({ droneId }).archivedChats).toEqual([]);
      await expect(upsertChatInStore({ droneId, chatName: 'default', chatEntry: chat('new') }))
        .rejects.toThrow('permanently deleted drone');
      await expect(upsertTranscriptTurnInStore({
        droneId,
        chatName: 'default',
        turn: { id: 'stale-turn', at: '2026-07-10T09:04:00.000Z', prompt: 'stale' },
      })).rejects.toThrow('permanently deleted drone');
      expect(() => upsertPendingPromptInStore({
        droneId,
        chatName: 'default',
        pending: { id: 'stale-prompt', at: '2026-07-10T09:04:00.000Z', prompt: 'stale', state: 'queued' },
      })).toThrow('permanently deleted drone');
    });
  });

  test('deletes an archived lifecycle through the same compatibility cleanup command', async () => {
    await withTempDroneDataDir('drone-delete-archived-', async () => {
      const droneId = 'bun-delete-archived';
      await updateRegistry((registry: any) => {
        registry.archived = {
          [droneId]: {
            id: droneId,
            name: droneId,
            runtime: 'container',
            archivedAt: '2026-07-10T09:00:00.000Z',
            deleteAt: '2026-07-11T09:00:00.000Z',
            archiveRetention: '1d',
          },
        };
      });
      await upsertChatInStore({ droneId, chatName: 'default', chatEntry: chat('active', true) });

      const result = await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'archived' });
      expect(result).toMatchObject({
        removedLifecycle: true,
        activeChatsDeleted: 1,
        turnsDeleted: 1,
        promptsDeleted: 1,
      });
      expect((await loadRegistry()).archived?.[droneId]).toBeUndefined();
      expect(listChatsFromStore({ droneId }).chats).toEqual([]);
      expect(listArchivedChatsFromStore({ droneId }).archivedChats).toEqual([]);
    });
  });
});
