import React, { act } from 'react';
import { createRequire } from 'node:module';
import type { ReactTestRenderer } from 'react-test-renderer';
import { expect, mock, test } from 'bun:test';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';

let appStateListener: ((state: string) => void) | null = null;
let prepareAudio: () => Promise<void> = async () => {};
const connections: Array<{ options: any; closed: number }> = [];
let mediaAction: ((action: 'play' | 'pause' | 'stop') => void) | undefined;
let controlsReleased = 0;
const cues: string[] = [];
let cuePlayback: (kind: string) => Promise<void> = async () => {};
let releaseAudio: () => Promise<void> = async () => {};
const appState = { currentState: 'active', addEventListener: (_event: string, callback: (state: string) => void) => {
  appStateListener = callback; return { remove() { appStateListener = null; } };
} };
const platform = { OS: 'ios' };
let stopFromNotification: (() => void) | undefined;
mock.module('react-native', () => ({ Platform: platform, AppState: appState }));
mock.module('../src/local-assistant/mobile-live-controls', () => ({ openMobileLiveControls: async (action: typeof mediaAction) => {
  mediaAction = action; return { update: async () => {}, cue: async (kind: string) => { cues.push(kind); await cuePlayback(kind); }, release: async () => { controlsReleased++; } };
} }));
mock.module('expo-crypto', () => ({ randomUUID: () => 'voice-session' }));
mock.module('../src/mesh/MeshContext', () => ({ useMesh: () => ({ request: async () => ({}), subscribe: () => () => {} }) }));
mock.module('../src/local-assistant/openMobileLiveAudio', () => ({
  openMobileLiveAudio: async (_callbacks: unknown, onStopped: () => void, options: any) => { stopFromNotification = onStopped; return { release: () => options.onCaptureStopped() }; },
  prepareMobileLiveAudio: () => prepareAudio(),
}));
mock.module('../src/local-assistant/MobileCompanionLiveConnection', () => ({
  MobileCompanionLiveConnection: class {
    readonly instance: { options: any; closed: number };
    private audio: any;
    constructor(options: any) { this.instance = { options, closed: 0 }; connections.push(this.instance); }
    async start() { this.audio = await this.instance.options.openAudio(); this.instance.options.onCapturing(); this.instance.options.onReady('selected-backend'); }
    close() { this.instance.closed++; return releaseAudio().then(() => this.audio?.release()); }
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

test('iOS Live survives backgrounding; explicit stop aborts delegation waits and ignores stale events', async () => {
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
    await act(async () => { appState.currentState = 'background'; appStateListener?.('background'); });
    expect(live.status).toBe('listening'); expect(signal?.aborted).toBe(false);
    await act(async () => { live.stop(); });
    appState.currentState = 'active';
    expect(signal?.aborted).toBe(true); expect(connection.closed).toBe(1); expect(live.status).toBe('idle');
    await act(async () => { connection.options.onReady('stale'); connection.options.onError('stale error'); });
    expect(live.status).toBe('idle'); expect(live.error).toBe('');
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('headset pause closes Live; locked-screen play starts fresh audio after cleanup', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  const releasedBefore = controlsReleased;
  const released = Promise.withResolvers<void>();
  try {
    cues.length = 0;
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', async () => 'reply'); });
    expect(cues).toEqual(['recording']);
    const first = connections.at(-1)!; const count = connections.length;
    releaseAudio = () => released.promise;
    await act(async () => { appState.currentState = 'background'; mediaAction?.('pause'); });
    expect(live.status).toBe('paused'); expect(first.closed).toBe(1);
    expect(controlsReleased).toBe(releasedBefore);
    expect(cues).toEqual(['recording']); // No stopped cue before capture actually releases.
    await act(async () => { mediaAction?.('play'); mediaAction?.('play'); });
    expect(connections).toHaveLength(count);
    await act(async () => { released.resolve(); });
    expect(connections).toHaveLength(count + 1);
    expect(live.status).toBe('listening');
    expect(connections.at(-1)).not.toBe(first);
    expect(cues).toEqual(['recording', 'stopped', 'recording']);
    await act(async () => { first.options.onReady('stale'); first.options.onError('stale'); });
    expect(live.status).toBe('listening'); expect(live.error).toBe('');
    await act(async () => { mediaAction?.('stop'); });
    expect(live.status).toBe('idle'); expect(controlsReleased).toBe(releasedBefore + 1);
    const endedCount = connections.length;
    await act(async () => { mediaAction?.('play'); });
    expect(connections).toHaveLength(endedCount);
  } finally {
    released.resolve(); releaseAudio = async () => {}; appState.currentState = 'active';
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('ending a paused session prevents a queued headset resume from reopening audio', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  const released = Promise.withResolvers<void>();
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', async () => 'reply'); });
    const count = connections.length;
    releaseAudio = () => released.promise;
    await act(async () => { mediaAction?.('pause'); mediaAction?.('play'); live.stop(); released.resolve(); });
    expect(live.status).toBe('idle'); expect(connections).toHaveLength(count);
  } finally {
    released.resolve(); releaseAudio = async () => {};
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('a late cue failure from the previous recording cannot end the resumed session', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  const cue = Promise.withResolvers<void>();
  try {
    cuePlayback = (kind) => kind === 'recording' ? cue.promise : Promise.resolve();
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', async () => 'reply'); });
    await act(async () => { mediaAction?.('pause'); });
    cuePlayback = async () => {};
    await act(async () => { mediaAction?.('play'); });
    const resumed = connections.at(-1)!;
    await act(async () => { cue.reject(new Error('Late cue failure')); });
    expect(live.status).toBe('listening'); expect(resumed.closed).toBe(0);
  } finally {
    cue.resolve(); cuePlayback = async () => {};
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
