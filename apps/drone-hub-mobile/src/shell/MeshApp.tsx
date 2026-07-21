import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import Check from 'lucide-react-native/icons/check';
import Menu from 'lucide-react-native/icons/menu';
import MoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import Plus from 'lucide-react-native/icons/plus';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { MeshProvider, useMesh } from '../mesh/MeshContext';
import { LocalAssistantProvider } from '../local-assistant/LocalAssistantContext';
import { MobileChatVoiceRecorderProvider } from '../local-assistant/MobileChatVoiceRecorderContext';
import {
  AppDrawerProvider,
  AppDrawer,
  appDrawerWidth,
  type AppDrawerNavigationItem,
  type DrawerDevicePickerItem,
} from '../local-assistant/AppDrawer';
import { DevicesScreen } from '../screens/DevicesScreen';
import { DronesScreen, type DronesAppHeaderState } from '../screens/DronesScreen';
import { PairScreen } from '../screens/PairScreen';
import { SettingsScreen, type SettingsTab } from '../screens/SettingsScreen';
import { colors } from '../theme';
import { resolveAvailableDeviceSelection } from './device-selection-model';
import { loadSelectedDeviceId, saveSelectedDeviceId } from './device-selection-storage';

const DRAWER_EDGE_SWIPE_WIDTH = 12;

type Tab = 'drones' | 'devices' | 'settings';

type HeaderMenuAction = {
  id: string;
  label: string;
  icon?: typeof Trash2;
  destructive?: boolean;
  disabled?: boolean;
  onPress(): void;
};

