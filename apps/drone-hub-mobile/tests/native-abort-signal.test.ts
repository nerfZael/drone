import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { throwIfAborted } from '@drone/device-protocol';
import { discoverHub } from '../src/mesh/discover-hub';

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve('react-native/package.json'));
const { AbortController: NativeAbortController } = nativeRequire(
  'abort-controller/dist/abort-controller',
);

test('cancellation works with the exact implementation installed by React Native', () => {
  const controller = new NativeAbortController();
  expect(typeof controller.signal.throwIfAborted).toBe('undefined');
  expect(() => throwIfAborted(controller.signal)).not.toThrow();
  controller.abort();
  try {
    throwIfAborted(controller.signal);
    throw new Error('Expected cancellation');
  } catch (error: any) {
    expect(error.name).toBe('AbortError');
  }
});

test('discovery cancellation works on native signals before any request is sent', async () => {
  const controller = new NativeAbortController();
  controller.abort();
  let requested = false;
  await expect(
    discoverHub('https://desktop.tail.ts.net:8791', {
      nonce: 'test',
      signal: controller.signal,
      keyId: async () => 'unused',
      fetchImpl: (async () => {
        requested = true;
        throw new Error('unexpected request');
      }) as typeof fetch,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(requested).toBe(false);
});

test('mobile and shared transport code do not call the unsupported signal prototype method', () => {
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(filename);
      else if (/\.tsx?$/.test(filename))
        expect(readFileSync(filename, 'utf8')).not.toMatch(/\??\.throwIfAborted\s*\(/);
    }
  }
  inspect(new URL('../src', import.meta.url).pathname);
  inspect(new URL('../../../packages/device-protocol/src', import.meta.url).pathname);
});
