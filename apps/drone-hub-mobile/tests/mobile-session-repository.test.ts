import { describe, expect, test } from 'bun:test';
import type { TranscriptEntry } from '@blip/core';
import type { AgentMessage } from '@mariozechner/pi-agent-core/portable';
import type {
  LocalAssistantMessage,
  LocalAssistantThread,
  LocalBlipSessionSnapshot,
} from '../src/local-assistant/local-assistant-types';
import { MobileSessionRepository } from '../src/local-assistant/mobile-session-repository';
import { cleanLocalBlipSessionSnapshot } from '../src/local-assistant/mobile-session-snapshot';

function thread(): LocalAssistantThread {
  return {
    id: 'thread_persistence',
    title: 'Persistence',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    model: 'gpt-test',
    thinkingLevel: 'low',
    status: 'idle',
    error: null,
    workspaceTargets: [],
    messages: [],
  };
}

function user(id: string, content: string): LocalAssistantMessage {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'user',
    content,
  };
}

function assistant(id: string, content: string): LocalAssistantMessage {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'assistant',
    content,
  };
}

describe('mobile Blip session repository', () => {
  test('persists only new transcript chunks and implements deletion as a terminal state', async () => {
    const writes: Array<{ startIndex: number; types: string[] }> = [];
    let deleted = false;
    const repository = new MobileSessionRepository(
      thread(),
      [user('seed', 'seed context')],
      'openai',
      async () => undefined,
      null,
      async (_snapshot, startIndex, entries) => {
        writes.push({ startIndex, types: entries.map((entry) => entry.type) });
      },
      async () => {
        deleted = true;
      },
    );

    await repository.save(repository.state);
    await repository.appendRuntimeEvent(repository.state, {
      version: 1,
      type: 'turn_started',
      eventId: 'event_1',
      timestamp: '2026-01-02T00:00:00.000Z',
      sessionId: repository.state.id,
    });
    await repository.flush();
    await repository.flush();

    expect(writes).toEqual([
      { startIndex: 0, types: ['message'] },
      { startIndex: 1, types: ['runtime_event'] },
      { startIndex: 2, types: [] },
    ]);
    await repository.delete(repository.state.id);
    expect(deleted).toBe(true);
    expect(await repository.list()).toEqual([]);
    expect(await repository.latest()).toBeUndefined();
    await expect(repository.load(repository.state.id)).rejects.toThrow('was deleted');
    await expect(repository.appendEntry(repository.state, persistedEntry('late'))).rejects.toThrow(
      'was deleted',
    );
  });

  test('migrates UI history, persists the complete transcript, and restores compacted context', async () => {
    let persisted: LocalBlipSessionSnapshot | null = null;
    const repository = new MobileSessionRepository(
      thread(),
      [
        user('old', 'old context'),
        assistant('old_answer', 'legacy string answer'),
        user('kept', 'recent context'),
      ],
      'openai',
      async () => undefined,
      null,
      async (snapshot) => {
        persisted = snapshot;
      },
    );

    await repository.save(repository.state);
    const compaction: TranscriptEntry = {
      type: 'compaction',
      id: 'cmp_1',
      createdAt: '2026-01-02T00:00:00.000Z',
      trigger: 'auto',
      tokensBefore: 100_000,
      tokensAfterEstimate: 10_000,
      firstKeptEntryId: 'kept',
      summary: 'durable summary',
      details: { readFiles: [], modifiedFiles: [] },
    };
    await repository.appendEntry(repository.state, compaction);
    repository.state.compactedSummary = compaction.summary;
    await repository.appendRuntimeEvent(repository.state, {
      version: 1,
      type: 'compaction_completed',
      eventId: 'event_1',
      timestamp: '2026-01-02T00:00:00.000Z',
      sessionId: repository.state.id,
      summaryId: compaction.id,
      tokensBefore: compaction.tokensBefore,
      tokensAfter: compaction.tokensAfterEstimate ?? 0,
    });
    await repository.flush();

    expect(persisted).not.toBeNull();
    expect(persisted!.transcript.map((entry) => entry.type)).toEqual([
      'message',
      'message',
      'message',
      'compaction',
      'runtime_event',
    ]);
    const migratedAnswer = persisted!.transcript.find((entry) => entry.id === 'old_answer');
    expect(migratedAnswer?.type === 'message' ? migratedAnswer.message.content : null).toEqual([
      { type: 'text', text: 'legacy string answer' },
    ]);
    const restored = new MobileSessionRepository(
      thread(),
      [],
      'openai',
      async () => undefined,
      persisted,
    );
    const modelMessages = await restored.readModelMessages(restored.state);
    expect(modelMessages).toHaveLength(2);
    expect(String(modelMessages[0]?.content)).toContain('durable summary');
    expect(modelMessages[1]?.content).toBe('recent context');
    expect(restored.state.compactedSummary).toBe('durable summary');
  });

  test('rejects snapshots from a different thread without truncating valid transcripts', () => {
    const snapshot = {
      version: 1,
      state: {
        id: 'mobile_thread_persistence',
        workspaceRoot: 'mobile-mesh',
        modelProvider: 'openai',
        modelId: 'gpt-test',
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
        loadedSkills: [],
        transcriptPath: 'mobile:thread_persistence',
        changedFiles: [],
        readFiles: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      transcript: [
        {
          type: 'message',
          id: 'message_1',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { role: 'user', content: 'hello', timestamp: 1 } as AgentMessage,
        },
      ],
    };
    expect(cleanLocalBlipSessionSnapshot('thread_persistence', snapshot)?.transcript).toHaveLength(
      1,
    );
    expect(cleanLocalBlipSessionSnapshot('another_thread', snapshot)).toBeNull();
  });
});

function persistedEntry(id: string): TranscriptEntry {
  return {
    type: 'message',
    id,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: id, timestamp: 1 },
  };
}
