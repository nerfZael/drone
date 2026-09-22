import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import * as companionModule from '../src/droneHub/companion/CompanionContext';
import * as dialogModule from '../src/ui/components/Dialog';
import * as httpModule from '../src/droneHub/http';
import { DesktopRecordings } from '../src/droneHub/recordings/DesktopRecordings';

test('Stop remains available during Companion work and history requests; preference failures do not block capture', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let finishCompanion!: () => void, finishHistory!: () => void;
  const companionPending = new Promise<void>(resolve => { finishCompanion = resolve; });
  const historyPending = new Promise<void>(resolve => { finishHistory = resolve; });
  let holdHistory = false;
  const capture = { id: 'active', supported: true, busy: false, startedAt: Date.now(), microphone: 'mic', system: 'monitor', error: '' };
  const calls: string[] = [];
  Object.assign(dom, { droneHubDesktop: { desktopRecording: async (action: string) => {
    calls.push(action);
    if (action === 'stop') capture.id = '';
    if (action === 'start') capture.id = 'next';
    return { ...capture };
  } } });
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const saved = { id: 'saved', title: 'Earlier meeting', status: 'complete', durationSeconds: 4, speakerCount: 0,
    audioFiles: [], segments: [], previewSegments: [], warnings: [], relativePath: 'transcripts/saved', inHomeFiles: true };
  const http = spyOn(httpModule, 'requestJson').mockImplementation(async (url: any) => {
    if (holdHistory) await historyPending;
    return (url === '/api/recordings' ? { recordings: [saved] } : { recording: saved }) as any;
  });
  const companion = spyOn(companionModule, 'useCompanion').mockReturnValue({ status: 'idle', submitText: async () => {
    await companionPending; return { ok: true };
  } } as any);
  const dialog = spyOn(dialogModule, 'UiDialog').mockImplementation(({ open, children }) => open ? <div>{children}</div> : null);
  const element = dom.document.createElement('div');
  dom.document.body.append(element);
  const root = createRoot(element as unknown as HTMLElement);
  const button = (label: string) => {
    const found = [...dom.document.querySelectorAll('button')].find(item => item.textContent?.includes(label));
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  try {
    await act(async () => { root.render(<DesktopRecordings />); });
    await act(async () => { button('●').click(); });
    await act(async () => { button('Ask Companion').click(); });
    expect(button('Ask Companion').disabled).toBe(true);
    expect(button('Stop ·').disabled).toBe(false);
    holdHistory = true;
    await act(async () => { button('Stop ·').click(); });
    expect(calls.filter(call => call === 'stop')).toHaveLength(1);
    expect(button('Record desktop + mic').disabled).toBe(false);
    await act(async () => { button('Record desktop + mic').click(); });
    expect(calls.filter(call => call === 'start')).toHaveLength(1);
    expect(button('Stop ·').disabled).toBe(false);
  } finally {
    await act(async () => { finishCompanion(); finishHistory(); });
    await act(async () => { root.unmount(); });
    http.mockRestore(); companion.mockRestore(); dialog.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.abort();
  }
});
