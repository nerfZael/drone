import React, { act } from 'react';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { ReactTestRenderer } from 'react-test-renderer';

const listeners = new Set<(state: string) => void>();
const appState = { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
  listeners.add(listener); return { remove: () => listeners.delete(listener) };
} };
let ready: (id: string) => Promise<boolean> = async () => true;
let permitted = true;
let focused = true;
let claimed = false;
mock.module('react-native', () => ({ AppState: appState }));
mock.module('../src/local-assistant/mobile-phone-assistant', () => ({ phoneAssistant: {
  ready: (id: string) => ready(id), canStart: async () => focused, hasPermissions: async () => permitted,
  claimStart: async () => { if (claimed) return false; claimed = true; return true; },
  retry: async () => { claimed = false; return true; },
} }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { usePhoneAssistantLaunch } = await import('../src/local-assistant/use-phone-assistant-launch');
let root: ReactTestRenderer;
let launch: ReturnType<typeof usePhoneAssistantLaunch>;
let starts: AbortSignal[];
let stops: number;
let startImpl: (signal: AbortSignal) => Promise<void>;
function Harness({ id = 'press-1', available = true }: { id?: string; available?: boolean }) {
  launch = usePhoneAssistantLaunch({ requestId: id, rendered: true, available,
    start: async (signal) => { starts.push(signal); await startImpl(signal); },
  });
  return null;
}
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 230)); });
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  starts = []; stops = 0; permitted = true; focused = true; claimed = false;
  appState.currentState = 'active'; ready = async () => true; startImpl = async () => {};
});
afterEach(async () => {
  await act(async () => root?.unmount());
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

test('cold launch waits for the workspace, starts once, and a new press can resume', async () => {
  await act(async () => { root = create(<Harness available={false} />); });
  await tick(); expect(starts).toHaveLength(0);
  await act(async () => { root.update(<Harness />); });
  await tick(); expect(starts).toHaveLength(1);
  await act(async () => { root.update(<Harness />); });
  await tick(); expect(starts).toHaveLength(1);
  claimed = false; // The native service issued a fresh request.
  await act(async () => { root.update(<Harness id="press-2" />); });
  expect(starts).toHaveLength(2);
});

test('dismissal during hydration prevents a later microphone start', async () => {
  await act(async () => { root = create(<Harness available={false} />); });
  await act(async () => launch.cancel());
  await act(async () => { root.update(<Harness />); });
  await tick(); expect(starts).toHaveLength(0);
  expect(launch.pending).toBe(false);
});

test('leaving the screen aborts a pending connection without restarting on foreground', async () => {
  startImpl = (signal) => new Promise((resolve) => signal.addEventListener('abort', () => { stops++; resolve(); }));
  await act(async () => { root = create(<Harness />); });
  expect(starts).toHaveLength(1);
  await act(async () => {
    appState.currentState = 'background'; listeners.forEach((listener) => listener('background'));
  });
  expect(starts[0]!.aborted).toBe(true); expect(stops).toBe(1);
  await act(async () => {
    appState.currentState = 'active'; listeners.forEach((listener) => listener('active'));
  });
  await tick(); expect(starts).toHaveLength(1);
});

test('backgrounding an established conversation keeps Live running', async () => {
  await act(async () => { root = create(<Harness />); });
  await act(async () => {
    appState.currentState = 'background'; listeners.forEach((listener) => listener('background'));
  });
  expect(stops).toBe(0); expect(launch.error).toBe('');
});

test('a rejected native request never starts audio', async () => {
  ready = async () => false;
  await act(async () => { root = create(<Harness />); });
  await tick(); expect(starts).toHaveLength(0);
  expect(launch.error).toContain('ended');
});

test('missing audio permission shows setup guidance and an explicit retry can start after granting it', async () => {
  permitted = false;
  await act(async () => { root = create(<Harness />); });
  expect(starts).toHaveLength(0); expect(launch.error).toContain('allow microphone');
  permitted = true;
  await act(async () => launch.retry());
  expect(starts).toHaveLength(1);
});

test('a delayed ready response cannot revive a dismissed invocation', async () => {
  let resolve!: (value: boolean) => void;
  ready = () => new Promise((done) => { resolve = done; });
  await act(async () => { root = create(<Harness />); });
  await act(async () => launch.cancel());
  await act(async () => resolve(true));
  await tick(); expect(starts).toHaveLength(0);
});

test('backgrounding before native ready cancels the press even if the activity returns later', async () => {
  let resolve!: (value: boolean) => void;
  ready = () => new Promise((done) => { resolve = done; });
  await act(async () => { root = create(<Harness />); });
  await act(async () => {
    appState.currentState = 'background'; listeners.forEach((listener) => listener('background'));
  });
  await act(async () => resolve(true));
  await act(async () => {
    appState.currentState = 'active'; listeners.forEach((listener) => listener('active'));
  });
  await tick(); expect(starts).toHaveLength(0);
});

test('remounting the assistant surface does not replay a consumed press', async () => {
  await act(async () => { root = create(<Harness />); });
  expect(starts).toHaveLength(1);
  await act(async () => { root.unmount(); });
  await act(async () => { root = create(<Harness />); });
  await tick(); expect(starts).toHaveLength(1);
  await act(async () => { await launch.retry(); });
  expect(starts).toHaveLength(2);
});
