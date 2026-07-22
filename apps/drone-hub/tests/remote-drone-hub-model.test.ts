import { describe, expect, test } from 'bun:test';
import {
  normalizeRemoteChatMessages,
  normalizeRemoteDrones,
} from '../src/droneHub/app/use-remote-drone-hub';

describe('desktop remote Drone Hub model', () => {
  test('normalizes remote drones without changing their device-local ids', () => {
    expect(
      normalizeRemoteDrones({
        drones: [
          {
            id: 'drone-one',
            name: 'One',
            repoPath: '/work/repo',
            chats: ['default', 'review', 'review'],
            busyChats: ['review'],
            unreadChats: ['default'],
          },
        ],
      }),
    ).toEqual([
      {
        id: 'drone-one',
        name: 'One',
        runtime: 'container',
        group: null,
        repoPath: '/work/repo',
        chats: ['default', 'review'],
        busyChats: ['review'],
        unreadChats: ['default'],
        statusOk: true,
        statusError: null,
      },
    ]);
  });

  test('turn history becomes isolated user and assistant messages', () => {
    expect(
      normalizeRemoteChatMessages({
        historyKind: 'turns',
        turns: [
          {
            id: 'turn-1',
            prompt: 'Check the tests',
            output: 'All green',
            promptAt: '2026-07-22T10:00:00.000Z',
            completedAt: '2026-07-22T10:01:00.000Z',
          },
        ],
      }),
    ).toMatchObject([
      { id: 'turn-1:user', role: 'user', content: 'Check the tests' },
      { id: 'turn-1:assistant', role: 'assistant', content: 'All green' },
    ]);
  });

  test('keeps attachment-only prompts visible in remote history', () => {
    expect(
      normalizeRemoteChatMessages({
        historyKind: 'turns',
        turns: [{ id: 'turn-files', prompt: '', attachments: [{ name: 'screen.png' }] }],
      }),
    ).toMatchObject([
      {
        id: 'turn-files:user',
        role: 'user',
        content: 'Attached 1 file to this prompt.',
      },
    ]);
  });

  test('keeps native message history and current streaming messages in order', () => {
    expect(
      normalizeRemoteChatMessages({
        historyKind: 'messages',
        history: { entries: [{ id: 'user-1', message: { role: 'user', content: 'Hello' } }] },
        streamingMessages: [{ id: 'assistant-1', role: 'assistant', content: 'Working' }],
      }),
    ).toMatchObject([
      { id: 'user-1', role: 'user', content: 'Hello' },
      { id: 'assistant-1', role: 'assistant', content: 'Working' },
    ]);
  });
});
