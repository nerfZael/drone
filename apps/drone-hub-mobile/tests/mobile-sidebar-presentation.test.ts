import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('mobile sidebar presentation', () => {
  test('matches the desktop Hub working-indicator speed', () => {
    const mobileSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const desktopSource = readFileSync(
      new URL('../../drone-hub/src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );
    const mobileDuration = Number(
      /DRAWER_WORKING_SPIN_DURATION_MS = ([\d_]+)/
        .exec(mobileSource)?.[1]
        ?.replaceAll('_', ''),
    );
    const desktopDuration = Number(
      /animate-\[spin_([\d.]+)s_linear_infinite\]/.exec(desktopSource)?.[1],
    ) * 1_000;

    expect(mobileDuration).toBe(desktopDuration);
    expect(mobileSource.match(/duration: DRAWER_WORKING_SPIN_DURATION_MS/g)).toHaveLength(2);
  });

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

  test('orders header states by approval, unread, then working', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const countsStart = source.indexOf('function DroneStateCounts');
    const countsEnd = source.indexOf('function switchStateLabel', countsStart);
    const countsSource = source.slice(countsStart, countsEnd);

    expect(countsSource.indexOf('summary.approval')).toBeLessThan(
      countsSource.indexOf('summary.unread'),
    );
    expect(countsSource.indexOf('summary.unread')).toBeLessThan(
      countsSource.indexOf('summary.working'),
    );
  });

  test('derives the selected drone approval state from the active native thread', () => {
    const source = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('withMobileApprovalRequired(');
    expect(source).toContain("nativeThread?.status === 'waiting_for_approval'");
  });

  test('matches the desktop drone row hierarchy and selection treatment', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const indicatorIndex = source.indexOf(
      '<SwitchItemStatusIndicator state={displayState} unread={unread} />',
    );
    const titleIndex = source.indexOf('{drone.name}', indicatorIndex);

    expect(indicatorIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeGreaterThan(indicatorIndex);
    expect(source).not.toContain('RuntimeStatusIndicator');
    expect(source).not.toContain('styles.switchItemRuntimeSlot');
    expect(source).toContain('style={styles.switchItemTimeSlot}');
    expect(source).not.toContain('styles.switchItemMeta');
    expect(source).not.toContain('styles.chatCount');
    expect(source).toContain('selected ? <View style={styles.sidebarSelectionEdge} /> : null');
    expect(source).toContain('containsSelectedDrone ? <View style={styles.sidebarSelectionEdge} /> : null');
    expect(source).toContain('switchItemRowActive: { backgroundColor: colors.sidebarSelectionWash }');
    expect(source).toContain('repoRowActive: { backgroundColor: colors.sidebarSelectionWash }');
    expect(source).toContain("droneList: { paddingBottom: 24 }");
  });

  test('uses the working spinner for starting and operation states without visible labels', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("state === 'starting' ||");
    expect(source).toContain("state === 'archiving' ||");
    expect(source).toContain("state === 'deleting';");
    expect(source).toContain('{ready ? null : working ? (');
    expect(source).not.toContain('{stateLabel}</Text>');
  });

  test('keeps a fixed leading status gutter while leaving ready drones visually silent', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("const ready = state === 'idle' && !unread;");
    expect(source).toContain('{ready ? null : working ? (');
    expect(source).toContain('width: DRAWER_TREE_LEADING_SLOT_WIDTH');
    expect(source).toContain('height: DRAWER_TREE_LEADING_SLOT_WIDTH');
  });

  test('aligns group and drone labels at the same tree depth', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source.match(/paddingLeft: drawerTreeRowPaddingLeft\(depth\)/g)).toHaveLength(2);
    expect(source).toContain('gap: DRAWER_TREE_LEADING_GAP');
    expect(source).toContain('width: DRAWER_TREE_LEADING_SLOT_WIDTH');
  });

  test('shows pinned drones first and keeps pinning in the chat header menu', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const dronesSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');

    expect(drawerSource).toContain(
      'resolvePinnedSidebarDronesForRepo(',
    );
    expect(drawerSource).toContain('activeRepo.repoPath');
    expect(drawerSource).toContain('drones={activeRepoPinnedDrones}');
    expect(drawerSource).toContain('<Text style={styles.pinnedHeaderText}>Pinned</Text>');
    expect(drawerSource).toContain('<Pin color={colors.mutedDim} size={13} strokeWidth={1.7} />');
    expect(drawerSource).not.toContain('styles.pinnedCount');
    expect(drawerSource).not.toContain('<Text style={styles.pinnedCount}>{drones.length}</Text>');
    expect(drawerSource).not.toContain('accessibilityLabel={pinned ? `Unpin ${drone.name}`');
    expect(drawerSource.match(/<DrawerPinnedDrones/g)).toHaveLength(1);
    expect(dronesSource).toContain('onTogglePinned: () =>');
    expect(dronesSource).toContain('void setDronePinned(');
    expect(shellSource).toContain("id: 'toggle-pin'");
    expect(shellSource).toContain("label: dronesHeader.pinned ? 'Unpin drone' : 'Pin drone'");
    expect(shellSource).toContain('disabled: dronesHeader.pinDisabled');
  });

  test('does not render status counts on group rows', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const folderStart = source.indexOf('function DrawerDroneFolder');
    const folderEnd = source.indexOf('function DrawerDroneEntry', folderStart);
    const folderSource = source.slice(folderStart, folderEnd);

    expect(folderSource).not.toContain('<DroneStateCounts');
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
