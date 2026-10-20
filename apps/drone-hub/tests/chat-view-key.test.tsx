import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { afterEach, expect, test } from 'bun:test';
import { chatIdentityTesting, publishChatIds, renameChatId } from '../src/droneHub/app/chat-identity';
import { useChatViewKey } from '../src/droneHub/app/chat-selection-model';

afterEach(() => chatIdentityTesting.reset());

test('a chat view is not mounted again when its chat gets an ID or a new name, but is for another chat', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  let mounts = 0;
  function View() {
    React.useEffect(() => { mounts += 1; }, []);
    return null;
  }
  function Keyed({ chatName }: { chatName: string }) {
    return <View key={useChatViewKey('drone', chatName)} />;
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement);
  try {
    // Opened by name, as a chat made by a "send in new chat" action is, before the summary lists it.
    await act(async () => root.render(<Keyed chatName="Plan" />));
    publishChatIds([{ id: 'drone', chatIds: { Plan: 'chat-1' } }]);
    await act(async () => root.render(<Keyed chatName="Plan" />));
    renameChatId('drone', 'Plan', 'Roadmap');
    await act(async () => root.render(<Keyed chatName="Roadmap" />));
    expect(mounts).toBe(1);

    await act(async () => root.render(<Keyed chatName="Other" />));
    expect(mounts).toBe(2);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
