import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useGlobalDictation } from '../src/droneHub/dictation/use-global-dictation';

test('recorder rejects stale edits, unavailable editors, and closed targets', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ open: true, text: 'original' }),
  } });
  try {
    let recorder!: ReturnType<typeof useGlobalDictation>;
    function Harness() {
      recorder = useGlobalDictation({
        resolveTarget: () => ({ ok: false, error: 'No chat' }),
        send: async () => ({ ok: true }),
        sendToCompanion: async () => ({ ok: true }),
      });
      return null;
    }
    renderToStaticMarkup(<Harness />);
    const original = recorder.readRecorder();
    expect(() => recorder.applyRecorder('other', original.revision, 'bad', () => true)).toThrow('TARGET');
    expect(() => recorder.applyRecorder(original.targetId, original.revision, 'bad', () => false)).toThrow('NOT_READY');
    recorder.setText('transcript or user edit');
    expect(() => recorder.applyRecorder(original.targetId, original.revision, 'bad', () => true)).toThrow('REVISION');
    const fresh = recorder.readRecorder();
    let edited = '';
    recorder.applyRecorder(fresh.targetId, fresh.revision, 'updated', (text) => { edited = text; return true; });
    expect(edited).toBe('updated');
    expect(recorder.readRecorder().content).toBe('updated');
    expect(recorder.readRecorder().revision).not.toBe(fresh.revision);
    const sendingSnapshot = recorder.readRecorder();
    const sending = recorder.requestSend('companion');
    expect(recorder.readRecorder().mode).toBe('read-only');
    expect(() => recorder.applyRecorder(sendingSnapshot.targetId, sendingSnapshot.revision, 'bad', () => true))
      .toThrow('NOT_EDITABLE');
    await sending;
    expect(() => recorder.readRecorder()).toThrow('NO_OPEN_RECORDER');
    expect(() => recorder.applyRecorder(fresh.targetId, fresh.revision, 'bad', () => true)).toThrow('NO_OPEN_RECORDER');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Companion destination captures at send before asynchronous finalization, and captures anew next time', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ open: true, text: 'same repo please' }),
  } });
  try {
    let recorder!: ReturnType<typeof useGlobalDictation>;
    let repo = 'a';
    const captures: string[] = [];
    const received: unknown[] = [];
    function Harness() {
      recorder = useGlobalDictation({
        resolveTarget: () => ({ ok: false, error: 'No chat' }),
        send: async () => ({ ok: true }),
        sendToCompanion: async () => { throw new Error('Must use the captured submission'); },
        prepareCompanionSend: () => {
          const capturedRepo = repo;
          captures.push(capturedRepo);
          return async (text) => {
            received.push({ repo: capturedRepo, text });
            return { ok: true };
          };
        },
      });
      return null;
    }
    renderToStaticMarkup(<Harness />);
    const sending = recorder.requestSend('companion');
    expect(captures).toEqual(['a']);
    expect(received).toEqual([]);
    repo = 'b';
    await sending;
    expect(received).toEqual([{ repo: 'a', text: 'same repo please' }]);
    recorder.setText('another request');
    await recorder.requestSend('companion');
    expect(received.at(-1)).toEqual({ repo: 'b', text: 'another request' });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('a context capture failure keeps dictated text available for another send', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => JSON.stringify({ open: true, text: 'keep this request' }),
  } });
  try {
    let recorder!: ReturnType<typeof useGlobalDictation>;
    let fail = true;
    const sent: string[] = [];
    function Harness() {
      recorder = useGlobalDictation({
        resolveTarget: () => ({ ok: false, error: 'No chat' }),
        send: async () => ({ ok: true }),
        sendToCompanion: async () => ({ ok: true }),
        prepareCompanionSend: () => {
          if (fail) throw new Error('Context unavailable');
          return async (text) => { sent.push(text); return { ok: true }; };
        },
      });
      return null;
    }
    renderToStaticMarkup(<Harness />);
    await expect(recorder.requestSend('companion')).resolves.toBeUndefined();
    expect(recorder.readRecorder()).toMatchObject({ content: 'keep this request', mode: 'edit' });
    fail = false;
    await recorder.requestSend('companion');
    expect(sent).toEqual(['keep this request']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
