import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import { CompanionClientController, type CompanionServerMessage } from '@drone/assistant-chat';
import { CompanionLiveConnection } from '../src/droneHub/companion/CompanionLiveConnection';
import { useCompanionLive } from '../src/droneHub/companion/use-companion-live';

async function harness(initialEnabled = true) {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let enabled = initialEnabled;
  let nextCleanup: Promise<void> | undefined;
  for (const [name, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (_url: string, init: RequestInit) => {
      if (init.method === 'PUT' && typeof JSON.parse(String(init.body)).enabled === 'boolean') enabled = JSON.parse(String(init.body)).enabled;
      return Response.json({ enabled, systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 8000 });
    } })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const connections: Array<{ callbacks: any; closed: boolean; events: Record<string, unknown>[]; muted: boolean }> = [];
  const start = spyOn(CompanionLiveConnection.prototype, 'start').mockImplementation(async function (this: CompanionLiveConnection) {
    connections.push({ callbacks: (this as any).options, closed: false, events: [], muted: (this as any).muted });
  });
  const send = spyOn(CompanionLiveConnection.prototype, 'send').mockImplementation(function (this: CompanionLiveConnection, event) {
    connections.find(entry => entry.callbacks === (this as any).options)!.events.push(event);
  });
  const close = spyOn(CompanionLiveConnection.prototype, 'close').mockImplementation(function (this: CompanionLiveConnection) {
    const entry = connections.find(entry => entry.callbacks === (this as any).options);
    if (entry) entry.closed = true;
    const cleanup = nextCleanup ?? Promise.resolve();
    nextCleanup = undefined;
    return cleanup;
  });
  let id = 0;
  const controller = new CompanionClientController({ createId: () => String(++id) });
  let receive!: (message: CompanionServerMessage) => void;
  let userMessageId = '';
  const submit = () => controller.submitPrompt({ prompt: 'Watch the drone', executeTool: () => ({}), createTransport: () => ({
    open: async input => { receive = input.onMessage; return undefined; },
    sendPrompt: input => { userMessageId = input.messageId; }, sendToolResult() {}, sendProposalResult() {}, cancel() {}, close() {},
  }) });
  const reconnects: number[] = [];
  let live!: ReturnType<typeof useCompanionLive>;
  const schedule = (_callback: () => void, delay: number) => { reconnects.push(delay); return () => {}; };
  function Harness() { live = useCompanionLive(controller, schedule); return null; }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement);
  await act(async () => { root.render(<Harness />); await submit(); });
  const finish = (messageId: string, reply: string) => {
    receive({ type: 'reply', messageId, reply });
    receive({ type: 'status', messageId, status: 'completed' });
  };
  await act(async () => { finish(userMessageId, 'Subscribed'); });
  return { connections, controller, reconnects, live: () => live,
    async page(event: 'pagehide' | 'pageshow') { await act(async () => { dom.dispatchEvent(new dom.Event(event)); }); },
    setEnabled: (value: boolean) => { enabled = value; },
    delayNextClose() {
      let finish!: () => void;
      nextCleanup = new Promise(resolve => { finish = resolve; });
      return finish;
    },
    async notify(reply = 'The drone finished.') {
      const messageId = `event-${++id}`;
      await act(async () => { receive({ type: 'subscription', messageId }); finish(messageId, reply); });
      return messageId;
    },
    async userReply() { await act(async () => { await submit(); finish(userMessageId, 'Ordinary reply'); }); },
    async duplicate(messageId: string) { await act(async () => { receive({ type: 'status', messageId, status: 'completed' }); }); },
    async cleanup() {
      await act(async () => { root.unmount(); await controller.close(); });
      start.mockRestore(); send.mockRestore(); close.mockRestore();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      }
      dom.happyDOM.abort();
    },
  };
}

test('stopped Live wakes for subscription completion, announces once, and closes after speaker playback', async () => {
  const h = await harness();
  try {
    expect(h.connections).toHaveLength(0); // Ordinary backend completion never wakes Live.
    await act(async () => { await h.live().start(async () => '', 'Workspace'); h.live().stop(); });
    const messageId = await h.notify();
    const announcement = h.connections[1];
    expect(h.live().announcing).toBe(true);
    expect(h.live().status).toBe('connecting');
    expect(announcement.muted).toBe(true);
    expect(announcement.events).toEqual([]);
    await h.notify('Another update'); // Preserve results that arrive during startup.
    await act(async () => { announcement.callbacks.onReady('backend'); });
    expect(announcement.events.filter(event => event.type === 'session.commentary.append').map(event => event.content))
      .toEqual(['The drone finished.']);
    await h.duplicate(messageId);
    expect(announcement.events).toHaveLength(2);
    await act(async () => { h.live().toggleMute(); });
    expect(h.live().muted).toBe(true);
    await act(async () => {
      announcement.callbacks.onAnnouncementPlayback({ stage: 'scheduled', silent: false });
      announcement.callbacks.onAnnouncementPlayback({ stage: 'completed', silent: false });
      await new Promise(resolve => setTimeout(resolve, 2_600));
    });
    expect(announcement.closed).toBe(false);
    expect(announcement.events.at(-1)?.content).toBe('Another update');
    await act(async () => {
      announcement.callbacks.onAnnouncementPlayback({ stage: 'scheduled', silent: false });
      announcement.callbacks.onAnnouncementPlayback({ stage: 'completed', silent: false });
      await new Promise(resolve => setTimeout(resolve, 2_600));
    });
    expect(announcement.closed).toBe(true);
    expect(h.live().status).toBe('idle');
    expect(h.live().enabled).toBe(true);
    expect(h.live().announcing).toBe(false);
    expect(h.controller.getSnapshot().reply).toBe('Another update');
    await h.notify(); // A future notification can wake it again.
    expect(h.connections).toHaveLength(3);
  } finally { await h.cleanup(); }
}, 10_000);

