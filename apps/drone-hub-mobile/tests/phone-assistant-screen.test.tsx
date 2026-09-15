import React, { act } from 'react';
import { CompanionScreen } from '../../../packages/assistant-chat/src/CompanionScreen';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { ReactTestRenderer } from 'react-test-renderer';

const noop = () => {};
mock.module('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  BackHandler: { addEventListener: () => ({ remove: noop }) },
  // Later files in the same run see this mock too; keep the exports they import.
  AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) }, Platform: { OS: 'android' },
}));
mock.module('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value, withRepeat: (value: number) => value, withDelay: (_: number, value: number) => value,
  cancelAnimation: noop, Easing: { out: () => noop, quad: noop, linear: noop },
}));
mock.module('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
for (const name of ['arrow-up-right', 'mic', 'mic-off', 'pause', 'play', 'rotate-ccw', 'sparkles', 'triangle-alert', 'x']) {
  mock.module(`lucide-react-native/icons/${name}`, () => ({ default: name }));
}
const calls: string[] = [];
const live = { status: 'listening', capturing: true, muted: false, error: '', captions: 'secret words the user said', targetName: 'Studio Mac',
  pause: () => calls.push('pause'), toggleMute: () => calls.push('mute') };
const companion = { screen: new CompanionScreen(), live, status: 'idle', available: true, error: '', startAssistantVoice: async () => {}, close: async () => { calls.push('close'); } };
const launch = { pending: false, error: '', retry: async () => { calls.push('retry'); }, cancel: () => calls.push('cancel') };
mock.module('../src/local-assistant/MobileCompanionScreenPanel', () => ({ MobileCompanionScreenPanel: () => <TextDisplay /> }));
function TextDisplay() { return React.createElement('Text', {}, 'Display surface'); }
mock.module('../src/local-assistant/MobileCompanionContext', () => ({ useMobileCompanion: () => companion }));
mock.module('../src/local-assistant/PhoneAssistantContext', () => ({ usePhoneAssistantRequest: () => 'press-1' }));
mock.module('../src/local-assistant/use-phone-assistant-launch', () => ({ usePhoneAssistantLaunch: () => launch }));
mock.module('../src/local-assistant/mobile-phone-assistant', () => ({ phoneAssistant: {
  dismiss: async (id: string) => { calls.push(`dismiss:${id}`); }, openApp: async (id: string) => { calls.push(`open:${id}`); },
} }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { PhoneAssistantScreen } = await import('../src/local-assistant/PhoneAssistantScreen');

let root: ReactTestRenderer;
const texts = () => root.root.findAllByType('Text').map((node) => node.children.join(''));
const button = (label: string) => root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label)[0];
const render = () => act(async () => { root = create(<PhoneAssistantScreen />); });
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  calls.length = 0;
  companion.screen.clear();
  Object.assign(live, { status: 'listening', capturing: true, muted: false, error: '' });
  Object.assign(companion, { status: 'idle', error: '' });
  Object.assign(launch, { pending: false, error: '' });
});
afterEach(async () => { await act(async () => root?.unmount()); Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); });

test('listening shows the headline and target without any transcript', async () => {
  await render();
  const shown = texts();
  expect(shown).toContain('Listening');
  expect(shown).toContain('Studio Mac');
  expect(shown.join('\n')).not.toContain('secret words');
  expect(button('Pause')).toBeDefined();
  expect(button('Mute').props.disabled).toBe(false);
});

test('controls pause, mute, end, and open the full app', async () => {
  await render();
  await act(async () => button('Pause').props.onPress());
  await act(async () => button('Mute').props.onPress());
  await act(async () => button('End').props.onPress());
  await act(async () => root.root.findAllByType('Pressable').find((node) =>
    node.findAllByType('Text').some((text) => text.children.join('') === 'Open Drone Hub'))!.props.onPress());
  expect(calls).toEqual(['pause', 'mute', 'cancel', 'close', 'dismiss:press-1', 'cancel', 'open:press-1']);
});

test('a failed start offers retry and shows the error', async () => {
  Object.assign(live, { status: 'idle', capturing: false });
  launch.error = 'Enable Companion Live voice in Drone Hub settings first.';
  await render();
  expect(texts()).toContain('Needs attention');
  expect(texts()).toContain(launch.error);
  expect(button('Mute').props.disabled).toBe(true);
  await act(async () => button('Retry').props.onPress());
  expect(calls).toEqual(['retry']);
});

test('a paused session offers resume and a muted one reads as muted', async () => {
  Object.assign(live, { status: 'paused', capturing: false });
  await render();
  expect(texts()).toContain('Paused');
  expect(button('Resume')).toBeDefined();
  await act(async () => root.unmount());
  Object.assign(live, { status: 'listening', capturing: true, muted: true });
  await render();
  expect(texts()).toContain('Muted');
  expect(button('Unmute').props.accessibilityState.selected).toBe(true);
});

test('startup shows a busy primary control instead of pause', async () => {
  launch.pending = true;
  await render();
  expect(texts()).toContain('Starting Live');
  expect(button('Starting').props.disabled).toBe(true);
  expect(root.root.findAllByType('ActivityIndicator')).toHaveLength(1);
});


test('display content replaces the animation while controls remain available', async () => {
  companion.screen.resize(300, 400);
  const result = companion.screen.execute({ markdown: '**Ready**' });
  companion.screen.measured(companion.screen.getSnapshot().candidate!.id, 300, 40);
  expect(await result).toMatchObject({ displayed: true });
  await render();
  expect(texts()).toContain('Display surface');
  expect(texts()).not.toContain('Listening');
  expect(button('Pause')).toBeDefined();
  expect(button('Mute')).toBeDefined();
  expect(button('End')).toBeDefined();
  await act(async () => companion.screen.clear());
  expect(texts()).toContain('Listening');
});
