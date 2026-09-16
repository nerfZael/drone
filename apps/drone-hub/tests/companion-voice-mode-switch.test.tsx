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
  let hasStarted = false;
  let status: 'idle' | 'listening' = 'idle';
  const original = liveModule.useCompanionLive;
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockImplementation(() => ({
    ...original(), enabled: true, loading: false, saving: false, resolved: true, hasStarted, status,
  }));
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({
    status: 'idle', durationMillis: 0, discardRecording: async () => {},
  } as ReturnType<typeof voiceModule.useChatVoiceRecorder>);
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const render = async () => {
    await act(async () => { root.render(<CompanionProvider><CompanionOverlay /></CompanionProvider>); });
    return container.innerHTML;
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
  } finally {
    await act(async () => { root.unmount(); });
    voiceSpy.mockRestore(); liveSpy.mockRestore();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
    dom.happyDOM.abort();
  }
});
