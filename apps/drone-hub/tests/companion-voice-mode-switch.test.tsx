import React from 'react';
import { expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
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
