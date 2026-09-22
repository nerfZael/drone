import { expect, test } from 'bun:test';
import { applyChatModelOverrides } from '../src/droneHub/chat/selected-chat-model-overrides';

test('unchanged never writes configuration, including chats with different models and reasoning', async () => {
  const writes: unknown[] = [];
  const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    writes.push({ url, body: JSON.parse(String(init?.body)) });
    return { ok: true } as T;
  };
  await applyChatModelOverrides(request, { droneId: 'a', chatName: 'codex-high' });
  await applyChatModelOverrides(request, { droneId: 'b', chatName: 'claude-low' }, {});
  await applyChatModelOverrides(request, { droneId: 'b', chatName: 'claude-low' }, { model: undefined, reasoning: undefined });
  expect(writes).toEqual([]);
});

test('overrides only change explicitly chosen fields; Auto is distinct from Unchanged', async () => {
  const bodies: unknown[] = [];
  const request = async <T>(_url: string, init?: RequestInit): Promise<T> => {
    bodies.push(JSON.parse(String(init?.body)));
    return { ok: true } as T;
  };
  const target = { droneId: 'a', chatName: 'work' };
  await applyChatModelOverrides(request, target, { reasoning: 'high' });
  await applyChatModelOverrides(request, target, { model: 'chosen-model' });
  await applyChatModelOverrides(request, target, { model: null });
  expect(bodies).toEqual([{ reasoning: 'high' }, { model: 'chosen-model' }, { model: null }]);
});

test('failed configuration overrides reject so the caller does not send with unintended settings', async () => {
  await expect(applyChatModelOverrides(async () => { throw new Error('Unsupported model'); },
    { droneId: 'a', chatName: 'work' }, { model: 'unsupported' })).rejects.toThrow('Unsupported model');
});
