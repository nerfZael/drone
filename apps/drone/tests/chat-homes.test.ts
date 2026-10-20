import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { ChatHomes, chatHomesDirectory } from '../src/hub/chat-homes';
import {
  archiveChatInStore,
  commitPermanentDroneDeletionInStore,
  deleteActiveChatFromStore,
  deleteArchivedChatFromStore,
  listChatIdentitiesFromStore,
  readChatMetadataFromStore,
  resetTranscriptStoreForTests,
  restoreArchivedChatInStore,
  subscribeChatRemovals,
  upsertChatInStore,
} from '../src/hub/transcript-store';
import { withTempDroneDataDir } from './test-helpers';

// Other test files leave chats in the in-memory store.
beforeEach(async () => {
  await resetTranscriptStoreForTests();
});
afterEach(async () => {
  await resetTranscriptStoreForTests();
});

describe('chat homes follow their chats', () => {
  test('kept while archived or renamed, deleted with the chat, the archive purge, or the drone', async () => {
    await withTempDroneDataDir('chat-homes-', async () => {
      const homes = new ChatHomes();
      const removals: number[] = [];
      const stop = subscribeChatRemovals(() => removals.push(removals.length));
      try {
        const chats: Array<[string, string]> = [
          ['d1', 'default'],
          ['d1', 'a'],
          ['d1', 'b'],
          ['d2', 'default'],
          ['d3', 'default'],
        ];
        const ids: Record<string, string> = {};
        for (const [droneId, chatName] of chats) {
          await upsertChatInStore({ droneId, chatName, chatEntry: { createdAt: '2026-10-20T00:00:00.000Z' } });
          const id = readChatMetadataFromStore({ droneId, chatName }).chat!.id as string;
          ids[`${droneId}/${chatName}`] = id;
          await homes.ensure(id);
        }
        const folder = (key: string) => path.join(chatHomesDirectory(), ids[key]!);
        expect(listChatIdentitiesFromStore().chats).toHaveLength(5);

        await archiveChatInStore({
          droneId: 'd1',
          chatName: 'b',
          archivedAt: '2026-10-20T00:00:00.000Z',
          deleteAt: '2026-10-21T00:00:00.000Z',
          archiveRetention: '1d',
        });
        expect(listChatIdentitiesFromStore().chats.find((chat) => chat.chatId === ids['d1/b'])?.archived).toBe(true);
        expect(await homes.sweep()).toEqual([]);
        await restoreArchivedChatInStore({ droneId: 'd1', archivedChatName: 'b' });
        expect(await homes.sweep()).toEqual([]);
        await archiveChatInStore({
          droneId: 'd1',
          chatName: 'b',
          archivedAt: '2026-10-20T00:00:00.000Z',
          deleteAt: '2026-10-21T00:00:00.000Z',
          archiveRetention: '1d',
        });

        const before = removals.length;
        await deleteActiveChatFromStore({ droneId: 'd1', chatName: 'a' });
        expect(removals.length).toBeGreaterThan(before);
        expect(await homes.sweep()).toEqual([ids['d1/a']]);
        expect(fs.existsSync(folder('d1/a'))).toBe(false);

        await deleteArchivedChatFromStore({ droneId: 'd1', archivedChatName: 'b' });
        expect(await homes.sweep()).toEqual([ids['d1/b']]);

        await commitPermanentDroneDeletionInStore({ droneId: 'd2', lifecycleState: 'real' });
        expect(await homes.sweep()).toEqual([ids['d2/default']]);

        expect(fs.existsSync(folder('d1/default'))).toBe(true);
        expect(fs.existsSync(folder('d3/default'))).toBe(true);
        expect((await homes.list()).map((home) => home.chatId).sort()).toEqual([ids['d1/default'], ids['d3/default']].sort());
      } finally {
        stop();
      }
    });
  });
});