function HeaderOverflowMenu({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: HeaderMenuAction[];
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.actionMenuLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close actions menu"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.actionMenu, { top: insets.top + 50 }]}>
          {actions.map((action) => {
            const Icon = action.icon ?? (action.destructive ? Trash2 : SlidersHorizontal);
            return (
              <Pressable
                key={action.id}
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={() => {
                  onClose();
                  action.onPress();
                }}
                style={({ pressed }) => [
                  styles.actionMenuItem,
                  action.disabled && styles.headerActionDisabled,
                  pressed && styles.actionMenuItemPressed,
                ]}
              >
                <Icon
                  color={action.destructive ? colors.danger : colors.muted}
                  size={16}
                  strokeWidth={2}
                />
                <Text
                  style={[
                    styles.actionMenuItemText,
                    action.destructive && styles.actionMenuItemTextDanger,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function Shell() {
  const mesh = useMesh();
  const [tab, setTab] = React.useState<Tab>('drones');
  const [pairing, setPairing] = React.useState(false);
  const [pairReturnTab, setPairReturnTab] = React.useState<Tab>('drones');
  const [appDrawerOpen, setAppDrawerOpen] = React.useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState('');
  const [deviceSelectionLoaded, setDeviceSelectionLoaded] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('assistant');
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [dronesHeader, setDronesHeader] = React.useState<DronesAppHeaderState | null>(null);
  const handleDronesHeaderChange = React.useCallback(
    (header: DronesAppHeaderState | null) => setDronesHeader(header),
    [],
  );
  const devicePickerItems = React.useMemo<DrawerDevicePickerItem[]>(() => {
    const currentId = mesh.identity?.id ?? '';
    const current = mesh.devices.find((device) => device.id === currentId);
    const others = mesh.devices.filter((device) => device.id !== currentId && !device.revokedAt);
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
      })),
    ];
  }, [mesh.connectedDeviceIds, mesh.devices, mesh.identity?.id, mesh.identity?.name]);
  const activeDeviceId = deviceSelectionLoaded
    ? resolveAvailableDeviceSelection(devicePickerItems, selectedDeviceId)
    : '';
  const pairingVisible = pairing || !mesh.profile;
  React.useEffect(() => {
    let active = true;
    void loadSelectedDeviceId()
      .then((deviceId) => {
        if (active) setSelectedDeviceId(deviceId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setDeviceSelectionLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const selectDevice = React.useCallback(
    (deviceId: string) => {
      const nextDeviceId = resolveAvailableDeviceSelection(devicePickerItems, deviceId);
      setSelectedDeviceId(nextDeviceId);
      void saveSelectedDeviceId(nextDeviceId).catch(() => undefined);
    },
    [devicePickerItems],
  );
  React.useEffect(() => setHeaderMenuOpen(false), [activeDeviceId, pairingVisible, tab]);
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = appDrawerWidth(windowWidth);
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
          gesture.x0 <= DRAWER_EDGE_SWIPE_WIDTH &&
          gesture.dx > 3 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          drawerEnabledRef.current &&
          !drawerOpenRef.current &&
          gesture.x0 <= DRAWER_EDGE_SWIPE_WIDTH &&
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

  if (mesh.loading || !deviceSelectionLoaded) {
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
  const navigateToTab = (nextTab: Tab) => {
    if (nextTab === 'devices' || nextTab === 'settings') setAppDrawerOpen(false);
    if (!pairingVisible && tab === nextTab) return;
    setPairing(false);
    setTab(nextTab);
  };
  const navigationItems: AppDrawerNavigationItem[] = [
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
    ? mesh.profile
      ? 'Update connection'
      : 'Pair device'
    : (
        {
          drones: 'Drones',
          devices: 'Devices',
          settings: 'Settings',
        } as const
      )[tab];
  const hasContextHeader = Boolean(!pairingVisible && tab === 'drones' && dronesHeader);
  const headerMenuActions: HeaderMenuAction[] = !pairingVisible
    ? tab === 'drones' && dronesHeader
      ? [
            ...(dronesHeader.onNewDrone
              ? [
                  {
                    id: 'new-drone',
                    label: 'New drone',
                    icon: Plus,
                    onPress: dronesHeader.onNewDrone,
                  },
                ]
              : []),
            ...(dronesHeader.onNewChat
              ? [
                  {
                    id: 'new-chat',
                    label: 'New chat',
                    icon: MessageCircle,
                    onPress: dronesHeader.onNewChat,
                  },
                ]
              : []),
            ...(dronesHeader.onDelete
              ? [
                  {
                    id: 'delete-drone',
                    label: 'Delete drone',
                    destructive: true,
                    onPress: dronesHeader.onDelete,
                  },
                ]
              : []),
            ...(dronesHeader.onToggleAccess
              ? [{
                  id: 'access',
                  label: dronesHeader.accessOpen ? 'Return to chat' : 'Edit workspace access',
                  disabled: dronesHeader.accessDisabled,
                  onPress: dronesHeader.onToggleAccess,
                }]
              : []),
            ...(dronesHeader.onToggleAutoApprove
              ? [{
                  id: 'auto-approve',
                  label: dronesHeader.autoApprove ? 'Disable auto-approve requests' : 'Auto-approve requests',
                  icon: Check,
                  onPress: dronesHeader.onToggleAutoApprove,
                }]
              : []),
          ]
      : []
    : [];
  const content = pairingVisible ? (
    <ScrollView keyboardShouldPersistTaps="handled">
      {mesh.profile ? (
        <View style={styles.pairBack}>
          <Pressable onPress={() => setPairing(false)} style={styles.backButton}>
            <ChevronLeft color={colors.accent} size={17} strokeWidth={2.4} />
            <Text style={styles.backText}>Settings</Text>
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
      onDeviceChange={selectDevice}
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
      {mesh.profile && (tab !== 'drones' || pairingVisible) ? (
        <AppDrawer
          open={appDrawerOpen}
          offset={drawerOffset}
          openingGestureActive={openingGestureActive}
          navigationItems={navigationItems}
          devicePickerItems={devicePickerItems}
          activeDeviceId={activeDeviceId}
          onSelectDevice={selectDevice}
          onClose={() => setAppDrawerOpen(false)}
        />
      ) : null}
      <View style={styles.header}>
        <View pointerEvents="none" style={styles.headerAccent} />
        {mesh.profile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle app menu"
            onPress={() => setAppDrawerOpen((value) => !value)}
            style={styles.titleButton}
          >
            {!hasContextHeader ? (
              <View style={[styles.menuButton, appDrawerOpen && styles.menuButtonActive]}>
                <Menu
                  color={appDrawerOpen ? colors.accent : colors.text}
                  size={19}
                  strokeWidth={2.2}
                />
              </View>
            ) : null}
            {hasContextHeader ? (
              <View style={styles.contextTitle}>
                <View style={styles.contextTitleRow}>
                  <Text numberOfLines={1} style={styles.contextTitleText}>
                    {dronesHeader?.title}
                  </Text>
                </View>
                {dronesHeader?.subtitle ? (
                  <Text numberOfLines={1} style={styles.contextSubtitle}>
                    {dronesHeader.subtitle}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.title}>{title}</Text>
            )}
          </Pressable>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
        <View style={styles.headerActions}>
          {tab === 'drones' && dronesHeader?.onToggleDraft ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Create as draft"
              accessibilityState={{
                checked: Boolean(dronesHeader.draft),
                disabled: dronesHeader.draftDisabled,
              }}
              disabled={dronesHeader.draftDisabled}
              onPress={dronesHeader.onToggleDraft}
              style={({ pressed }) => [
                styles.draftAction,
                dronesHeader.draftDisabled && styles.headerActionDisabled,
                pressed && styles.actionMenuItemPressed,
              ]}
            >
              <View
                style={[styles.draftCheckbox, dronesHeader.draft && styles.draftCheckboxActive]}
              >
                {dronesHeader.draft ? (
                  <Check color={colors.onAccent} size={12} strokeWidth={3} />
                ) : null}
              </View>
              <Text
                style={[styles.draftActionText, dronesHeader.draft && styles.draftActionTextActive]}
              >
                Draft
              </Text>
            </Pressable>
          ) : null}
          {headerMenuActions.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open actions menu"
              accessibilityState={{ expanded: headerMenuOpen }}
              onPress={() => setHeaderMenuOpen(true)}
              style={styles.contextMenuAction}
            >
              <MoreVertical color={colors.text} size={19} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.content}>{content}</View>
      <HeaderOverflowMenu
        open={headerMenuOpen && headerMenuActions.length > 0}
        actions={headerMenuActions}
        onClose={() => setHeaderMenuOpen(false)}
      />
    </SafeAreaView>
  );
}

export function MeshApp() {
  return (
    <MeshProvider>
      <LocalAssistantProvider>
        <MobileChatVoiceRecorderProvider>
          <AppDrawerProvider>
            <Shell />
          </AppDrawerProvider>
        </MobileChatVoiceRecorderProvider>
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
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    justifyContent: 'space-between',
    backgroundColor: colors.panel,
  },
  headerAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 94,
    height: 1,
    backgroundColor: colors.accent,
    opacity: 0.7,
  },
  title: {
    color: colors.textStrong,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  titleButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  menuButtonActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  contextTitle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  contextTitleRow: { flexDirection: 'row', alignItems: 'center' },
  contextTitleText: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.15,
  },
  contextSubtitle: {
    color: colors.muted,
    fontSize: 9,
    fontFamily: 'monospace',
    marginTop: 2,
    marginLeft: 0,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 7 },
  draftAction: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: 'transparent',
  },
  draftCheckbox: {
    width: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  draftCheckboxActive: { backgroundColor: colors.accent },
  draftActionText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  draftActionTextActive: { color: colors.accent },
  headerActionDisabled: { opacity: 0.55 },
  contextMenuAction: {
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  actionMenuLayer: { flex: 1 },
  actionMenu: {
    position: 'absolute',
    right: 10,
    width: 210,
    padding: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
    elevation: 24,
    shadowColor: colors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  actionMenuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    borderRadius: 5,
  },
  actionMenuItemPressed: { backgroundColor: colors.whiteWash },
  actionMenuItemText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  actionMenuItemTextDanger: { color: colors.danger },
  content: { flex: 1 },
  pairBack: { paddingHorizontal: 20, paddingTop: 14 },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  backText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
});
