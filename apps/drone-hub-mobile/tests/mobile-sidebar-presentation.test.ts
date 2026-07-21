import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('mobile sidebar presentation', () => {
  test('keeps repository rows path-free and aligned with desktop state glyphs', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('styles.repoPath');
    expect(source).toContain('<ApprovalStatusIndicator />');
    expect(source).toContain('<WorkingStatusIndicator />');
    expect(source).toContain('<UnreadStatusIndicator />');
    expect(source).toContain("repoCopy: { flex: 1, minWidth: 0, justifyContent: 'center' }");
  });

  test('omits the selected-drone subtitle while preserving contextual create copy', () => {
    const dronesSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');

    expect(dronesSource).not.toContain('mobileRepoLabel(selected.repoPath)');
    expect(dronesSource).toContain("subtitle: `Create on ${activeTarget?.name ?? 'this device'}`");
    expect(shellSource).toContain('dronesHeader?.subtitle ?');
  });

  test('keeps Android drawer gestures on the UI thread and long lists virtualized', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const rootPackageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    );
    const drawerPatch = readFileSync(
      new URL('../../../patches/react-native-drawer-layout@4.2.7.patch', import.meta.url),
      'utf8',
    );

    expect(drawerSource).toContain('<FlatList<MobileDroneSidebarEntry>');
    expect(drawerSource).toContain('<FlatList<MobileDroneRepoGroup>');
    expect(drawerSource).toContain("removeClippedSubviews={Platform.OS === 'android'}");
    expect(drawerSource).toContain('renderToHardwareTextureAndroid');
    expect(drawerSource).not.toContain('<Modal');
    expect(drawerSource).toContain("don't commit a new drawer tree while its surface is moving");
    expect(drawerSource).toContain('onTransitionEnd={handleTransitionEnd}');
    expect(drawerSource).toContain('renderDrawerContent={() => drawerContent}');
    expect(drawerSource).toContain('drawerRefreshFrameRef.current = requestAnimationFrame');
    expect(drawerSource).toContain("import { Drawer } from 'react-native-drawer-layout'");
    expect(drawerSource).toContain('drawerType="front"');
    expect(drawerSource).toContain('swipeEnabled={Boolean(drawerProps)}');
    expect(drawerSource).toContain('return Math.max(0, windowWidth);');
    expect(drawerSource).toContain('swipeEdgeWidth={windowWidth}');
    expect(drawerSource).toContain('width: windowWidth');
    expect(drawerSource).toContain('.activeOffsetX(drawerOpen ? -6 : 6)');
    expect(drawerSource).toContain('swipeMinDistance={24}');
    expect(drawerSource).toContain('.failOffsetY([-18, 18])');
    expect(drawerSource).toContain('drawerPropsRef.current?.onClose()');
    expect(drawerSource).toContain('drawerPropsRef.current?.onOpen()');
    expect(drawerSource).toContain('registerDrawer?.(null)');
    expect(drawerSource).not.toContain('closeRequestedRef');
    expect(drawerSource).not.toContain('onTouchMoveCapture');
    expect(shellSource).not.toContain('PanResponder');
    expect(shellSource).not.toContain('drawerOffset');
    expect(shellSource).not.toContain('{!hasContextHeader ? (');
    expect(appSource).toContain('<GestureHandlerRootView style={{ flex: 1 }}>');
    expect(packageJson.dependencies['react-native-drawer-layout']).toBe('4.2.7');
    expect(packageJson.dependencies['react-native-gesture-handler']).toBe('~2.32.0');
    expect(packageJson.dependencies['react-native-reanimated']).toBe('4.5.0');
    expect(packageJson.reanimated.staticFeatureFlags.ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS).toBe(
      true,
    );
    expect(rootPackageJson.patchedDependencies['react-native-drawer-layout@4.2.7']).toBe(
      'patches/react-native-drawer-layout@4.2.7.patch',
    );
    expect(drawerPatch).toContain('+          stiffness: 700,');
    expect(drawerPatch).toContain('+          energyThreshold: 1e-5,');
    expect(drawerPatch).not.toContain('+          restDisplacementThreshold:');
    expect(drawerPatch).toContain('targetTranslationX.value === translateX');
    expect(drawerPatch).toContain("drawerType === 'front' ? 1 : translateX.value === 0");
  });
});
