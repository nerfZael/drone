import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as approvalModule from '../src/droneHub/companion/use-companion-auto-approve';
import * as speechModule from '../src/droneHub/companion/use-companion-speech-mute';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';
import { companionSessionStore, writeCompanionSlots } from '../src/droneHub/companion/companion-session-store';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';

for (const detached of [false, true]) test(`session switches keep shared settings and toolbar mounted (floating=${detached})`, async () => {
  const dom = new Window({ url: 'http://localhost' });
  const child = new Window({ url: 'about:blank' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  for (const key of ['document', 'ResizeObserver', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'HTMLInputElement', 'CustomEvent']) install(key, (dom as any)[key]);
  install('window', dom); install('getComputedStyle', dom.getComputedStyle.bind(dom));
  install('IS_REACT_ACT_ENVIRONMENT', true);
  const { CompanionOverlay } = await import('../src/droneHub/companion/CompanionOverlay');
  const oldDetached = useDroneHubUiStore.getState().companionWindowDetached;
  useDroneHubUiStore.setState({ companionWindowDetached: detached });
  if (detached) Object.assign(dom, { open: () => child, droneHubDesktop: { companionWindow: { control: () => {}, onClose: () => () => {} } } });
  let loads = 0;
  let finishSave!: () => void;
  let finishRefresh: (() => void) | undefined;
  let deferRefresh = false;
  let settings = { enabled: true, mode: 'live', systemPrompt: 'Shared instructions', defaultSystemPrompt: '', maxSystemPromptChars: 8000 };
  install('fetch', async (url: string, init?: RequestInit) => {
    if (url !== '/api/settings/companion/live-voice') return Response.json({ ok: true, settings: { provider: 'openai', model: 'test', thinkingLevel: '' }, models: [], credentials: { openai: true } });
    if (init?.method === 'PUT') {
      await new Promise<void>(resolve => { finishSave = resolve; });
      settings = { ...settings, ...JSON.parse(String(init.body)) };
    } else {
      loads++;
      if (deferRefresh) await new Promise<void>(resolve => { finishRefresh = resolve; });
    }
    return Response.json(settings);
  });
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({ status: 'idle', durationMillis: 0,
    startRecording: async () => true, discardRecording: async () => {}, toggleRecordingPause: () => {},
  } as ReturnType<typeof voiceModule.useChatVoiceRecorder>);
  const approvalSpy = spyOn(approvalModule, 'useCompanionAutoApprove').mockReturnValue({ enabled: false, loading: false, error: '', toggle: async () => {} } as any);
  const speechSpy = spyOn(speechModule, 'useCompanionSpeechMute').mockReturnValue({ muted: false, busy: false, toggle: async () => {} });
  // Start with a completed reply, then switch to idle slots: previously that closed the menu.
  companionSessionStore(1).write({ runId: 'session-one', reply: 'First session reply', transcript: 'First request' });
  writeCompanionSlots({ active: 1, slots: [1] });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  const rendered: Array<{ loading: boolean; enabled: boolean; prompt: string }> = [];
  function Harness() {
    companion = useCompanion()!;
    rendered.push({ loading: companion.live.loading, enabled: companion.live.enabled, prompt: companion.live.systemPrompt });
    return <CompanionOverlay />;
  }
  const container = dom.document.createElement('div'); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => root.render(<CompanionProvider><Harness /></CompanionProvider>));
    await act(async () => companion.selectSession(1));
    const page = detached ? child.document : dom.document;
    const frame = page.querySelector('aside[aria-label="Companion"]');
    const toolbar = page.querySelector('[data-companion-window-bar]');
    const sessions = page.querySelector('[aria-label="Companion sessions"]');
    const liveButton = page.querySelector('[aria-label="Start live voice"]');
    expect(frame).not.toBeNull(); expect(toolbar).not.toBeNull(); expect(liveButton).not.toBeNull();
    expect(loads).toBe(1);
    await act(async () => (page.querySelector('button[aria-label="Companion options"]') as unknown as HTMLButtonElement).click());
    const menu = page.querySelector('[role="dialog"][aria-label="Companion options"]');
    expect(menu).not.toBeNull();
    rendered.length = 0;
    for (const slot of [2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]) {
      await act(async () => companion.selectSession(slot));
      expect(companion.activeSlot).toBe(slot);
      expect(page.querySelector('aside[aria-label="Companion"]')).toBe(frame);
      expect(page.querySelector('[data-companion-window-bar]')).toBe(toolbar);
      expect(page.querySelector('[aria-label="Companion sessions"]')).toBe(sessions);
      expect(page.querySelector('[aria-label="Start live voice"]')).toBe(liveButton);
      expect(page.querySelector('[role="dialog"][aria-label="Companion options"]')).toBe(menu);
    }
    expect(loads).toBe(1);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.every(value => !value.loading && value.enabled && value.prompt === 'Shared instructions')).toBe(true);
    // A save belongs to the shared preferences, even when its originating slot is no longer selected.
    let saving!: Promise<boolean>;
    await act(async () => { saving = companion.live.saveSystemPrompt('Updated instructions'); });
    await act(async () => companion.selectSession(3));
    expect(companion.live.saving).toBe(true);
    await act(async () => { finishSave(); expect(await saving).toBe(true); });
    expect(companion.live.saving).toBe(false);
    expect(companion.live.systemPrompt).toBe('Updated instructions');
    await act(async () => companion.selectSession(2));
    expect(companion.live.systemPrompt).toBe('Updated instructions');
    expect(loads).toBe(1);
    // External changes still refresh on focus, without reverting to unloaded defaults.
    deferRefresh = true;
    await act(async () => dom.dispatchEvent(new dom.Event('focus')));
    expect(loads).toBe(2);
    expect(companion.live.loading).toBe(false);
    expect(page.querySelector('[aria-label="Start live voice"]')).toBe(liveButton);
    settings = { ...settings, enabled: false };
    await act(async () => finishRefresh!());
    expect(companion.live.enabled).toBe(false);
    await act(async () => companion.selectSession(1));
    expect(companion.live.enabled).toBe(false);
    expect(loads).toBe(2);
    await act(async () => companion.dismiss());
    await act(async () => companion.selectSession(1));
    expect(page.querySelector('button[aria-label="Companion options"]')?.getAttribute('data-state')).toBe('closed');
  } finally {
    await act(async () => root.unmount());
    voiceSpy.mockRestore(); approvalSpy.mockRestore(); speechSpy.mockRestore();
    useDroneHubUiStore.setState({ companionWindowDetached: oldDetached });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.close(); await child.happyDOM.close();
  }
});
