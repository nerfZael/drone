import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import type { ReactTestRenderer } from 'react-test-renderer';

let selected = true;
let permissions = 0;
let roleRequests = 0;
let foreground: (state: string) => void;
mock.module('react-native', () => ({ Text: 'text', AppState: { addEventListener: (_: string, listener: typeof foreground) => {
  foreground = listener; return { remove() {} };
} } }));
mock.module('../src/components/Ui', () => ({ Button: 'button', ErrorBanner: 'error' }));
mock.module('../src/local-assistant/mobile-phone-assistant', () => ({ phoneAssistant: {
  getStatus: async () => ({ supported: true, selected }), requestRole: async () => { roleRequests++; },
} }));
mock.module('../src/local-assistant/openMobileLiveAudio', () => ({ prepareMobileLiveAudio: async () => {
  permissions++; throw new Error('Microphone permission denied');
} }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { PhoneAssistantSettings } = await import('../src/local-assistant/PhoneAssistantSettings');

test('changing away from Companion works without audio permission; voice setup remains available', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  try {
    selected = true; permissions = 0; roleRequests = 0;
    await act(async () => { root = create(<PhoneAssistantSettings />); });
    await act(async () => root.root.findAllByType('button' as any)[0]!.props.onPress());
    expect(roleRequests).toBe(1);
    expect(permissions).toBe(0);
    await act(async () => root.root.findAllByType('button' as any)[1]!.props.onPress());
    expect(permissions).toBe(1);
    expect(roleRequests).toBe(1);
    expect(root.root.findByType('error' as any).props.message).toContain('permission denied');
    await act(async () => foreground('active'));
    expect(root.root.findByType('error' as any).props.message).toContain('permission denied');
  } finally { await act(async () => root?.unmount()); Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); }
});

test('initial assistant setup does not open the role picker after audio permission is denied', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  try {
    selected = false; permissions = 0; roleRequests = 0;
    await act(async () => { root = create(<PhoneAssistantSettings />); });
    await act(async () => root.root.findAllByType('button' as any)[0]!.props.onPress());
    expect(permissions).toBe(1);
    expect(roleRequests).toBe(0);
  } finally { await act(async () => root?.unmount()); Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); }
});
