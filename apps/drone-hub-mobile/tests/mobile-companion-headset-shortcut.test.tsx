import React, { act } from 'react';
import { createRequire } from 'node:module';
import type { ReactTestRenderer } from 'react-test-renderer';
import { expect, mock, test } from 'bun:test';

let stored: string | null = null;
let listener: ((state: string) => void) | undefined;
const appState = { currentState: 'active', addEventListener: (_event: string, fn: typeof listener) => {
  listener = fn; return { remove() { listener = undefined; } };
} };
mock.module('react-native', () => ({ AppState: appState, Platform: { OS: 'android' } }));
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async () => stored, setItem: async (_key: string, value: string) => { stored = value; },
} }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { useMobileCompanionHeadsetShortcut } = await import('../src/local-assistant/use-mobile-companion-headset-shortcut');

async function harness(setArmed: (value: boolean) => Promise<void>) {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer; let setting!: ReturnType<typeof useMobileCompanionHeadsetShortcut>;
  function Capture() { setting = useMobileCompanionHeadsetShortcut(setArmed); return null; }
  await act(async () => { root = create(<Capture />); });
  return { setting: () => setting, async cleanup() {
    await act(async () => root.unmount()); appState.currentState = 'active';
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  } };
}

test('shortcut defaults off and persists explicit opt-in; notification End turns it off', async () => {
  stored = null; const calls: boolean[] = [];
  const h = await harness(async (value) => { calls.push(value); });
  try {
    expect(h.setting().enabled).toBe(false); expect(calls).toEqual([]);
    await act(async () => { await h.setting().save(true); });
    expect(stored).toBe('on'); expect(h.setting().enabled).toBe(true);
    await act(async () => { h.setting().ended(); });
    expect(stored).toBe('off'); expect(h.setting().enabled).toBe(false);
    const count = calls.length;
    await act(async () => { listener?.('active'); });
    expect(calls).toHaveLength(count);
  } finally { await h.cleanup(); }
});

test('saved opt-in waits for a visible activity before rearming after app startup', async () => {
  stored = 'on'; appState.currentState = 'background'; const calls: boolean[] = [];
  const h = await harness(async (value) => { calls.push(value); });
  try {
    expect(h.setting().enabled).toBe(true); expect(calls).toEqual([]);
    await act(async () => { appState.currentState = 'active'; listener?.('active'); });
    expect(calls).toEqual([true]);
    await act(async () => { await h.setting().save(false); });
    expect(calls).toEqual([true, false]); expect(stored).toBe('off');
  } finally { await h.cleanup(); }
});

test('permission failure leaves new shortcut disabled and exposes the error', async () => {
  stored = null;
  const h = await harness(async (value) => { if (value) throw new Error('Microphone permission required'); });
  try {
    await act(async () => { await h.setting().save(true); });
    expect(h.setting().enabled).toBe(false); expect(stored).toBeNull();
    expect(h.setting().error).toBe('Microphone permission required');
  } finally { await h.cleanup(); }
});
