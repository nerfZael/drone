import assert from 'node:assert/strict';
import test from 'node:test';
import { HubSessionRepository } from '../../src/hub/assistant/hub-session-repository';
import {
  readNativeChatMessages,
  readNativeChatSubscriptionStatus,
} from '../../src/hub/native-chat-messages';
import { resetHubDatabaseForTests, requireHubDatabase } from '../../src/host/hub-database';
import {
  archiveChatInStore,
  searchActiveChatMessages,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
} from '../../src/hub/transcript-store';
import { withTempDroneDataDir } from '../test-helpers';

test('search combines native and CLI replies with scope, archive filtering and stable paging', async () => {
  await withTempDroneDataDir('native-search-node-', async () => {
    requireHubDatabase(); // Fail rather than silently testing the memory fallback.
    const repo = new HubSessionRepository();
    try {
      for (const [droneId, chatName] of [
        ['native', 'default'],
        ['private', 'default'],
        ['native', 'other'],
      ]) {
        const threadId = `${droneId}-${chatName}`;
        await upsertChatInStore({
          droneId,
          chatName,
          chatEntry: { id: threadId, agent: { kind: 'native' } },
        });
        const entries: any[] = [
          {
            type: 'message',
            id: `${threadId}-user`,
            timestamp: '2026-09-14T07:24:59Z',
            message: { role: 'user', content: 'Explain cobalt proposals' },
          },
          {
            type: 'message',
            id: `${threadId}-tool`,
            message: { role: 'toolResult', content: 'secret cobalt' },
          },
          {
            type: 'message',
            id: `${threadId}-answer`,
            timestamp: '2026-09-14T07:25:19Z',
            message: {
              role: 'assistant',
              stopReason: 'stop',
              content: [
                { type: 'thinking', thinking: 'secret cobalt' },
                { type: 'text', text: 'The cobalt proposal reply was saved.' },
              ],
            },
          },
          { type: 'compaction', id: `${threadId}-summary`, summary: 'secret cobalt' },
        ];
        const session = await repo.create({
          provider: 'openai',
          model: 'test',
          permissionMode: 'read-only',
          toolProfile: 'test',
          transcriptSeed: entries,
        } as any);
        await repo.bindThread(threadId, session.id);
      }
      await upsertChatInStore({
        droneId: 'cli',
        chatName: 'default',
        chatEntry: { id: 'cli-chat' },
      });
      await upsertTranscriptTurnInStore({
        droneId: 'cli',
        chatName: 'default',
        turn: {
          id: 'cli-turn',
          at: '2026-09-14T07:25:00Z',
          prompt: 'cobalt',
          output: 'cobalt reply',
          ok: true,
        },
      });
      const opts = { query: 'cobalt', droneIds: ['native', 'cli'], chatName: 'default' };
      const all = searchActiveChatMessages(opts).results;
      assert.equal(all.length, 4);
      assert.deepEqual(
        all
          .filter((row) => row.droneId === 'native')
          .map((row) => row.role)
          .sort(),
        ['assistant', 'user'],
      );
      assert.deepEqual(searchActiveChatMessages({ ...opts, limit: 2 }).results, all.slice(0, 2));
      assert.deepEqual(
        searchActiveChatMessages({ ...opts, limit: 2, offset: 2 }).results,
        all.slice(2),
      );
      assert.deepEqual(searchActiveChatMessages({ ...opts, query: 'secret' }).results, []);
      assert.deepEqual(searchActiveChatMessages({ ...opts, droneIds: [] }).results, []);
      assert.equal(
        searchActiveChatMessages({ ...opts, query: 'saved proposal', droneId: 'native' }).results
          .length,
        1,
      );
      assert.equal(
        readNativeChatMessages('native-default', 1, 4000).messages[0].text,
        'The cobalt proposal reply was saved.',
      );
      const staleCanonical = {
        idle: false,
        reason: 'active_user_messages',
        latest: { id: 'sent-prompt', role: 'user', status: 'sent' },
      };
      const finished = readNativeChatSubscriptionStatus('native-default', false, staleCanonical);
      assert.equal(finished.idle, true);
      assert.equal(finished.latest?.text, 'The cobalt proposal reply was saved.');
      assert.equal(
        readNativeChatSubscriptionStatus('native-default', true, staleCanonical).idle,
        false,
      );
      assert.equal(readNativeChatSubscriptionStatus('empty', false, staleCanonical).idle, true);
      const failed = { ...staleCanonical, idle: true, reason: 'latest_user_failed' };
      assert.deepEqual(readNativeChatSubscriptionStatus('native-default', false, failed), failed);
      await archiveChatInStore({
        droneId: 'native',
        chatName: 'default',
        archivedAt: '2026-09-14T08:00:00Z',
        deleteAt: '2026-10-14T08:00:00Z',
        archiveRetention: '30d',
      });
      assert.deepEqual(searchActiveChatMessages({ ...opts, droneId: 'native' }).results, []);
    } finally {
      repo.close();
      await resetHubDatabaseForTests();
    }
  });
});
