import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useChatVoiceRecorder } from '../src/droneHub/chat/use-chat-voice-recorder';
import { browserMicrophoneCoordinator } from '../src/droneHub/chat/browser-microphone-coordinator';

test('a sent clip releases the microphone immediately; later clips and cancellations do not corrupt its transcription', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const tracks: Array<{ stop: () => void; stopped: boolean }> = [];
  const uploads: Array<{ signal: AbortSignal; resolve: (value: Response) => void }> = [];
  const errors: string[] = [];
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    state = 'inactive';
    mimeType = 'audio/webm';
    constructor(_stream: unknown, _options: unknown) { super(); }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        const data = new Event('dataavailable');
        Object.defineProperty(data, 'data', { value: new Blob(['audio']) });
        this.dispatchEvent(data);
        this.dispatchEvent(new Event('stop'));
      });
    }
  }
  Object.defineProperty(dom, 'MediaRecorder', { value: Recorder });
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true, MediaRecorder: Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => {
      const track = { stopped: false, stop() { this.stopped = true; } };
      tracks.push(track);
      return { getTracks: () => [track] };
    } } },
    fetch: async (_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init.signal!;
      uploads.push({ signal, resolve });
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  let voice!: ReturnType<typeof useChatVoiceRecorder>;
  const onError = (message: string) => { if (message) errors.push(message); };
  function Harness() {
    voice = useChatVoiceRecorder({ onError, microphoneOwner: 'companion', backgroundTranscription: true });
    return <span>{voice.status}:{voice.pendingTranscriptions}</span>;
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { expect(await voice.startRecording()).toBe(true); });
    let first!: Promise<string>;
    await act(async () => {
      first = voice.stopRecordingForTranscript();
      expect(tracks[0].stopped).toBe(true);
      expect(browserMicrophoneCoordinator.getSnapshot()).toBe(null);
      expect(await voice.startRecording()).toBe(true);
    });
    expect(voice.status).toBe('recording');
    expect(uploads).toHaveLength(1);
    expect(container.textContent).toBe('recording:1');
    let second!: Promise<string>;
    await act(async () => { second = voice.stopRecordingForTranscript(); });
    expect(uploads).toHaveLength(2);
    await act(async () => { expect(await voice.startRecording()).toBe(true); });
    await act(async () => {
      uploads[1].resolve(Response.json({ text: 'second' }));
      expect(await second).toBe('second');
    });
    expect(voice.status).toBe('recording');
    expect(tracks[2].stopped).toBe(false);
    await act(async () => { await voice.discardRecording({ preserveTranscriptions: true }); });
    expect(tracks[2].stopped).toBe(true);
    expect(uploads).toHaveLength(2); // Discard never transcribes.
    expect(uploads[0].signal.aborted).toBe(false);
    await act(async () => {
      uploads[0].resolve(Response.json({ text: 'first' }));
      expect(await first).toBe('first');
    });
    expect(voice.status).toBe('idle');
    await act(async () => { await voice.startRecording(); });
    let resetClip!: Promise<string>;
    await act(async () => { resetClip = voice.stopRecordingForTranscript(); });
    await act(async () => {
      await voice.discardRecording();
      expect(await resetClip).toBe('');
      expect(await voice.startRecording()).toBe(true);
    });
    expect(uploads[2].signal.aborted).toBe(true);
    expect(voice.status).toBe('recording');
    const clipErrors: string[] = [];
    let failedClip!: Promise<string>;
    await act(async () => {
      failedClip = voice.stopRecordingForTranscript({ onError: message => { if (message) clipErrors.push(message); } });
      await voice.startRecording();
    });
    await act(async () => {
      uploads[3].resolve(Response.json({ error: 'Clip upload failed' }, { status: 500 }));
      expect(await failedClip).toBe('');
    });
    expect(clipErrors).toHaveLength(1);
    expect(voice.status).toBe('recording');
    expect(errors).toEqual([]); // A sent clip reports to its captured destination.

  } finally {
    await act(async () => { root.unmount(); });
    expect(browserMicrophoneCoordinator.getSnapshot()).toBe(null);
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.abort();
  }
});
