import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { colors } from '../src/theme';

function normalizedColor(value: string): string {
  return value
    .replaceAll(/\s+/g, '')
    .replaceAll(/([,(])0\./g, '$1.')
    .toLowerCase();
}

describe('mobile sidebar presentation', () => {
  test('offers selected container drones a clone action', () => {
    const screenSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');

    expect(shellSource).toContain("label: 'Clone drone'");
    expect(screenSource).toContain('cloneFrom: source.id');
    expect(screenSource).toContain('cloneChats: true');
    expect(screenSource).toContain("source.runtime.trim().toLowerCase() === 'host'");
    expect(screenSource).toContain("selected.runtime.trim().toLowerCase() === 'host'");
  });

  test('gives optimistic drone rows stable creation and group identity metadata', () => {
    const source = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('groupId: result?.drone?.groupId ?? result?.groupId');
    expect(source).toContain('result?.drone?.createdAt ??');
    expect(source).toContain('result?.createdAt ??');
    expect(source).toContain('payload.seedSubmittedAt ??');
  });

  test('shares the desktop Catppuccin sidebar palette', () => {
    const desktopStyles = readFileSync(
      new URL('../../drone-hub/src/styles.css', import.meta.url),
      'utf8',
    );
    const themeStart = desktopStyles.indexOf(":root[data-theme='catppuccin-mocha']");
    const themeEnd = desktopStyles.indexOf('\n}', themeStart);
    const desktopTheme = desktopStyles.slice(themeStart, themeEnd);
    const desktopColor = (name: string) =>
      new RegExp(`--${name}:\\s*([^;]+);`).exec(desktopTheme)?.[1] ?? '';

    expect(normalizedColor(colors.sidebarFg)).toBe(normalizedColor(desktopColor('sidebar-fg')));
    expect(normalizedColor(colors.sidebarFgActive)).toBe(
      normalizedColor(desktopColor('sidebar-fg-active')),
    );
    expect(normalizedColor(colors.sidebarHeadingFg)).toBe(
      normalizedColor(desktopColor('sidebar-heading-fg')),
    );
    expect(normalizedColor(colors.sidebarActionFg)).toBe(
      normalizedColor(desktopColor('sidebar-action-fg')),
    );
    expect(normalizedColor(colors.sidebarSubitemFg)).toBe(
      normalizedColor(desktopColor('sidebar-subitem-fg')),
    );
    expect(normalizedColor(colors.sidebarDroneFg)).toBe(
      normalizedColor(desktopColor('sidebar-drone-fg')),
    );
    expect(normalizedColor(colors.sidebarDroneActiveFg)).toBe(
      normalizedColor(desktopColor('sidebar-drone-active-fg')),
    );
    expect(normalizedColor(colors.sidebarSelectionWash)).toBe(
      normalizedColor(desktopColor('sidebar-row-selected-bg')),
    );
    expect(normalizedColor(colors.sidebarSelectionEdge)).toBe(
      normalizedColor(desktopColor('sidebar-row-selected-edge')),
    );
    expect(normalizedColor(colors.sidebarBlockedIndicator)).toBe(
      normalizedColor(desktopColor('sidebar-blocked-indicator')),
    );
    expect(normalizedColor(colors.sidebarHeaderBorder)).toBe(
      normalizedColor(desktopColor('app-header-border')),
    );
  });

  test('uses the exact desktop SVG paths for shared sidebar icons', () => {
    const mobileIcons = readFileSync(
      new URL('../src/local-assistant/SidebarIcons.tsx', import.meta.url),
      'utf8',
    );
    const desktopIcons = [
      '../../drone-hub/src/droneHub/icons.tsx',
      '../../drone-hub/src/droneHub/app/icons.tsx',
      '../../drone-hub/src/droneHub/overview/icons.tsx',
      '../../drone-hub/src/droneHub/overview/DroneCard.tsx',
    ]
      .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
      .join('\n');
    const paths = (source: string) =>
      [...source.matchAll(/<(?:path|Path)\s+d="([^"]+)"/g)].map((match) => match[1]);
    const desktopPathSet = new Set(paths(desktopIcons));

    for (const mobilePath of paths(mobileIcons)) {
      expect(desktopPathSet.has(mobilePath)).toBe(true);
    }
    expect(mobileIcons).toContain('<Rect x="5" y="5" width="6" height="6" rx="1" />');
    expect(mobileIcons).toContain('<Path d="M6.8 1.03a1.2 1.2 0 012.4 0l.1.81');
    expect(mobileIcons).toContain("? 'm15 18-6-6 6-6'");
    expect(mobileIcons).toContain("? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'");
    expect(mobileIcons).toContain('<Path d="M2.25 2.5h2.6c.44 0 .84.21 1.08.58l.78 1.17');
    expect(mobileIcons).toContain('strokeWidth="1.2"');
  });

  test('uses a flat device picker with quiet local and trailing platform metadata', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');

    expect(drawerSource).toContain('deviceOptionActiveEdge');
    expect(drawerSource).toContain('borderColor: colors.sidebarMutedDim');
    expect(drawerSource).toContain('shadowColor: colors.online');
    expect(drawerSource).toContain('<Text numberOfLines={1} style={styles.devicePlatform}>');
    expect(drawerSource).toContain('{devicePlatformLabel(device.platform)}');
    expect(drawerSource).toContain("platform === 'server' || platform === 'desktop'");
    expect(drawerSource).toContain('deviceOptionsContent: {\n    padding: 0,');
    expect(drawerSource).not.toContain('deviceOptionsContent: {\n    padding: 5,');
    expect(shellSource).toContain("detail: 'This device'");
    expect(shellSource).toContain("platform: current?.platform ?? 'android'");
    expect(shellSource).toContain('platform: device.platform');
    expect(drawerSource).toContain('width: 232,');
    expect(drawerSource).toContain(
      "deviceOptionName: { color: colors.sidebarFg, fontSize: 12, fontWeight: '400' }",
    );
    expect(drawerSource).toContain('deviceOptionNameActive: { color: colors.sidebarFgActive }');
    expect(drawerSource).toContain('backgroundColor: colors.sidebarSelectionEdge');
    expect(drawerSource).toContain('accessibilityLabel="Manage devices"');
    expect(drawerSource).toContain('deviceSettingsActionLabel');
    expect(drawerSource).not.toContain('<SidebarNetworkIcon');
    expect(drawerSource).toContain('borderTopColor: colors.borderSubtle');
    expect(drawerSource).toContain('{devicesNavigationItem ? (');
    expect(drawerSource).toContain('accessibilityLabel="Open settings"');
    expect(drawerSource).toContain('<SidebarSettingsIcon');
    expect(drawerSource).not.toContain('<View style={styles.navigation}>');
    expect(drawerSource).not.toContain('function navigationIcon');
    expect(drawerSource).toContain(
      "devicePickerName: { color: colors.text, fontSize: 12, fontWeight: '400' }",
    );
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
    expect(dronesSource).toContain("'Reconnecting to device'");
    expect(dronesSource).toContain("'Reconnecting…'");
    expect(dronesSource).toContain('mesh.retryDeviceConnection(targetId)');
    expect(dronesSource).toContain('This chat is readable. Sending will resume');
    expect(drawerSource).toContain("device.connectionState === 'reconnecting'");
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

  test('uses spacious repository rows with muted paths and desktop-aligned state glyphs', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('style={styles.repoPath}');
    expect(source).toContain("{group.repoPath || 'Drones without a repository'}");
    expect(source).toContain('<ApprovalStatusIndicator />');
    expect(source).toContain('<WorkingStatusIndicator />');
    expect(source).toContain('<UnreadStatusIndicator />');
    expect(source).toContain("repoCopy: { flex: 1, minWidth: 0, justifyContent: 'center' }");
    expect(source).not.toContain('const projectCount =');
    expect(source).not.toContain('repoListHeader: {');
    expect(source).toContain('style={styles.repoIconSlot}');
    expect(source).toContain('repoIconSlot: {');
    expect(source).toContain('{isUngrouped ? (');
    expect(source).toContain('<SidebarFolderOutlineIcon');
    expect(source).not.toContain('repoIconFrame: {');
    expect(source).toContain('repoUngroupedDivider: {');
    expect(source).not.toContain('styles.repoGroup');
    expect(source).toContain('repoRow: {\n    minHeight: 50,');
    expect(source).toContain('paddingHorizontal: 14,');
    expect(source).toContain('paddingVertical: 7,');
    expect(source).toContain(
      "repoName: { color: colors.sidebarHeadingFg, fontSize: 13, fontWeight: '600' }",
    );
    expect(source).toContain('repoPath: {\n    marginTop: 2,');
    expect(source).toContain('fontSize: 8.5,');
    expect(source).toContain('opacity: 0.55,');
    expect(source).toContain(
      "repoNameActive: { color: colors.sidebarDroneActiveFg, fontWeight: '600' }",
    );
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
    expect(source).toContain('switchItemRow: {\n    height: 36,');
    expect(source).toContain("fontSize: 13,\n    fontWeight: '400',");
    expect(source).toContain('switchItemTitleActive: { color: colors.sidebarDroneActiveFg }');
    expect(source).toContain('const DRAWER_TREE_ROW_PADDING_LEFT = 12;');
    expect(source).toContain('const DRAWER_TREE_DEPTH_INDENT = 10;');
    expect(source).toContain('sidebarRowPressed: { backgroundColor: colors.whiteWash }');
    expect(source).toContain('droneList: { paddingBottom: 24 }');
  });

  test('uses distinct progress indicators for archive and delete in the compact row', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("const working = state === 'working' || state === 'starting';");
    expect(source).toContain("state === 'archiving' ? (");
    expect(source).toContain('<OperationStatusIndicator operation="archiving" />');
    expect(source).toContain("state === 'deleting' ? (");
    expect(source).toContain('<OperationStatusIndicator operation="deleting" />');
    expect(source).toContain("operation === 'archiving' ? colors.info : colors.danger");
    expect(source).toContain(
      '<SidebarWorkingIcon color={colors.info} size={12} strokeWidth={2.4} />',
    );
    expect(source).toContain('height={6}');
    expect(source).toContain('width={6}');
    expect(source).toContain("operationStatusGlyph: { position: 'absolute' }");
    expect(source).toContain(') : working ? (');
    expect(source).not.toContain('<Text style={styles.switchItemState}>{stateLabel}</Text>');
  });

  test('keeps a fixed leading status gutter with the desktop ready anchor', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("const ready = showReadyAnchor && state === 'idle' && !unread;");
    expect(source).toContain('<View style={styles.readyStateAnchor} />');
    expect(source).toContain('width: DRAWER_TREE_LEADING_SLOT_WIDTH');
    expect(source).toContain('height: DRAWER_TREE_LEADING_SLOT_WIDTH');
    expect(source).toContain('borderColor: colors.sidebarMutedDim');
    expect(source).toContain('opacity: 0.7');
  });

  test('matches the desktop blocked warning and unread glow indicators', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("state === 'blocked' ? (");
    expect(source).toContain('<BlockedStatusIndicator emphasized={emphasized} />');
    expect(source).toContain('d="M6 1.25 11 10.25H1L6 1.25Z"');
    expect(source).toContain('d="M6 4.15v2.75"');
    expect(source).toContain('cx="6" cy="8.5"');
    expect(source).toContain('const color = colors.sidebarBlockedIndicator;');
    expect(source).toContain('quietBlockedStatusIndicator: { opacity: 0.7 }');
    expect(source).toContain('shadowColor: colors.onlineBorder');
    expect(source).toContain('shadowOffset: { width: 0, height: 0 }');
    expect(source).toContain('const RECENT_BLOCKED_EMPHASIS_MS = 30_000;');
    expect(source).toContain('emphasized={recentlyBlocked || selected}');
  });

  test('uses the composer runtime icons and colors for container and host drone rows', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const runtimeSource = readFileSync(
      new URL('../src/drones/NewDroneRuntimePicker.tsx', import.meta.url),
      'utf8',
    );

    expect(drawerSource).toContain('<RuntimeIcon runtime={runtime} size={14} />');
    expect(runtimeSource).toContain(
      "const color = runtime === 'host' ? colors.online : colors.accent;",
    );
    expect(runtimeSource).toContain('<Monitor color={color}');
    expect(runtimeSource).toContain('<Box color={color}');
  });

  test('renders desktop-equivalent multi-chat disclosures, including pinned drones', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const modelSource = readFileSync(
      new URL('../src/drones/drone-sidebar-model.ts', import.meta.url),
      'utf8',
    );
    const screenSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const localControlSource = readFileSync(
      new URL('../src/drones/local-drone-control.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('const chats = orderedMobileDroneChats(');
    expect(source).toContain(
      'const hasVisibleActiveChildChat = hasActiveChildChat && chatSectionExpanded;',
    );
    expect(source).toContain('sidebarChatOrderByDrone[drone.id]');
    expect(source).toContain('showChats && hasMultipleChats ? (');
    expect(source).toContain('buildSidebarChatTree({');
    expect(source).toContain('<DrawerDroneChatTreeEntry');
    expect(source).toContain('const isChatDisclosure = showChats && hasMultipleChats;');
    expect(source).toContain('const chatSectionExpanded = !collapsedDroneIds.has(drone.id);');
    expect(source).toContain('if (isChatDisclosure) {');
    expect(source).toContain('onSelectContainer(drone.id);');
    expect(source).toContain('onSelect(drone.id, selectedChat);');
    expect(source).toContain('onToggleDrone(drone.id);');
    expect(source).toContain('expanded: isChatDisclosure ? chatSectionExpanded : undefined');
    expect(source).toContain('<View accessible={false} style={styles.droneChevronSlot}>');
    expect(source).toContain('expanded={chatSectionExpanded}');
    expect(source).toContain('chatSectionExpanded ? (');
    expect(source).toContain('<RuntimeIcon runtime={runtime} size={14} />');
    expect(source).toContain('style={styles.droneRuntimeIconSlot}');
    expect(source).not.toContain('<SidebarContainerIcon');
    expect(source).not.toContain('styles.droneSpineExpanded');
    expect(source).toContain('muted ? (');
    expect(source).toContain('mobileDroneDisplayState(drone, !hasMultipleChats)');
    expect(source).toContain('!isDraft && !hasMultipleChats');
    expect(source).toContain('return summarizeMobileDroneChats({');
    expect(source).toContain(
      '<DroneStateCounts summary={chatStateSummary} compact entity="chat" />',
    );
    expect(source).toContain('{ marginLeft: drawerTreeRowPaddingLeft(depth) + 8 }');
    expect(source).toContain('selectionWashInset={drawerTreeRowPaddingLeft(depth) + 8}');
    expect(source).toContain('hasActiveChildChat && styles.droneChatRailVisible');
    expect(source).toContain("borderLeftColor: 'transparent'");
    expect(source).toContain('gap: 4,\n    paddingLeft: 8,\n    paddingRight: 6,');
    expect(source).toContain('styles.droneChatSelectionWash, { left: -selectionWashInset }');
    expect(source).toContain('<DrawerDroneChatRow');
    expect(source).toContain('drone.draftChats?.[chatName] === true');
    expect(source).toContain('styles.droneChatDraftBadge');
    expect(source).toContain('borderColor: colors.accentAlt,');
    expect(source).toContain(
      '<SwitchItemStatusIndicator state={displayState} unread={unread} muted={muted} showReadyAnchor />',
    );
    expect(source).toContain(
      'const containerSelected = isChatDisclosure && selectedContainerDroneId === drone.id;',
    );
    expect(source).toContain(
      'const parentSelected = containerSelected || (selected && !hasVisibleActiveChildChat);',
    );
    expect(source).toContain('parentSelected && styles.switchItemRowActive');
    expect(source).toContain(
      'parentSelected ? <View style={styles.sidebarSelectionEdge} /> : null',
    );
    expect(source).toContain('delayLongPress={600}');
    expect(source).toContain('suppressPressAfterLongPressRef.current = true;');
    expect(source).toContain('onOpenActions({ drone, chatName });');
    expect(source).toContain('if (suppressPressAfterLongPressRef.current) {');
    expect(source).toContain('if (!applied) return;');
    expect(source).toContain('onSelectDroneChat?.(');
    expect(source).toContain("label: 'Create chat'");
    expect(source).toContain("label: 'Rename chat'");
    expect(source).toContain(": 'Delete chat'");
    expect(source).toContain("label: directlyMuted ? 'Unmute group' : 'Mute group'");
    expect(source).toContain("label: 'Delete chats in group'");
    expect(source).toContain('setDeleteChatGroupTarget({');
    expect(source).not.toContain('setSelectedChatNodeIds(new Set(groupChatNames');
    expect(source).toContain('resolveEffectiveSidebarChatMuteSets(tree, mutedChatIdSet)');
    expect(source).toContain('muteContext?.effectiveChatIds.has(');
    expect(source).not.toContain("label: 'Hide group'");
    expect(source).toContain('<TextInputDialog');
    expect(source).toContain('<ConfirmDialog');
    expect(source).toContain('resolveMobileChatDeletePlan({');
    const deleteFlow = source.slice(
      source.indexOf('const deleteChatPlan'),
      source.indexOf('const chatContextActions'),
    );
    expect(deleteFlow).not.toContain('window.confirm');
    expect(deleteFlow).not.toContain('Alert.alert');
    expect(deleteFlow).toContain('for (const name of deleteChatPlan.chatNames)');
    expect(deleteFlow).toContain('catch {');
    expect(source).toContain('repoNavigationHead: {\n    minHeight: 48,\n    marginBottom: 8,');
    expect(source).not.toContain('showChats={false}');
    expect(source).toContain('color: colors.sidebarSubitemFg,');
    expect(source).toContain('droneChildren: {\n    position: \'relative\',');
    expect(source).toContain('style={[styles.groupChildrenGuide, { left: drawerTreeRowPaddingLeft(depth) + 8 }]}');
    expect(source).toContain('node={child}\n              depth={depth + 1}');
    expect(modelSource).toContain('sidebarChatOrderByDrone: Record<string, string[]>;');
    expect(modelSource).toContain(
      'sidebarChatOrderByDrone: stringListMap(sidebar.sidebarChatOrderByDrone)',
    );
    expect(screenSource).toContain("requestDroneControl(destinationId, 'chat.rename'");
    expect(screenSource).toContain("requestDroneControl(destinationId, 'chat.delete'");
    expect(screenSource).toContain('commitDrawerChatMutation(');
    expect(screenSource).toContain('return targetIdRef.current === destinationId;');
    expect(screenSource).toContain('onCreateDroneChat={createDrawerChat}');
    expect(screenSource).toContain('onRenameDroneChat={renameDrawerChat}');
    expect(screenSource).toContain('onDeleteDroneChat={deleteDrawerChat}');
    expect(screenSource).toContain(
      'const wasMuted = droneSidebarOrderRef.current.mutedChatIds.includes',
    );
    expect(screenSource).toContain("targetKind: 'chat'");
    expect(localControlSource).toContain("if (operation === 'chat.rename')");
    expect(localControlSource).toContain("if (operation === 'chat.delete')");
    expect(localControlSource).toContain(
      'mutedSidebarGroupIds: sidebarOrderRef.current.mutedSidebarGroupIds',
    );
    expect(localControlSource).toContain('mutedChatIds: nextLayout.mutedChatIds');
  });

  test('distinguishes draft and loading rows instead of showing misleading ready content', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("drone.phase.trim().toLowerCase() === 'draft'");
    expect(source).toContain('<View accessible={false} style={styles.switchItemStatus} />');
    expect(source).toContain('accessibilityLabel="Draft drone"');
    expect(source).toContain('style={styles.switchItemDraftBadge}');
    expect(source).toContain('buildMobileDroneRepoGroups(drones, droneSidebarOrder)');
    expect(source).not.toContain('Prepared drone drafts');
    expect(source).not.toContain('const preparedDrones =');
    expect(source).toContain('dronesLoading && drones.length === 0 ? (');
    expect(source).toContain('accessibilityLabel="Loading projects and drones"');
    expect(source).toContain('Loading projects and drones…');
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
    expect(source).toContain('color={colors.sidebarMutedDim}');
    expect(source).toContain('style={styles.folderChevron}');
    expect(source).not.toContain('<Folder color={colors.muted}');
    expect(source).toContain(
      'const hasSelectedDirectDrone = folder.roots.some((node) => node.drone.id === activeDroneId);',
    );
    expect(source).toContain('{hasSelectedDirectDrone ? (');
    expect(source).toContain('styles.groupChildrenGuide');
    expect(source).toContain(
      "groupName: { color: colors.sidebarHeadingFg, fontSize: 13, fontWeight: '400', flex: 1 }",
    );
    expect(source).toContain('groupRow: {\n    minHeight: 36,');
    const chatGroupRows = source.slice(
      source.indexOf('function DrawerDroneChatTreeEntry'),
      source.indexOf('function DrawerDroneNode'),
    );
    expect(chatGroupRows).toContain('styles.groupRow');
    expect(chatGroupRows).toContain('<View style={styles.folderChevronSlot}>');
    expect(chatGroupRows).not.toContain('<SidebarFolderOutlineIcon');
    expect(chatGroupRows).toContain('styles.groupChildrenGuide');
    expect(source).not.toContain("label: 'Create chat group'");
    expect(source).toContain('if (onReorderSidebar && chatActionTarget.drone.chats.length > 1)');
    expect(source).toContain('if (chats.length > 1) {');
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
    expect(drawerSource).not.toContain('<DrawerPreparedDrones');
    expect(drawerSource).not.toContain('resolvePinnedSidebarDronesForRepo(');
    expect(drawerSource).not.toContain('excludePinnedMobileDrones');
    expect(drawerSource).toContain('data={activeRepo.entries}');
    expect(drawerSource).toContain('drones={globalPinnedDrones}');
    expect(drawerSource).toContain('<Text style={styles.pinnedHeaderText}>Pinned</Text>');
    expect(drawerSource).toContain('pinnedSection: {\n    flexShrink: 0,\n    paddingBottom: 4,');
    expect(drawerSource).toContain('pinnedHeader: {\n    minHeight: 32,');
    expect(drawerSource).toContain('paddingLeft: 12,\n    paddingRight: 8,');
    expect(drawerSource).toContain('borderBottomWidth: StyleSheet.hairlineWidth,');
    expect(drawerSource).toContain('color={colors.sidebarMutedDim}');
    expect(drawerSource).toContain('style={styles.pinnedHeaderIcon}');
    expect(drawerSource).toContain(
      "accessibilityLabel={collapsed ? 'Expand pinned drones' : 'Collapse pinned drones'}",
    );
    expect(drawerSource).toContain('accessibilityState={{ expanded: !collapsed }}');
    expect(drawerSource).toContain('onPress={onToggleCollapsed}');
    expect(drawerSource).toContain('? drones.map((drone) => (');
    expect(drawerSource).toContain("fontSize: 10.5,\n    fontWeight: '400',");
    expect(drawerSource).toContain(
      '<Text numberOfLines={1} style={styles.switchItemContextBadge}>',
    );
    expect(drawerSource).toContain(
      'if (summary.approval <= 0 && summary.unread <= 0 && summary.working <= 0) return null;',
    );
    const pinnedCountsIndex = drawerSource.indexOf('hasMultipleChats && contextLabel ? (');
    const contextBadgeIndex = drawerSource.indexOf(
      '<Text numberOfLines={1} style={styles.switchItemContextBadge}>',
    );
    const regularCountsIndex = drawerSource.indexOf('hasMultipleChats && !contextLabel ? (');
    expect(pinnedCountsIndex).toBeGreaterThan(-1);
    expect(pinnedCountsIndex).toBeLessThan(contextBadgeIndex);
    expect(regularCountsIndex).toBeGreaterThan(contextBadgeIndex);
    expect(drawerSource).toContain('switchItemContextBadge: {\n    maxWidth: 76,');
    expect(drawerSource).toContain('color: colors.sidebarFgActive,');
    expect(drawerSource).toContain('borderColor: colors.border,');
    expect(drawerSource).toContain('backgroundColor: colors.sidebarSurfaceInset,');
    expect(drawerSource).not.toContain('styles.pinnedCount');
    expect(drawerSource).not.toContain('<Text style={styles.pinnedCount}>{drones.length}</Text>');
    expect(drawerSource).not.toContain('accessibilityLabel={pinned ? `Unpin ${drone.name}`');
    expect(drawerSource.match(/<DrawerPinnedDrones/g)).toHaveLength(1);
    const activeRepoListStart = drawerSource.indexOf('key={`repo:${activeRepo.id}`}');
    const activeRepoHeaderStart = drawerSource.indexOf(
      'ListHeaderComponent={',
      activeRepoListStart,
    );
    const activeRepoHeaderEnd = drawerSource.indexOf('ListFooterComponent=', activeRepoHeaderStart);
    const activeRepoHeader = drawerSource.slice(activeRepoHeaderStart, activeRepoHeaderEnd);
    const topPinnedIndex = drawerSource.indexOf(
      "{pinnedSidebarPlacement === 'top' ? pinnedDronesSection : null}",
    );
    expect(topPinnedIndex).toBeGreaterThan(-1);
    expect(topPinnedIndex).toBeLessThan(activeRepoListStart);
    expect(activeRepoHeader).not.toContain(
      "pinnedSidebarPlacement === 'top' ? pinnedDronesSection : null",
    );
    expect(drawerSource).toContain(
      "pinnedSidebarPlacement === 'bottom' ? pinnedDronesSection : null",
    );
    expect(drawerSource).toContain("current === 'top' ? 'bottom' : 'top'");
    expect(drawerSource).toContain('AsyncStorage.setItem(PINNED_SIDEBAR_PLACEMENT_KEY, next)');
    expect(drawerSource).toContain('AsyncStorage.setItem(PINNED_SIDEBAR_COLLAPSED_KEY');
    expect(drawerSource).toContain("React.useState<PinnedSidebarPlacement>('bottom')");
    expect(drawerSource).toContain('React.useState(false)');
    expect(drawerSource).toContain('collapsed={pinnedSidebarCollapsed}');
    expect(drawerSource).toContain('onToggleCollapsed={togglePinnedSidebarCollapsed}');
    expect(drawerSource).toContain("stored === 'top' || stored === 'bottom'");
    expect(drawerSource).toContain(
      "placement === 'top' ? 'Move pinned drones to bottom' : 'Move pinned drones to top'",
    );
    expect(drawerSource).toContain('style={styles.pinnedHeaderText}>Pinned</Text>');
    expect(drawerSource).toContain('pinnedHeaderText: {\n    flex: 1,');
    expect(drawerSource).toContain('pinnedPlacementToggle: {');
    expect(drawerSource).toContain(
      "placement === 'top' && separateFromRepositoryList && styles.pinnedSectionTop",
    );
    expect(drawerSource).toContain('separateFromRepositoryList={!activeRepo}');
    expect(drawerSource).toContain("placement === 'bottom' && styles.pinnedSectionBottom");
    expect(drawerSource).toContain('pinnedSectionBottom: {\n    flexShrink: 0,');
    expect(drawerSource).toContain(
      'pinnedSectionTop: {\n    borderBottomWidth: 1,\n    borderBottomColor: colors.borderSubtle,',
    );
    expect(drawerSource).toContain('stickyHeaderIndices={[0]}');
    expect(drawerSource).toContain("pinnedSidebarPlacement === 'top' &&");
    expect(drawerSource).toContain('globalPinnedDrones.length > 0 &&');
    expect(drawerSource).toContain('styles.repoNavigationHeadBelowPinned');
    expect(drawerSource).toContain(
      'repoNavigationHeadBelowPinned: {\n    borderTopWidth: 1,\n    borderTopColor: colors.borderSubtle,',
    );
    expect(drawerSource).toContain('backgroundColor: colors.panel,');
    expect(drawerSource).not.toContain('pinnedSection: {\n    borderBottomWidth: 1,');
    expect(
      drawerSource.lastIndexOf("pinnedSidebarPlacement === 'bottom' ? pinnedDronesSection : null"),
    ).toBeGreaterThan(drawerSource.lastIndexOf('keyboardShouldPersistTaps="handled"'));
    const pinnedSelectionStart = drawerSource.indexOf('const selectPinnedDroneChat');
    const pinnedSelectionEnd = drawerSource.indexOf(
      'const pinnedDronesSection',
      pinnedSelectionStart,
    );
    const pinnedSelectionSource = drawerSource.slice(pinnedSelectionStart, pinnedSelectionEnd);
    expect(pinnedSelectionSource).toContain('const repoId = resolveDroneRepoId(droneId)');
    expect(pinnedSelectionSource).toContain('if (repoId) setActiveRepoId(repoId)');
    expect(pinnedSelectionSource).toContain('onSelectDroneChat?.(droneId, chatName)');
    expect(drawerSource).toContain('resolveMobileSidebarRepositoryAlignment({');
    expect(drawerSource).toContain('alignedActiveDroneSelectionKeyRef.current');
    expect(drawerSource).toContain(
      'if (alignment.repoIdToOpen) setActiveRepoId(alignment.repoIdToOpen)',
    );
    expect(dronesSource).toContain('onTogglePinned: () =>');
    expect(dronesSource).toContain('void setDronePinned(');
    expect(shellSource).toContain("id: 'toggle-pin'");
    expect(shellSource).toContain("label: dronesHeader.pinned ? 'Unpin drone' : 'Pin drone'");
    expect(shellSource).toContain('disabled: dronesHeader.pinDisabled');
  });

  test('keeps Companion at the bottom of the drawer with a top app overlay', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const overlaySource = readFileSync(
      new URL('../src/local-assistant/MobileCompanionOverlay.tsx', import.meta.url),
      'utf8',
    );
    const providerSource = readFileSync(
      new URL('../src/local-assistant/MobileCompanionContext.tsx', import.meta.url),
      'utf8',
    );
    const workspaceTargetSource = readFileSync(
      new URL('../src/local-assistant/use-mobile-companion-workspace-target.ts', import.meta.url),
      'utf8',
    );
    const dronesSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');
    const bottomPinnedIndex = drawerSource.lastIndexOf(
      "pinnedSidebarPlacement === 'bottom' ? pinnedDronesSection : null",
    );
    const companionIndex = drawerSource.lastIndexOf('<DrawerCompanionButton');

    expect(bottomPinnedIndex).toBeGreaterThan(-1);
    expect(companionIndex).toBeGreaterThan(bottomPinnedIndex);
    expect(drawerSource).toContain("companion.status === 'recording' ? 'Listening' : 'Companion'");
    expect(drawerSource).toContain("width: '100%',");
    expect(drawerSource).toContain("justifyContent: 'center'");
    expect(shellSource).toContain('<MobileCompanionProvider>');
    expect(shellSource).toContain('<MobileCompanionOverlay />');
    expect(shellSource).toContain("workspaceVisible={!pairingVisible && tab === 'drones'}");
    expect(workspaceTargetSource).toContain('pane: !workspaceVisible');
    expect(workspaceTargetSource).toContain('workspaceVisible && openFile.visible');
    expect(dronesSource).toContain('visible={workspaceVisible && filePreview.visible}');
    expect(providerSource).toContain('!activeTarget.reachable');
    expect(providerSource).toContain('!hasOperations');
    expect(providerSource).toContain('!hasGrant');
    expect(providerSource).toContain("tool === 'read_companion_proposal'");
    expect(providerSource).toContain("tool === 'apply_companion_proposal_patch'");
    expect(providerSource).not.toContain('prepareDroneDraft');
    expect(workspaceTargetSource).toContain('executeCompanionProposal(proposal');
    expect(workspaceTargetSource).not.toContain('prepareDroneDraft');
    expect(providerSource).toContain('controller.submitPrompt({');
    expect(providerSource).toContain('controller.hasSession()');
    expect(overlaySource).toContain("justifyContent: 'flex-start'");
    expect(overlaySource).toContain('accessibilityLabel="Stop Companion recording"');
    expect(overlaySource).toContain('accessibilityLabel="Companion proposal"');
    expect(overlaySource).toContain('accessibilityLabel="Apply Companion proposal"');
    expect(overlaySource).toContain('<NativeMarkdown text={companion.reply} />');
    expect(overlaySource).toContain(
      'const [activityExpanded, setActivityExpanded] = React.useState(false)',
    );
    expect(overlaySource).toContain('setActivityExpanded(false)');

    expect(overlaySource.indexOf('accessibilityLabel="Companion proposal"')).toBeGreaterThan(
      overlaySource.indexOf('<NativeMarkdown text={companion.reply} />'),
    );
  });

  test('shows descendant state counts only on collapsed group rows', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const folderStart = source.indexOf('function DrawerDroneFolder');
    const folderEnd = source.indexOf('function DrawerDroneEntry', folderStart);
    const folderSource = source.slice(folderStart, folderEnd);

    expect(folderSource).toContain('summarizeDroneScope(');
    expect(folderSource).toContain('muteContext?.effectiveDroneIds');
    expect(folderSource).toContain(
      '{muted ? <MutedStatusIndicator /> : collapsed ? <DroneStateCounts summary={stateSummary} compact /> : null}',
    );
    expect(source).toContain(
      "groupRow: {\n    minHeight: 36,\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: DRAWER_TREE_LEADING_GAP,\n    paddingRight: 10,",
    );
  });

  test('shows descendant chat state counts on collapsed mobile chat groups', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const groupStart = source.indexOf('function DrawerDroneChatTreeEntry');
    const groupEnd = source.indexOf('function DrawerDroneNode', groupStart);
    const groupSource = source.slice(groupStart, groupEnd);

    expect(groupSource).toContain('summarizeMobileDroneChatSubset(');
    expect(groupSource).toContain('sidebarChatTreeChatNamesInGroup(tree, node.id).filter(');
    expect(groupSource).toContain('muteContext?.effectiveChatIds.has(');
    expect(groupSource).toContain(
      ': !expanded ? (\n            <DroneStateCounts summary={stateSummary} compact entity="chat" />',
    );
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

  test('keeps the fleet drawer mounted across tabs and quiets the chat header controls', () => {
    const shellSource = readFileSync(new URL('../src/shell/MeshApp.tsx', import.meta.url), 'utf8');

    expect(shellSource).toContain(
      "(pairingVisible || tab !== 'drones') && styles.tabContentHidden",
    );
    expect(shellSource).toContain("tabContentHidden: { display: 'none' }");
    expect(shellSource).not.toContain('  AppDrawer,\n');
    expect(shellSource).toContain(
      "accessibilityLabel={hasBackNavigation ? 'Open drone navigation'",
    );
    expect(shellSource).toContain('hasBackNavigation && styles.contextBackButton');
    expect(shellSource).toContain('<ChevronLeft\n                  color={appDrawerOpen');
    expect(shellSource).toContain(
      '<MoreVertical color={colors.muted} size={19} strokeWidth={2} />',
    );
    expect(shellSource).toContain('contextBackButton: {\n    width: 28,\n    borderWidth: 0,');
    expect(shellSource).toContain(
      "contextMenuAction: {\n    width: 36,\n    height: 36,\n    alignItems: 'center',",
    );

    const dronesSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    expect(dronesSource).toContain(
      "navigationItems.find((item) => item.id === 'drones')?.onPress();",
    );
    expect(dronesSource).toContain('backNavigation: true,');
    expect(dronesSource.match(/navigateToDrones\(\);/g)).toHaveLength(2);
  });

  test('opens Companion chat navigation visibly after preserving the new-drone draft', () => {
    const source = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const openChat = source.slice(
      source.indexOf('openChat: async (drone, requestedChat) => {'),
      source.indexOf('\n    },', source.indexOf('openChat: async (drone, requestedChat) => {')),
    );

    expect(openChat).toContain('await saveNewDroneDraftBeforeNavigation();');
    expect(openChat).toContain("navigationItems.find((item) => item.id === 'drones')?.onPress();");
    expect(openChat).toContain('onDrawerOpenChange(false);');
    expect(openChat).toContain('await activateDrone(drone, requestedChat);');
  });

  test('uses the Drone Hub brand as a project-list home control', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(drawerSource).toContain('accessibilityLabel="Open project list"');
    expect(drawerSource).toContain('setActiveRepoId(null);');
    expect(drawerSource).toContain('dronesNavigationItem?.onPress();');
    expect(drawerSource).not.toContain(
      'dronesNavigationItem?.onPress();\n              onClose();',
    );
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

  test('requires a deliberate long press on names to reorder without visible grips', () => {
    const drawerSource = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );
    const dragSource = readFileSync(
      new URL('../src/local-assistant/MobileSidebarDragDrop.tsx', import.meta.url),
      'utf8',
    );
    const dropTargetSource = readFileSync(
      new URL('../src/drones/mobile-sidebar-drop-target.ts', import.meta.url),
      'utf8',
    );
    const dronesScreenSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );

    expect(drawerSource).toContain('<MobileSidebarDragArea');
    const chatRowStart = drawerSource.indexOf('function DrawerDroneChatRow');
    const chatTreeStart = drawerSource.indexOf('function DrawerDroneChatTreeEntry');
    const droneNodeStart = drawerSource.indexOf('function DrawerDroneNode');
    expect(drawerSource.slice(chatRowStart, chatTreeStart)).toContain(
      '<MobileSidebarDragTarget',
    );
    expect(drawerSource.slice(chatTreeStart, droneNodeStart)).toContain(
      '<MobileSidebarDragTarget',
    );
    expect(drawerSource.slice(droneNodeStart)).toContain('<MobileSidebarDragTarget');
    expect(drawerSource).toContain('label={`${folder.label} group`}');
    expect(drawerSource).toContain("kind: 'move-into-folder'");
    expect(drawerSource).toContain('canDropInside={(activeItemId) => {');
    expect(drawerSource).not.toContain('MobileSidebarDragHandle');
    expect(dragSource).toContain('.activateAfterLongPress(450)');
    expect(dropTargetSource).toContain('const placement: MobileSidebarDropPlacement = inside');
    expect(dragSource).toContain('styles.dropInside');
    expect(dragSource).toContain('nextTarget.overData?.insidePosition');
    expect(dragSource).toContain('styles.dropInsideStart');
    expect(dragSource).toContain('styles.dropInsideEnd');
    expect(dragSource).not.toContain('GripVertical');
    expect(dronesScreenSource).toContain("isGranted(selfDevice.grants, 'drone-control', 1");
    expect(dronesScreenSource).toContain('targetCanReorderSidebar ? reorderSidebar : undefined');
  });
});
