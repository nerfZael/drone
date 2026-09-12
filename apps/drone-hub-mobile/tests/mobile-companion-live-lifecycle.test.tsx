import React, { act } from 'react';
import { createRequire } from 'node:module';
import type { ReactTestRenderer } from 'react-test-renderer';
import { expect, mock, test } from 'bun:test';
import { CompanionClientController, waitForCompanionReply, type CompanionServerMessage } from '@drone/assistant-chat';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';

let appStateListener: ((state: string) => void) | null = null;
let prepareAudio: () => Promise<void> = async () => {};
const connections: Array<{ options: any; closed: number; sent: Record<string, unknown>[] }> = [];
let mediaAction: ((action: 'play' | 'pause' | 'stop' | 'end') => void) | undefined;
let controlsReleased = 0;
const cues: string[] = [];
const controlStates: string[] = [];
const controlModes: boolean[] = [];
let cuePlayback: (kind: string) => Promise<void> = async () => {};
let releaseAudio: () => Promise<void> = async () => {};
let connectImmediately = true;
const appState = { currentState: 'active', addEventListener: (_event: string, callback: (state: string) => void) => {
  appStateListener = callback; return { remove() { appStateListener = null; } };
} };
const platform = { OS: 'ios' };
let stopFromNotification: (() => void) | undefined;
mock.module('react-native', () => ({ Platform: platform, AppState: appState }));
mock.module('../src/local-assistant/mobile-live-controls', () => ({ openMobileLiveControls: async (action: typeof mediaAction, standby = false) => {
  controlModes.push(standby);
  mediaAction = action; return { update: async (state: string) => { controlStates.push(state); }, cue: async (kind: string) => { cues.push(kind); await cuePlayback(kind); }, release: async () => { controlsReleased++; } };
} }));
mock.module('expo-crypto', () => ({ randomUUID: () => 'voice-session' }));
mock.module('../src/mesh/MeshContext', () => ({ useMesh: () => ({ request: async () => ({}), subscribe: () => () => {} }) }));
mock.module('../src/local-assistant/openMobileLiveAudio', () => ({
  openMobileLiveAudio: async (_callbacks: unknown, onStopped: () => void, options: any) => { stopFromNotification = onStopped; return { release: () => options.onCaptureStopped() }; },
  prepareMobileLiveAudio: () => prepareAudio(),
}));
mock.module('../src/local-assistant/MobileCompanionLiveConnection', () => ({
  MobileCompanionLiveConnection: class {
    readonly instance: { options: any; closed: number; sent: Record<string, unknown>[] };
    private audio: any;
    constructor(options: any) { this.instance = { options, closed: 0, sent: [] }; connections.push(this.instance); }
    async start() {
      this.audio = await this.instance.options.openAudio();
      this.instance.options.onCapturing();
      if (connectImmediately) this.instance.options.onReady('selected-backend');
    }
    close() { this.instance.closed++; return releaseAudio().then(() => this.audio?.release()); }
    mute() {} send(event: Record<string, unknown>) { this.instance.sent.push(event); }
  },
}));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { useMobileCompanionLive } = await import('../src/local-assistant/use-mobile-companion-live');

