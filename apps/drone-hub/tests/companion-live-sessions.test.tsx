import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as approvalModule from '../src/droneHub/companion/use-companion-auto-approve';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';
import { CompanionLiveConnection } from '../src/droneHub/companion/CompanionLiveConnection';

test('live session handoff waits for microphone release and closing cancels a waiting start', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  install('window', dom); install('document', dom.document); install('IS_REACT_ACT_ENVIRONMENT', true);
  install('fetch', async () => Response.json({ ok: true, enabled: true, mode: 'live', systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 8000 }));
  const voiceSpy = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({ status: 'idle', durationMillis: 0,
    startRecording: async () => true, discardRecording: async () => {}, toggleRecordingPause: () => {},
  } as ReturnType<typeof voiceModule.useChatVoiceRecorder>);
  const approvalSpy = spyOn(approvalModule, 'useCompanionAutoApprove').mockReturnValue({ enabled: false, loading: false, error: '', toggle: async () => {} } as any);
  const started: CompanionLiveConnection[] = [];
  const releases = new Map<CompanionLiveConnection, { promise: Promise<void>; release: () => void }>();
  let microphone: CompanionLiveConnection | null = null;
  const startSpy = spyOn(CompanionLiveConnection.prototype, 'start').mockImplementation(async function(this: CompanionLiveConnection) {
    expect(microphone).toBeNull();
    microphone = this; started.push(this);
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    releases.set(this, { promise, release: () => { if (microphone === this) microphone = null; resolve(); } });
    (this as any).options.onCapturing();
    (this as any).options.onReady('test');
  });
  const closeSpy = spyOn(CompanionLiveConnection.prototype, 'close').mockImplementation(function(this: CompanionLiveConnection) {
    return releases.get(this)?.promise ?? Promise.resolve();
  });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  function Harness() { companion = useCompanion()!; return null; }
  const element = dom.document.createElement('div'); dom.document.body.append(element);
  const root = createRoot(element as unknown as HTMLElement);
  let mounted = true;
  try {
    await act(async () => root.render(<CompanionProvider><Harness /></CompanionProvider>));
    await act(async () => companion.toggle());
    expect(started).toHaveLength(1);
    expect(companion.live.status).toBe('listening');
    await act(async () => companion.live.toggleMute());
    expect(companion.live.muted).toBe(true);
    await act(async () => companion.selectSession(2));
    expect(companion.activeSlot).toBe(2);
    expect(started).toHaveLength(1);
    // Rapid selection during the handoff preserves recording intent and mute.
    await act(async () => companion.selectSession(3));
    expect(started).toHaveLength(1);
    await act(async () => releases.get(started[0])!.release());
    expect(started).toHaveLength(2);
    expect(companion.activeSlot).toBe(3);
    expect(companion.live.muted).toBe(true);
    expect(companion.recordingPaused).toBe(true);
    expect((started[1] as any).muted).toBe(true);
    expect(companion.live.status).toBe('listening');
    // Revisit an existing slot while the previous connection is still closing.
    await act(async () => companion.selectSession(1));
    expect(started).toHaveLength(2);
    await act(async () => companion.dismiss());
    await act(async () => releases.get(started[1])!.release());
    expect(started).toHaveLength(2);
    expect(companion.panelVisibility).toBe('closed');
    // A manual recording request also waits, even if it replaces an automatic handoff.
    await act(async () => companion.toggle());
    expect(started).toHaveLength(3);
    await act(async () => companion.selectSession(0));
    let pending!: Promise<void>;
    await act(async () => { pending = companion.toggle(); });
    expect(started).toHaveLength(3);
    await act(async () => { releases.get(started[2])!.release(); await pending; });
    expect(started).toHaveLength(4);
    expect(companion.activeSlot).toBe(0);
    let deleting!: Promise<void>;
    await act(async () => { deleting = companion.deleteSession(); });
    expect(companion.activeSlot).toBe(0);
    await act(async () => { releases.get(started[3])!.release(); await deleting; });
    expect(companion.activeSlot).toBe(1);
    expect(companion.sessions.some(s => s.slot === 0)).toBe(false);
    await act(async () => companion.toggle());
    expect(started).toHaveLength(5);
    await act(async () => companion.selectSession(4));
    await act(async () => root.unmount()); mounted = false;
    await act(async () => releases.get(started[4])!.release());
    expect(started).toHaveLength(5);
  } finally {
    for (const item of releases.values()) item.release();
    if (mounted) await act(async () => root.unmount());
    startSpy.mockRestore(); closeSpy.mockRestore(); voiceSpy.mockRestore(); approvalSpy.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.close();
  }
});
