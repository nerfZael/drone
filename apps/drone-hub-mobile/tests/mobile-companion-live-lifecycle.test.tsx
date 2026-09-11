import React, { act } from 'react';
import { createRequire } from 'node:module';
import type { ReactTestRenderer } from 'react-test-renderer';
import { expect, mock, test } from 'bun:test';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';

let appStateListener: ((state: string) => void) | null = null;
let prepareAudio: () => Promise<void> = async () => {};
const connections: Array<{ options: any; closed: number }> = [];
const platform = { OS: 'ios' };
let stopFromNotification: (() => void) | undefined;
mock.module('react-native', () => ({ Platform: platform, AppState: { currentState: 'active',
  addEventListener: (_event: string, callback: (state: string) => void) => {
    appStateListener = callback; return { remove() { appStateListener = null; } };
  } } }));
mock.module('expo-crypto', () => ({ randomUUID: () => 'voice-session' }));
mock.module('../src/mesh/MeshContext', () => ({ useMesh: () => ({ request: async () => ({}), subscribe: () => () => {} }) }));
mock.module('../src/local-assistant/openMobileLiveAudio', () => ({
  openMobileLiveAudio: async (onStopped: () => void) => { stopFromNotification = onStopped; return {}; },
  prepareMobileLiveAudio: () => prepareAudio(),
}));
mock.module('../src/local-assistant/MobileCompanionLiveConnection', () => ({
  MobileCompanionLiveConnection: class {
    readonly instance: { options: any; closed: number };
    constructor(options: any) { this.instance = { options, closed: 0 }; connections.push(this.instance); }
    async start() { await this.instance.options.openAudio(); this.instance.options.onReady('selected-backend'); }
    close() { this.instance.closed++; }
    mute() {} send() {}
  },
}));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { useMobileCompanionLive } = await import('../src/local-assistant/use-mobile-companion-live');

test('Android Live survives screen lock and the notification Stop ends the session', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  platform.OS = 'android';
  let root!: ReactTestRenderer;
  let live!: ReturnType<typeof useMobileCompanionLive>;
  let signal: AbortSignal | undefined;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', async (_prompt, abort) => {
      signal = abort;
      return new Promise((resolve) => abort.addEventListener('abort', () => resolve('stopped')));
    }); });
    const connection = connections.at(-1)!;
    await act(async () => {
      appStateListener?.('background');
      connection.options.onEvent({ type: 'session.input_transcript.delta', delta: 'Check this.', turn_id: 'turn' });
      connection.options.onEvent({ type: 'session.delegation.created', delegation: { id: 'delegation', target: 'client' } });
      await new Promise((resolve) => setTimeout(resolve, 550));
    });
    expect(live.status).toBe('listening');
    expect(connection.closed).toBe(0);
    expect(signal?.aborted).toBe(false);
    await act(async () => { stopFromNotification?.(); });
    expect(signal?.aborted).toBe(true);
    expect(connection.closed).toBe(1);
    expect(live.status).toBe('idle');
  } finally {
    await act(async () => root.unmount());
    platform.OS = 'ios';
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('permission dialog backgrounding keeps startup visible and dismissal cancels pending startup', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  const permission = Promise.withResolvers<void>();
  prepareAudio = () => permission.promise;
  let starting!: Promise<void>;
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { starting = live.start('hub', 'Hub', async () => 'reply'); });
    await act(async () => { appStateListener?.('background'); });
    expect(live.status).toBe('connecting');
    await act(async () => { appStateListener?.('active'); permission.resolve(); await starting; });
    expect(live.status).toBe('listening');
    await act(async () => { live.stop(); });

    const latePermission = Promise.withResolvers<void>();
    prepareAudio = () => latePermission.promise;
    const count = connections.length;
    await act(async () => { starting = live.start('hub', 'Hub', async () => 'reply'); });
    await act(async () => { live.stop(); latePermission.resolve(); await starting; });
    expect(live.status).toBe('idle');
    expect(connections).toHaveLength(count);
  } finally {
    permission.resolve();
    prepareAudio = async () => {};
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('mobile backgrounding ends voice, aborts pending delegation waits, and ignores stale events', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  let live!: ReturnType<typeof useMobileCompanionLive>;
  let signal: AbortSignal | undefined;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', async (_prompt, abort) => {
      signal = abort;
      return new Promise((resolve) => abort.addEventListener('abort', () => resolve('stopped')));
    }); });
    expect(live.status).toBe('listening'); expect(live.backendModel).toBe('selected-backend');
    const connection = connections.at(-1)!;
    await act(async () => {
      connection.options.onEvent({ type: 'session.input_transcript.delta', delta: 'Please check this.', turn_id: 'turn' });
      connection.options.onEvent({ type: 'session.delegation.created', delegation: { id: 'delegation', target: 'client' } });
      await new Promise((resolve) => setTimeout(resolve, 550));
    });
    expect(signal?.aborted).toBe(false);
    await act(async () => { appStateListener?.('background'); });
    expect(signal?.aborted).toBe(true); expect(connection.closed).toBe(1); expect(live.status).toBe('idle');
    await act(async () => { connection.options.onReady('stale'); connection.options.onError('stale error'); });
    expect(live.status).toBe('idle'); expect(live.error).toBe('');
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
