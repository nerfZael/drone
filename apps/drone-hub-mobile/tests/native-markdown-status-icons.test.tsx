import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';

const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean).map(flatten))
    : ((style ?? {}) as Record<string, unknown>);

mock.module('react-native', () => ({
  Linking: { openURL: () => undefined },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (value: unknown) => value, flatten },
}));
mock.module('expo-clipboard', () => ({ setStringAsync: async () => undefined }));
mock.module('../src/mobile-reading-density', () => ({ useMobileReadingDensity: () => 'compact' }));
mock.module('../src/components/EmbeddedHorizontalScrollView', () => ({ EmbeddedHorizontalScrollView: 'ScrollView' }));
mock.module('../src/local-assistant/NativeMermaidDiagram', () => ({ NativeMermaidDiagram: 'Mermaid' }));
for (const name of [
  'arrow-right', 'ban', 'circle-check', 'circle-dashed', 'circle-pause', 'circle-x', 'copy',
  'hourglass', 'info', 'refresh-cw', 'skip-forward', 'text-wrap', 'triangle-alert',
]) {
  mock.module(`lucide-react-native/icons/${name}`, () => ({ default: `icon:${name}` }));
}
const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
mock.module(rendererRequire.resolve('react'), () => React);
const { create } = await import('react-test-renderer');
const { NativeMarkdown } = await import('../src/local-assistant/NativeMarkdown');
const { colors } = await import('../src/theme');

test('draws status emoji as coloured icons sized to the text they sit in', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let root!: ReturnType<typeof create>;
  try {
    await act(async () => {
      root = create(<NativeMarkdown text={'# ⏳ Waiting\n\n- ✅ done\n- ~~⏭️ skipped~~\n\nUse `✅` literally 🚀'} />);
    });
    const done = root.root.findByType('icon:circle-check' as any);
    expect(done.props).toMatchObject({ accessibilityLabel: 'Done', color: colors.online, size: 16 });
    const waiting = root.root.findByType('icon:hourglass' as any);
    expect(waiting.props).toMatchObject({ color: colors.warning, size: 23 });
    const skipped = root.root.findByType('icon:skip-forward' as any);
    expect(done.props.style).toEqual([{ transform: [{ translateY: 3 }] }, false]);
    expect(skipped.props.style).toEqual([{ transform: [{ translateY: 3 }] }, { opacity: 0.7 }]);
    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('✅');
    expect(json).toContain('🚀');
    expect(json).not.toContain('⏳');
  } finally {
    await act(async () => { root?.unmount(); });
    if (original) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', original);
  }
});
