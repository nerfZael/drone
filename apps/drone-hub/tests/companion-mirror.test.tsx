import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, mock, test } from 'bun:test';
import { CompanionMirrorProvider } from '../src/droneHub/companion/CompanionMirrorContext';
import { CompanionMirrorSettings } from '../src/droneHub/companion/CompanionMirrorSettings';
import { CompanionMirrorOverlay } from '../src/droneHub/companion/CompanionMirrorOverlay';

mock.module('../src/droneHub/chat/ChatMessageBody', () => ({ ChatMessageBody: ({ text }: { text: string }) => <div>{text}</div> }));

test('desktop mirrors proposals, routes clicks, synchronizes auto-approve, and keeps disconnected controls disabled', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let socket!: FakeSocket;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    sent: any[] = [];
    constructor() { socket = this; }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  set('window', dom); set('document', dom.document); set('navigator', dom.navigator);
  set('HTMLElement', dom.HTMLElement); set('Element', dom.Element); set('Node', dom.Node);
  set('MutationObserver', dom.MutationObserver); set('getComputedStyle', dom.getComputedStyle.bind(dom));
  set('WebSocket', FakeSocket); set('IS_REACT_ACT_ENVIRONMENT', true);
  const writes: any[] = [];
  let finishAutoApprove: (() => void) | undefined;
  set('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') writes.push({ url, body: JSON.parse(String(init.body)) });
    if (init?.method === 'PUT' && url.endsWith('/auto-approve')) await new Promise<void>((resolve) => { finishAutoApprove = resolve; });
    return Response.json({ enabled: init?.method === 'PUT' ? JSON.parse(String(init.body)).enabled : false });
  });
  const element = dom.document.createElement('div'); dom.document.body.append(element);
  const root = createRoot(element as unknown as HTMLElement);
  const session = {
    deviceId: 'phone', deviceName: 'My phone', sessionId: 'session', connected: true, pending: false,
    status: 'completed', liveStatus: 'listening', captions: 'You: create a group', reply: 'Ready to apply', error: '',
    proposal: { version: 1, title: 'Review group', operations: [{ id: 'one', type: 'create_group', name: 'Review' }] },
    proposalRevision: 4, proposalExecuting: false, proposalExecution: null, proposalDefaultRepoPath: '/repo', lastExecution: null,
  };
  const button = (label: string) => [...element.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)!;
  try {
    await act(async () => root.render(<CompanionMirrorProvider><CompanionMirrorSettings /><CompanionMirrorOverlay /></CompanionMirrorProvider>));
    expect(element.querySelector('input')!.disabled).toBe(true);
    await act(async () => {
      socket.onopen?.();
      socket.receive({ type: 'mirror_state', enabled: true, sessions: [session] });
      socket.receive({ type: 'mirror_auto_approve', enabled: false });
    });
    expect(socket.sent[0]).toEqual({ type: 'mirror_subscribe' });
    expect(element.textContent).toContain('Live on My phone');
    expect(element.textContent).toContain('Review group');
    await act(async () => { button('Apply proposal').click(); button('Apply proposal').click(); });
    const commands = socket.sent.filter((message) => message.type === 'mirror_command');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ deviceId: 'phone', sessionId: 'session', proposalRevision: 4, action: 'approve' });
    await act(async () => { socket.receive({ type: 'mirror_result', requestId: commands[0].requestId, ok: false, error: 'Proposal changed' }); });
    expect(element.textContent).toContain('Proposal changed');
    await act(async () => { socket.receive({ type: 'mirror_auto_approve', enabled: true }); });
    expect([...element.querySelectorAll('input')][1]!.checked).toBe(true);
    await act(async () => { [...element.querySelectorAll('input')][1]!.click(); });
    await act(async () => { socket.receive({ type: 'mirror_auto_approve', enabled: false }); });
    await act(async () => { finishAutoApprove!(); });
    expect([...element.querySelectorAll('input')][1]!.checked).toBe(false);
    expect([...element.querySelectorAll('input')][1]!.disabled).toBe(false);
    await act(async () => { button('Hide').click(); });
    expect(element.textContent).toContain('Show Live on My phone');
    expect(socket.sent).toHaveLength(2); // Hiding sends no stop or voice command.
    await act(async () => { button('Show Live on My phone · Proposal waiting').click(); });
    await act(async () => { socket.receive({ type: 'mirror_state', enabled: true, sessions: [{ ...session, connected: false }] }); });
    expect(button('Apply proposal').disabled).toBe(true);
    expect(button('Discard').disabled).toBe(true);
    expect([...element.querySelectorAll('input')][1]!.disabled).toBe(true);
    await act(async () => { socket.receive({ type: 'mirror_state', enabled: true, sessions: [session] }); });
    expect(button('Apply proposal').disabled).toBe(false);
    await act(async () => { element.querySelector('input')!.click(); });
    expect(writes.at(-1)).toEqual({ url: '/api/settings/companion/mirror', body: { enabled: false } });
    const extended = { ...session, voiceControls: true, muted: false, screenMarkdown: 'Display on both devices',
      proposals: [{ targetId: 'second', title: 'Second proposal', status: 'draft' }], selectedProposalId: 'first',
      history: [{ proposal: session.proposal, execution: { ok: true, operations: [] }, defaultRepoPath: '/repo' }],
      activity: [{ callId: 'read', label: 'Read workspace', status: 'completed' }] };
    await act(async () => { socket.receive({ type: 'mirror_state', enabled: true, sessions: [extended] }); });
    expect(element.textContent).toContain('Display on both devices');
    expect(element.textContent).toContain('Execution history (1)');
    expect(element.textContent).toContain('Read workspace');
    for (const [label, action, targetId] of [
      ['Mute microphone', 'mute'], ['Pause voice', 'pause'], ['End voice', 'end_voice'],
      ['Second proposal · draft', 'select_proposal', 'second'],
    ]) {
      await act(async () => button(label!).click());
      const command = socket.sent.at(-1);
      expect(command).toMatchObject({ action, ...(targetId ? { targetId } : {}) });
      await act(async () => { socket.receive({ type: 'mirror_result', requestId: command.requestId, ok: true }); });
    }
    await act(async () => { socket.receive({ type: 'mirror_state', enabled: true, sessions: [{ ...extended, connected: false }] }); });
    expect(button('Mute microphone').disabled).toBe(true);
    expect(button('Pause voice').disabled).toBe(true);
    expect(button('Second proposal · draft').disabled).toBe(true);

    const normal = { ...session, liveStatus: 'idle', status: 'recording', voiceControls: false, recordingPaused: true };
    await act(async () => { socket.receive({ type: 'mirror_state', enabled: true, sessions: [normal] }); });
    expect(element.textContent).toContain('Companion on My phone');
    expect(element.textContent).toContain('Recording paused on phone');
    expect(element.querySelector('[aria-label="Phone voice controls"]')).toBeNull();
    await act(async () => { socket.receive({ type: 'mirror_state', enabled: true, sessions: [{ ...normal, status: 'completed' }] }); });
    expect(element.textContent).toContain('Ready to apply');
    expect(button('Apply proposal').disabled).toBe(false);

  } finally {
    await act(async () => root.unmount()); await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
    }
  }
});
