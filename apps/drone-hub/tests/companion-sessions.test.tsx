import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import type { CompanionClientTransport, CompanionServerMessage } from '@drone/assistant-chat';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as liveModule from '../src/droneHub/companion/use-companion-live';
import * as approvalModule from '../src/droneHub/companion/use-companion-auto-approve';
import * as transportModule from '../src/droneHub/companion/companion-websocket-transport';
import { CompanionOverlay } from '../src/droneHub/companion/CompanionOverlay';
import * as speechModule from '../src/droneHub/companion/use-companion-speech-mute';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';
import { companionSessionShortcut } from '../src/droneHub/companion/companion-session-shortcut';
import { companionSessionStore, readCompanionSlots, writeCompanionSlots } from '../src/droneHub/companion/companion-session-store';
import { cloneDefaultShortcutBindings } from '../src/droneHub/app/shortcuts';
import { migrateDroneHubUiPersistedState, useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';

const flush = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };

for (const detached of [false, true]) test(`sessions preserve recording, concurrent work and proposal ownership (floating=${detached})`, async () => {
  const dom = new Window({ url: 'http://localhost' });
  const child = new Window({ url: 'about:blank' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, ResizeObserver: dom.ResizeObserver, MutationObserver: dom.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const oldBindings = useDroneHubUiStore.getState().shortcutBindings;
  const oldDetached = useDroneHubUiStore.getState().companionWindowDetached;
  useDroneHubUiStore.setState({ companionWindowDetached: detached });
  if (detached) Object.assign(dom, { open: () => child, droneHubDesktop: { companionWindow: { control: () => {}, onClose: () => () => {} } } });
  useDroneHubUiStore.setState({ shortcutBindings: cloneDefaultShortcutBindings() });
  let changed = () => {};
  let starts = 0;
  const transcriptions: Array<(text: string) => void> = [];
  const voice = {
    status: 'idle' as ReturnType<typeof voiceModule.useChatVoiceRecorder>['status'], durationMillis: 1000,
    startRecording: async () => { starts++; voice.status = 'recording'; changed(); return true; },
    toggleRecordingPause: () => { voice.status = voice.status === 'paused' ? 'recording' : 'paused'; changed(); },
    discardRecording: async () => { voice.status = 'idle'; changed(); },
    stopRecordingForTranscript: () => {
      voice.status = 'idle'; changed();
      return new Promise<string>(resolve => transcriptions.push(resolve));
    },
  };
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockImplementation(() => {
    const [, tick] = React.useReducer(n => n + 1, 0); changed = tick;
    return voice as ReturnType<typeof voiceModule.useChatVoiceRecorder>;
  });
  const noop = () => {};
  const speechSpy = spyOn(speechModule, 'useCompanionSpeechMute').mockReturnValue({ muted: false, busy: false, toggle: async () => {} });
  const liveState = { status: 'idle', enabled: false, mode: 'live', resolved: true, loading: false, stop: noop, reset: noop, cancelPending: noop };
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockReturnValue(liveState as any);
  const approvalSpy = spyOn(approvalModule, 'useCompanionAutoApprove').mockReturnValue({ enabled: false, loading: false, error: '', toggle: async () => {} } as any);
  const transports: Array<{ prompts: Parameters<CompanionClientTransport['sendPrompt']>[0][]; receive: (message: CompanionServerMessage) => void; cancelled: boolean }> = [];
  const transportSpy = spyOn(transportModule, 'createCompanionWebSocketTransport').mockImplementation(() => {
    const entry = { prompts: [] as Parameters<CompanionClientTransport['sendPrompt']>[0][], receive: (_: CompanionServerMessage) => {}, cancelled: false };
    transports.push(entry);
    return {
      open: async input => { entry.receive = input.onMessage; }, sendPrompt: input => { entry.prompts.push(input); },
      sendToolResult: noop, sendProposalResult: noop, cancel: () => { entry.cancelled = true; }, close: noop,
    };
  });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  function Harness() { companion = useCompanion()!; return <CompanionOverlay />; }
  const container = dom.document.createElement('div'); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const page = () => detached && child.document.querySelector('[data-companion-surface]') ? child : dom;
  const press = async (key: string, target = page().document.body) => act(async () => { target.dispatchEvent(new (page().KeyboardEvent)('keydown', { key, bubbles: true, cancelable: true })); });
  try {
    await act(async () => root.render(<CompanionProvider><Harness /></CompanionProvider>));
    expect(companion.sessions).toEqual([]);
    const canvas = dom.document.createElement('div');
    canvas.setAttribute('data-shortcut-capture', 'true');
    canvas.setAttribute('data-drone-canvas-viewport', '1');
    canvas.tabIndex = 0;
    dom.document.body.append(canvas);
    canvas.focus();
    await press('2', canvas);
    expect(companion.sessions.map(s => s.slot)).toEqual([2]);
    expect(companion.activeSlot).toBe(2);
    expect(page().document.querySelector('[aria-label="Companion sessions"] button')?.textContent).toBe('2');
    expect(voice.status).toBe('recording');
    await press('1');
    expect(starts).toBe(1);
    await act(async () => companion.toggleRecordingPause());
    await press('0');
    expect(voice.status).toBe('paused');
    expect(companion.activeSlot).toBe(0);
    let sendZero!: Promise<void>;
    await act(async () => { sendZero = companion.toggle(); await flush(); });
    await press('2');
    expect(companion.status).toBe('idle'); // Slot 0 alone is transcribing.
    await act(async () => companion.toggle());
    let sendTwo!: Promise<void>;
    await act(async () => { sendTwo = companion.toggle(); await flush(); });
    await act(async () => { transcriptions[1]('for two'); await sendTwo; });
    await act(async () => { transcriptions[0]('for zero'); await sendZero; });
    expect(transports.map(t => t.prompts[0].prompt)).toEqual(['for two', 'for zero']);
    expect(transports[0].prompts[0].runId).not.toBe(transports[1].prompts[0].runId);
    expect(companion.sessions.filter(s => s.working).map(s => s.slot)).toEqual([2, 0]);
    await act(async () => transports[0].receive({ type: 'subscriptions', subscriptions: [{ id: 'watch-two', provider: 'github',
      resourceType: 'pull_request', resourceId: 'acme/repo#2', events: ['pull_request.merged'], status: 'active' }] }));
    expect(companion.subscriptions.map(item => item.id)).toEqual(['watch-two']);
    const patch = async (index: number) => act(async () => {
      transports[index].receive({ type: 'tool_call', messageId: transports[index].prompts[0].messageId, generation: 1,
        callId: 'proposal', tool: 'apply_proposal_patch', args: { targetId: 'companion-proposal', baseRevision: '0',
          content: JSON.stringify({ version: 1, title: `Proposal ${index}`, operations: [{ id: 'create', type: 'create_group', name: `Group ${index}` }] }) } });
      await flush();
    });
    await patch(0); await patch(1);
    expect(page().document.querySelector('[aria-label="Pending proposals"]')?.textContent).toContain('S0');
    expect(page().document.querySelector('[aria-label="Pending proposals"]')?.textContent).toContain('S2');
    expect(companion.proposals.map(p => p.targetId)).toEqual(['2:companion-proposal', '0:companion-proposal']);
    await act(async () => (page().document.querySelector('[aria-label^="Session 0 · Proposal"]') as unknown as HTMLButtonElement).click());
    expect(companion.activeSlot).toBe(0);
    expect(companion.proposal?.title).toBe('Proposal 1');
    expect(companion.subscriptions).toEqual([]);
    await act(async () => companion.discardProposal(companion.selectedProposalId!));
    expect(companion.proposals.map(p => p.targetId)).toEqual(['2:companion-proposal']);
    // Delete 0 while 2 has a sent clip still transcribing. Only 0's work is cancelled.
    await press('2');
    await act(async () => companion.toggle());
    let pendingTwo!: Promise<void>;
    await act(async () => { pendingTwo = companion.toggle(); await flush(); });
    await press('0');
    await act(async () => (page().document.querySelector('[aria-label="Delete session 0 and clear its conversation"]') as unknown as HTMLButtonElement).click());
    expect(companion.sessions.map(s => s.slot)).toEqual([1, 2]);
    expect(transports[1].cancelled).toBe(true);
    expect(transports[0].cancelled).toBe(false);
    await act(async () => { transcriptions[2]('still for two'); await pendingTwo; });
    expect(transports[0].prompts.map(p => p.prompt)).toEqual(['for two', 'still for two']);
    expect(companionSessionStore(0).read()).toBeNull();
    expect(readCompanionSlots().slots).toEqual([1, 2]);
    // Open + existing session is inspection only, including a working session.
    const idleStarts = starts;
    await press('2');
    expect(companion.activeSlot).toBe(2);
    expect(companion.status).toBe('working');
    expect(voice.status).toBe('idle');
    expect(starts).toBe(idleStarts);
    // Open + missing slot stages a frontend draft, without microphone or transport.
    await press('0');
    expect(companion.activeSlot).toBe(0);
    expect(companion.sessionId).toBeNull();
    expect(voice.status).toBe('idle');
    expect(starts).toBe(idleStarts);
    expect(transports).toHaveLength(2);
    await act(async () => page().dispatchEvent(new (page().Event)('blur')));
    expect(companion.sessions.map(s => s.slot)).toEqual([1, 2, 0]);
    for (const slot of [3, 4, 5, 6, 7, 8, 9]) await press(String(slot));
    expect(starts).toBe(idleStarts);
    expect(transports).toHaveLength(2);
    expect(companion.sessions.map(s => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    const count = starts;
    await press('9');
    expect(starts).toBe(count); // Selecting the current slot never sends or toggles.
    // Closed + missing slot creates it and starts recording, from the Hub window.
    await act(async () => companion.deleteSession());
    await act(async () => companion.dismiss());
    await press('9');
    expect(companion.activeSlot).toBe(9);
    expect(voice.status).toBe('recording');
    expect(starts).toBe(count + 1);
    // Closed + existing session also records immediately.
    await act(async () => companion.dismiss());
    await press('2');
    expect(companion.activeSlot).toBe(2);
    expect(voice.status).toBe('recording');
    // A delayed preference load must not revive a cancelled start on a later visit.
    await act(async () => companion.dismiss());
    liveState.loading = true;
    const beforeLoading = starts;
    await press('3');
    expect(voice.status).toBe('idle');
    await press('4');
    await act(async () => { liveState.loading = false; changed(); });
    await press('3');
    expect(companion.activeSlot).toBe(3);
    expect(voice.status).toBe('idle');
    expect(starts).toBe(beforeLoading);
    // Closing while preferences are loading cancels the requested microphone start.
    await act(async () => companion.dismiss());
    liveState.loading = true;
    await press('5');
    await act(async () => companion.dismiss());
    await act(async () => { liveState.loading = false; changed(); });
    expect(starts).toBe(beforeLoading);
    expect(companion.panelVisibility).toBe('closed');
  } finally {
    await act(async () => root.unmount());
    voiceSpy.mockRestore(); liveSpy.mockRestore(); approvalSpy.mockRestore(); transportSpy.mockRestore(); speechSpy.mockRestore();
    useDroneHubUiStore.setState({ shortcutBindings: oldBindings, companionWindowDetached: oldDetached });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
    }
    await dom.happyDOM.close(); await child.happyDOM.close();
  }
});

test('number shortcuts respect typing, dialogs, modifiers, repeats, and manual bindings in any window', () => {
  const dom = new Window();
  const bindings = cloneDefaultShortcutBindings();
  const event = (key = '2', target = dom.document.body, options = {}) => {
    const e = new dom.KeyboardEvent('keydown', { key, ...options });
    Object.defineProperty(e, 'target', { value: target });
    return e as unknown as KeyboardEvent;
  };
  expect(companionSessionShortcut(event(), bindings)).toBe(2);
  expect(companionSessionShortcut(event('0'), bindings)).toBe(0);
  const focused = spyOn(dom.document, 'hasFocus').mockReturnValue(false);
  expect(companionSessionShortcut(event(), bindings)).toBeNull();
  focused.mockReturnValue(true);
  expect(companionSessionShortcut(event(), bindings)).toBe(2);
  focused.mockRestore();
  for (const options of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { metaKey: true }]) {
    expect(companionSessionShortcut(event('2', dom.document.body, options), bindings)).toBeNull();
  }
  for (const tag of ['input', 'textarea', 'select']) expect(companionSessionShortcut(event('2', dom.document.createElement(tag)), bindings)).toBeNull();
  const editor = dom.document.createElement('div'); editor.setAttribute('contenteditable', 'true');
  const child = dom.document.createElement('span'); editor.append(child);
  expect(companionSessionShortcut(event('2', child), bindings)).toBeNull();
  const dialog = dom.document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dom.document.body.append(dialog);
  expect(companionSessionShortcut(event(), bindings)).toBeNull(); dialog.remove();
  const canvas = dom.document.createElement('div');
  canvas.setAttribute('data-shortcut-capture', 'true');
  canvas.setAttribute('data-drone-canvas-viewport', '1');
  const card = dom.document.createElement('button'); canvas.append(card);
  expect(companionSessionShortcut(event('2', canvas), bindings)).toBe(2);
  expect(companionSessionShortcut(event('2', card), bindings)).toBe(2);
  const composer = dom.document.createElement('textarea'); canvas.append(composer);
  expect(companionSessionShortcut(event('2', composer), bindings)).toBeNull();
  const capture = dom.document.createElement('div');
  capture.setAttribute('data-shortcut-capture', 'true'); canvas.append(capture);
  expect(companionSessionShortcut(event('2', capture), bindings)).toBeNull();
  bindings.createDraftDrone = { key: '2', mod: false, ctrl: false, meta: false, shift: false, alt: false };
  expect(companionSessionShortcut(event('2', canvas), bindings)).toBeNull();
  expect(companionSessionShortcut(event(), bindings)).toBeNull();
});

test('upgrades former defaults once and preserves numbers explicitly rebound afterward', () => {
  const binding = (key: string) => ({ key, mod: false, ctrl: false, meta: false, shift: false, alt: false });
  const legacy = { shortcutBindings: { createDraftDrone: binding('1'), cloneDroneChat: binding('4'), createDroneChat: binding('8') } };
  expect(migrateDroneHubUiPersistedState(legacy, 20).shortcutBindings).toMatchObject({ createDraftDrone: null, cloneDroneChat: null, createDroneChat: binding('8') });
  expect(migrateDroneHubUiPersistedState(legacy, 21).shortcutBindings).toMatchObject(legacy.shortcutBindings);
  const rebound = { shortcutBindings: { createDroneChat: binding('2') } };
  expect(migrateDroneHubUiPersistedState(rebound, 21).shortcutBindings).toMatchObject(rebound.shortcutBindings);
});


test('slot storage restores the legacy conversation in 1 and keeps slot 0 distinct', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const dom = new Window();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom });
  try {
    companionSessionStore(1).write({ runId: 'legacy', reply: 'Saved answer', transcript: 'Earlier request' });
    expect(readCompanionSlots()).toEqual({ active: 1, slots: [1] });
    companionSessionStore(0).write({ runId: 'zero', reply: '', transcript: 'Different conversation' });
    writeCompanionSlots({ active: 0, slots: [2, 0] });
    expect(readCompanionSlots()).toEqual({ active: 0, slots: [2, 0] });
    expect(companionSessionStore(0).read()?.runId).toBe('zero');
    companionSessionStore(0).write(null);
    expect(companionSessionStore(0).read()).toBeNull();
    expect(companionSessionStore(1).read()?.runId).toBe('legacy');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});
