import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TranscriptEntry } from '../src/types';
import { ActiveTranscript } from '../src/ActiveTranscript';
import { modelMessagesFromTranscript } from '../src/model-context';
import { SessionStore } from '../src/session-store';
import { readTranscriptBackwards } from '../src/readTranscriptBackwards';
import { HubSessionRepository } from '../../../../apps/drone/src/hub/assistant/hub-session-repository';
import { MobileSessionRepository } from '../../../../apps/drone-hub-mobile/src/local-assistant/mobile-session-repository';

const at = '2026-01-01T00:00:00.000Z';
const user = (id: string): TranscriptEntry => ({ type: 'message', id, timestamp: at, message: { role: 'user', content: id, timestamp: 1 } });
const event = (id: string): TranscriptEntry => ({ type: 'runtime_event', id, timestamp: at, event: { type: 'turn_started', version: 1, eventId: id, sessionId: 'test', timestamp: at } });
const checkpoint = (id: string, firstKeptEntryId?: string, retainedUserEntryId?: string): TranscriptEntry => ({
  type: 'compaction', id, createdAt: at, trigger: 'manual', tokensBefore: 50_000,
  summary: id, firstKeptEntryId, retainedUserEntryId, details: { readFiles: [], modifiedFiles: [] },
});
const fixtures = [
  [user('old'), event('e'), user('new')],
  [user('old'), user('keep'), checkpoint('c1', 'keep'), event('e'), user('new')],
  [user('old'), user('keep'), checkpoint('c1', 'keep'), user('new'), checkpoint('c2', 'new'), user('latest')],
  [user('old'), checkpoint('c1'), user('new')],
  [user('old'), checkpoint('c1', 'missing'), user('new')],
  [user('old'), checkpoint('c1', 'new'), user('new')],
  [user('old'), event('event-boundary'), user('keep'), checkpoint('c1', 'event-boundary'), user('new')],
  [user('old'), user('pin'), user('discard'), user('keep'), checkpoint('c1', 'keep', 'pin'), user('new')],
  [user('old'), user('pin'), user('discard'), checkpoint('c1', undefined, 'pin'), user('new')],
  [user('old'), user('keep'), checkpoint('c1', 'keep', 'missing'), user('new')],
  [user('old'), event('bad-pin'), user('keep'), checkpoint('c1', 'keep', 'bad-pin'), user('new')],
  [user('old'), user('keep'), checkpoint('c1', 'keep', 'new'), user('new')],
  [user('old'), user('keep'), checkpoint('c1', 'keep', 'keep'), user('new')],
];

