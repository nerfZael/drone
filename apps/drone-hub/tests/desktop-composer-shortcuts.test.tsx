import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { ActiveComposerProvider, useActiveComposer } from '../src/droneHub/chat/ActiveComposerContext';
import { ChatContextActionsContext } from '../src/droneHub/app/ChatContextActions';
import { useChatContextMenu } from '../src/droneHub/app/use-chat-context-menu';

test('desktop composer shortcuts act on the local composer and leave typing alone', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, Element: dom.Element, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const calls: string[] = [];
  let recording = false;
  let onKey: (event: KeyboardEvent, scope: HTMLElement) => void;
  function Fixture() {
    const active = useActiveComposer();
    onKey = useChatContextMenu('Chat', () => [], { droneId: 'other', chatName: 'fork' }).onDesktopKeyDown;
    React.useEffect(() => {
      const main = active.registerComposer({ id: 'main', isEligible: () => true, appendTranscript() {},
        sendMessage: () => { calls.push('wrong-main'); return true; } });
      const local = active.registerComposer({ id: 'desktop', isEligible: () => true, appendTranscript() {},
        voiceRecordingStatus: () => recording ? 'recording' : 'idle',
        sendRecordingInClonedChat: () => { calls.push('clone-recording'); return true; },
        sendMessage: mode => { calls.push(mode === 'asap' ? 'asap' : 'send'); return true; },
        clearComposer: () => { calls.push('clear'); return true; },
        toggleVoiceRecording: () => { calls.push('voice'); return true; },
      });
      active.focusComposer('main');
      return () => { main(); local(); };
    }, [active.registerComposer]);
    return <div data-active-composer-id="desktop"><textarea data-chat-input-focus-id="desktop" /></div>;
  }
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const key = async (key: string, target = dom.document.body, shiftKey = false) => {
    const event = new dom.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    await act(async () => onKey!(event as unknown as KeyboardEvent, host as unknown as HTMLElement));
    return event.defaultPrevented;
  };
  try {
    await act(async () => root.render(<ActiveComposerProvider><ChatContextActionsContext.Provider value={{ createChat() {}, cloneChat() {} }}><Fixture /></ChatContextActionsContext.Provider></ActiveComposerProvider>));
    expect(await key('s')).toBe(true);
    expect(await key('Tab')).toBe(true);
    expect(await key('R', dom.document.body, true)).toBe(true);
    expect(await key('q')).toBe(true);
    expect(calls).toEqual(['send', 'asap', 'clear', 'voice']);
    const input = host.querySelector('textarea')!;
    expect(await key('s', input)).toBe(false);
    expect(calls).toHaveLength(4);
    expect(await key('Enter')).toBe(true);
    expect(dom.document.activeElement).toBe(input);
    recording = true;
    expect(await key('r', input)).toBe(true);
    expect(calls.at(-1)).toBe('clone-recording');
    expect(await key('R', dom.document.body, true)).toBe(true);
    expect(calls.slice(-2)).toEqual(['clone-recording', 'clone-recording']);
  } finally {
    await act(async () => root.unmount());
    dom.happyDOM.cancelAsync();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
