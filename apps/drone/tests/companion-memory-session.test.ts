import { expect, test } from 'bun:test';

import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';

test('Companion-style repositories keep sessions isolated in memory', async () => {
  const first = new HubSessionRepository({ inMemory: true });
  const second = new HubSessionRepository({ inMemory: true });
  try {
    const session = await first.create({
      provider: 'codex',
      model: 'gpt-5.6-sol',
      permissionMode: 'workspace-write',
      toolProfile: 'local-trusted-write',
    });
    await first.bindThread('companion:test', session.id);
    expect(await first.sessionIdForThread('companion:test')).toBe(session.id);
    expect(await second.sessionIdForThread('companion:test')).toBeUndefined();
    await first.delete(session.id);
    expect(await first.sessionIdForThread('companion:test')).toBeUndefined();
  } finally {
    first.close();
    second.close();
  }
});

test('Companion replies omit stored model reasoning', async () => {
  const repository = new HubSessionRepository({ inMemory: true });
  const session = await repository.create({
    provider: 'codex',
    model: 'gpt-5.6-sol',
    permissionMode: 'workspace-write',
    toolProfile: 'local-trusted-write',
  });
  await repository.bindThread('companion:visible-reply', session.id);
  await repository.appendMessage(session, {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'hidden chain of thought' },
      { type: 'text', text: 'Visible answer' },
    ],
    timestamp: Date.now(),
  } as any);
  const host = new BlipAssistantHost(
    async () => { throw new Error('configuration should not load'); },
    undefined,
    repository,
  );
  try {
    expect(await host.latestAssistantVisibleText('companion:visible-reply')).toBe('Visible answer');
  } finally {
    await host.close();
  }
});
