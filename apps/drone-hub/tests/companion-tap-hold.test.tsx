import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, spyOn, test } from 'bun:test';
import type { CompanionClientTransport } from '@drone/assistant-chat';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as liveModule from '../src/droneHub/companion/use-companion-live';
import * as transportModule from '../src/droneHub/companion/companion-websocket-transport';
import * as cuesModule from '../src/droneHub/companion/companion-recording-cues';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('tap sends on release, allows immediate restart, orders clips, and keeps cancel separate from reset', async () => {
  const pending: Array<(text: string) => void> = [];
  const cues: string[] = [];
  const cueSpy = spyOn(cuesModule, 'playCompanionRecordingCue').mockImplementation(cue => { cues.push(cue); });
  let starts = 0;
  const discards: Array<boolean> = [];
  const voice = {
    status: 'idle' as ReturnType<typeof voiceModule.useChatVoiceRecorder>['status'],
    pendingTranscriptions: 0,
    durationMillis: 1000,
    startRecording: async () => { starts++; voice.status = 'recording'; return true; },
    toggleRecordingPause: () => { voice.status = voice.status === 'paused' ? 'recording' : 'paused'; },
    discardRecording: async (options?: { preserveTranscriptions?: boolean }) => {
      discards.push(options?.preserveTranscriptions === true);
      voice.status = 'idle';
    },
    stopRecordingForTranscript: async () => {
      voice.status = 'transcribing';
      return await new Promise<string>(resolve => pending.push(text => {
        if (voice.status === 'transcribing') voice.status = 'idle';
        resolve(text);
      }));
    },
  };
  const useLive = liveModule.useCompanionLive;
  const liveSpy = spyOn(liveModule, 'useCompanionLive').mockImplementation(() => ({ ...useLive(), enabled: false, loading: false, resolved: true }));
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue(voice);
  const prompts: Parameters<CompanionClientTransport['sendPrompt']>[0][] = [];
  let closes = 0;
  let deferClose = false;
  let finishClosing: (() => void) | undefined;
  const transportSpy = spyOn(transportModule, 'createCompanionWebSocketTransport').mockImplementation(() => ({
    open: async () => undefined,
    sendPrompt: input => { prompts.push(input); },
    sendToolResult: () => {}, sendProposalResult: () => {}, cancel: () => {}, close: () => {
      closes++;
      if (deferClose) return new Promise<void>(resolve => { finishClosing = resolve; });
    },
  }));
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'http://localhost' } } });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  function Harness() { companion = useCompanion()!; return null; }
  const release = async (heldMs = 30) => {
    companion.handleShortcut({ phase: 'up', heldMs });
    await flush();
  };
  const press = () => companion.handleShortcut({ phase: 'down' });
  const tap = async () => { press(); await release(); };
  try {
    renderToStaticMarkup(<CompanionProvider><Harness /></CompanionProvider>);
    press();
    expect(starts).toBe(0);
    await release();
    expect(voice.status).toBe('recording');
    press();
    expect(pending).toHaveLength(0); // No speculative transcription on keydown.
    await release();
    expect(pending).toHaveLength(1);
    await tap(); // Quick tap starts again instead of closing / resetting.
    expect(voice.status).toBe('recording');
    await tap();
    expect(pending).toHaveLength(2);
    expect(cues).toEqual(['start', 'send', 'start', 'send']);
    pending[1]('second request');
    await flush();
    expect(prompts).toHaveLength(0);
    pending[0]('first request');
    await flush();
    expect(prompts.map(prompt => prompt.prompt)).toEqual(['first request', 'second request']);
    expect(prompts[0].runId).toBe(prompts[1].runId);
    expect(closes).toBe(0);
    expect(voice.status).toBe('idle'); // Send never restarts the microphone.

    await tap();
    await tap(); // Third request is already committed, still transcribing.
    await tap(); // Fourth recording will be canceled.
    press();
    await release(700);
    expect(voice.status).toBe('idle');
    expect(discards.at(-1)).toBe(true);
    expect(cues.at(-1)).toBe('cancel');
    expect(pending).toHaveLength(3);
    expect(closes).toBe(0);
    pending[2]('third request');
    await flush();
    expect(prompts.at(-1)?.prompt).toBe('third request');
    expect(prompts.at(-1)?.runId).toBe(prompts[0].runId);

    await tap();
    await tap(); // A pending clip that must never enter the reset conversation.
    await tap();
    const startsBeforeReset = starts;
    press();
    await release(1600);
    expect(voice.status).toBe('recording');
    expect(starts).toBe(startsBeforeReset + 1);
    expect(discards.at(-1)).toBe(false);
    expect(closes).toBe(1);
    expect(cues.at(-1)).toBe('reset');
    pending[3]('stale request after reset');
    await flush();
    expect(prompts).toHaveLength(3);
    await tap();
    pending[4]('fresh request');
    await flush();
    expect(prompts.at(-1)?.prompt).toBe('fresh request');
    expect(prompts.at(-1)?.runId).not.toBe(prompts[0].runId);

    const startsWhileIdle = starts;
    press();
    await release(1600);
    expect(voice.status).toBe('idle');
    expect(starts).toBe(startsWhileIdle);
    expect(pending).toHaveLength(5);
    press();
    companion.handleShortcut({ phase: 'cancel' });
    await release(); // Lost focus / disconnected key must do nothing.
    expect(starts).toBe(startsWhileIdle);

    await tap();
    await tap();
    pending[5]('a conversation with a slow close');
    await flush();
    await tap();
    deferClose = true;
    const startsBeforeSlowReset = starts;
    const reset = companion.resetContext();
    await flush();
    expect(finishClosing).toBeDefined();
    expect(starts).toBe(startsBeforeSlowReset + 1);
    expect(voice.status).toBe('recording'); // Keep capturing while connection teardown is pending.
    await tap();
    pending[6]('recorded during reset');
    await flush();
    expect(prompts.at(-1)?.prompt).toBe('a conversation with a slow close');
    await tap();
    const startsBeforeCancel = starts;
    await companion.discardRecording();
    finishClosing!();
    await reset;
    await flush();
    expect(prompts.at(-1)?.prompt).toBe('recorded during reset');
    expect(starts).toBe(startsBeforeCancel);
    expect(voice.status).toBe('idle'); // Cancel during reset must not reopen the microphone.
    deferClose = false;

    await tap();
    press();
    const startsBeforeEscape = starts;
    await companion.discardRecording(); // Escape or the Discard button while the key is held.
    await release();
    expect(starts).toBe(startsBeforeEscape);
    expect(voice.status).toBe('idle');

    await tap();
    voice.status = 'idle'; // The browser reports an unexpected microphone failure.
    const startsBeforeRecovery = starts;
    await tap();
    expect(starts).toBe(startsBeforeRecovery + 1);
    expect(voice.status).toBe('recording');
    await companion.discardRecording();

    const immediateStart = voice.startRecording;
    let finishOldStart!: (started: boolean) => void;
    voice.startRecording = async () => {
      voice.status = 'starting';
      return await new Promise<boolean>(resolve => { finishOldStart = resolve; });
    };
    const oldStart = companion.toggle();
    voice.startRecording = immediateStart;
    await companion.resetContext();
    finishOldStart(false);
    await oldStart;
    const pendingBeforeSend = pending.length;
    const sending = companion.toggle();
    expect(pending).toHaveLength(pendingBeforeSend + 1); // Old startup cannot clear the replacement recording.
    pending.at(-1)!('request after startup reset');
    await sending;
    expect(prompts.at(-1)?.prompt).toBe('request after startup reset');
  } finally {
    await companion?.close();
    voiceSpy.mockRestore(); liveSpy.mockRestore(); transportSpy.mockRestore(); cueSpy.mockRestore();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
