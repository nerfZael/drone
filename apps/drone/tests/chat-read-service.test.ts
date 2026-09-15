import { expect, test } from 'bun:test';
import { ChatReadService } from '../src/hub/chat-read/ChatReadService';
import {
  chatReadSnapshotFromRegistry,
  summarizeChatActivity,
  type ChatReadSnapshot,
} from '../src/hub/chat-read/helpers/chat-read-model';

const snapshot: ChatReadSnapshot = {
  id: 'drone',
  chat: 'default',
  chatId: 'chat',
  agent: { kind: 'builtin' },
  transcripts: [],
  pending: [],
};

test('read service bounds requests, reports older history and removes completed delivery records', async () => {
  let request: any;
  const service = new ChatReadService(async (input) => {
    request = input;
    return {
      ...snapshot,
      ok: true,
      turnCount: 21,
      transcripts: [
        { id: 'done', at: '2026-09-15T10:00:00Z', prompt: 'question', output: 'answer', ok: true },
      ],
      pending: [
        { id: 'done', state: 'sent', prompt: 'question' },
        { id: 'queued', state: 'queued', prompt: 'next' },
      ],
    };
  });
  const result = await service.read({
    droneRef: 'drone',
    chatName: 'default',
    limit: Infinity,
    maxChars: 3,
  });
  expect(request.tailRaw).toBe('10');
  expect(result).toMatchObject({
    historyKind: 'messages',
    hasOlder: true,
    pendingCount: 1,
    messages: [
      { id: 'user:done', text: 'que', textTruncated: true },
      { id: 'assistant:done', text: 'ans', textTruncated: true },
    ],
  });
});

test('activity handles queued work, failed delivery, silent completion and empty chats consistently', () => {
  expect(summarizeChatActivity(snapshot)).toMatchObject({ idle: true, reason: 'no_messages' });
  const completed = {
    ...snapshot,
    transcripts: [{ id: 'done', at: '2026-09-15T10:00:00Z', prompt: 'work', output: '', ok: true }],
    pending: [{ id: 'done', state: 'sent', prompt: 'work' }],
  };
  expect(summarizeChatActivity(completed)).toMatchObject({
    idle: true,
    reason: 'latest_agent_message',
    activeUserMessages: 0,
  });
  expect(
    summarizeChatActivity({
      ...completed,
      pending: [{ id: 'next', state: 'queued', at: '2026-09-15T11:00:00Z', prompt: 'next' }],
    }),
  ).toMatchObject({ idle: false, activeUserMessages: 1, queuedUserMessages: 1 });
  expect(
    summarizeChatActivity({
      ...completed,
      pending: [{ id: 'next', state: 'failed', at: '2026-09-15T11:00:00Z', prompt: 'next' }],
    }),
  ).toMatchObject({ idle: true, reason: 'latest_user_failed', failedUserMessages: 1 });
  expect(summarizeChatActivity(completed, true)).toMatchObject({ idle: false });
});

test('startup seed and inherited agent use the resolved chat identity', () => {
  const read = chatReadSnapshotFromRegistry(
    { pending: { key: { id: 'drone', name: 'Drone', seed: { prompt: 'start' } } } },
    { droneId: 'Drone', chatName: 'default' },
  );
  expect(summarizeChatActivity(read)).toMatchObject({
    droneId: 'drone',
    idle: false,
    queuedUserMessages: 1,
  });
});

test('source read failures remain errors rather than successful empty history', async () => {
  const service = new ChatReadService(async () => ({
    ok: false,
    statusCode: 404,
    error: 'unknown chat',
  }));
  expect(await service.read({ droneRef: 'missing', chatName: 'default' })).toEqual({
    ok: false,
    statusCode: 404,
    error: 'unknown chat',
  });
});

test('failed CLI output keeps failure status even without a separate error string', () => {
  const failed = {
    ...snapshot,
    transcripts: [
      {
        id: 'failure',
        prompt: 'work',
        output: 'Could not finish',
        ok: false,
        at: '2026-09-15T10:00:00Z',
      },
    ],
  };
  expect(summarizeChatActivity(failed)).toMatchObject({
    idle: true,
    reason: 'latest_user_failed',
    latest: { id: 'agent:failure', role: 'agent', status: 'failed', text: 'Could not finish' },
  });
});
