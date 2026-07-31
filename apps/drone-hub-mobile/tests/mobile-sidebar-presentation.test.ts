import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('mobile sidebar presentation', () => {
  test('uses a flat device picker with quiet local and trailing platform metadata', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');

    expect(drawerSource).toContain('deviceOptionActiveEdge');
    expect(drawerSource).toContain('borderColor: colors.mutedDim');
    expect(drawerSource).toContain('shadowColor: colors.online');
    expect(drawerSource).toContain('<Text numberOfLines={1} style={styles.devicePlatform}>');
    expect(drawerSource).toContain('{devicePlatformLabel(device.platform)}');
    expect(drawerSource).toContain("platform === 'server' || platform === 'desktop'");
    expect(drawerSource).toContain('deviceOptionsContent: {\n    padding: 0,');
    expect(drawerSource).not.toContain('deviceOptionsContent: {\n    padding: 5,');
    expect(shellSource).toContain("detail: 'This device'");
    expect(shellSource).toContain("platform: current?.platform ?? 'android'");
    expect(shellSource).toContain('platform: device.platform');
  });

  test('uses explicit offline states without exposing transport terminology', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const dronesSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const transcriptSource = readFileSync(
      new URL('../src/local-assistant/LocalAssistantTranscript.tsx', import.meta.url),
      'utf8',
    );
    const socketSource = readFileSync(
      new URL('../src/mesh/MeshSocket.ts', import.meta.url),
      'utf8',
    );

    expect(drawerSource).not.toContain('No mesh route');
    expect(drawerSource).toContain('Drones will appear when it reconnects.');
    expect(dronesSource).toContain("subtitle: 'Offline · reconnecting automatically'");
    expect(dronesSource).toContain("{activeTarget?.name ?? 'This device'} is offline");
    expect(dronesSource).toContain('This chat is readable. Sending will resume');
    expect(dronesSource).toContain('editable={targetReachable}');
    expect(dronesSource).toContain('disabled={!targetReachable}');
    expect(dronesSource).toContain("disabled={!targetReachable || busy === 'prompt'}");
    expect(dronesSource).toContain(
      '<MobileLoadingState accessibilityLabel="Loading drones" label="Loading drones…" />',
    );
    expect(dronesSource).toContain('requestError={dronesLoading ? null : error}');
    expect(transcriptSource).toContain('<MobileLoadingState');
    expect(socketSource).toContain("new Error('Target device did not respond in time.')");
    expect(dronesSource).not.toContain('meshRouteAvailable');
  });

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
      /DRAWER_WORKING_SPIN_DURATION_MS = ([\d_]+)/.exec(mobileSource)?.[1]?.replaceAll('_', ''),
    );
    const desktopDuration =
      Number(/animate-\[spin_([\d.]+)s_linear_infinite\]/.exec(desktopSource)?.[1]) * 1_000;

    expect(mobileDuration).toBe(desktopDuration);
    expect(mobileSource.match(/duration: DRAWER_WORKING_SPIN_DURATION_MS/g)).toHaveLength(2);
  });

  test('keeps repository rows compact, path-free, and aligned with desktop state glyphs', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('styles.repoPath');
    expect(source).toContain('<ApprovalStatusIndicator />');
    expect(source).toContain('<WorkingStatusIndicator />');
    expect(source).toContain('<UnreadStatusIndicator />');
    expect(source).toContain("repoCopy: { flex: 1, minWidth: 0, justifyContent: 'center' }");
    expect(source).toContain('repoListSpacer: { height: 4 }');
    expect(source).toContain('<View style={styles.repoListSpacer} />');
    expect(source).not.toContain('styles.repoGroup');
    expect(source).toContain("repoRow: {\n    height: 36,");
    expect(source).toContain('paddingHorizontal: 14,');
    expect(source).toContain(
      "repoName: { color: colors.secondary, fontSize: 12, fontWeight: '500' }",
    );
    expect(source).toContain("repoNameActive: { color: colors.text, fontWeight: '600' }");
    expect(source).not.toContain('<ChevronRight color={colors.muted} size={15}');
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

  test('keeps repository state indicators aligned across one- and two-digit counts', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('fleetStateText: {\n    minWidth: 11,');
    expect(source).toContain("fontFamily: 'monospace',\n    textAlign: 'left',");
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
    const indicatorIndex = source.indexOf('<SwitchItemStatusIndicator');
    const titleIndex = source.indexOf('{drone.name}', indicatorIndex);

    expect(indicatorIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeGreaterThan(indicatorIndex);
    expect(source).not.toContain('RuntimeStatusIndicator');
    expect(source).not.toContain('styles.switchItemRuntimeSlot');
    expect(source).not.toContain('<View style={styles.switchItemCopy}>');
    expect(source).not.toContain('<View style={styles.switchItemMeta}>');
    expect(source).not.toContain('<Text style={styles.switchItemState}>{stateLabel}</Text>');
    expect(source).not.toContain('styles.switchItemTimeSlot');
    expect(source).not.toContain('styles.chatCount');
    expect(source).toContain('selected ? <View style={styles.sidebarSelectionEdge} /> : null');
    expect(source).toContain('containsSelectedDrone ? (');
    expect(source).toContain(
      'switchItemRowActive: { backgroundColor: colors.sidebarSelectionWash }',
    );
    expect(source).toContain('repoRowActive: { backgroundColor: colors.sidebarSelectionWash }');
    expect(source).toContain("droneNode: { position: 'relative' }");
    expect(source).toContain("switchItemRow: {\n    height: 36,");
    expect(source).toContain('fontSize: 13,\n    fontWeight: \'400\',');
    expect(source).toContain("switchItemTitleActive: { color: colors.text }");
    expect(source).toContain('const DRAWER_TREE_ROW_PADDING_LEFT = 12;');
    expect(source).toContain('const DRAWER_TREE_DEPTH_INDENT = 10;');
    expect(source).toContain('sidebarRowPressed: { backgroundColor: colors.whiteWash }');
    expect(source).toContain('droneList: { paddingBottom: 24 }');
  });

  test('uses the working spinner for starting and operation states in the compact row', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("state === 'starting' ||");
    expect(source).toContain("state === 'archiving' ||");
    expect(source).toContain("state === 'deleting';");
    expect(source).toContain(') : working ? (');
    expect(source).not.toContain('<Text style={styles.switchItemState}>{stateLabel}</Text>');
  });

  test('keeps a fixed leading status gutter with a faint ready anchor', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("const ready = state === 'idle' && !unread;");
    expect(source).toContain('<View style={styles.readyStateAnchor} />');
    expect(source).toContain('width: DRAWER_TREE_LEADING_SLOT_WIDTH');
    expect(source).toContain('height: DRAWER_TREE_LEADING_SLOT_WIDTH');
    expect(source).toContain('borderColor: colors.mutedDim');
    expect(source).toContain('opacity: 0.35');
  });

  test('matches the desktop blocked warning and unread glow indicators', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("state === 'blocked' ? (");
    expect(source).toContain('<BlockedStatusIndicator />');
    expect(source).toContain('d="M6 1.25 11 10.25H1L6 1.25Z"');
    expect(source).toContain('d="M6 4.15v2.75"');
    expect(source).toContain('cx="6" cy="8.5"');
    expect(source).toContain('stroke={colors.sidebarBlockedIndicator}');
    expect(source).toContain('shadowColor: colors.onlineBorder');
    expect(source).toContain('shadowOffset: { width: 0, height: 0 }');
  });

  test('uses the desktop chevron-only group treatment and selected-child guide', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source.match(/paddingLeft: drawerTreeRowPaddingLeft\(depth\)/g)).toHaveLength(2);
    expect(source).toContain('gap: DRAWER_TREE_LEADING_GAP');
    expect(source).toContain('width: DRAWER_TREE_LEADING_SLOT_WIDTH');
    expect(source).toContain('<View style={styles.folderChevronSlot}>');
    expect(source).toContain(
      '<Chevron color={colors.mutedDim} size={16} strokeWidth={1.25} />',
    );
    expect(source).not.toContain('<Folder color={colors.muted}');
    expect(source).toContain(
      'const hasSelectedDirectDrone = folder.roots.some((node) => node.drone.id === activeDroneId);',
    );
    expect(source).toContain('{hasSelectedDirectDrone ? (');
    expect(source).toContain('styles.groupChildrenGuide');
    expect(source).toContain(
      "groupName: { color: colors.secondary, fontSize: 13, fontWeight: '400', flex: 1 }",
    );
    expect(source).toContain("groupRow: {\n    minHeight: 36,");
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
      'resolvePinnedSidebarDrones(drones, droneSidebarOrder.pinnedDroneIds)',
    );
    expect(drawerSource).not.toContain('resolvePinnedSidebarDronesForRepo(');
    expect(drawerSource).not.toContain('excludePinnedMobileDrones');
    expect(drawerSource).toContain('data={activeRepo.entries}');
    expect(drawerSource).toContain('drones={globalPinnedDrones}');
    expect(drawerSource).toContain('<Text style={styles.pinnedHeaderText}>Pinned</Text>');
    expect(drawerSource).toContain('pinnedSection: {\n    paddingBottom: 4,');
    expect(drawerSource).toContain('pinnedHeader: {\n    minHeight: 32,');
    expect(drawerSource).toContain('paddingLeft: 12,\n    paddingRight: 8,');
    expect(drawerSource).toContain('<Pin color={colors.mutedDim} size={14} strokeWidth={1.7} />');
    expect(drawerSource).toContain("fontSize: 10.5,\n    fontWeight: '400',");
    expect(drawerSource).toContain('<Text numberOfLines={1} style={styles.switchItemContextBadge}>');
    expect(drawerSource).not.toContain('styles.pinnedCount');
    expect(drawerSource).not.toContain('<Text style={styles.pinnedCount}>{drones.length}</Text>');
    expect(drawerSource).not.toContain('accessibilityLabel={pinned ? `Unpin ${drone.name}`');
    expect(drawerSource.match(/<DrawerPinnedDrones/g)).toHaveLength(1);
    const activeRepoListStart = drawerSource.indexOf('key={`repo:${activeRepo.id}`}');
    const activeRepoHeaderStart = drawerSource.indexOf('ListHeaderComponent={', activeRepoListStart);
    const activeRepoHeaderEnd = drawerSource.indexOf('ListFooterComponent=', activeRepoHeaderStart);
    const activeRepoHeader = drawerSource.slice(activeRepoHeaderStart, activeRepoHeaderEnd);
    expect(activeRepoHeader.indexOf("pinnedSidebarPlacement === 'top' ? pinnedDronesSection : null")).toBeLessThan(
      activeRepoHeader.indexOf('styles.repoNavigationHead,'),
    );
    expect(drawerSource).toContain(
      "pinnedSidebarPlacement === 'bottom' ? pinnedDronesSection : null",
    );
    expect(drawerSource).toContain("current === 'top' ? 'bottom' : 'top'");
    expect(drawerSource).toContain('AsyncStorage.setItem(PINNED_SIDEBAR_PLACEMENT_KEY, next)');
    expect(drawerSource).toContain("React.useState<PinnedSidebarPlacement>('bottom')");
    expect(drawerSource).toContain("stored === 'top' || stored === 'bottom'");
    expect(drawerSource).toContain("placement === 'top' ? 'Move pinned drones to bottom' : 'Move pinned drones to top'");
    expect(drawerSource).toContain('style={styles.pinnedHeaderText}>Pinned</Text>');
    expect(drawerSource).toContain('pinnedHeaderText: {\n    flex: 1,');
    expect(drawerSource).toContain('pinnedPlacementToggle: {');
    expect(drawerSource).toContain("placement === 'bottom' && styles.pinnedSectionBottom");
    expect(drawerSource).toContain('pinnedSectionBottom: {\n    flexShrink: 0,');
    expect(drawerSource).toContain("pinnedSidebarPlacement === 'top' &&");
    expect(drawerSource).toContain('globalPinnedDrones.length > 0 &&');
    expect(drawerSource).toContain('styles.repoNavigationHeadBelowPinned');
    expect(drawerSource).toContain(
      'repoNavigationHeadBelowPinned: {\n    borderTopWidth: 1,\n    borderTopColor: colors.borderSubtle,',
    );
    expect(drawerSource).toContain('borderTopWidth: 1,\n    borderTopColor: colors.borderSubtle,');
    expect(drawerSource).not.toContain('pinnedSection: {\n    paddingBottom: 0,\n    borderBottomWidth: 1,');
    expect(drawerSource.lastIndexOf("pinnedSidebarPlacement === 'bottom' ? pinnedDronesSection : null")).toBeGreaterThan(
      drawerSource.lastIndexOf('keyboardShouldPersistTaps="handled"'),
    );
    const pinnedSelectionStart = drawerSource.indexOf('const selectPinnedDroneChat');
    const pinnedSelectionEnd = drawerSource.indexOf('const pinnedDronesSection', pinnedSelectionStart);
    const pinnedSelectionSource = drawerSource.slice(pinnedSelectionStart, pinnedSelectionEnd);
    expect(pinnedSelectionSource).not.toContain('setActiveRepoId');
    expect(pinnedSelectionSource).toContain('onSelectDroneChat?.(droneId, chatName)');
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
