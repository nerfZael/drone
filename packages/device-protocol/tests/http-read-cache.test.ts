import { expect, test } from 'bun:test';
import {
  applyDeviceReadPatch,
  diffDeviceRead,
  DeviceReadClientCache,
} from '../src/http-read-cache';
import { readBoundedHttpText } from '../src/http-event-client';

test('transcript deltas append streaming text and preserve nested data', () => {
  const before = { messages: [{ text: 'hello', tools: [] }], stale: true };
  const after = { messages: [{ text: 'hello world', tools: [{ id: '1' }] }] };
  const patches = diffDeviceRead(before, after);
  expect(patches).toContainEqual({ path: ['messages', '0', 'text'], append: ' world' });
  expect(applyDeviceReadPatch(before, patches)).toEqual(after);
  expect(before.messages[0].text).toBe('hello');
});

test('read caches isolate devices and reject unknown delta baselines', () => {
  const cache = new DeviceReadClientCache();
  const first = cache.prepare('a', 'drone-control', 'chat.read', { chat: 'one' });
  first.decode({ type: 'device.read', revision: 'v1', value: { text: 'hello' } });
  expect(
    cache.prepare('a', 'drone-control', 'chat.read', { chat: 'one' }).payload.__deviceReadRevision,
  ).toBe('v1');
  const other = cache.prepare('b', 'drone-control', 'chat.read', { chat: 'one' });
  expect(other.payload.__deviceReadRevision).toBe('');
  expect(() => other.decode({ type: 'device.read', base: 'v1', patch: [] })).toThrow(
    'revision mismatch',
  );
});

test('read patches cannot traverse inherited object properties', () => {
  expect(() =>
    applyDeviceReadPatch({}, [{ path: ['__proto__', 'polluted'], value: true }]),
  ).toThrow();
  const value = applyDeviceReadPatch({}, [{ path: ['__proto__'], value: { polluted: true } }]);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(({} as any).polluted).toBeUndefined();
});

test('caller mutations cannot change the baseline used to reconstruct transcript deltas', () => {
  const cache = new DeviceReadClientCache();
  const prepare = () => cache.prepare('a', 'drone-control', 'chat.read', { chat: 'one' });
  const value = prepare().decode({ type: 'device.read', revision: 'v1', value: { text: 'hello' } });
  value.text = 'local UI annotation';
  expect(
    prepare().decode({
      type: 'device.read',
      base: 'v1',
      revision: 'v2',
      patch: [{ path: ['text'], append: ' world' }],
    }),
  ).toEqual({ text: 'hello world' });
});

test('HTTP response limits count UTF-8 bytes and cancel excessive streams', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('😀😀'));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readBoundedHttpText(new Response(body), 7)).rejects.toThrow('too large');
  expect(cancelled).toBe(true);
});
