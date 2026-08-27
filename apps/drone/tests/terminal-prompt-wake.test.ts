import { describe, expect, test } from 'bun:test';

import { createTerminalPromptWakeHandler } from '../src/hub/terminal-prompt-wake';

describe('terminal prompt wake-up', () => {
  test('uses canonical pending prompts to wake the owning chat', async () => {
    const reconciled: string[] = [];
    const pumped: string[] = [];
    const handleTerminalPrompt = createTerminalPromptWakeHandler({
      normalizeDroneId: (value) => value.trim(),
      normalizeChatName: (value) => value.trim() || 'default',
      findChatNamesForPrompt: async () => ['default', 'default'],
      enqueueReconcile: (droneId, chatName) => reconciled.push(`${droneId}/${chatName}`),
      enqueuePromptPump: (droneId, chatName) => pumped.push(`${droneId}/${chatName}`),
    });

    await handleTerminalPrompt('drone-1', 'active-prompt');

    expect(reconciled).toEqual(['drone-1/default']);
    expect(pumped).toEqual(['drone-1/default']);
  });

  test('does not wake unrelated chats or invalid events', async () => {
    const wakeups: string[] = [];
    const handleTerminalPrompt = createTerminalPromptWakeHandler({
      normalizeDroneId: (value) => value.trim(),
      normalizeChatName: (value) => value.trim() || 'default',
      findChatNamesForPrompt: async () => [],
      enqueueReconcile: (_droneId, chatName) => wakeups.push(`reconcile:${chatName}`),
      enqueuePromptPump: (_droneId, chatName) => wakeups.push(`pump:${chatName}`),
    });

    await handleTerminalPrompt('drone-1', 'missing-prompt');
    await handleTerminalPrompt('', 'another-prompt');
    await handleTerminalPrompt('drone-1', '');

    expect(wakeups).toEqual([]);
  });
});
