import assert from 'node:assert/strict';
import test from 'node:test';
import { HubSessionRepository } from '../../src/hub/assistant/hub-session-repository';
import { resetHubDatabaseForTests, requireHubDatabase } from '../../src/host/hub-database';
import {
  archiveChatInStore,
  restoreArchivedChatInStore,
  renameChatInStore,
  searchActiveChatMessages,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
} from '../../src/hub/transcript-store';
import { withTempDroneDataDir } from '../test-helpers';

const message = (id: string, text: string) => ({
  type: 'message',
  id,
  timestamp: '2026-09-15T10:00:00Z',
  message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] },
});
const input = (entries: any[]) =>
  ({
    provider: 'openai',
    model: 'test',
    permissionMode: 'read-only',
    toolProfile: 'test',
    transcriptSeed: entries,
  }) as any;

test('shared search backfills, appends, repairs edits and rebinds without duplicate or stale messages', async () => {
  await withTempDroneDataDir('shared-search-recovery-', async () => {
    const db = requireHubDatabase();
    let repo = new HubSessionRepository();
    try {
      await upsertChatInStore({
        droneId: 'drone',
        chatName: 'default',
        chatEntry: { id: 'thread', agent: { kind: 'native' } },
      });
      const session = await repo.create(
        input([message('old', 'cobalt old'), message('keep', 'cobalt keep')]),
      );
      await repo.bindThread('thread', session.id);
      const search = async () =>
        (await searchActiveChatMessages({ query: 'cobalt', droneIds: ['drone'] })).results;
      const ids = async () => (await search()).map((row) => row.turnId).sort();
      assert.deepEqual(await ids(), ['keep', 'old']);
      assert.deepEqual(await ids(), ['keep', 'old']);
      const indexed = () =>
        db.read((conn) =>
          conn
            .prepare("SELECT count(*) AS n FROM active_chat_message_search WHERE source='native'")
            .get(),
        ) as { n: number };
      assert.equal(indexed().n, 2);
      await repo.appendEntry(session, message('new', 'cobalt new') as any);
      assert.deepEqual(await ids(), ['keep', 'new', 'old']);
      // A middle deletion followed by an append leaves the row count unchanged.
      await repo.deleteThreadMessage('thread', 'old', false);
      await repo.appendEntry(session, message('replacement', 'cobalt replacement') as any);
      assert.deepEqual(await ids(), ['keep', 'new', 'replacement']);
      assert.equal(indexed().n, 3);
      await repo.deleteThreadMessage('thread', 'new', true);
      assert.deepEqual(await ids(), ['keep']);
      repo.close();
      repo = new HubSessionRepository();
      assert.deepEqual(await ids(), ['keep']);
      const rebound = await repo.create(input([message('rebound', 'cobalt rebound')]));
      await repo.bindThread('thread', rebound.id);
      assert.deepEqual(await ids(), ['rebound']);
      const simultaneous = await Promise.all([search(), search(), search()]);
      assert.deepEqual(simultaneous[0], simultaneous[1]);
      assert.deepEqual(simultaneous[1], simultaneous[2]);
      assert.equal(indexed().n, 1);
      await repo.delete(rebound.id);
      assert.deepEqual(await ids(), []);
      assert.equal(indexed().n, 0);
    } finally {
      repo.close();
      await resetHubDatabaseForTests();
    }
  });
});

