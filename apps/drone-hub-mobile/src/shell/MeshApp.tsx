import React from 'react';
import {
  Modal,
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
import Copy from 'lucide-react-native/icons/copy';
import Menu from 'lucide-react-native/icons/menu';
import MoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import FolderTree from 'lucide-react-native/icons/folder-tree';
import Pin from 'lucide-react-native/icons/pin';
import Plus from 'lucide-react-native/icons/plus';
import Pencil from 'lucide-react-native/icons/pencil';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { CircuitRobotLoader } from '../components/CircuitRobotLoader';
import { MeshProvider, useMesh } from '../mesh/MeshContext';
import { LocalDroneControlProvider } from '../drones/local-drone-control';
import { LocalAssistantProvider } from '../local-assistant/LocalAssistantContext';
import { MobileChatVoiceRecorderProvider } from '../local-assistant/MobileChatVoiceRecorderContext';
import { MobileCompanionProvider } from '../local-assistant/MobileCompanionContext';
import { MobileCompanionOverlay } from '../local-assistant/MobileCompanionOverlay';
import {
  AppDrawerProvider,
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

type Tab = 'drones' | 'devices' | 'settings';

type HeaderMenuAction = {
  id: string;
  label: string;
  icon?: typeof Trash2;
  section?: string;
  selected?: boolean;
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
  const { height } = useWindowDimensions();
  const menuTop = insets.top + 50;
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
        <ScrollView
          style={[
            styles.actionMenu,
            {
              top: menuTop,
              maxHeight: Math.max(180, height - menuTop - insets.bottom - 10),
            },
          ]}
          contentContainerStyle={styles.actionMenuContent}
          showsVerticalScrollIndicator={false}
        >
          {actions.map((action, index) => {
            const Icon =
              action.icon ??
              (action.selected ? Check : action.destructive ? Trash2 : SlidersHorizontal);
            const showSection = action.section && action.section !== actions[index - 1]?.section;
            return (
              <React.Fragment key={action.id}>
                {showSection ? (
                  <Text style={styles.actionMenuSection}>{action.section}</Text>
                ) : null}
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityState={{
                    disabled: action.disabled,
                    selected: action.selected,
                  }}
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
                    color={
                      action.destructive
                        ? colors.danger
                        : action.selected
                          ? colors.accent
                          : colors.muted
                    }
                    size={16}
                    strokeWidth={2}
                  />
                  <Text
                    style={[
                      styles.actionMenuItemText,
                      action.selected && styles.actionMenuItemTextSelected,
                      action.destructive && styles.actionMenuItemTextDanger,
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </ScrollView>
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
              connectionState: 'connected' as const,
              detail: 'This device',
              platform: current?.platform ?? 'android',
            },
          ]
        : []),
      ...others.map((device) => ({
        id: device.id,
        name: device.name,
        connected: mesh.connectionStatesByDevice[device.id] === 'connected',
        connectionState: mesh.connectionStatesByDevice[device.id] ?? 'offline',
        platform: device.platform,
      })),
    ];
  }, [mesh.connectionStatesByDevice, mesh.devices, mesh.identity?.id, mesh.identity?.name]);
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
  const toggleAppDrawer = React.useCallback(() => setAppDrawerOpen((current) => !current), []);

  if (mesh.loading || !deviceSelectionLoaded) {
    return (
      <SafeAreaView style={styles.loading}>
        <CircuitRobotLoader />
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
  const hasBackNavigation = Boolean(hasContextHeader && dronesHeader?.backNavigation);
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
          ...(dronesHeader.onOpenFiles
            ? [
                {
                  id: 'files',
                  label: 'Files',
                  icon: FolderTree,
                  onPress: dronesHeader.onOpenFiles,
                },
              ]
            : []),
          ...(dronesHeader.onClone
            ? [
                {
                  id: 'clone-drone',
                  label: 'Clone drone',
                  icon: Copy,
                  disabled: dronesHeader.cloneDisabled,
                  onPress: dronesHeader.onClone,
                },
              ]
            : []),
          ...(dronesHeader.onRename
            ? [
                {
                  id: 'rename-drone',
                  label: 'Rename drone',
                  icon: Pencil,
                  onPress: dronesHeader.onRename,
                },
              ]
            : []),
          ...(dronesHeader.onTogglePinned
            ? [
                {
                  id: 'toggle-pin',
                  label: dronesHeader.pinned ? 'Unpin drone' : 'Pin drone',
                  icon: Pin,
                  disabled: dronesHeader.pinDisabled,
                  onPress: dronesHeader.onTogglePinned,
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
            ? [
                {
                  id: 'access',
                  label: dronesHeader.accessOpen ? 'Return to chat' : 'Edit workspace access',
                  disabled: dronesHeader.accessDisabled,
                  onPress: dronesHeader.onToggleAccess,
                },
              ]
            : []),
          ...(dronesHeader.onToggleAutoApprove
            ? [
                {
                  id: 'auto-approve',
                  label: dronesHeader.autoApprove
                    ? 'Ask for approvals'
                    : 'Never ask for approvals',
                  icon: Check,
                  onPress: dronesHeader.onToggleAutoApprove,
                },
              ]
            : []),
          ...(dronesHeader.agentAccessOptions ?? []).map((option) => ({
            id: `agent-access-${option.id}`,
            section: 'Access',
            label: option.label,
            selected: option.selected,
            disabled: option.disabled,
            onPress: option.onSelect,
          })),
          ...(dronesHeader.approvalPolicyOptions ?? []).map((option) => ({
            id: `approval-policy-${option.id}`,
            section: 'Approvals',
            label: option.label,
            selected: option.selected,
            disabled: option.disabled,
            onPress: option.onSelect,
          })),
        ]
      : []
    : [];
  const pairingContent = pairingVisible ? (
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
  ) : null;
  const content = (
    <>
      {mesh.profile ? (
        <View
          pointerEvents={!pairingVisible && tab === 'drones' ? 'auto' : 'none'}
          style={[
            styles.tabContent,
            (pairingVisible || tab !== 'drones') && styles.tabContentHidden,
          ]}
        >
          <DronesScreen
            drawerOpen={appDrawerOpen}
            workspaceVisible={!pairingVisible && tab === 'drones'}
            navigationItems={navigationItems}
            onDrawerOpenChange={setAppDrawerOpen}
            onHeaderChange={handleDronesHeaderChange}
            selectedDeviceId={activeDeviceId}
            devicePickerItems={devicePickerItems}
            onDeviceChange={selectDevice}
          />
        </View>
      ) : null}
      {pairingContent}
      {!pairingVisible && tab === 'settings' ? (
        <SettingsScreen tab={settingsTab} onTabChange={setSettingsTab} onPair={openPairing} />
      ) : null}
      {!pairingVisible && tab === 'devices' ? <DevicesScreen /> : null}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
      <View style={styles.header}>
        <View pointerEvents="none" style={styles.headerAccent} />
        {mesh.profile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasBackNavigation ? 'Open drone navigation' : 'Toggle app menu'}
            onPress={toggleAppDrawer}
            style={styles.titleButton}
          >
            <View
              style={[
                styles.menuButton,
                hasBackNavigation && styles.contextBackButton,
                appDrawerOpen && styles.menuButtonActive,
              ]}
            >
              {hasBackNavigation ? (
                <ChevronLeft
                  color={appDrawerOpen ? colors.accent : colors.text}
                  size={22}
                  strokeWidth={2.1}
                />
              ) : (
                <Menu
                  color={appDrawerOpen ? colors.accent : colors.text}
                  size={19}
                  strokeWidth={2.2}
                />
              )}
            </View>
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
          {headerMenuActions.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open actions menu"
              accessibilityState={{ expanded: headerMenuOpen }}
              onPress={() => setHeaderMenuOpen(true)}
              style={styles.contextMenuAction}
            >
              <MoreVertical color={colors.muted} size={19} strokeWidth={2} />
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
        <LocalDroneControlProvider>
          <MobileChatVoiceRecorderProvider>
            <MobileCompanionProvider>
              <View style={styles.appRoot}>
                <AppDrawerProvider>
                  <Shell />
                </AppDrawerProvider>
                <MobileCompanionOverlay />
              </View>
            </MobileCompanionProvider>
          </MobileChatVoiceRecorderProvider>
        </LocalDroneControlProvider>
      </LocalAssistantProvider>
    </MeshProvider>
  );
}

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  contextBackButton: {
    width: 28,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
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
  headerActionDisabled: { opacity: 0.55 },
  contextMenuAction: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  actionMenuLayer: { flex: 1 },
  actionMenu: {
    position: 'absolute',
    right: 10,
    width: 210,
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
  actionMenuContent: { padding: 5 },
  actionMenuSection: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    paddingHorizontal: 11,
    paddingBottom: 3,
    paddingTop: 10,
    textTransform: 'uppercase',
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
  actionMenuItemTextSelected: { color: colors.accent },
  actionMenuItemTextDanger: { color: colors.danger },
  content: { flex: 1 },
  tabContent: { flex: 1 },
  tabContentHidden: { display: 'none' },
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