describe('active history parity', () => {
  test('rejects future pinned references and includes an overlapping pin only once', () => {
    const old = user('old');
    const keep = user('keep');
    const future = user('future');
    const invalid = [old, keep, checkpoint('bad', 'keep', 'future'), future];
    expect(modelMessagesFromTranscript(invalid)).toEqual([old, keep, future].map((entry) =>
      entry.type === 'message' ? entry.message : undefined));
    const valid = [old, keep, checkpoint('valid', 'keep', 'keep')];
    const messages = modelMessagesFromTranscript(valid);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(keep.type === 'message' ? keep.message : undefined);
  });

  test('collector preserves checkpoint semantics including corrupt references and pinned instructions', () => {
    for (const entries of fixtures) {
      const active = new ActiveTranscript();
      for (const entry of [...entries].reverse()) if (active.add(entry)) break;
      expect(modelMessagesFromTranscript(active.finish())).toEqual(modelMessagesFromTranscript(entries));
    }
  });

  test.each(['jsonl', 'sqlite', 'mobile'])('%s repository matches full history through append and repeated checkpoints', async (kind) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'blip-active-'));
    try {
      for (const entries of fixtures) {
        const repository = kind === 'jsonl' ? new SessionStore(workspace) : kind === 'sqlite' ? new HubSessionRepository({ inMemory: true }) :
          new MobileSessionRepository({ id: 'test', title: 'Test', createdAt: at, updatedAt: at, model: 'test', thinkingLevel: 'low', status: 'idle', error: null, workspaceTargets: [], messages: [] }, [], 'test', async () => undefined);
        const session = await repository.create({ provider: 'test', model: 'test', permissionMode: 'read-only', toolProfile: 'read-only', transcriptSeed: entries });
        try {
          expect(await repository.readModelMessages(session)).toEqual(modelMessagesFromTranscript(entries));
          const extra = user('appended');
          await repository.appendEntry(session, extra);
          expect(await repository.readModelMessages(session)).toEqual(modelMessagesFromTranscript([...entries, extra]));
          expect(await repository.readTranscript(session)).toEqual([...entries, extra]);
        } finally {
          await repository.delete(session.id);
          if (repository instanceof HubSessionRepository) repository.close();
        }
      }
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });

  test.each(['jsonl', 'sqlite', 'mobile'])('%s reads active context without a full transcript read and recovers compacted output', async (kind) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'blip-active-fast-'));
    const repository = kind === 'jsonl' ? new SessionStore(workspace) : kind === 'sqlite' ? new HubSessionRepository({ inMemory: true }) :
      new MobileSessionRepository({ id: 'test', title: 'Test', createdAt: at, updatedAt: at, model: 'test', thinkingLevel: 'low', status: 'idle', error: null, workspaceTargets: [], messages: [] }, [], 'test', async () => undefined);
    const raw: TranscriptEntry = { type: 'message', id: 'raw', timestamp: at, message: { role: 'toolResult', toolCallId: 'old-result', toolName: 'bash', content: [{ type: 'text', text: 'Original output' }], isError: false, timestamp: 1 } };
    const seed = [user('old'), raw, ...Array.from({ length: 1_000 }, (_, index) => event(`event-${index}`)), user('keep'), checkpoint('c1', 'keep'), user('new')];
    const session = await repository.create({ provider: 'test', model: 'test', permissionMode: 'read-only', toolProfile: 'read-only', transcriptSeed: seed });
    try {
      repository.readTranscript = async () => { throw new Error('Full transcript read forbidden'); };
      expect(await repository.readModelMessages(session)).toEqual(modelMessagesFromTranscript(seed));
      expect((await repository.readActiveTranscript(session)).map((entry) => entry.id)).toEqual(['keep', 'c1', 'new']);
      expect(await repository.readToolResult(session, 'old-result')).toEqual(raw.message);
      expect(await repository.readToolResult(session, 'missing')).toBeUndefined();
    } finally {
      await repository.delete(session.id);
      if (repository instanceof HubSessionRepository) repository.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test('JSONL reader handles chunk boundaries, unicode, CRLF, missing final newline and file replacement', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'blip-active-unicode-'));
    const store = new SessionStore(workspace);
    const session = await store.create({ provider: 'test', model: 'test', permissionMode: 'read-only', toolProfile: 'read-only' });
    try {
      const entries = [user('🙂日本語'.repeat(40_000)), user('keep'), checkpoint('c1', 'keep'), user('end')];
      for (const ending of ['\n', '\r\n', '']) {
        await writeFile(session.transcriptPath, entries.map((entry) => JSON.stringify(entry)).join('\r\n') + ending);
        const backwards: TranscriptEntry[] = [];
        for await (const entry of readTranscriptBackwards(session.transcriptPath)) backwards.push(entry);
        expect(backwards).toEqual([...entries].reverse());
        expect(await store.readModelMessages(session)).toEqual(modelMessagesFromTranscript(entries));
      }
      await writeFile(session.transcriptPath, JSON.stringify(user('replacement')) + '\n');
      expect(await store.readModelMessages(session)).toEqual(modelMessagesFromTranscript([user('replacement')]));
      // Deliberately invalid old data demonstrates that the checkpoint prefix is never parsed.
      await writeFile(session.transcriptPath, 'unparsed old data\n' + entries.slice(1).map((entry) => JSON.stringify(entry)).join('\n'));
      expect(await store.readModelMessages(session)).toEqual(modelMessagesFromTranscript(entries));
      expect((await readFile(session.transcriptPath, 'utf8')).startsWith('unparsed')).toBe(true);
    } finally { await store.delete(session.id); await rm(workspace, { recursive: true, force: true }); }
  });
});
