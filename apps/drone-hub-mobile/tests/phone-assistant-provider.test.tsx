import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import type { ReactTestRenderer } from 'react-test-renderer';

let event: (launch: { requestId: string }) => void;
let resolve!: (launch: { requestId: string }) => void;
let reject!: (error: Error) => void;
mock.module('react-native', () => ({ Text: 'text', View: 'view' }));
mock.module('../src/components/Ui', () => ({ Button: 'button' }));
mock.module('../src/local-assistant/mobile-phone-assistant', () => ({ phoneAssistant: {
  getLaunch: () => new Promise((yes, no) => { resolve = yes; reject = no; }),
  addListener: (_: string, listener: typeof event) => { event = listener; return { remove() {} }; },
} }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { PhoneAssistantProvider, usePhoneAssistantRequest } = await import('../src/local-assistant/PhoneAssistantContext');
function Child() { return <span>{usePhoneAssistantRequest()}</span>; }

test('a native launch event recovers an initial read failure without exposing the normal app', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(<PhoneAssistantProvider><Child /></PhoneAssistantProvider>); });
    expect(root.toJSON()).toBeNull();
    await act(async () => reject(new Error('bridge unavailable')));
    expect(root.root.findAllByType('span')).toHaveLength(0);
    await act(async () => event({ requestId: 'new-press' }));
    expect(root.root.findByType('span').children).toEqual(['new-press']);
  } finally { await act(async () => root?.unmount()); Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); }
});

test('a slow initial snapshot cannot overwrite a newer button press', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(<PhoneAssistantProvider><Child /></PhoneAssistantProvider>); });
    await act(async () => event({ requestId: 'new-press' }));
    await act(async () => resolve({ requestId: '' }));
    expect(root.root.findByType('span').children).toEqual(['new-press']);
  } finally { await act(async () => root?.unmount()); Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); }
});
