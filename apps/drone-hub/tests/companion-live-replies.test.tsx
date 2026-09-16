import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import { CompanionClientController, waitForCompanionReply, type CompanionServerMessage } from '@drone/assistant-chat';
import { CompanionLiveConnection } from '../src/droneHub/companion/CompanionLiveConnection';
import { useCompanionLive } from '../src/droneHub/companion/use-companion-live';

test('desktop supplies backend completion context after restarting Live, including subscription results', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  set('window', dom); set('document', dom.document); set('IS_REACT_ACT_ENVIRONMENT', true);
  set('fetch', async () => Response.json({ enabled: true, systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 8000 }));
  const connections: Array<{ connection: CompanionLiveConnection; callbacks: any }> = [];
  const sent: Array<{ connection: CompanionLiveConnection; event: Record<string, unknown> }> = [];
  const start = spyOn(CompanionLiveConnection.prototype, 'start').mockImplementation(async function (this: CompanionLiveConnection) {
    const callbacks = (this as any).options;
    connections.push({ connection: this, callbacks });
    callbacks.onReady('backend');
  });
  const send = spyOn(CompanionLiveConnection.prototype, 'send').mockImplementation(function (this: CompanionLiveConnection, event) { sent.push({ connection: this, event }); });
  const close = spyOn(CompanionLiveConnection.prototype, 'close').mockImplementation(() => {});
  let nextId = 0;
  const controller = new CompanionClientController({ createId: () => String(++nextId) });
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
  let live!: ReturnType<typeof useCompanionLive>;
  function Harness() { live = useCompanionLive(controller); return null; }
  const element = dom.document.createElement('div');
  dom.document.body.append(element);
  const root = createRoot(element as unknown as HTMLElement);
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await live.start(run, 'Workspace'); });
    expect(live.hasStarted).toBe(true);
    // Stopping before any backend turn must still leave Companion available.
    await act(async () => { live.stop(); });
    expect(live.status).toBe('idle');
    expect(live.hasStarted).toBe(true);
    await act(async () => { await live.start(run, 'Workspace'); });
    const old = connections.at(-1)!;
    await act(async () => {
      old.callbacks.onEvent({ type: 'session.input_transcript.delta', delta: 'Check this' });
      old.callbacks.onEvent({ type: 'session.delegation.created', delegation: { id: 'old', target: 'client' } });
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await act(async () => { live.stop(); });
    expect(live.hasStarted).toBe(true);
    expect(controller.getSnapshot().status).toBe('working');
    expect(backendCalls).toEqual([]);
    await act(async () => { await live.start(run, 'Workspace'); });
    const current = connections.at(-1)!;
    await act(async () => {
      receive({ type: 'reply', messageId, reply: 'Finished' });
      receive({ type: 'status', messageId, status: 'completed' });
      receive({ type: 'subscription', messageId: 'subscription' });
      receive({ type: 'reply', messageId: 'subscription', reply: 'Notification' });
      receive({ type: 'status', messageId: 'subscription', status: 'completed' });
    });
    expect(sent.map(({ event }) => event)).toEqual([
      { type: 'session.thinking.append', delegation_id: null, content: 'Finished' },
      { type: 'session.commentary.append', delegation_id: null, content: 'Notification' },
    ]);
    expect(sent.every(({ connection }) => connection === current.connection)).toBe(true);
    await act(async () => { live.reset(); });
    expect(live.hasStarted).toBe(false);
    expect(backendCalls).toEqual([]);
  } finally {
    await act(async () => { root.unmount(); await controller.close(); });
    start.mockRestore(); send.mockRestore(); close.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});

test('desktop automatically reconnects with backoff but an explicit stop cancels it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  set('window', dom); set('document', dom.document); set('IS_REACT_ACT_ENVIRONMENT', true);
  set('fetch', async () => Response.json({ enabled: true, systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 8000 }));
  const connections: Array<{ callbacks: any; closed: number }> = [];
  const start = spyOn(CompanionLiveConnection.prototype, 'start').mockImplementation(async function (this: CompanionLiveConnection) {
    connections.push({ callbacks: (this as any).options, closed: 0 });
  });
  const close = spyOn(CompanionLiveConnection.prototype, 'close').mockImplementation(function (this: CompanionLiveConnection) {
    const found = connections.find((entry) => entry.callbacks === (this as any).options);
    if (found) found.closed += 1;
  });
  const scheduled: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
  const schedule = (callback: () => void, delay: number) => {
    const entry = { callback, delay, cancelled: false };
    scheduled.push(entry);
    return () => { entry.cancelled = true; };
  };
  let live!: ReturnType<typeof useCompanionLive>;
  function Harness() { live = useCompanionLive(undefined, schedule); return null; }
  const element = dom.document.createElement('div');
  dom.document.body.append(element);
  const root = createRoot(element as unknown as HTMLElement);
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await live.start(async () => 'reply', 'Workspace'); });
    await act(async () => { connections[0].callbacks.onReady('backend'); });
    expect(live.status).toBe('listening');

    await act(async () => { connections[0].callbacks.onError('Hub restarted'); });
    expect(live.status).toBe('connecting');
    expect(scheduled.map((entry) => entry.delay)).toEqual([1_000]);
    await act(async () => { scheduled[0].callback(); await Promise.resolve(); });
    expect(connections).toHaveLength(2);

    await act(async () => { connections[1].callbacks.onError('Still offline'); });
    expect(scheduled.map((entry) => entry.delay)).toEqual([1_000, 2_000]);
    await act(async () => { scheduled[1].callback(); await Promise.resolve(); });
    expect(connections).toHaveLength(3);
    await act(async () => {
      connections[2].callbacks.onReady('backend');
      connections[2].callbacks.onError('Disconnected again');
    });
    expect(scheduled.map((entry) => entry.delay)).toEqual([1_000, 2_000, 1_000]);
    await act(async () => { live.stop(); });
    expect(live.status).toBe('idle');
    expect(scheduled[2].cancelled).toBe(true);
    await act(async () => { scheduled[2].callback(); await Promise.resolve(); });
    expect(connections).toHaveLength(3);
  } finally {
    await act(async () => { root.unmount(); });
    start.mockRestore(); close.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
