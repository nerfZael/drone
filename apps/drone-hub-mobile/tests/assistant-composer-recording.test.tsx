import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import type { ReactTestRenderer } from 'react-test-renderer';

type Animation = { finish?: (finished: boolean) => void };
let openingAnimation: Animation | undefined;
const noop = () => {};
mock.module('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Platform: { OS: 'android' },
  Keyboard: { dismiss: noop, addListener: () => ({ remove: noop }) },
  BackHandler: { addEventListener: () => ({ remove: noop }) },
}));
mock.module('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useSharedValue: (initial: number) => React.useMemo(() => {
    let current: number | Animation = initial;
    return {
      get value() { return current; },
      set value(next: number | Animation) {
        if (typeof current === 'object') current.finish?.(false);
        current = next;
      },
    };
  }, []),
  useAnimatedStyle: () => ({}), interpolate: () => 0,
  cancelAnimation: (progress: { value: number }) => { progress.value = 0; },
  Easing: { out: (value: unknown) => value, quad: noop },
  runOnJS: (callback: unknown) => callback,
  withDelay: (_delay: number, animation: Animation) => animation,
  withTiming: (_value: number, options: { duration: number }, finish?: Animation['finish']) => {
    const animation = { finish };
    if (options.duration === 160) openingAnimation = animation;
    return animation;
  },
}));
for (const name of ['arrow-up', 'audio-lines', 'chevron-down', 'mic', 'pause', 'play', 'plus', 'square', 'x']) {
  mock.module(`lucide-react-native/icons/${name}`, () => ({ default: name }));
}
mock.module('../src/components/ThemedTextInput', () => ({ ThemedTextInput: 'Input' }));
mock.module('../src/local-assistant/MobileDictationComposer', () => ({
  MobileDictationComposer: 'Dictation', MobileDictationComposerPreview: 'Preview',
  mobileDictationComposerHeight: () => 200,
}));
mock.module('../src/local-assistant/MobileContinuousVoiceModePicker', () => ({ MobileContinuousVoiceModePicker: 'Picker' }));
mock.module('../src/local-assistant/MobileCompanionContext', () => ({
  useMobileCompanion: () => ({ status: 'idle', overlayOpen: false, setComposerFocused: noop }),
}));
mock.module('../src/local-assistant/use-mobile-transcription-queue', () => ({
  useMobileTranscriptionQueue: () => ({ hasClips: false }),
}));
mock.module('../src/local-assistant/use-mobile-composer-continuous-voice', () => ({
  useMobileComposerContinuousVoice: () => ({ state: { kind: 'idle', status: 'idle' } }),
}));
mock.module('../src/local-assistant/use-mobile-continuous-voice', () => ({ mobileContinuousVoiceStatusLabel: () => '' }));
let microphoneOwned = false;
mock.module('../src/local-assistant/MobileChatVoiceRecorderContext', () => ({
  useSharedMobileChatVoiceRecorder: () => ({
    error: '', setError: noop,
    session: microphoneOwned
      ? { kind: 'dictation', status: 'recording', microphoneAvailable: false }
      : { kind: 'idle', status: 'idle', microphoneAvailable: true },
  }),
}));
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { AssistantComposer } = await import('../src/local-assistant/AssistantComposer');

test('mic press opens dictation before acquiring the microphone; an interrupted morph acquires nothing', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const previousFrame = globalThis.requestAnimationFrame;
  const previousCancelFrame = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = noop;
  globalThis.requestAnimationFrame = () => 1;
  microphoneOwned = false;
  let opened = 0;
  let root!: ReactTestRenderer;
  const props = {
    value: '', onChangeText: noop, onSend: noop, onOpenModel: noop, modelLabel: 'Test',
    onOpenDictation: () => { opened += 1; microphoneOwned = true; },
    // Keep the former wiring in this regression harness to detect premature acquisition.
    onDictationPrestart: () => { microphoneOwned = true; },
  };
  try {
    await act(async () => { root = create(<AssistantComposer {...props} />); });
    const pressMic = () => root.root.findAllByType('Pressable' as any)
      .find((button) => button.props.accessibilityLabel === 'Open dictation draft')!.props.onPress();
    await act(async () => { pressMic(); });
    expect(microphoneOwned).toBe(false);
    expect(opened).toBe(0);
    // Becoming disabled interrupts the native animation, just as mic ownership did.
    await act(async () => { root.update(<AssistantComposer {...props} sending />); });
    expect(microphoneOwned).toBe(false);
    expect(opened).toBe(0);
    await act(async () => { root.update(<AssistantComposer {...props} />); });
    await act(async () => { pressMic(); });
    await act(async () => { openingAnimation?.finish?.(true); });
    expect(opened).toBe(1);
    expect(microphoneOwned).toBe(true);
    await act(async () => { root.update(<AssistantComposer {...props} />); });
    expect(opened).toBe(1);
  } finally {
    await act(async () => { root?.unmount(); });
    globalThis.requestAnimationFrame = previousFrame;
    globalThis.cancelAnimationFrame = previousCancelFrame;
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
