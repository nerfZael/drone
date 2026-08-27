import { describe, expect, test } from 'bun:test';
import { hasBlockingPendingPrompt } from '@drone/assistant-chat';

import {
  projectPromptRuntimeChatEntry,
  resolveStoredChatEntry,
} from '../src/hub/chat-session-runtime';

describe('chat session runtime storage resolution', () => {
  test('returns an existing canonical chat without enqueueing a legacy import', async () => {
    const canonical = { id: 'canonical-chat', turns: [] };
    let importCount = 0;

    const resolved = await resolveStoredChatEntry({
      droneId: 'drone-1',
      chatName: 'default',
      registryChatEntry: { id: 'legacy-chat' },
      readChatFromStore: () => ({ available: true, chat: canonical }),
      importChatFromRegistry: async () => {
        importCount += 1;
      },
    });

    expect(resolved).toBe(canonical);
    expect(importCount).toBe(0);
  });

  test('imports once when the canonical chat is genuinely missing', async () => {
    const imported = { id: 'imported-chat', turns: [] };
    let readCount = 0;
    let importCount = 0;

    const resolved = await resolveStoredChatEntry({
      droneId: 'drone-1',
      chatName: 'default',
      registryChatEntry: { id: 'legacy-chat' },
      readChatFromStore: () => ({
        available: true,
        chat: readCount++ === 0 ? null : imported,
      }),
      importChatFromRegistry: async () => {
        importCount += 1;
      },
    });

    expect(resolved).toBe(imported);
    expect(importCount).toBe(1);
    expect(readCount).toBe(2);
  });

  test('includes pending-related completed turns without loading unrelated transcript history', () => {
    const completed = { id: 'completed-prompt', ok: true };
    const chat = projectPromptRuntimeChatEntry({
      metadata: {
        available: true,
        chat: { id: 'manager-chat', agent: { kind: 'builtin', id: 'codex' } },
      },
      rows: {
        available: true,
        pending: [
          { id: 'completed-prompt', state: 'sent' },
          { id: 'follow-up', state: 'queued' },
        ],
        pendingTurns: [completed],
      },
    });

    expect(chat).toMatchObject({
      id: 'manager-chat',
      pendingPrompts: [
        { id: 'completed-prompt', state: 'sent' },
        { id: 'follow-up', state: 'queued' },
      ],
      turns: [completed],
    });
    expect(
      hasBlockingPendingPrompt(chat.pendingPrompts.slice(0, 1), chat.turns, 'queue'),
    ).toBe(false);
  });
});