test('one FTS query uses token matching for both sources and retains current ownership after archive/agent changes', async () => {
  await withTempDroneDataDir('shared-search-ownership-', async () => {
    const db = requireHubDatabase();
    const repo = new HubSessionRepository();
    try {
      await upsertChatInStore({
        droneId: 'drone',
        chatName: 'named',
        chatEntry: { id: 'thread', agent: { kind: 'native' } },
      });
      const session = await repo.create(input([message('answer', 'cobalt native')]));
      await repo.bindThread('thread', session.id);
      await upsertTranscriptTurnInStore({
        droneId: 'drone',
        chatName: 'named',
        turn: {
          id: 'answer',
          at: '2026-09-15T10:00:00Z',
          prompt: 'cobalt CLI',
          output: '',
          ok: true,
        },
      });
      const search = async (query = 'cobalt') =>
        (await searchActiveChatMessages({ query, droneIds: ['drone'] })).results;
      assert.equal((await search()).length, 1); // Old CLI turns are not current native history.
      assert.deepEqual(await search('cobal'), []); // Native no longer uses substring matching.
      await upsertTranscriptTurnInStore({
        droneId: 'drone',
        chatName: 'named',
        turn: {
          id: 'answer',
          at: '2026-09-15T10:00:00Z',
          prompt: 'cobalt updated CLI',
          output: '',
          ok: true,
        },
      });
      assert.equal((await search())[0].role, 'assistant'); // CLI trigger cannot delete same-ID native row.
      await upsertChatInStore({
        droneId: 'drone',
        chatName: 'named',
        chatEntry: { id: 'thread', agent: { kind: 'builtin', id: 'codex' } },
      });
      assert.equal((await search())[0].role, 'user');
      assert.equal(
        (
          db.read((conn) =>
            conn
              .prepare("SELECT count(*) AS n FROM active_chat_message_search WHERE source='native'")
              .get(),
          ) as any
        ).n,
        0,
      );
      await upsertChatInStore({
        droneId: 'drone',
        chatName: 'named',
        chatEntry: { id: 'thread', agent: { kind: 'native' } },
      });
      assert.equal((await search())[0].role, 'assistant');
      await archiveChatInStore({
        droneId: 'drone',
        chatName: 'named',
        archivedAt: '2026-09-15T11:00:00Z',
        deleteAt: '2026-10-15T11:00:00Z',
        archiveRetention: '30d',
      });
      assert.deepEqual(await search(), []);
      assert.equal(
        (
          db.read((conn) =>
            conn.prepare('SELECT count(*) AS n FROM native_chat_search_cursors').get(),
          ) as any
        ).n,
        0,
      );
      const restored = await restoreArchivedChatInStore({
        droneId: 'drone',
        archivedChatName: 'named',
      });
      assert.equal(restored.restored, true);
      assert.equal((await search())[0].role, 'assistant');
      await renameChatInStore({ droneId: 'drone', chatName: 'named', newChatName: 'renamed' });
      assert.equal((await search())[0].chatName, 'renamed');
      assert.equal((await search()).length, 1);
    } finally {
      repo.close();
      await resetHubDatabaseForTests();
    }
  });
});

test('upgrading the previous search schema rebuilds CLI rows and backfills native history idempotently', async () => {
  await withTempDroneDataDir('shared-search-migration-', async () => {
    const db = requireHubDatabase();
    const repo = new HubSessionRepository();
    try {
      await upsertChatInStore({
        droneId: 'cli',
        chatName: 'default',
        chatEntry: { id: 'cli-thread' },
      });
      await upsertTranscriptTurnInStore({
        droneId: 'cli',
        chatName: 'default',
        turn: {
          id: 'turn',
          at: '2026-09-15T10:00:00Z',
          prompt: 'cobalt question',
          output: 'cobalt answer',
          ok: true,
        },
      });
      await upsertChatInStore({
        droneId: 'native',
        chatName: 'default',
        chatEntry: { id: 'native-thread', agent: { kind: 'native' } },
      });
      const session = await repo.create(input([message('native-answer', 'cobalt native')]));
      await repo.bindThread('native-thread', session.id);
      // Install the prior schema shape. Migration must recover its index from source turns.
      await db.writeTransaction('simulate previous search schema', (conn) =>
        conn.exec(`
        DROP TRIGGER native_chat_search_delete;
        DROP TRIGGER native_chat_search_rename;
        DROP TRIGGER native_chat_search_identity_update;
        DROP TABLE native_chat_search_cursors;
        DROP TRIGGER active_chat_message_search_turn_insert;
        DROP TRIGGER active_chat_message_search_turn_delete;
        DROP TRIGGER active_chat_message_search_turn_update;
        DROP TABLE active_chat_message_search;
        CREATE VIRTUAL TABLE active_chat_message_search USING fts5(drone_id UNINDEXED, chat_name UNINDEXED, turn_id UNINDEXED, role UNINDEXED, timestamp UNINDEXED, content, tokenize='unicode61');
        CREATE TRIGGER active_chat_message_search_turn_insert AFTER INSERT ON canonical_chat_turns BEGIN SELECT 1; END;
        CREATE TRIGGER active_chat_message_search_turn_delete AFTER DELETE ON canonical_chat_turns BEGIN SELECT 1; END;
        CREATE TRIGGER active_chat_message_search_turn_update AFTER UPDATE ON canonical_chat_turns BEGIN SELECT 1; END;
        DELETE FROM hub_schema_migrations WHERE scope='chats' AND version=13;
      `),
      );
      const { ChatTranscriptRepository } = await import('../../src/hub/transcript-store');
      new ChatTranscriptRepository(db);
      const first = (await searchActiveChatMessages({ query: 'cobalt' })).results;
      assert.equal(first.length, 3);
      new ChatTranscriptRepository(db);
      assert.deepEqual((await searchActiveChatMessages({ query: 'cobalt' })).results, first);
      assert.equal(
        (
          db.read((conn) =>
            conn.prepare('SELECT count(*) AS n FROM canonical_chat_turns').get(),
          ) as any
        ).n,
        1,
      );
    } finally {
      repo.close();
      await resetHubDatabaseForTests();
    }
  });
});