test('disabled, empty, and ordinary replies do not wake Live; re-enabling does not replay old results', async () => {
  const h = await harness(false);
  try {
    await h.notify();
    expect(h.connections).toHaveLength(0);
    await act(async () => { await h.live().toggleEnabled(); });
    expect(h.connections).toHaveLength(0);
    await h.notify('   ');
    await h.userReply();
    expect(h.connections).toHaveLength(0);
    await h.notify();
    expect(h.connections).toHaveLength(1);
    await act(async () => { await h.live().toggleEnabled(); h.connections[0].callbacks.onReady('late'); });
    expect(h.connections[0].closed).toBe(true);
    expect(h.connections[0].events).toEqual([]);
    expect(h.live().status).toBe('idle');
  } finally { await h.cleanup(); }
});

test('active Live keeps normal delivery and explicit stop or startup error ends an announcement', async () => {
  const h = await harness();
  try {
    await act(async () => { await h.live().start(async () => '', 'Workspace'); h.connections[0].callbacks.onReady('backend'); });
    await h.notify();
    expect(h.connections).toHaveLength(1);
    expect(h.connections[0].events[0].type).toBe('session.thinking.append');
    expect(h.live().announcing).toBe(false);
    await act(async () => { h.live().stop(); });
    await h.notify();
    await act(async () => { h.live().stop(); h.connections[1].callbacks.onReady('late'); });
    expect(h.connections[1].events).toEqual([]);
    await h.notify();
    await act(async () => { h.connections[2].callbacks.onError('Microphone unavailable'); });
    expect(h.connections[2].closed).toBe(true);
    expect(h.live().status).toBe('idle');
    expect(h.live().error).toBe('Microphone unavailable');
    expect(h.reconnects).toEqual([]);
    await h.notify();
    await act(async () => { await h.live().start(async () => '', 'Workspace'); });
    expect(h.connections[3].closed).toBe(true);
    expect(h.connections[4].muted).toBe(false);
    expect(h.live().announcing).toBe(false);
  } finally { await h.cleanup(); }
});

test('stopping pending startup cannot bypass microphone cleanup or restart a cancelled announcement', async () => {
  const h = await harness();
  let finishCleanup: (() => void) | undefined;
  try {
    await act(async () => { await h.live().start(async () => '', 'Workspace'); });
    finishCleanup = h.delayNextClose();
    await act(async () => { h.live().stop(); });
    await h.notify();
    expect(h.live().status).toBe('connecting');
    expect(h.connections).toHaveLength(1);
    await act(async () => { h.live().stop(); });
    await h.notify('Later notification');
    expect(h.connections).toHaveLength(1);
    await act(async () => { finishCleanup!(); });
    expect(h.connections).toHaveLength(2);
    await act(async () => { h.connections[1].callbacks.onReady('backend'); });
    expect(h.connections[1].events.filter(event => event.type === 'session.commentary.append').map(event => event.content))
      .toEqual(['Later notification']);
  } finally { finishCleanup?.(); await h.cleanup(); }
});

test('saving a prompt stops an announcement if the returned preference was disabled elsewhere', async () => {
  const h = await harness();
  try {
    await h.notify();
    h.setEnabled(false);
    await act(async () => { await h.live().saveSystemPrompt('New prompt'); });
    expect(h.connections[0].closed).toBe(true);
    expect(h.live().enabled).toBe(false);
    expect(h.live().status).toBe('idle');
  } finally { await h.cleanup(); }
});

test('navigating away prevents late subscription results from reopening voice', async () => {
  const h = await harness();
  try {
    await h.notify();
    await h.page('pagehide');
    expect(h.connections[0].closed).toBe(true);
    await h.notify('While leaving');
    expect(h.connections).toHaveLength(1);
    await h.page('pageshow');
    expect(h.connections).toHaveLength(1);
    await h.notify('After returning');
    expect(h.connections).toHaveLength(2);
  } finally { await h.cleanup(); }
});
