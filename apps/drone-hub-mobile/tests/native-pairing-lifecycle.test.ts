import { expect, test } from 'bun:test';
import { startNativePairing, stopNativePairing } from '../src/mesh/native-pairing-lifecycle';

test('a cancelled pending start is cleaned up before the next screen starts its listener', async () => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const calls: string[] = [];
  const native = {
    start: async (descriptor: string) => {
      calls.push(`start:${descriptor}`);
      if (descriptor === 'old') {
        entered();
        await gate;
      }
    },
    stop: async () => {
      calls.push('stop');
    },
  };
  let current = true;
  const old = startNativePairing(native, 'old', () => current);
  await started;
  current = false;
  const stop = stopNativePairing(native);
  const next = startNativePairing(native, 'new', () => true);
  finish();
  expect(await old).toBe(false);
  await stop;
  expect(await next).toBe(true);
  expect(calls).toEqual(['start:old', 'stop', 'stop', 'start:new']);
});

test('cancelled queued starts never open a listener and failures do not poison later attempts', async () => {
  const calls: string[] = [];
  const native = {
    start: async (descriptor: string) => {
      calls.push(descriptor);
      if (descriptor === 'failure') throw new Error('bind failed');
    },
    stop: async () => {},
  };
  expect(await startNativePairing(native, 'cancelled', () => false)).toBe(false);
  await expect(startNativePairing(native, 'failure', () => true)).rejects.toThrow('bind failed');
  expect(await startNativePairing(native, 'retry', () => true)).toBe(true);
  expect(calls).toEqual(['failure', 'retry']);
});
