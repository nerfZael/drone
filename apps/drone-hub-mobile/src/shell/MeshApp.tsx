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
} from '../local-assistant/AssistantThreadDrawer';
import { DevicesScreen } from '../screens/DevicesScreen';
import { AssistantHomeScreen, type AssistantLocation } from '../screens/AssistantHomeScreen';
import { DronesScreen } from '../screens/DronesScreen';
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
  const [assistantLocation, setAssistantLocation] = React.useState<AssistantLocation>('phone');
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('assistant');
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
    />
  ) : tab === 'assistant' ? (
    <AssistantHomeScreen
      drawerOpen={appDrawerOpen}
      drawerOffset={drawerOffset}
      navigationItems={navigationItems}
      openingGestureActive={openingGestureActive}
      onDrawerOpenChange={setAppDrawerOpen}
      location={assistantLocation}
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
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.titleChevron}>{appDrawerOpen ? '‹' : '›'}</Text>
          </Pressable>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
        <View style={styles.headerActions}>
          {tab === 'assistant' && !pairingVisible ? (
            <Pressable
              onPress={() => {
                setAppDrawerOpen(false);
                setAssistantLocation((value) => (value === 'phone' ? 'devices' : 'phone'));
              }}
              style={styles.locationToggle}
            >
              <Text style={styles.locationToggleText}>
                {assistantLocation === 'phone' ? 'ON PHONE' : 'ON DEVICES'}
              </Text>
              <Text style={styles.locationToggleIcon}>⇄</Text>
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
  titleButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42 },
  titleChevron: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 7 },
  locationToggle: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  locationToggleText: { color: colors.text, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  locationToggleIcon: { color: colors.accent, fontSize: 12, fontWeight: '900' },
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
