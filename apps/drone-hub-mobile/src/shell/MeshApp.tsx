import React from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeshProvider, useMesh } from '../mesh/MeshContext';
import { LocalAssistantProvider } from '../local-assistant/LocalAssistantContext';
import {
  AssistantThreadDrawer,
  assistantDrawerWidth,
  type AppDrawerNavigationItem,
  type DrawerDevicePickerItem,
} from '../local-assistant/AssistantThreadDrawer';
import { DevicesScreen } from '../screens/DevicesScreen';
import {
  AssistantHomeScreen,
  type AssistantAppHeaderState,
} from '../screens/AssistantHomeScreen';
import { DronesScreen, type DronesAppHeaderState } from '../screens/DronesScreen';
import { PairScreen } from '../screens/PairScreen';
import { SettingsScreen, type SettingsTab } from '../screens/SettingsScreen';
import { colors } from '../theme';

type Tab = 'assistant' | 'drones' | 'devices' | 'settings';

function Shell() {
  const mesh = useMesh();
  const [tab, setTab] = React.useState<Tab>('assistant');
  const [pairing, setPairing] = React.useState(false);
  const [pairReturnTab, setPairReturnTab] = React.useState<Tab>('assistant');
  const [appDrawerOpen, setAppDrawerOpen] = React.useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState('');
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('assistant');
  const [dronesHeader, setDronesHeader] = React.useState<DronesAppHeaderState | null>(null);
  const [assistantHeader, setAssistantHeader] = React.useState<AssistantAppHeaderState | null>(null);
  const handleDronesHeaderChange = React.useCallback(
    (header: DronesAppHeaderState | null) => setDronesHeader(header),
    [],
  );
  const handleAssistantHeaderChange = React.useCallback(
    (header: AssistantAppHeaderState | null) => setAssistantHeader(header),
    [],
  );
  const devicePickerItems = React.useMemo<DrawerDevicePickerItem[]>(() => {
    const currentId = mesh.identity?.id ?? '';
    const current = mesh.devices.find((device) => device.id === currentId);
    const others = mesh.devices.filter(
      (device) => device.id !== currentId && !device.revokedAt,
    );
    return [
      ...(currentId
        ? [
            {
              id: currentId,
              name: current?.name ?? mesh.identity?.name ?? 'This device',
              connected: true,
              detail: 'This device',
            },
          ]
        : []),
      ...others.map((device) => ({
        id: device.id,
        name: device.name,
        connected: mesh.connectedDeviceIds.includes(device.id),
        detail: device.platform,
      })),
    ];
  }, [mesh.connectedDeviceIds, mesh.devices, mesh.identity?.id, mesh.identity?.name]);
  const activeDeviceId = devicePickerItems.some((device) => device.id === selectedDeviceId)
    ? selectedDeviceId
    : (devicePickerItems[0]?.id ?? '');
  React.useEffect(() => {
    if (devicePickerItems.some((device) => device.id === selectedDeviceId)) return;
    setSelectedDeviceId(devicePickerItems[0]?.id ?? '');
  }, [devicePickerItems, selectedDeviceId]);
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = assistantDrawerWidth(windowWidth);
  const drawerOffset = React.useRef(new Animated.Value(-drawerWidth)).current;
  const drawerOpenRef = React.useRef(appDrawerOpen);
  const drawerWidthRef = React.useRef(drawerWidth);
  const drawerEnabledRef = React.useRef(Boolean(mesh.profile));
  const [openingGestureActive, setOpeningGestureActive] = React.useState(false);
  drawerOpenRef.current = appDrawerOpen;
  drawerWidthRef.current = drawerWidth;
  drawerEnabledRef.current = Boolean(mesh.profile);
  const drawerPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          drawerEnabledRef.current &&
          !drawerOpenRef.current &&
          gesture.x0 <= 42 &&
          gesture.dx > 3 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          drawerEnabledRef.current &&
          !drawerOpenRef.current &&
          gesture.x0 <= 42 &&
          gesture.dx > 3 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onPanResponderGrant: (_event, gesture) => {
          const width = drawerWidthRef.current;
          drawerOffset.stopAnimation();
          drawerOffset.setValue(Math.min(0, -width + Math.max(0, gesture.dx)));
          setOpeningGestureActive(true);
          setAppDrawerOpen(true);
        },
        onPanResponderMove: (_event, gesture) => {
          drawerOffset.setValue(Math.min(0, -drawerWidthRef.current + Math.max(0, gesture.dx)));
        },
        onPanResponderRelease: (_event, gesture) => {
          const shouldOpen = gesture.dx >= drawerWidthRef.current * 0.3 || gesture.vx >= 0.45;
          setOpeningGestureActive(false);
          setAppDrawerOpen(shouldOpen);
        },
        onPanResponderTerminate: () => {
          setOpeningGestureActive(false);
          setAppDrawerOpen(false);
        },
      }),
    [drawerOffset],
  );

  if (mesh.loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>Preparing secure identity…</Text>
      </SafeAreaView>
    );
  }

  const openPairing = () => {
    setPairReturnTab('settings');
    setPairing(true);
  };
  const pairingVisible = pairing || !mesh.profile;
  const navigateToTab = (nextTab: Tab) => {
    setAppDrawerOpen(false);
    if (!pairingVisible && tab === nextTab) return;
    setTimeout(() => {
      setPairing(false);
      setTab(nextTab);
    }, 180);
  };
  const navigationItems: AppDrawerNavigationItem[] = [
    {
      id: 'assistant',
      label: 'Assistant',
      active: !pairingVisible && tab === 'assistant',
      onPress: () => navigateToTab('assistant'),
    },
    {
      id: 'drones',
      label: 'Drones',
      active: !pairingVisible && tab === 'drones',
      onPress: () => navigateToTab('drones'),
    },
    {
      id: 'devices',
      label: 'Devices',
      active: !pairingVisible && tab === 'devices',
      onPress: () => navigateToTab('devices'),
    },
    {
      id: 'settings',
      label: 'Settings',
      active: !pairingVisible && tab === 'settings',
      onPress: () => navigateToTab('settings'),
    },
  ];
  const title = pairingVisible
    ? 'Pair device'
    : (
        {
          assistant: 'Assistant',
          drones: 'Drones',
          devices: 'Devices',
          settings: 'Settings',
        } as const
      )[tab];
  const content = pairingVisible ? (
    <ScrollView keyboardShouldPersistTaps="handled">
      {mesh.profile ? (
        <View style={styles.pairBack}>
          <Pressable onPress={() => setPairing(false)} style={styles.backButton}>
            <Text style={styles.backText}>‹ Settings</Text>
          </Pressable>
        </View>
      ) : null}
      <PairScreen
        onComplete={() => {
          setPairing(false);
          setTab(pairReturnTab);
        }}
      />
    </ScrollView>
  ) : tab === 'settings' ? (
    <SettingsScreen tab={settingsTab} onTabChange={setSettingsTab} onPair={openPairing} />
  ) : tab === 'drones' ? (
    <DronesScreen
      drawerOpen={appDrawerOpen}
      drawerOffset={drawerOffset}
      navigationItems={navigationItems}
      openingGestureActive={openingGestureActive}
      onDrawerOpenChange={setAppDrawerOpen}
      onHeaderChange={handleDronesHeaderChange}
      selectedDeviceId={activeDeviceId}
      devicePickerItems={devicePickerItems}
      onDeviceChange={setSelectedDeviceId}
    />
  ) : tab === 'assistant' ? (
    <AssistantHomeScreen
      drawerOpen={appDrawerOpen}
      drawerOffset={drawerOffset}
      navigationItems={navigationItems}
      openingGestureActive={openingGestureActive}
      onDrawerOpenChange={setAppDrawerOpen}
      location={activeDeviceId === mesh.identity?.id ? 'phone' : 'devices'}
      activeDeviceId={activeDeviceId}
      devicePickerItems={devicePickerItems}
      onDeviceChange={setSelectedDeviceId}
      onHeaderChange={handleAssistantHeaderChange}
    />
  ) : (
    <DevicesScreen />
  );

  return (
    <SafeAreaView
      style={styles.safe}
      edges={['top', 'right', 'bottom', 'left']}
      {...drawerPanResponder.panHandlers}
    >
      {mesh.profile && ((tab !== 'assistant' && tab !== 'drones') || pairingVisible) ? (
        <AssistantThreadDrawer
          open={appDrawerOpen}
          title=""
          threads={[]}
          activeThreadId=""
          offset={drawerOffset}
          openingGestureActive={openingGestureActive}
          navigationItems={navigationItems}
          showThreads={false}
          devicePickerItems={devicePickerItems}
          activeDeviceId={activeDeviceId}
          onSelectDevice={setSelectedDeviceId}
          onClose={() => setAppDrawerOpen(false)}
          onSelect={() => {}}
          onCreate={() => {}}
        />
      ) : null}
      <View style={styles.header}>
        {mesh.profile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle app menu"
            onPress={() => setAppDrawerOpen((value) => !value)}
            style={styles.titleButton}
          >
            {!pairingVisible &&
            ((tab === 'drones' && dronesHeader) || (tab === 'assistant' && assistantHeader)) ? (
              <View style={styles.contextTitle}>
                <View style={styles.contextTitleRow}>
                  <View
                    style={[
                      styles.contextStatus,
                      ((tab === 'drones' && dronesHeader?.statusOk) ||
                        (tab === 'assistant' && assistantHeader?.statusTone === 'online')) &&
                        styles.contextStatusOnline,
                      tab === 'assistant' &&
                        assistantHeader?.statusTone === 'error' &&
                        styles.contextStatusError,
                      tab === 'drones' &&
                        dronesHeader &&
                        !dronesHeader.statusOk &&
                        styles.contextStatusError,
                    ]}
                  />
                  <Text numberOfLines={1} style={styles.contextTitleText}>
                    {tab === 'drones' ? dronesHeader?.title : assistantHeader?.title}
                  </Text>
                  <Text style={styles.titleChevron}>{appDrawerOpen ? '‹' : '›'}</Text>
                </View>
                <Text numberOfLines={1} style={styles.contextSubtitle}>
                  {tab === 'drones' ? dronesHeader?.subtitle : assistantHeader?.subtitle}
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.titleChevron}>{appDrawerOpen ? '‹' : '›'}</Text>
              </>
            )}
          </Pressable>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
        <View style={styles.headerActions}>
          {!pairingVisible && tab === 'assistant' && assistantHeader?.onToggleAccess ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={assistantHeader.accessOpen ? 'Return to chat' : 'Edit access'}
              accessibilityState={{ disabled: assistantHeader.accessDisabled }}
              disabled={assistantHeader.accessDisabled}
              onPress={assistantHeader.onToggleAccess}
              style={[
                styles.contextTextAction,
                assistantHeader.accessDisabled && styles.headerActionDisabled,
              ]}
            >
              <Text style={styles.contextTextActionLabel}>
                {assistantHeader.accessOpen ? 'CHAT' : 'ACCESS'}
              </Text>
            </Pressable>
          ) : null}
          {!pairingVisible && tab === 'assistant' && assistantHeader?.onDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete thread"
              onPress={assistantHeader.onDelete}
              style={styles.contextDeleteAction}
            >
              <Text style={styles.contextDeleteActionText}>×</Text>
            </Pressable>
          ) : null}
          {mesh.connectedDeviceIds.length === 0 ? (
            <View style={styles.route}>
              <Text style={styles.routeText}>OFFLINE</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.content}>{content}</View>
    </SafeAreaView>
  );
}

export function MeshApp() {
  return (
    <MeshProvider>
      <LocalAssistantProvider>
        <Shell />
      </LocalAssistantProvider>
    </MeshProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { color: colors.muted, fontSize: 12 },
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    justifyContent: 'space-between',
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  titleButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 42,
  },
  titleChevron: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  contextTitle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  contextTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  contextStatus: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#53676d' },
  contextStatusOnline: { backgroundColor: colors.online },
  contextStatusError: { backgroundColor: colors.danger },
  contextTitleText: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.15,
  },
  contextSubtitle: {
    color: colors.muted,
    fontSize: 8,
    fontFamily: 'monospace',
    marginTop: 2,
    marginLeft: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerActionDisabled: { opacity: 0.55 },
  contextTextAction: {
    height: 32,
    paddingHorizontal: 9,
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  contextTextActionLabel: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  contextDeleteAction: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' },
  contextDeleteActionText: { color: colors.muted, fontSize: 22 },
  route: {
    marginLeft: 'auto',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  routeText: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  content: { flex: 1 },
  pairBack: { paddingHorizontal: 20, paddingTop: 14 },
  backButton: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  backText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
});
