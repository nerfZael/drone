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
