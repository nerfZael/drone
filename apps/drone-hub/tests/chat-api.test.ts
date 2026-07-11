import { describe, expect, test } from 'bun:test';
import { fetchDroneChatState, fetchDroneChatTranscript, sameTranscriptItem } from '../src/droneHub/app/chat-api';
import type { TranscriptItem } from '../src/droneHub/types';

function transcriptItem(overrides: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    turn: 1,
    at: '2026-06-16T18:34:44.000Z',
    id: 'turn-1',
    prompt: 'run task',
    session: 'default',
    logPath: '',
    ok: true,
    output: 'done',
    ...overrides,
  };
}

describe('chat api transcript equality', () => {
  test('detects docker snapshot status changes', () => {
    const creating = transcriptItem({
      dockerSnapshot: {
        id: 'snapshot-1',
        status: 'creating',
        createdAt: '2026-06-16T18:34:44.000Z',
      },
    });
    const ready = transcriptItem({
      dockerSnapshot: {
        id: 'snapshot-1',
        status: 'ready',
        createdAt: '2026-06-16T18:34:44.000Z',
        readyAt: '2026-06-16T18:34:53.000Z',
        sizeBytes: 7392574357,
      },
    });

    expect(sameTranscriptItem(creating, ready)).toBe(false);
  });

  test('detects agent plan progress changes', () => {
    const pending = transcriptItem({
      agentPlan: {
        source: 'codex',
        updatedAt: '2026-06-16T18:34:45.000Z',
        items: [{ text: 'Run tests', status: 'pending' }],
      },
    });
    const completed = transcriptItem({
      agentPlan: {
        source: 'codex',
        updatedAt: '2026-06-16T18:34:46.000Z',
        items: [{ text: 'Run tests', status: 'completed' }],
      },
    });

    expect(sameTranscriptItem(pending, completed)).toBe(false);
  });
});

describe('chat api request scopes', () => {
  test('loads the initial transcript tail and pending prompts in one request', async () => {
    const urls: string[] = [];
    const result = await fetchDroneChatState(
      async <T>(url: string): Promise<T> => {
        urls.push(url);
        return { ok: true, transcripts: [transcriptItem()], pending: [{ id: 'pending-1' }] } as T;
      },
      { droneId: 'drone one', chatName: 'default', turn: 'all', tail: 50 },
    );

    expect(urls).toEqual([
      '/api/drones/drone%20one/chats/default/state?turn=all&tail=50&transcript=tail',
    ]);
    expect(result.transcripts).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
  });

  test('requests full transcript without pending prompts for explicit export', async () => {
    const urls: string[] = [];
    await fetchDroneChatTranscript(
      async <T>(url: string): Promise<T> => {
        urls.push(url);
        return { ok: true, transcripts: [] } as T;
      },
      { droneId: 'drone-1', chatName: 'chat one', turn: 'all' },
    );

    expect(urls).toEqual([
      '/api/drones/drone-1/chats/chat%20one/state?turn=all&transcript=selected&pending=none',
    ]);
  });
});