test('start cue announces capture while Live connects and does not sound again on connection', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  try {
    connectImmediately = false; cues.length = 0;
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', async () => 'reply'); });
    expect(live.status).toBe('connecting');
    expect(live.capturing).toBe(true);
    expect(cues).toEqual(['recording']);
    await act(async () => { connections.at(-1)!.options.onReady('selected-backend'); });
    expect(live.status).toBe('listening');
    expect(cues).toEqual(['recording']);
  } finally {
    connectImmediately = true;
    await act(async () => { root?.unmount(); });
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

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
    await act(async () => { mediaAction?.('end'); });
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


test('mobile reconnect routes backend completion and subscription replies to the current Live connection', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  let live!: ReturnType<typeof useMobileCompanionLive>;
  let nextId = 0;
  const controller = new CompanionClientController({ createId: () => String(++nextId) });
  const coordinator = new MobileMicrophoneCoordinator();
  let receive!: (event: CompanionServerMessage) => void;
  let messageId = '';
  const backendCalls: string[] = [];
  const run = (_prompt: string, signal: AbortSignal) => waitForCompanionReply(controller, () => controller.submitPrompt({
    prompt: 'Check this', executeTool: () => ({}), createTransport: () => ({
      open: async (options) => { receive = options.onMessage; return undefined; },
      sendPrompt: (input) => { messageId = input.messageId; },
      sendToolResult: () => {}, cancel: () => { backendCalls.push('cancel'); }, close: () => { backendCalls.push('close'); },
    }),
  }), signal);
  function Capture() { live = useMobileCompanionLive(coordinator, controller); return null; }
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', run); });
    expect(live.hasStarted).toBe(true);
    await act(async () => { live.stop(); });
    expect(live.status).toBe('idle');
    expect(live.hasStarted).toBe(true);
    await act(async () => { await live.start('hub', 'Hub', run); });
    const old = connections.at(-1)!;
    await act(async () => {
      old.options.onEvent({ type: 'session.input_transcript.delta', delta: 'Check this' });
      old.options.onEvent({ type: 'session.delegation.created', delegation: { id: 'old', target: 'client' } });
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await act(async () => { live.stop(); });
    expect(live.hasStarted).toBe(true);
    expect(controller.getSnapshot().status).toBe('working');
    expect(backendCalls).toEqual([]);
    const preparation = Promise.withResolvers<void>();
    prepareAudio = () => preparation.promise;
    let restarting!: Promise<void>;
    await act(async () => { restarting = live.start('hub', 'Hub', run); });
    await act(async () => {
      receive({ type: 'reply', messageId, reply: 'Finished' });
      receive({ type: 'status', messageId, status: 'completed' });
    });
    expect(old.sent).toEqual([]);
    await act(async () => { preparation.resolve(); await restarting; });
    const current = connections.at(-1)!;
    await act(async () => {
      receive({ type: 'subscription', messageId: 'subscription' });
      receive({ type: 'reply', messageId: 'subscription', reply: 'Notification' });
      receive({ type: 'status', messageId: 'subscription', status: 'completed' });
    });
    expect(old.sent).toEqual([]);
    expect(current.sent).toEqual([
      { type: 'session.commentary.append', delegation_id: null, content: 'Finished' },
      { type: 'session.commentary.append', delegation_id: null, content: 'Notification' },
    ]);
    await act(async () => { live.reset(); });
    expect(live.hasStarted).toBe(false);
    expect(backendCalls).toEqual([]);
  } finally {
    await act(async () => { root.unmount(); await controller.close(); });
    prepareAudio = async () => {};
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('headset stop preserves Companion and submitted backend work, and play resumes while locked', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  let nextId = 0;
  const controller = new CompanionClientController({ createId: () => String(++nextId) });
  const coordinator = new MobileMicrophoneCoordinator();
  const backendCalls: string[] = [];
  let receive!: (event: CompanionServerMessage) => void;
  let messageId = '';
  function Capture() { live = useMobileCompanionLive(coordinator, controller); return null; }
  const releasedBefore = controlsReleased;
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.start('hub', 'Hub', async () => 'reply'); });
    await controller.submitPrompt({ prompt: 'Work continues', executeTool: () => ({}), createTransport: () => ({
      open: async (options) => { receive = options.onMessage; return undefined; },
      sendPrompt: (input) => { messageId = input.messageId; }, sendToolResult: () => {},
      cancel: () => { backendCalls.push('cancel'); }, close: () => { backendCalls.push('close'); },
    }) });
    const first = connections.at(-1)!;
    await act(async () => { appState.currentState = 'background'; mediaAction?.('stop'); });
    expect(first.closed).toBe(1);
    expect(live.status).toBe('paused');
    expect(live.hasStarted).toBe(true);
    expect(controlsReleased).toBe(releasedBefore);
    expect(controller.getSnapshot().status).toBe('working');
    expect(backendCalls).toEqual([]);
    await act(async () => { mediaAction?.('play'); });
    expect(live.status).toBe('listening');
    const current = connections.at(-1)!;
    expect(current).not.toBe(first);
    await act(async () => {
      receive({ type: 'reply', messageId, reply: 'Finished' });
      receive({ type: 'status', messageId, status: 'completed' });
    });
    expect(current.sent).toEqual([{ type: 'session.commentary.append', delegation_id: null, content: 'Finished' }]);
    // The app's stop control uses the same pause path; the headset can restart it.
    await act(async () => { live.pause(); });
    expect(live.status).toBe('paused');
    await act(async () => { mediaAction?.('play'); });
    expect(live.status).toBe('listening');
    await act(async () => { live.reset(); });
    const count = connections.length;
    expect(live.hasStarted).toBe(false);
    expect(controlsReleased).toBe(releasedBefore + 1);
    await act(async () => { mediaAction?.('play'); });
    expect(connections).toHaveLength(count);
    expect(backendCalls).toEqual([]);
  } finally {
    appState.currentState = 'active';
    await act(async () => { root.unmount(); await controller.close(); });
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});


test('opt-in shortcut arms without capture, opens Live while locked, and survives closing Companion', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  platform.OS = 'android';
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  let ended = 0;
  function Capture() { live = useMobileCompanionLive(coordinator, undefined, {
    start: () => live.start('hub', 'Hub', async () => 'reply'), ended: () => { ended++; },
  }); return null; }
  const count = connections.length; const releases = controlsReleased;
  try {
    controlModes.length = 0;
    await act(async () => { root = create(<Capture />); });
    expect(live.shortcutArmed).toBe(false);
    expect(controlModes).toEqual([]);
    await act(async () => { await live.setHeadsetShortcut(true); });
    expect(controlModes).toEqual([true]);
    expect(live.shortcutArmed).toBe(true);
    expect(live.status).toBe('idle'); expect(live.hasStarted).toBe(false);
    expect(connections).toHaveLength(count); expect(coordinator.getSnapshot()).toBeNull();
    await act(async () => { appState.currentState = 'background'; mediaAction?.('play'); });
    expect(live.status).toBe('listening');
    await act(async () => { live.reset(); });
    expect(live.hasStarted).toBe(false); expect(live.shortcutArmed).toBe(true);
    expect(controlsReleased).toBe(releases);
    expect(controlStates.at(-1)).toBe('paused');
    await act(async () => { mediaAction?.('play'); });
    expect(connections).toHaveLength(count + 2); expect(live.status).toBe('listening');
    await act(async () => { mediaAction?.('pause'); });
    expect(live.status).toBe('paused');
    await act(async () => { mediaAction?.('play'); });
    expect(live.status).toBe('listening');
    await act(async () => { mediaAction?.('end'); });
    expect(ended).toBe(1); expect(live.shortcutArmed).toBe(false);
    expect(controlsReleased).toBe(releases + 1);
    const stoppedCount = connections.length;
    await act(async () => { mediaAction?.('play'); });
    expect(connections).toHaveLength(stoppedCount);
  } finally {
    appState.currentState = 'active'; platform.OS = 'ios';
    await act(async () => { root?.unmount(); });
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('disabling idle shortcut releases controls; disabling during Live preserves normal pause/resume', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  platform.OS = 'android';
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  const releases = controlsReleased;
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.setHeadsetShortcut(true); });
    await act(async () => { await live.setHeadsetShortcut(false); });
    expect(controlsReleased).toBe(releases + 1);
    await act(async () => { await live.setHeadsetShortcut(true); });
    await act(async () => { await live.start('hub', 'Hub', async () => 'reply'); });
    await act(async () => { await live.setHeadsetShortcut(false); });
    expect(live.status).toBe('listening'); expect(controlsReleased).toBe(releases + 1);
    await act(async () => { live.pause(); mediaAction?.('play'); });
    expect(live.status).toBe('listening');
    await act(async () => { live.reset(); });
    expect(controlsReleased).toBe(releases + 2);
  } finally {
    platform.OS = 'ios'; await act(async () => { root?.unmount(); });
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('concurrent shortcut arming and Live startup share controls in either order', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  platform.OS = 'android';
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  try {
    await act(async () => { root = create(<Capture />); });
    for (const armFirst of [true, false]) {
      const before = controlModes.length;
      await act(async () => {
        if (armFirst) await Promise.all([live.setHeadsetShortcut(true), live.start('hub', 'Hub', async () => 'reply')]);
        else await Promise.all([live.start('hub', 'Hub', async () => 'reply'), live.setHeadsetShortcut(true)]);
      });
      expect(live.status).toBe('listening'); expect(live.shortcutArmed).toBe(true);
      expect(controlModes.length).toBe(before + 1);
      await act(async () => { await live.setHeadsetShortcut(false); live.reset(); });
    }
  } finally {
    platform.OS = 'ios'; await act(async () => { root?.unmount(); });
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});


test('closing and immediately toggling a cold shortcut can cancel startup before old audio releases', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  platform.OS = 'android';
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  const released = Promise.withResolvers<void>();
  function Capture() { live = useMobileCompanionLive(coordinator, undefined, {
    start: () => live.start('hub', 'Hub', async () => 'reply'), ended() {},
  }); return null; }
  try {
    await act(async () => { root = create(<Capture />); });
    await act(async () => { await live.setHeadsetShortcut(true); await live.start('hub', 'Hub', async () => 'reply'); });
    const count = connections.length;
    releaseAudio = () => released.promise;
    await act(async () => { live.reset(); mediaAction?.('play'); mediaAction?.('pause'); });
    expect(live.status).toBe('paused');
    await act(async () => { released.resolve(); });
    expect(connections).toHaveLength(count);
    await act(async () => { mediaAction?.('play'); });
    expect(live.status).toBe('listening'); expect(connections).toHaveLength(count + 1);
  } finally {
    released.resolve(); releaseAudio = async () => {}; platform.OS = 'ios';
    await act(async () => { root?.unmount(); });
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

test('disabling while shortcut permission is pending never opens background controls', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  platform.OS = 'android';
  let root!: ReactTestRenderer; let live!: ReturnType<typeof useMobileCompanionLive>;
  const coordinator = new MobileMicrophoneCoordinator();
  const permission = Promise.withResolvers<void>();
  function Capture() { live = useMobileCompanionLive(coordinator); return null; }
  let enabling!: Promise<void>;
  try {
    prepareAudio = () => permission.promise;
    const count = controlModes.length;
    await act(async () => { root = create(<Capture />); });
    await act(async () => { enabling = live.setHeadsetShortcut(true); });
    await act(async () => {
      const disabling = live.setHeadsetShortcut(false);
      permission.resolve(); await Promise.all([enabling, disabling]);
    });
    expect(live.shortcutArmed).toBe(false); expect(controlModes).toHaveLength(count);
  } finally {
    permission.resolve(); prepareAudio = async () => {}; platform.OS = 'ios';
    await act(async () => { root?.unmount(); });
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
