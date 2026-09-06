import { expect, test } from 'bun:test';
import type { DroneBrowserSession } from '@drone/device-protocol';
import {
  startNativeBrowser,
  stopNativeBrowser,
  type BrowserNative,
} from '../src/drones/native-browser-lifecycle';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function session(id: string): DroneBrowserSession {
  return {
    sessionId: id,
    url: 'wss://hub/browser',
    token: 'test',
    expiresAt: '',
    upstreamAuthority: '127.0.0.1:3000',
  };
}

test('a stale native start is stopped before the next screen takes ownership', async () => {
  const entered = deferred();
  const complete = deferred();
  const calls: string[] = [];
  let current = true;
  const native: BrowserNative = {
    async start(id) {
      calls.push(`start:${id}`);
      if (id === 'old') {
        entered.resolve();
        await complete.promise;
      }
      return { sessionId: id, origin: '', url: '' };
    },
    async stop(id) {
      calls.push(`stop:${id}`);
    },
  };
  const old = startNativeBrowser(native, session('old'), '/', 3000, () => current);
  await entered.promise;
  current = false;
  const next = startNativeBrowser(native, session('new'), '/', 3000, () => true);
  complete.resolve();
  expect(await old).toBeNull();
  expect((await next)?.sessionId).toBe('new');
  expect(calls).toEqual(['start:old', 'stop:old', 'start:new']);
  await stopNativeBrowser(native, 'new');
});

test('a queued start cancelled before native execution never replaces the active gateway', async () => {
  const entered = deferred();
  const complete = deferred();
  const calls: string[] = [];
  const native: BrowserNative = {
    async start(id) {
      calls.push(id);
      entered.resolve();
      await complete.promise;
      return { sessionId: id, origin: '', url: '' };
    },
    async stop() {},
  };
  const active = startNativeBrowser(native, session('active'), '/', 3000, () => true);
  await entered.promise;
  const cancelled = startNativeBrowser(native, session('cancelled'), '/', 3000, () => false);
  complete.resolve();
  await active;
  expect(await cancelled).toBeNull();
  expect(calls).toEqual(['active']);
});
