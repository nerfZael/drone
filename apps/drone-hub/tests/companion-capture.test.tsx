import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import type { CompanionClientTransport, CompanionServerMessage } from '@drone/assistant-chat';
import * as voiceModule from '../src/droneHub/chat/use-chat-voice-recorder';
import * as liveModule from '../src/droneHub/companion/use-companion-live';
import * as approvalModule from '../src/droneHub/companion/use-companion-auto-approve';
import * as transportModule from '../src/droneHub/companion/companion-websocket-transport';
import { CompanionProvider, useCompanion } from '../src/droneHub/companion/CompanionContext';

test('captures queue for the next instruction, can be removed, survive delivery errors, and reset safely', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const noop = () => {};
  const voice = spyOn(voiceModule, 'useChatVoiceRecorder').mockReturnValue({ status: 'idle', durationMillis: 0, discardRecording: async () => {}, toggleRecordingPause: noop } as any);
  const live = spyOn(liveModule, 'useCompanionLive').mockReturnValue({ status: 'idle', mode: 'off', stop: noop, reset: noop, cancelPending: noop, loading: false } as any);
  const approval = spyOn(approvalModule, 'useCompanionAutoApprove').mockReturnValue({ enabled: false, loading: false, error: '', toggle: async () => {} } as any);
  const prompts: Parameters<CompanionClientTransport['sendPrompt']>[0][] = [];
  let receive!: (message: CompanionServerMessage) => void;
  const transport = spyOn(transportModule, 'createCompanionWebSocketTransport').mockReturnValue({
    open: async input => { receive = input.onMessage; return undefined; }, sendPrompt: input => { prompts.push(input); },
    sendToolResult: noop, sendProposalResult: noop, cancel: noop, close: noop,
  });
  const image = { name: 'shot.png', mime: 'image/png', size: 3, dataBase64: 'cG5n' };
  const modes: string[] = [];
  let pending: Promise<typeof image | null> | undefined;
  Object.assign(dom, { droneHubDesktop: { captureCompanion: async (mode: string) => { modes.push(mode); return pending ? await pending : image; } } });
  let companion!: NonNullable<ReturnType<typeof useCompanion>>;
  function Harness() { companion = useCompanion()!; return null; }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement);
  const capture = async (mode = 'region') => { await act(async () => { dom.dispatchEvent(new dom.CustomEvent('companion-capture', { detail: mode })); }); };
  try {
    await act(async () => { root.render(<CompanionProvider><Harness /></CompanionProvider>); });
    await capture(); await capture('screen');
    expect(modes).toEqual(['region', 'screen']);
    expect(companion.attachments).toHaveLength(2);
    expect(companion.panelVisibility).toBe('open');
    expect(prompts).toHaveLength(0);
    await act(async () => { companion.removeAttachment(companion.attachments[0].id); });
    expect(companion.attachments).toHaveLength(1);
    await act(async () => { expect(await companion.submitText('Explain this')).toEqual({ ok: true }); });
    expect(prompts[0].attachments).toEqual([image]);
    expect(companion.attachments).toHaveLength(0);
    await act(async () => { receive({ type: 'error', runId: prompts[0].runId, error: 'Delivery failed' }); });
    expect(companion.attachments).toHaveLength(1);
    await act(async () => { await companion.submitText('Try again'); });
    expect(prompts[1].attachments).toEqual([image]);
    await act(async () => { receive({ type: 'status', runId: prompts[1].runId, messageId: prompts[1].messageId, status: 'completed' }); });
    await act(async () => { await companion.submitText('Next'); });
    expect(prompts[2].attachments).toEqual([]);
    await act(async () => { await companion.close(); });
    let finish!: (value: typeof image | null) => void;
    pending = new Promise(resolve => { finish = resolve; });
    await capture();
    await act(async () => { await companion.close(); finish(image); });
    expect(companion.attachments).toHaveLength(0);
    pending = Promise.resolve(null);
    await capture();
    expect(companion.attachments).toHaveLength(0);
  } finally {
    await act(async () => { root.unmount(); });
    voice.mockRestore(); live.mockRestore(); approval.mockRestore(); transport.mockRestore();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    dom.happyDOM.abort();
  }
});
