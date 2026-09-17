import React, { act } from 'react';
import { expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as liveModule from '../src/droneHub/companion/use-companion-live';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';

test('switching voice modes starts the selected input without closing Companion and ignores failed saves', async () => {
  const calls: string[] = [];
  let enabled = true;
  let fail = false;
  const original = liveModule.useCompanionLive;
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockImplementation(() => ({
    ...original(), enabled, loading: false, saving: false, resolved: true,
    toggleEnabled: async () => { calls.push('save'); return fail ? undefined : !enabled; },
    start: async () => { calls.push('live'); }, reset: () => { calls.push('reset'); },
  }));
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({
    status: 'idle', durationMillis: 0,
    startRecording: async () => { calls.push('dictation'); return true; },
    discardRecording: async () => { calls.push('discard'); },
    toggleRecordingPause: () => {},
  } as ReturnType<typeof voiceModule.useChatVoiceRecorder>);
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  function Harness() { companion = useCompanion()!; return null; }
  const render = () => renderToStaticMarkup(<CompanionProvider><Harness /></CompanionProvider>);
  try {
    render();
    await companion.toggleLiveVoice();
    expect(calls).toEqual(['save', 'dictation']);
    calls.length = 0;
    enabled = false;
    render();
    await companion.toggleLiveVoice();
    expect(calls).toEqual(['save', 'live']);
    calls.length = 0;
    fail = true;
    render();
    await companion.toggleLiveVoice();
    expect(calls).toEqual(['save']);
  } finally { voiceSpy.mockRestore(); liveSpy.mockRestore(); }
});

test('stopped Live keeps the idle companion visible with a restart control until explicitly closed', async () => {
  const { CompanionOverlay } = await import('../src/droneHub/companion/CompanionOverlay');
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, HTMLElement: dom.HTMLElement,
    ResizeObserver: dom.ResizeObserver, MutationObserver: dom.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => Response.json({ enabled: true, systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 8000 }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  let enabled = true;
  let hasStarted = false;
  let status: 'idle' | 'listening' = 'idle';
  const original = liveModule.useCompanionLive;
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockImplementation(() => ({
    ...original(), enabled, loading: false, saving: false, resolved: true, hasStarted, status,
  }));
  const voice = {
    status: 'idle' as ReturnType<typeof voiceModule.useChatVoiceRecorder>['status'], durationMillis: 0,
    startRecording: async () => { voice.status = 'recording'; return true; },
    discardRecording: async () => { voice.status = 'idle'; },
  } as ReturnType<typeof voiceModule.useChatVoiceRecorder>;
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue(voice);
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  function Harness() { companion = useCompanion()!; return <CompanionOverlay />; }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const render = async () => {
    await act(async () => { root.render(<CompanionProvider><Harness /></CompanionProvider>); });
    return Array.from(dom.document.body.children).map(child => child.innerHTML).join('');
  };
  try {
    expect(await render()).toBe('');
    hasStarted = true;
    expect(await render()).toContain('Start live voice');
    status = 'listening';
    expect(await render()).toContain('Stop live voice; submitted work continues');
    status = 'idle';
    expect(await render()).toContain('Start live voice');
    hasStarted = false;
    expect(await render()).toBe('');
    enabled = false;
    await render();
    const gesture = async (heldMs: number) => {
      await act(async () => {
        companion.handleShortcut({ phase: 'down' });
        companion.handleShortcut({ phase: 'up', heldMs });
      });
    };
    await gesture(30);
    expect(voice.status).toBe('recording');
    await gesture(900);
    expect(voice.status).toBe('idle');
    expect(companion.panelVisibility).toBe('open');
    expect(await render()).toContain('Close Companion');
    await gesture(900);
    expect(companion.panelVisibility).toBe('closed');
    expect(await render()).toBe('');
    await gesture(30);
    expect(voice.status).toBe('recording');
    expect(await render()).toContain('Close Companion');
  } finally {
    await act(async () => { root.unmount(); });
    voiceSpy.mockRestore(); liveSpy.mockRestore();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
    dom.happyDOM.abort();
  }
});
