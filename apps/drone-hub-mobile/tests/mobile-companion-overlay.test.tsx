import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import type { ReactTestRenderer } from 'react-test-renderer';

// Native-module mocks must not leak into other mobile test files.
if (process.env.DRONE_COMPANION_OVERLAY_TEST_CHILD !== '1') {
  test('mobile overlay history opens and closes with consistent hooks', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, DRONE_COMPANION_OVERLAY_TEST_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(stdout + stderr);
    expect(code).toBe(0);
  });
} else {
const noop = () => {};
mock.module('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => ({ height: 800, width: 400 }),
  BackHandler: { addEventListener: () => ({ remove: noop }) }, Keyboard: { dismiss: noop },
}));
mock.module('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }));
const chain: any = new Proxy({}, { get: () => () => chain });
mock.module('react-native-gesture-handler', () => ({ Gesture: { Pan: () => chain }, GestureDetector: 'GestureDetector' }));
mock.module('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' }, Easing: { out: (value: unknown) => value, cubic: noop },
  LinearTransition: chain, runOnJS: (fn: unknown) => fn,
  useAnimatedStyle: (fn: () => unknown) => fn(), useSharedValue: (value: unknown) => React.useRef({ value }).current,
  withTiming: (value: unknown) => value,
}));
mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
for (const icon of ['audio-lines', 'captions', 'ellipsis', 'folder', 'folder-open', 'mic', 'mic-off', 'pause', 'play', 'square', 'send', 'trash-2', 'x', 'zap']) {
  mock.module(`lucide-react-native/icons/${icon}`, () => ({ default: () => null }));
}
for (const name of ['MobileCompanionScreenPanel', 'MobileCompanionModelPicker', 'NativeMarkdown', 'MobileCompanionMenu', 'MobileCompanionProposal', 'MobileCompanionWorkspaceModal']) {
  mock.module(`../src/local-assistant/${name}`, () => ({ [name]: () => null }));
}
mock.module('../src/drones/ChatSubscriptionIndicator', () => ({ ChatSubscriptionIndicator: () => null }));
mock.module('../src/local-assistant/use-mobile-companion-current-workspace', () => ({ useMobileCompanionCurrentWorkspace: () => ({}) }));
const companion: any = {
  status: 'completed', overlayOpen: false, activity: [], subscriptions: [], transcript: '', reply: '', error: '',
  proposalHistory: [{ targetId: 'proposal-a', proposal: { title: 'Completed proposal' }, execution: { ok: true, operations: [] } }],
  live: { status: 'idle', error: '', captions: '' }, liveSettings: { error: '' }, autoApproveSettings: { error: '' },
  reportOverlayInset: noop, readAppContext: () => ({}), close: noop,
};
mock.module('../src/local-assistant/MobileCompanionContext', () => ({ useMobileCompanion: () => companion }));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { MobileCompanionOverlay } = await import('../src/local-assistant/MobileCompanionOverlay');

test('mobile proposal history survives opening the hidden overlay and resets its expansion when closed', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(<MobileCompanionOverlay />); });
    expect(root.toJSON()).toBeNull();
    companion.overlayOpen = true;
    await act(async () => { root.update(<MobileCompanionOverlay />); });
    const history = root.root.findAllByType('Pressable' as any).find(node => node.findAllByType('Text' as any).some(text => text.children.includes('Execution history')))!;
    expect(history).toBeDefined();
    await act(async () => { history.props.onPress(); });
    expect(JSON.stringify(root.toJSON())).toContain('Completed proposal');
    companion.overlayOpen = false;
    await act(async () => { root.update(<MobileCompanionOverlay />); });
    expect(root.toJSON()).toBeNull();
    companion.overlayOpen = true;
    await act(async () => { root.update(<MobileCompanionOverlay />); });
    expect(JSON.stringify(root.toJSON())).not.toContain('Completed proposal');
  } finally {
    await act(async () => root?.unmount());
    if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});

}
