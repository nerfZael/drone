import { describe, expect, test } from 'bun:test';

import { suggestAndRenameRemoteChatFromPrompt } from '../src/remote/remote-chat-auto-rename';

describe('remote chat auto rename', () => {
  test('suggests and renames an eligible generated chat', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const result = await suggestAndRenameRemoteChatFromPrompt({
      droneId: 'drone-1',
      chatName: 'chat-2',
      prompt: 'Fix login redirects',
      requestJson: async <T>(url: string, init?: RequestInit): Promise<T> => {
        calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        if (url === '/api/drones/name-from-message') {
          return { ok: true, name: 'fix-login-redirects' } as T;
        }
        return { ok: true, chat: 'fix-login-redirects' } as T;
      },
    });

    expect(result).toEqual({ ok: true, chatName: 'fix-login-redirects' });
    expect(calls[1]?.url).toBe('/api/drones/drone-1/chats/chat-2/rename');
    expect(calls[1]?.body).toEqual({ newName: 'fix-login-redirects' });
  });

  test('does not rename a manually named chat', async () => {
    let calls = 0;
    const result = await suggestAndRenameRemoteChatFromPrompt({
      droneId: 'drone-1',
      chatName: 'review-login',
      prompt: 'Fix login redirects',
      requestJson: async <T>(): Promise<T> => {
        calls += 1;
        return {} as T;
      },
    });

    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
});
