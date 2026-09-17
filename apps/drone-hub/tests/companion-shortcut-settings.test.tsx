import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { CompanionShortcutSettings } from '../src/droneHub/companion/CompanionShortcutSettings';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';

test('hold duration settings validate drafts, save together, and restore defaults', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const previous = useDroneHubUiStore.getState().companionShortcutDurations;
  useDroneHubUiStore.setState({ companionShortcutDurations: { pauseMs: 300, cancelMs: 800, resetMs: 1300 } });
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => root.render(<CompanionShortcutSettings />));
    const inputs = Array.from(container.querySelectorAll('input'));
    const buttons = Array.from(container.querySelectorAll('button'));
    const change = async (index: number, value: string) => {
      await act(async () => {
        inputs[index].value = value;
        Simulate.change(inputs[index] as unknown as HTMLInputElement);
      });
    };
    expect(buttons[1].disabled).toBe(true);
    await change(0, '2');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(buttons[1].disabled).toBe(true);
    await change(1, '3');
    await change(2, '4');
    expect(buttons[1].disabled).toBe(false);
    expect(useDroneHubUiStore.getState().companionShortcutDurations.pauseMs).toBe(300);
    await act(async () => buttons[1].click());
    expect(useDroneHubUiStore.getState().companionShortcutDurations).toEqual({ pauseMs: 2000, cancelMs: 3000, resetMs: 4000 });
    expect(buttons[1].disabled).toBe(true);
    await act(async () => buttons[0].click());
    expect(inputs.map(input => input.value)).toEqual(['0.3', '0.8', '1.3']);
  } finally {
    await act(async () => root.unmount());
    useDroneHubUiStore.setState({ companionShortcutDurations: previous });
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});
