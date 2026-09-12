import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import { CompanionClientController, waitForCompanionReply, type CompanionServerMessage } from '@drone/assistant-chat';
import { CompanionLiveConnection } from '../src/droneHub/companion/CompanionLiveConnection';
import { useCompanionLive } from '../src/droneHub/companion/use-companion-live';

test('desktop speaks a pending backend completion after restarting Live, then speaks subscription results', async () => {
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
      { type: 'session.commentary.append', delegation_id: null, content: 'Finished' },
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
