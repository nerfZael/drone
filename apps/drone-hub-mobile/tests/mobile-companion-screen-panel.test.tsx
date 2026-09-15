import React, { act } from 'react';
import { createRequire } from 'node:module';
import { expect, mock, test } from 'bun:test';
import { CompanionScreen } from '../../../packages/assistant-chat/src/CompanionScreen';

if (process.env.DRONE_SCREEN_PANEL_TEST_CHILD !== '1') {
  test('native screen display measures before publishing and preserves content on overflow', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, DRONE_SCREEN_PANEL_TEST_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(stdout + stderr);
    expect(code).toBe(0);
  });
} else {
  mock.module('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', useWindowDimensions: () => ({ width: 400, height: 800, fontScale: 1 }) }));
  mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) }));
  mock.module('../src/mobile-reading-density', () => ({ useMobileReadingDensity: () => 'comfortable' }));
  mock.module('../src/local-assistant/NativeMarkdown', () => ({ NativeMarkdown: ({ text }: { text: string }) => <>{text}</> }));
  const rendererRequire = createRequire(import.meta.resolve('react-test-renderer'));
  mock.module(rendererRequire.resolve('react'), () => React);
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const { create } = await import('react-test-renderer');
  const { MobileCompanionScreenPanel } = await import('../src/local-assistant/MobileCompanionScreenPanel');
  test('measures native content and rejects excess height without replacing accepted content', async () => {
    const screen = new CompanionScreen();
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<MobileCompanionScreenPanel screen={screen} fullscreen availableHeight={300} />); });
    expect(screen.constraints()).toMatchObject({ width: 336, height: 300 });
    let result: unknown;
    await act(async () => { result = screen.execute({ markdown: '**Ready**' }); });
    expect(screen.getSnapshot().markdown).toBe('');
    const measure = () => tree.root.findAllByType('View' as any).find((node) => node.props.onLayout)!;
    await act(async () => measure().props.onLayout({ nativeEvent: { layout: { width: 336, height: 300 } } }));
    expect(await result).toMatchObject({ displayed: true });
    await act(async () => { result = screen.execute({ markdown: 'Longer' }); });
    await act(async () => measure().props.onLayout({ nativeEvent: { layout: { width: 336, height: 301 } } }));
    expect(await result).toMatchObject({ error: 'CONTENT_DOES_NOT_FIT' });
    expect(screen.getSnapshot().markdown).toBe('**Ready**');
    await act(async () => tree.update(<MobileCompanionScreenPanel screen={screen} fullscreen availableHeight={100} />));
    expect(screen.getSnapshot().markdown).toBe('');
    await act(async () => tree.unmount());
    expect(screen.constraints().width).toBe(0);
  });
}
