import React from 'react';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  FlatList,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import Square from 'lucide-react-native/icons/square';
import Mic from 'lucide-react-native/icons/mic';
import X from 'lucide-react-native/icons/x';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Drawer } from 'react-native-drawer-layout';
import { colors } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedMobileChatVoiceRecorder } from './MobileChatVoiceRecorderContext';
import {
  formatMobileVoiceDuration,
  mobileVoiceStatusLabel,
} from './mobile-voice-transcription-model';
import {
  buildMobileDroneRepoGroups,
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  orderedMobileDroneChats,
  suggestNextMobileDroneChatName,
  type MobileDroneGroupFolder,
  type MobileDroneRepoGroup,
  type MobileDroneSidebarEntry,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
  type MobileDroneTreeNode,
} from '../drones/drone-sidebar-model';
import {
  buildSidebarChatTree,
  flattenSidebarChatTreeChatNodeIds,
  normalizeSidebarChatGroupPath,
  resolvePinnedSidebarDrones,
  sidebarChatGroupBaseName,
  sidebarChatGroupNodeId,
  sidebarChatGroupParentPath,
  sidebarChatNodeId,
  sidebarChatRootNodeId,
  sidebarDroneNodeId,
  sidebarFolderNodeId,
  type SidebarChatTreeFolderNode,
  type SidebarChatTreeModel,
  type SidebarChatTreeNode,
} from '@drone/hub-model/sidebar';
import {
  firstMobileSidebarInsertionTarget,
  type MobileSidebarMutationRequest,
} from '../drones/mobile-sidebar-reorder';
import {
  addMobileDroneToStateSummary,
  EMPTY_MOBILE_DRONE_STATE_SUMMARY,
  mobileDroneChatDisplayState,
  mobileDroneDisplayState,
  summarizeMobileDroneChats,
  type MobileDroneDisplayState,
  type MobileDroneStateSummary,
} from '../drones/drone-state-summary';
import {
  SidebarChevronIcon,
  SidebarFolderGitIcon,
  SidebarFolderOutlineIcon,
  SidebarPinIcon,
  SidebarPlusIcon,
  SidebarSettingsIcon,
  SidebarTreeChevronIcon,
  SidebarWorkingIcon,
} from './SidebarIcons';
import { RuntimeIcon } from '../drones/NewDroneRuntimePicker';
import type { MeshDeviceConnectionState } from '../mesh/MeshConnectionManager';
import { useMobileSidebarExpandedFolderIds } from './use-mobile-sidebar-expanded-folder-ids';
import { useMobileSidebarCollapsedDroneIds } from './use-mobile-sidebar-collapsed-drone-ids';
import {
  ConfirmDialog,
  ContextMenu,
  TextInputDialog,
  type ContextMenuAction,
} from '../components/Ui';
import {
  MobileSidebarDragDropProvider,
  MobileSidebarDragArea,
  MobileSidebarDragTarget,
  type MobileSidebarDragTargetData,
} from './MobileSidebarDragDrop';
import { resolveMobileSidebarRepositoryAlignment } from './mobile-sidebar-repository-navigation';
import { useMobileCompanion } from './MobileCompanionContext';
import { resolveMobileChatDeletePlan } from './mobile-chat-delete';

export function appDrawerWidth(windowWidth: number): number {
  return Math.max(0, windowWidth);
}

export type AppDrawerNavigationItem = {
  id: string;
  label: string;
  active: boolean;
  onPress(): void;
};

export type DrawerDevicePickerItem = {
  id: string;
  name: string;
  connected: boolean;
  connectionState?: MeshDeviceConnectionState;
  detail?: string;
  platform: string;
};

function deviceConnectionLabel(device: DrawerDevicePickerItem | undefined): string {
  if (!device) return 'offline';
  if (device.connectionState === 'reconnecting') return 'reconnecting';
  if (device.connectionState === 'suspended') return 'connection paused';
  return device.connected ? 'online' : 'offline';
}

function devicePlatformLabel(platform: string): string {
  if (platform === 'android') return 'Android';
  if (platform === 'server' || platform === 'desktop') return 'Desktop';
  return 'Device';
}

export type AppDrawerProps = {
  open: boolean;
  navigationItems: AppDrawerNavigationItem[];
  showDrones?: boolean;
  drones?: MobileDroneSummary[];
  droneSidebarOrder?: MobileDroneSidebarOrder;
  activeDroneId?: string;
  activeChatName?: string;
  companionHighlightedDroneIds?: readonly string[];
  droneOperationById?: Record<string, 'archiving' | 'deleting'>;
  dronesLoading?: boolean;
  dronesReachable?: boolean;
  dronesError?: string | null;
  devicePickerItems?: DrawerDevicePickerItem[];
  activeDeviceId?: string;
  onOpen(): void;
  onClose(): void;
  onCreateDrone?(repoPath: string): void;
  onRetryDrones?(): void;
  onSelectDroneChat?(droneId: string, chatName: string): void;
  onCreateDroneChat?(droneId: string, chatName: string, copyFrom: string): Promise<boolean>;
  onRenameDroneChat?(droneId: string, chatName: string, newName: string): Promise<boolean>;
  onDeleteDroneChat?(droneId: string, chatName: string): Promise<boolean>;
  onReorderSidebar?(request: MobileSidebarMutationRequest): void;
  onSelectDevice?(deviceId: string): void;
};

type DrawerChatActionTarget = {
  drone: MobileDroneSummary;
  chatName: string;
};

type DrawerChatGroupActionTarget = {
  drone: MobileDroneSummary;
  path: string | null;
};

type DrawerMuteActionTarget =
  | { kind: 'chat'; drone: MobileDroneSummary; chatName: string }
  | { kind: 'drone'; drone: MobileDroneSummary }
  | { kind: 'group'; folder: MobileDroneGroupFolder };

type RegisterDrawer = (props: AppDrawerProps | null) => void;

const AppDrawerHostContext = React.createContext<RegisterDrawer | null>(null);
const DrawerWorkingPhaseContext = React.createContext<Animated.Value | null>(null);
const DrawerSidebarReorderContext = React.createContext<
  ((request: MobileSidebarMutationRequest) => void) | null
>(null);
const DrawerChatTreeContext = React.createContext<{
  sidebar: MobileDroneSidebarOrder;
  expandedGroupIds: ReadonlySet<string>;
  selectedChatNodeIds: ReadonlySet<string>;
  toggleGroup(groupId: string): void;
  toggleChatSelection(droneId: string, chatName: string): void;
  clearChatSelection(): void;
  openGroupActions(target: DrawerChatGroupActionTarget): void;
} | null>(null);
const DrawerSidebarMuteContext = React.createContext<{
  effectiveGroupIds: ReadonlySet<string>;
  effectiveDroneIds: ReadonlySet<string>;
  mutedChatIds: ReadonlySet<string>;
  openActions?(target: DrawerMuteActionTarget): void;
} | null>(null);
const DrawerCompanionHighlightContext = React.createContext<ReadonlySet<string>>(new Set());
const DRAWER_WORKING_SPIN_DURATION_MS = 1_600;
const RECENT_BLOCKED_EMPHASIS_MS = 30_000;
const DRAWER_TREE_ROW_PADDING_LEFT = 12;
const DRAWER_TREE_DEPTH_INDENT = 10;
const DRAWER_TREE_LEADING_SLOT_WIDTH = 12;
const DRAWER_TREE_LEADING_GAP = 6;
const PINNED_SIDEBAR_PLACEMENT_KEY = 'droneHubMobile.pinnedSidebarPlacement';
const PINNED_SIDEBAR_COLLAPSED_KEY = 'droneHubMobile.pinnedSidebarCollapsed';
type PinnedSidebarPlacement = 'top' | 'bottom';

function drawerTreeRowPaddingLeft(depth: number): number {
  return DRAWER_TREE_ROW_PADDING_LEFT + Math.max(0, depth) * DRAWER_TREE_DEPTH_INDENT;
}

function mobileSidebarEntryNodeId(entry: MobileDroneSidebarEntry): string {
  return entry.kind === 'drone'
    ? sidebarDroneNodeId(entry.node.drone.id)
    : sidebarFolderNodeId(entry.folder.id);
}

function mobileSidebarChatId(droneId: string, chatName: string): string {
  return `chat:${String(droneId).trim()}:${String(chatName).trim() || 'default'}`;
}

export function AppDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerProps, setDrawerProps] = React.useState<AppDrawerProps | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { width: windowWidth } = useWindowDimensions();
  // The workspace currently resolves different @types/react versions for the app and the drawer.
  // Keep the compatibility cast scoped to that package boundary instead of erasing the type.
  const drawerChildren = children as React.ComponentProps<typeof Drawer>['children'];
  const drawerPropsRef = React.useRef<AppDrawerProps | null>(null);
  const drawerOpenRef = React.useRef(false);
  const drawerTransitionActiveRef = React.useRef(false);
  const drawerRefreshFrameRef = React.useRef<number | null>(null);
  const registerDrawer = React.useCallback<RegisterDrawer>((nextProps) => {
    const wasOpen = drawerOpenRef.current;
    drawerOpenRef.current = nextProps?.open ?? false;
    drawerPropsRef.current = nextProps;
    setDrawerOpen(nextProps?.open ?? false);
    setDrawerProps((currentProps) => {
      if (!nextProps) {
        return wasOpen || drawerTransitionActiveRef.current ? currentProps : null;
      }
      if (!currentProps) return nextProps;

      const visibilityChanged = currentProps.open !== nextProps.open;

      // The owning screen can update several times a second while a chat is streaming. Keep the
      // closed drawer dormant, and don't commit a new drawer tree while its surface is moving.
      if (!nextProps.open || visibilityChanged || drawerTransitionActiveRef.current) {
        return currentProps;
      }
      return nextProps;
    });
  }, []);

  const handleOpen = React.useCallback(() => {
    drawerPropsRef.current?.onOpen();
  }, []);
  const handleClose = React.useCallback(() => {
    drawerPropsRef.current?.onClose();
  }, []);
  const handleTransitionStart = React.useCallback(() => {
    drawerTransitionActiveRef.current = true;
    if (drawerRefreshFrameRef.current != null) {
      cancelAnimationFrame(drawerRefreshFrameRef.current);
      drawerRefreshFrameRef.current = null;
    }
  }, []);
  const handleTransitionEnd = React.useCallback(() => {
    drawerTransitionActiveRef.current = false;
    drawerRefreshFrameRef.current = requestAnimationFrame(() => {
      drawerRefreshFrameRef.current = null;
      if (!drawerTransitionActiveRef.current) {
        setDrawerProps(drawerPropsRef.current);
      }
    });
  }, []);
  const drawerContent = React.useMemo(
    () =>
      drawerProps ? <AppDrawerView {...drawerProps} /> : <View style={styles.drawerContent} />,
    [drawerProps],
  );
  const configureGestureHandler = React.useCallback(
    (
      gesture: Parameters<
        NonNullable<React.ComponentProps<typeof Drawer>['configureGestureHandler']>
      >[0],
    ) =>
      gesture
        .hitSlop({
          left: 0,
          width: windowWidth,
        })
        // Only claim a swipe in the useful direction. This lets vertical content keep scrolling,
        // while making a closed drawer available from anywhere on the screen rather than its edge.
        .activeOffsetX(drawerOpen ? -6 : 6)
        .failOffsetY([-18, 18]),
    [drawerOpen, windowWidth],
  );

  React.useEffect(() => {
    if (!drawerOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      drawerPropsRef.current?.onClose();
      return true;
    });
    return () => subscription.remove();
  }, [drawerOpen]);
  React.useEffect(
    () => () => {
      if (drawerRefreshFrameRef.current != null) {
        cancelAnimationFrame(drawerRefreshFrameRef.current);
      }
    },
    [],
  );

  return (
    <AppDrawerHostContext.Provider value={registerDrawer}>
      <Drawer
        open={drawerOpen}
        onOpen={handleOpen}
        onClose={handleClose}
        onGestureStart={handleTransitionStart}
        onTransitionStart={handleTransitionStart}
        onTransitionEnd={handleTransitionEnd}
        configureGestureHandler={configureGestureHandler}
        renderDrawerContent={() => drawerContent}
        drawerType="front"
        drawerPosition="left"
        drawerStyle={[styles.drawer, { width: appDrawerWidth(windowWidth) }]}
        overlayStyle={styles.backdrop}
        overlayAccessibilityLabel="Close app menu"
        swipeEnabled={Boolean(drawerProps)}
        swipeEdgeWidth={windowWidth}
        swipeMinDistance={24}
        swipeMinVelocity={320}
        keyboardDismissMode="on-drag"
        style={styles.host}
      >
        {drawerChildren}
      </Drawer>
    </AppDrawerHostContext.Provider>
  );
}

function DrawerDevicePicker({
  devices,
  activeDeviceId,
  onSelect,
  onOpenDeviceSettings,
}: {
  devices: DrawerDevicePickerItem[];
  activeDeviceId: string;
  onSelect?(deviceId: string): void;
  onOpenDeviceSettings?(): void;
}) {
  const [open, setOpen] = React.useState(false);
  const activeDevice = devices.find((device) => device.id === activeDeviceId) ?? devices[0];
  React.useEffect(() => setOpen(false), [activeDeviceId]);
  return (
    <View style={styles.devicePickerSection}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${activeDevice?.name ?? 'Choose device'}, ${deviceConnectionLabel(activeDevice)}. Choose device.`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [
          styles.devicePicker,
          open && styles.devicePickerOpen,
          pressed && styles.devicePickerPressed,
        ]}
      >
        <View style={[styles.deviceDot, activeDevice?.connected && styles.deviceDotOnline]} />
        <View style={styles.devicePickerTriggerCopy}>
          <Text numberOfLines={1} style={styles.devicePickerName}>
            {activeDevice?.name ?? 'Choose a device'}
          </Text>
        </View>
        <SidebarChevronIcon
          color={colors.sidebarActionFg}
          size={14}
          strokeWidth={2}
          direction={open ? 'up' : 'down'}
        />
      </Pressable>
      {open ? (
        <View style={styles.deviceOptions}>
          <ScrollView
            style={styles.deviceOptionsList}
            contentContainerStyle={styles.deviceOptionsContent}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {devices.map((device, index) => {
              const active = device.id === activeDeviceId;
              return (
                <Pressable
                  key={device.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${device.name}, ${deviceConnectionLabel(device)}, ${devicePlatformLabel(device.platform)}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setOpen(false);
                    if (!active) onSelect?.(device.id);
                  }}
                  style={({ pressed }) => [
                    styles.deviceOption,
                    index === devices.length - 1 && styles.deviceOptionLast,
                    active && styles.deviceOptionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  {active ? <View style={styles.deviceOptionActiveEdge} /> : null}
                  <View style={[styles.deviceDot, device.connected && styles.deviceDotOnline]} />
                  <View style={styles.devicePickerCopy}>
                    <Text
                      numberOfLines={1}
                      style={[styles.deviceOptionName, active && styles.deviceOptionNameActive]}
                    >
                      {device.name}
                    </Text>
                    {device.detail ? (
                      <Text numberOfLines={1} style={styles.devicePickerDetail}>
                        {device.detail}
                      </Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={styles.devicePlatform}>
                    {devicePlatformLabel(device.platform)}
                  </Text>
                </Pressable>
              );
            })}
            {devices.length === 0 ? (
              <Text style={styles.empty}>No compatible devices are available.</Text>
            ) : null}
          </ScrollView>
          {onOpenDeviceSettings ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manage devices"
              onPress={() => {
                setOpen(false);
                onOpenDeviceSettings();
              }}
              style={({ pressed }) => [styles.deviceSettingsAction, pressed && styles.pressed]}
            >
              <Text style={styles.deviceSettingsActionLabel}>Manage devices</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function droneTreeContains(nodes: MobileDroneTreeNode[], droneId: string): boolean {
  return nodes.some(
    (node) => node.drone.id === droneId || droneTreeContains(node.children, droneId),
  );
}

function droneFolderContains(folder: MobileDroneGroupFolder, droneId: string): boolean {
  return (
    droneTreeContains(folder.roots, droneId) ||
    folder.children.some((child) => droneFolderContains(child, droneId))
  );
}

type SwitchDisplayState = MobileDroneDisplayState | 'done' | 'archiving' | 'deleting';

function addDroneNodesToStateSummary(
  summary: MobileDroneStateSummary,
  nodes: MobileDroneTreeNode[],
  mutedDroneIds: ReadonlySet<string>,
  mutedChatIds: ReadonlySet<string>,
): void {
  for (const node of nodes) {
    if (!mutedDroneIds.has(node.drone.id)) {
      const unmutedChats = node.drone.chats.filter(
        (chatName) => !mutedChatIds.has(mobileSidebarChatId(node.drone.id, chatName)),
      );
      if (unmutedChats.length > 0) {
        const unmutedSet = new Set(unmutedChats);
        const unmutedApprovalChats = (node.drone.approvalChats ?? []).filter((chatName) =>
          unmutedSet.has(chatName),
        );
        addMobileDroneToStateSummary(summary, {
          ...node.drone,
          chats: unmutedChats,
          busyChats: node.drone.busyChats.filter((chatName) => unmutedSet.has(chatName)),
          unreadChats: node.drone.unreadChats?.filter((chatName) => unmutedSet.has(chatName)),
          approvalChats: unmutedApprovalChats,
          approvalRequired:
            node.drone.approvalRequired &&
            (node.drone.approvalChats
              ? unmutedApprovalChats.length > 0
              : unmutedChats.length > 0),
        });
      }
    }
    addDroneNodesToStateSummary(summary, node.children, mutedDroneIds, mutedChatIds);
  }
}

function addDroneFoldersToStateSummary(
  summary: MobileDroneStateSummary,
  folders: MobileDroneGroupFolder[],
  mutedDroneIds: ReadonlySet<string>,
  mutedChatIds: ReadonlySet<string>,
): void {
  for (const folder of folders) {
    addDroneNodesToStateSummary(summary, folder.roots, mutedDroneIds, mutedChatIds);
    addDroneFoldersToStateSummary(summary, folder.children, mutedDroneIds, mutedChatIds);
  }
}

function summarizeDroneScope(
  roots: MobileDroneTreeNode[],
  folders: MobileDroneGroupFolder[] = [],
  mutedDroneIds: ReadonlySet<string> = new Set(),
  mutedChatIds: ReadonlySet<string> = new Set(),
): MobileDroneStateSummary {
  const summary = { ...EMPTY_MOBILE_DRONE_STATE_SUMMARY };
  addDroneNodesToStateSummary(summary, roots, mutedDroneIds, mutedChatIds);
  addDroneFoldersToStateSummary(summary, folders, mutedDroneIds, mutedChatIds);
  return summary;
}

function DroneStateCounts({
  summary,
  compact = false,
  entity = 'drone',
}: {
  summary: MobileDroneStateSummary;
  compact?: boolean;
  entity?: 'drone' | 'chat';
}) {
  if (summary.approval <= 0 && summary.unread <= 0 && summary.working <= 0) return null;
  return (
    <View style={[styles.fleetStates, compact && styles.fleetStatesCompact]}>
      {summary.approval > 0 ? (
        <View
          accessibilityLabel={
            entity === 'chat'
              ? `${summary.approval} chats awaiting approval`
              : `${summary.approval} awaiting approval`
          }
          style={styles.fleetState}
        >
          <ApprovalStatusIndicator />
          <Text style={[styles.fleetStateText, styles.fleetStateTextApproval]}>
            {summary.approval}
          </Text>
        </View>
      ) : null}
      {summary.unread > 0 ? (
        <View
          accessibilityLabel={
            entity === 'chat'
              ? `${summary.unread} unread chats`
              : `${summary.unread} with unread chats`
          }
          style={styles.fleetState}
        >
          <UnreadStatusIndicator />
          <Text style={[styles.fleetStateText, styles.fleetStateTextUnread]}>{summary.unread}</Text>
        </View>
      ) : null}
      {summary.working > 0 ? (
        <View
          accessibilityLabel={
            entity === 'chat' ? `${summary.working} working chats` : `${summary.working} working`
          }
          style={styles.fleetState}
        >
          <WorkingStatusIndicator />
          <Text style={[styles.fleetStateText, styles.fleetStateTextWorking]}>
            {summary.working}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function switchStateLabel(state: SwitchDisplayState): string {
  if (state === 'offline') return 'Unavailable';
  if (state === 'approval') return 'Approval required';
  if (state === 'idle') return 'Ready';
  return `${state[0]?.toUpperCase() ?? ''}${state.slice(1)}`;
}

function switchStateColor(state: SwitchDisplayState): string {
  if (state === 'approval') return colors.warning;
  if (state === 'archiving') return colors.info;
  if (state === 'deleting') return colors.danger;
  if (state === 'working' || state === 'starting') return colors.warning;
  if (state === 'waiting') return colors.info;
  if (state === 'blocked' || state === 'offline') return colors.danger;
  if (state === 'done') return colors.online;
  return colors.muted;
}

function SwitchItemStatusIndicator({
  state,
  unread = false,
  muted = false,
  emphasized = false,
  showReadyAnchor = true,
}: {
  state: SwitchDisplayState;
  unread?: boolean;
  muted?: boolean;
  emphasized?: boolean;
  showReadyAnchor?: boolean;
}) {
  const ready = showReadyAnchor && state === 'idle' && !unread;
  const working = state === 'working' || state === 'starting';
  const stateColor = switchStateColor(state);
  return (
    <View accessible={false} style={styles.switchItemStatus}>
      {muted ? (
        <MutedStatusIndicator />
      ) : ready ? (
        <View style={styles.readyStateAnchor} />
      ) : state === 'archiving' ? (
        <OperationStatusIndicator operation="archiving" />
      ) : state === 'deleting' ? (
        <OperationStatusIndicator operation="deleting" />
      ) : working ? (
        <WorkingStatusIndicator />
      ) : state === 'approval' ? (
        <ApprovalStatusIndicator />
      ) : state === 'blocked' ? (
        <BlockedStatusIndicator emphasized={emphasized} />
      ) : unread && state === 'idle' ? (
        <UnreadStatusIndicator />
      ) : (
        <View accessible={false} style={styles.switchStateIndicator}>
          <View style={[styles.switchStateDot, { backgroundColor: stateColor }]} />
        </View>
      )}
    </View>
  );
}

function MutedStatusIndicator() {
  return (
    <View accessible={false} style={styles.stateStatusIndicator}>
      <Svg height={12} width={12} viewBox="0 0 12 12" fill="none">
        <Circle cx="6" cy="6" r="4.25" stroke={colors.sidebarMutedDim} strokeWidth="1.25" />
        <Line
          x1="2.6"
          y1="9.4"
          x2="9.4"
          y2="2.6"
          stroke={colors.sidebarMutedDim}
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

function OperationStatusIndicator({ operation }: { operation: 'archiving' | 'deleting' }) {
  const sharedPhase = React.useContext(DrawerWorkingPhaseContext);
  const rotate = sharedPhase?.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const operationColor = operation === 'archiving' ? colors.info : colors.danger;
  return (
    <View accessible={false} style={styles.operationStatusIndicator}>
      <Animated.View style={rotate ? { transform: [{ rotate }] } : undefined}>
        <SidebarWorkingIcon color={colors.info} size={12} strokeWidth={2.4} />
      </Animated.View>
      <Svg
        height={6}
        width={6}
        viewBox="0 0 12 12"
        fill="none"
        stroke={operationColor}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={styles.operationStatusGlyph}
      >
        {operation === 'archiving' ? (
          <>
            <Path d="M1.5 4.5h9v6h-9z" />
            <Path d="M6 1.25v5M3.9 4.25 6 6.35l2.1-2.1" />
          </>
        ) : (
          <Path d="M2.25 3.25h7.5M4.25 3.25V1.75h3.5v1.5M3.15 3.25l.5 7h4.7l.5-7M5 5.25v3M7 5.25v3" />
        )}
      </Svg>
    </View>
  );
}

function WorkingStatusIndicator() {
  const sharedPhase = React.useContext(DrawerWorkingPhaseContext);
  const localPhase = React.useRef(new Animated.Value(0)).current;
  const phase = sharedPhase ?? localPhase;
  React.useEffect(() => {
    if (sharedPhase) return;
    const animation = Animated.loop(
      Animated.timing(localPhase, {
        toValue: 1,
        duration: DRAWER_WORKING_SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [localPhase, sharedPhase]);
  return (
    <View accessible={false} style={styles.workingStatusIndicator}>
      <Animated.View
        style={{
          transform: [
            {
              rotate: phase.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '360deg'],
              }),
            },
          ],
        }}
      >
        <SidebarWorkingIcon color={colors.warning} size={12} strokeWidth={2.4} />
      </Animated.View>
    </View>
  );
}

function ApprovalStatusIndicator() {
  return (
    <View accessible={false} style={styles.stateStatusIndicator}>
      <Svg height={12} width={12} viewBox="0 0 12 12" fill="none">
        <Line
          x1="4"
          y1="2.5"
          x2="4"
          y2="9.5"
          stroke={colors.warning}
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <Line
          x1="8"
          y1="2.5"
          x2="8"
          y2="9.5"
          stroke={colors.warning}
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

function BlockedStatusIndicator({ emphasized = false }: { emphasized?: boolean }) {
  const color = colors.sidebarBlockedIndicator;
  return (
    <View
      accessible={false}
      style={[styles.stateStatusIndicator, !emphasized && styles.quietBlockedStatusIndicator]}
    >
      <Svg height={12} width={12} viewBox="0 0 12 12" fill="none">
        <Path
          d="M6 1.25 11 10.25H1L6 1.25Z"
          stroke={color}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M6 4.15v2.75" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
        <Circle cx="6" cy="8.5" r=".55" fill={color} />
      </Svg>
    </View>
  );
}

function UnreadStatusIndicator() {
  return (
    <View accessible={false} style={styles.stateStatusIndicator}>
      <View style={styles.unreadStatusDot} />
    </View>
  );
}

function DrawerDroneChatRow({
  drone,
  chatName,
  chatNames,
  dragScope,
  activeDroneId,
  activeChatName,
  selectionWashInset,
  depth = 0,
  parentPath = null,
  siblingNodeIds,
  orderedChatNodeIds,
  canReorder,
  onOpenActions,
  onSelect,
}: {
  drone: MobileDroneSummary;
  chatName: string;
  chatNames: string[];
  dragScope: string;
  activeDroneId: string;
  activeChatName: string;
  selectionWashInset: number;
  depth?: number;
  parentPath?: string | null;
  siblingNodeIds?: string[];
  orderedChatNodeIds: string[];
  canReorder: boolean;
  onOpenActions?(target: DrawerChatActionTarget): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  const reorderSidebar = React.useContext(DrawerSidebarReorderContext);
  const muteContext = React.useContext(DrawerSidebarMuteContext);
  const chatTreeContext = React.useContext(DrawerChatTreeContext);
  const sidebarNodeId = sidebarChatNodeId(drone.id, chatName);
  const multiSelected = Boolean(chatTreeContext?.selectedChatNodeIds.has(sidebarNodeId));
  const selected = drone.id === activeDroneId && chatName === activeChatName;
  const suppressPressAfterLongPressRef = React.useRef(false);
  const draft = drone.draftChats?.[chatName] === true;
  const muted = Boolean(
    muteContext?.effectiveDroneIds.has(drone.id) ||
      muteContext?.mutedChatIds.has(mobileSidebarChatId(drone.id, chatName)),
  );
  const unread = !muted && !selected && (drone.unreadChats?.includes(chatName) ?? false);
  const displayState = mobileDroneChatDisplayState(
    drone,
    chatName,
    selected && Boolean(drone.approvalRequired),
  );
  const stateLabel = muted
    ? 'Muted'
    : unread && displayState === 'idle'
      ? 'Unread'
      : switchStateLabel(displayState);
  const reorderChat = React.useCallback(
    (overNodeId: string, placement: 'before' | 'inside' | 'after', target?: MobileSidebarDragTargetData) => {
      const targetPath = placement === 'inside'
        ? target?.folderPath ?? null
        : target?.parentGroupPath ?? null;
      const selectedIds = chatTreeContext?.selectedChatNodeIds.has(sidebarNodeId)
        ? orderedChatNodeIds.filter((id) => chatTreeContext.selectedChatNodeIds.has(id))
        : [sidebarNodeId];
      reorderSidebar?.({
        kind: 'chat-tree-move',
        droneId: drone.id,
        itemKind: 'chat',
        activeNodeId: sidebarNodeId,
        activeNodeIds: selectedIds,
        sourcePath: parentPath,
        sourceSiblingNodeIds: siblingNodeIds ?? chatNames.map((name) => sidebarChatNodeId(drone.id, name)),
        targetPath,
        targetSiblingNodeIds: target?.siblingItemIds ?? [],
        ...(placement === 'inside' ? {} : { overNodeId }),
        placement,
      });
    },
    [chatNames, chatTreeContext, drone.id, orderedChatNodeIds, parentPath, reorderSidebar, siblingNodeIds, sidebarNodeId],
  );
  const moveChat = React.useCallback(
    (direction: 'up' | 'down') => {
      const siblings = siblingNodeIds ?? chatNames.map((name) => sidebarChatNodeId(drone.id, name));
      const index = siblings.indexOf(sidebarNodeId);
      const overNodeId = siblings[index + (direction === 'up' ? -1 : 1)];
      if (!overNodeId) return;
      reorderChat(
        overNodeId,
        direction === 'up' ? 'before' : 'after',
        { parentGroupPath: parentPath, siblingItemIds: siblings },
      );
    },
    [chatNames, drone.id, parentPath, reorderChat, siblingNodeIds, sidebarNodeId],
  );
  return (
    <MobileSidebarDragTarget
      scope={dragScope}
      treeScope={`chat-tree:${drone.id}`}
      itemId={sidebarNodeId}
      data={{
        parentId: parentPath ? sidebarChatGroupNodeId(drone.id, parentPath) : sidebarChatRootNodeId(drone.id),
        parentGroupPath: parentPath,
        siblingItemIds: siblingNodeIds ?? [],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${drone.name} / ${chatName}, ${stateLabel}`}
        accessibilityState={{ selected: selected || multiSelected }}
        delayLongPress={600}
        onLongPress={() => {
          if (!onOpenActions) return;
          suppressPressAfterLongPressRef.current = true;
          onOpenActions({ drone, chatName });
        }}
        onPressOut={() => {
          if (!suppressPressAfterLongPressRef.current) return;
          setTimeout(() => {
            suppressPressAfterLongPressRef.current = false;
          }, 0);
        }}
        onPress={() => {
          if (suppressPressAfterLongPressRef.current) {
            suppressPressAfterLongPressRef.current = false;
            return;
          }
          if (chatTreeContext?.selectedChatNodeIds.size) {
            chatTreeContext.toggleChatSelection(drone.id, chatName);
          } else {
            onSelect(drone.id, chatName);
          }
        }}
        style={({ pressed }) => [
          styles.droneChatRow,
          { paddingLeft: 8 + depth * 10 },
          multiSelected && styles.switchItemRowActive,
          pressed && !selected && styles.sidebarRowPressed,
        ]}
      >
        {selected ? (
          <View style={[styles.droneChatSelectionWash, { left: -selectionWashInset }]} />
        ) : null}
        {selected ? <View style={styles.sidebarSelectionEdge} /> : null}
        <SwitchItemStatusIndicator state={displayState} unread={unread} muted={muted} showReadyAnchor />
        {reorderSidebar && canReorder ? (
          <MobileSidebarDragArea
            scope={dragScope}
            treeScope={`chat-tree:${drone.id}`}
            itemId={sidebarNodeId}
            label={`${drone.name} / ${chatName} chat`}
            onDrop={reorderChat}
            onMoveAccessibility={moveChat}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.droneChatLabel,
                styles.draggableRowLabel,
                selected && styles.droneChatLabelActive,
              ]}
            >
              {chatName}
            </Text>
          </MobileSidebarDragArea>
        ) : (
          <Text
            numberOfLines={1}
            style={[styles.droneChatLabel, selected && styles.droneChatLabelActive]}
          >
            {chatName}
          </Text>
        )}
        {draft ? <Text style={styles.droneChatDraftBadge}>Draft</Text> : null}
      </Pressable>
    </MobileSidebarDragTarget>
  );
}

function DrawerDroneChatTreeEntry({
  drone,
  node,
  tree,
  allChatNames,
  orderedChatNodeIds,
  depth,
  activeDroneId,
  activeChatName,
  selectionWashInset,
  onOpenChatActions,
  onSelect,
}: {
  drone: MobileDroneSummary;
  node: SidebarChatTreeNode;
  tree: SidebarChatTreeModel;
  allChatNames: string[];
  orderedChatNodeIds: string[];
  depth: number;
  activeDroneId: string;
  activeChatName: string;
  selectionWashInset: number;
  onOpenChatActions?(target: DrawerChatActionTarget): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  const reorderSidebar = React.useContext(DrawerSidebarReorderContext);
  const chatTreeContext = React.useContext(DrawerChatTreeContext);
  if (node.kind === 'chat') {
    const parent = node.parentId === tree.rootId ? null : tree.nodesById[node.parentId];
    const parentPath = parent?.kind === 'folder' ? parent.path : null;
    return (
      <DrawerDroneChatRow
        drone={drone}
        chatName={node.chatName}
        chatNames={allChatNames}
        dragScope={`chat-parent:${node.parentId}`}
        parentPath={parentPath}
        siblingNodeIds={tree.childIdsByParent[node.parentId] ?? []}
        orderedChatNodeIds={orderedChatNodeIds}
        canReorder={Object.keys(tree.nodesById).length > 1}
        activeDroneId={activeDroneId}
        activeChatName={activeChatName}
        selectionWashInset={selectionWashInset + depth * 10}
        depth={depth}
        onOpenActions={onOpenChatActions}
        onSelect={onSelect}
      />
    );
  }
  const groupId = node.id;
  const expanded = Boolean(chatTreeContext?.expandedGroupIds.has(groupId));
  const parentPath = sidebarChatGroupParentPath(node.path);
  const childIds = tree.childIdsByParent[node.id] ?? [];
  const dragScope = `chat-parent:${node.parentId}`;
  const hasSelectedDirectChat = childIds.some((childId) => {
    const child = tree.nodesById[childId];
    return child?.kind === 'chat' &&
      drone.id === activeDroneId && child.chatName === activeChatName;
  });
  const reorderGroup = (
    overNodeId: string,
    placement: 'before' | 'inside' | 'after',
    target?: MobileSidebarDragTargetData,
  ) => {
    const targetPath = placement === 'inside'
      ? target?.folderPath ?? null
      : target?.parentGroupPath ?? null;
    reorderSidebar?.({
      kind: 'chat-tree-move',
      droneId: drone.id,
      itemKind: 'folder',
      activeNodeId: node.id,
      sourcePath: parentPath,
      sourceSiblingNodeIds: tree.childIdsByParent[node.parentId] ?? [],
      targetPath,
      targetSiblingNodeIds: target?.siblingItemIds ?? [],
      ...(placement === 'inside' ? {} : { overNodeId }),
      placement,
    });
  };
  const moveGroup = (direction: 'up' | 'down') => {
    const siblings = tree.childIdsByParent[node.parentId] ?? [];
    const index = siblings.indexOf(node.id);
    const overNodeId = siblings[index + (direction === 'up' ? -1 : 1)];
    if (!overNodeId) return;
    reorderGroup(
      overNodeId,
      direction === 'up' ? 'before' : 'after',
      { parentGroupPath: parentPath, siblingItemIds: siblings },
    );
  };
  return (
    <MobileSidebarDragTarget
      scope={dragScope}
      treeScope={`chat-tree:${drone.id}`}
      itemId={node.id}
      canDropInside
      data={{
        parentId: node.parentId,
        parentGroupPath: parentPath,
        siblingItemIds: tree.childIdsByParent[node.parentId] ?? [],
        folderPath: node.path,
        childItemIds: childIds,
      }}
    >
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${node.label} group`}
          delayLongPress={600}
          onLongPress={() => chatTreeContext?.openGroupActions({ drone, path: node.path })}
          onPress={() => chatTreeContext?.toggleGroup(groupId)}
          style={({ pressed }) => [
            styles.groupRow,
            { paddingLeft: 8 + depth * 10 },
            pressed && styles.sidebarRowPressed,
          ]}
        >
          <View style={styles.folderChevronSlot}>
            <SidebarTreeChevronIcon
              color={colors.sidebarMutedDim}
              size={16}
              strokeWidth={1.25}
              expanded={expanded}
              style={styles.folderChevron}
            />
          </View>
          {reorderSidebar ? (
            <MobileSidebarDragArea
              scope={dragScope}
              treeScope={`chat-tree:${drone.id}`}
              itemId={node.id}
              label={`${node.label} group`}
              onDrop={reorderGroup}
              onMoveAccessibility={moveGroup}
            >
              <Text numberOfLines={1} style={[styles.groupName, styles.draggableRowLabel]}>{node.label}</Text>
            </MobileSidebarDragArea>
          ) : (
            <Text numberOfLines={1} style={styles.groupName}>{node.label}</Text>
          )}
        </Pressable>
        {expanded ? (
          <View style={styles.groupChildren}>
            {hasSelectedDirectChat ? (
              <View
                pointerEvents="none"
                style={[styles.groupChildrenGuide, { left: 8 + depth * 10 + 8 }]}
              />
            ) : null}
            {childIds.map((childId) => (
              <DrawerDroneChatTreeEntry
                key={childId}
                drone={drone}
                node={tree.nodesById[childId]!}
                tree={tree}
                allChatNames={allChatNames}
                orderedChatNodeIds={orderedChatNodeIds}
                depth={depth + 1}
                activeDroneId={activeDroneId}
                activeChatName={activeChatName}
                selectionWashInset={selectionWashInset}
                onOpenChatActions={onOpenChatActions}
                onSelect={onSelect}
              />
            ))}
          </View>
        ) : null}
      </View>
    </MobileSidebarDragTarget>
  );
}

function DrawerDroneNode({
  node,
  depth,
  parentId,
  siblingNodeIds,
  treeScope,
  repoPath,
  parentGroupPath,
  pinnedDroneIds,
  contextLabel,
  sidebarChatOrderByDrone,
  collapsedDroneIds,
  selectedContainerDroneId,
  showChats = true,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleDrone,
  onSelectContainer,
  onOpenChatActions,
  onSelect,
}: {
  node: MobileDroneTreeNode;
  depth: number;
  parentId: string;
  siblingNodeIds: string[];
  treeScope?: string;
  repoPath?: string;
  parentGroupPath?: string | null;
  pinnedDroneIds?: string[];
  contextLabel?: string;
  sidebarChatOrderByDrone: Record<string, string[]>;
  collapsedDroneIds: ReadonlySet<string>;
  selectedContainerDroneId: string;
  showChats?: boolean;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onToggleDrone(droneId: string): void;
  onSelectContainer(droneId: string): void;
  onOpenChatActions?(target: DrawerChatActionTarget): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  const reorderSidebar = React.useContext(DrawerSidebarReorderContext);
  const muteContext = React.useContext(DrawerSidebarMuteContext);
  const companionHighlightedDroneIds = React.useContext(DrawerCompanionHighlightContext);
  const chatTreeContext = React.useContext(DrawerChatTreeContext);
  const suppressPressAfterLongPressRef = React.useRef(false);
  const { drone } = node;
  const companionHighlighted = companionHighlightedDroneIds.has(drone.id);
  const chats = orderedMobileDroneChats(drone, sidebarChatOrderByDrone[drone.id]);
  const chatTree = React.useMemo(() => buildSidebarChatTree({
    droneId: drone.id,
    chatNames: chats,
    groupPaths: chatTreeContext?.sidebar.sidebarChatGroupPathsByDrone[drone.id] ?? [],
    groupByChat: chatTreeContext?.sidebar.sidebarChatGroupByChat ?? {},
    nodeOrderByParent: chatTreeContext?.sidebar.sidebarChatNodeOrderByParent ?? {},
  }), [chatTreeContext?.sidebar.sidebarChatGroupByChat, chatTreeContext?.sidebar.sidebarChatGroupPathsByDrone, chatTreeContext?.sidebar.sidebarChatNodeOrderByParent, chats, drone.id]);
  const orderedChatNodeIds = React.useMemo(
    () => flattenSidebarChatTreeChatNodeIds(chatTree),
    [chatTree],
  );
  const selected = drone.id === activeDroneId;
  const hasMultipleChats = chats.length > 1 || chatTree.rootChildIds.some((id) => chatTree.nodesById[id]?.kind === 'folder');
  const chatSectionExpanded = !collapsedDroneIds.has(drone.id);
  const isChatDisclosure = showChats && hasMultipleChats;
  const hasActiveChildChat = selected && showChats && hasMultipleChats;
  const hasVisibleActiveChildChat = hasActiveChildChat && chatSectionExpanded;
  const containerSelected = isChatDisclosure && selectedContainerDroneId === drone.id;
  const parentSelected = containerSelected || (selected && !hasVisibleActiveChildChat);
  const selectedChat =
    selected && chats.includes(activeChatName) ? activeChatName : (chats[0] ?? '');
  const operation = droneOperationById[drone.id] as 'archiving' | 'deleting' | undefined;
  const displayState = operation ?? mobileDroneDisplayState(drone, !hasMultipleChats);
  const collapsedChatMuted = Boolean(
    !hasMultipleChats &&
      chats.length === 1 &&
      muteContext?.mutedChatIds.has(mobileSidebarChatId(drone.id, chats[0]!)),
  );
  const muted = Boolean(muteContext?.effectiveDroneIds.has(drone.id) || collapsedChatMuted);
  const isDraft = drone.draft === true || drone.phase.trim().toLowerCase() === 'draft';
  const unread = !muted && !isDraft && !hasMultipleChats && (drone.unreadChats?.length ?? 0) > 0;
  const chatStateSummary = React.useMemo(
    () => {
      if (muted) return EMPTY_MOBILE_DRONE_STATE_SUMMARY;
      const unmutedChats = drone.chats.filter(
        (chatName) => !muteContext?.mutedChatIds.has(mobileSidebarChatId(drone.id, chatName)),
      );
      const unmutedSet = new Set(unmutedChats);
      const unmutedApprovalChats = (drone.approvalChats ?? []).filter((chatName) =>
        unmutedSet.has(chatName),
      );
      return summarizeMobileDroneChats({
        ...drone,
        chats: unmutedChats,
        busyChats: drone.busyChats.filter((chatName) => unmutedSet.has(chatName)),
        unreadChats: drone.unreadChats?.filter((chatName) => unmutedSet.has(chatName)),
        approvalChats: unmutedApprovalChats,
        approvalRequired:
          drone.approvalRequired &&
          (drone.approvalChats ? unmutedApprovalChats.length > 0 : unmutedChats.length > 0),
      }, selected ? activeChatName : '');
    },
    [activeChatName, drone, muteContext, muted, selected],
  );
  const stateLabel = muted
    ? 'Muted'
    : isDraft
    ? 'Draft'
    : unread && displayState === 'idle'
      ? 'Unread'
      : switchStateLabel(displayState);
  const previousDisplayStateRef = React.useRef<SwitchDisplayState>(displayState);
  const [recentlyBlocked, setRecentlyBlocked] = React.useState(false);
  React.useEffect(() => {
    const previousDisplayState = previousDisplayStateRef.current;
    previousDisplayStateRef.current = displayState;
    if (displayState !== 'blocked') {
      setRecentlyBlocked(false);
      return;
    }
    if (previousDisplayState === 'blocked') return;
    setRecentlyBlocked(true);
    const timeoutId = setTimeout(() => setRecentlyBlocked(false), RECENT_BLOCKED_EMPHASIS_MS);
    return () => clearTimeout(timeoutId);
  }, [displayState]);
  const runtime = drone.runtime.trim().toLowerCase() === 'host' ? 'host' : 'container';
  const accessibilityLabel = [
    isChatDisclosure
      ? `${chatSectionExpanded ? 'Collapse' : 'Expand'} ${drone.name} chats`
      : `Open ${drone.name} chat`,
    stateLabel,
    unread && stateLabel !== 'Unread' ? 'unread chat' : '',
    `${runtime} runtime`,
    contextLabel ? `${contextLabel} repository` : '',
    chats.length > 1 ? `${chats.length} chats` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const dragScope = pinnedDroneIds ? `pinned-drones` : `tree:${parentId}`;
  const dragItemId = pinnedDroneIds ? drone.id : sidebarDroneNodeId(drone.id);
  const reorderDrone = React.useCallback(
    (
      overNodeId: string,
      placement: 'before' | 'inside' | 'after',
      target?: MobileSidebarDragTargetData,
    ) => {
      if (!reorderSidebar) return;
      if (pinnedDroneIds) {
        if (placement === 'inside') return;
        reorderSidebar({
          kind: 'pinned-drone',
          visibleDroneIds: pinnedDroneIds,
          activeDroneId: drone.id,
          overDroneId: overNodeId,
          placement,
        });
        return;
      }
      if (placement === 'inside' && target?.folderPath) {
        const insertAtStart = target.insidePosition === 'start';
        const firstChildNodeId = firstMobileSidebarInsertionTarget(
          target.childItemIds,
          dragItemId,
        );
        reorderSidebar({
          kind: 'move-into-folder',
          itemKind: 'drone',
          repoPath: repoPath ?? drone.repoPath,
          droneId: drone.id,
          sourceParentId: parentId,
          sourceSiblingNodeIds: siblingNodeIds,
          targetGroup: target.folderPath,
          targetParentId: overNodeId,
          targetSiblingNodeIds: target.childItemIds ?? [],
          targetOverNodeId: insertAtStart ? firstChildNodeId : undefined,
          placement: insertAtStart ? 'before' : placement,
        });
        return;
      }
      if (placement === 'inside') return;
      if (target?.parentId && target.parentId !== parentId) {
        reorderSidebar({
          kind: 'move-into-folder',
          itemKind: 'drone',
          repoPath: repoPath ?? drone.repoPath,
          droneId: drone.id,
          sourceParentId: parentId,
          sourceSiblingNodeIds: siblingNodeIds,
          targetGroup: target.parentGroupPath ?? null,
          targetParentId: target.parentId,
          targetSiblingNodeIds: target.siblingItemIds ?? [],
          targetOverNodeId: overNodeId,
          placement,
        });
        return;
      }
      reorderSidebar({
        kind: 'tree-entry',
        parentId,
        siblingNodeIds,
        activeNodeId: dragItemId,
        overNodeId,
        placement,
      });
    },
    [
      dragItemId,
      drone.id,
      drone.repoPath,
      parentId,
      pinnedDroneIds,
      reorderSidebar,
      repoPath,
      siblingNodeIds,
    ],
  );
  const moveDrone = React.useCallback(
    (direction: 'up' | 'down') => {
      const index = siblingNodeIds.indexOf(dragItemId);
      const overNodeId = siblingNodeIds[index + (direction === 'up' ? -1 : 1)];
      if (!overNodeId) return;
      reorderDrone(overNodeId, direction === 'up' ? 'before' : 'after');
    },
    [dragItemId, reorderDrone, siblingNodeIds],
  );
  return (
    <View style={styles.droneNode}>
      <MobileSidebarDragTarget
        scope={dragScope}
        treeScope={treeScope}
        itemId={dragItemId}
        data={
          pinnedDroneIds
            ? undefined
            : {
                parentId,
                parentGroupPath: parentGroupPath ?? null,
                siblingItemIds: siblingNodeIds,
              }
        }
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            selected: parentSelected,
            disabled: Boolean(operation),
            expanded: isChatDisclosure ? chatSectionExpanded : undefined,
          }}
          accessibilityLabel={accessibilityLabel}
          disabled={Boolean(operation)}
          delayLongPress={600}
          onLongPress={() => {
            if (!muteContext?.openActions || operation) return;
            suppressPressAfterLongPressRef.current = true;
            muteContext.openActions({ kind: 'drone', drone });
          }}
          onPressOut={() => {
            if (!suppressPressAfterLongPressRef.current) return;
            setTimeout(() => {
              suppressPressAfterLongPressRef.current = false;
            }, 0);
          }}
          onPress={() => {
            if (suppressPressAfterLongPressRef.current) {
              suppressPressAfterLongPressRef.current = false;
              return;
            }
            if (isChatDisclosure) {
              onSelectContainer(drone.id);
              onSelect(drone.id, selectedChat);
              onToggleDrone(drone.id);
              return;
            }
            onSelect(drone.id, selectedChat);
          }}
          style={({ pressed }) => [
            styles.switchItemRow,
            { paddingLeft: drawerTreeRowPaddingLeft(depth), paddingRight: 6 },
            companionHighlighted && styles.switchItemRowCompanionHighlighted,
            parentSelected && styles.switchItemRowActive,
            pressed && !parentSelected && styles.sidebarRowPressed,
          ]}
        >
          {parentSelected ? <View style={styles.sidebarSelectionEdge} /> : null}
          <View style={styles.switchItemMain}>
            {isChatDisclosure && !muted ? (
              <View accessible={false} style={styles.droneChevronSlot}>
                <SidebarTreeChevronIcon
                  color={colors.sidebarMutedDim}
                  size={16}
                  strokeWidth={1.25}
                  expanded={chatSectionExpanded}
                  style={styles.droneChevron}
                />
              </View>
            ) : null}
            {isChatDisclosure ? (
              <View accessible={false} style={styles.droneRuntimeIconSlot}>
                <RuntimeIcon runtime={runtime} size={14} />
              </View>
            ) : null}
            {muted ? (
              <MutedStatusIndicator />
            ) : isChatDisclosure ? null : isDraft ? (
              <View accessible={false} style={styles.switchItemStatus} />
            ) : (
              <SwitchItemStatusIndicator
                state={displayState}
                unread={unread}
                emphasized={recentlyBlocked || selected}
              />
            )}
            {reorderSidebar && (siblingNodeIds.length > 1 || Boolean(treeScope)) ? (
              <MobileSidebarDragArea
                scope={dragScope}
                treeScope={treeScope}
                itemId={dragItemId}
                label={`${drone.name} drone`}
                disabled={Boolean(operation)}
                onDrop={reorderDrone}
                onMoveAccessibility={moveDrone}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.switchItemTitle,
                    styles.draggableRowLabel,
                    parentSelected && styles.switchItemTitleActive,
                  ]}
                >
                  {drone.name}
                </Text>
              </MobileSidebarDragArea>
            ) : (
              <Text
                numberOfLines={1}
                style={[styles.switchItemTitle, parentSelected && styles.switchItemTitleActive]}
              >
                {drone.name}
              </Text>
            )}
            {isDraft ? (
              <Text accessibilityLabel="Draft drone" style={styles.switchItemDraftBadge}>
                Draft
              </Text>
            ) : null}
            {!muted && hasMultipleChats && contextLabel ? (
              <DroneStateCounts summary={chatStateSummary} compact entity="chat" />
            ) : null}
            {contextLabel ? (
              <Text numberOfLines={1} style={styles.switchItemContextBadge}>
                {contextLabel}
              </Text>
            ) : null}
            {!muted && hasMultipleChats && !contextLabel ? (
              <DroneStateCounts summary={chatStateSummary} compact entity="chat" />
            ) : null}
          </View>
        </Pressable>
      </MobileSidebarDragTarget>
      {showChats && hasMultipleChats ? (
        chatSectionExpanded ? (
          <View
            style={[
              styles.droneChatRail,
              { marginLeft: drawerTreeRowPaddingLeft(depth) + 8 },
              hasActiveChildChat && styles.droneChatRailVisible,
            ]}
          >
            {chatTree.rootChildIds.map((childId) => (
              <DrawerDroneChatTreeEntry
                key={childId}
                drone={drone}
                node={chatTree.nodesById[childId]!}
                tree={chatTree}
                allChatNames={chats}
                orderedChatNodeIds={orderedChatNodeIds}
                depth={0}
                activeDroneId={activeDroneId}
                activeChatName={activeChatName}
                selectionWashInset={drawerTreeRowPaddingLeft(depth) + 8}
                onOpenChatActions={operation ? undefined : onOpenChatActions}
                onSelect={onSelect}
              />
            ))}
          </View>
        ) : null
      ) : null}
      {node.children.length > 0 ? (
        <View style={styles.droneChildren}>
          <View
            pointerEvents="none"
            style={[styles.groupChildrenGuide, { left: drawerTreeRowPaddingLeft(depth) + 8 }]}
          />
          {node.children.map((child) => (
            <DrawerDroneNode
              key={child.drone.id}
              node={child}
              depth={depth + 1}
              parentId={sidebarDroneNodeId(drone.id)}
              siblingNodeIds={node.children.map((entry) => sidebarDroneNodeId(entry.drone.id))}
              treeScope={treeScope}
              repoPath={repoPath}
              parentGroupPath={parentGroupPath}
              sidebarChatOrderByDrone={sidebarChatOrderByDrone}
              collapsedDroneIds={collapsedDroneIds}
              selectedContainerDroneId={selectedContainerDroneId}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              droneOperationById={droneOperationById}
              onToggleDrone={onToggleDrone}
              onSelectContainer={onSelectContainer}
              onOpenChatActions={onOpenChatActions}
              onSelect={onSelect}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DrawerDroneFolder({
  folder,
  depth,
  parentId,
  siblingNodeIds,
  treeScope,
  repoPath,
  parentGroupPath,
  expandedFolderIds,
  collapsedDroneIds,
  selectedContainerDroneId,
  sidebarChatOrderByDrone,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleFolder,
  onToggleDrone,
  onSelectContainer,
  onOpenChatActions,
  onSelect,
}: {
  folder: MobileDroneGroupFolder;
  depth: number;
  parentId: string;
  siblingNodeIds: string[];
  treeScope: string;
  repoPath: string;
  parentGroupPath: string | null;
  expandedFolderIds: ReadonlySet<string>;
  collapsedDroneIds: ReadonlySet<string>;
  selectedContainerDroneId: string;
  sidebarChatOrderByDrone: Record<string, string[]>;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onToggleFolder(folderId: string): void;
  onToggleDrone(droneId: string): void;
  onSelectContainer(droneId: string): void;
  onOpenChatActions?(target: DrawerChatActionTarget): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  const reorderSidebar = React.useContext(DrawerSidebarReorderContext);
  const muteContext = React.useContext(DrawerSidebarMuteContext);
  const suppressPressAfterLongPressRef = React.useRef(false);
  const collapsed = !expandedFolderIds.has(folder.id);
  const muted = Boolean(muteContext?.effectiveGroupIds.has(sidebarFolderNodeId(folder.id)));
  const hasSelectedDirectDrone = folder.roots.some((node) => node.drone.id === activeDroneId);
  const stateSummary = React.useMemo(
    () => summarizeDroneScope(
      folder.roots,
      folder.children,
      muteContext?.effectiveDroneIds,
      muteContext?.mutedChatIds,
    ),
    [folder.children, folder.roots, muteContext],
  );
  const nodeId = sidebarFolderNodeId(folder.id);
  const childNodeIds = folder.entries.map(mobileSidebarEntryNodeId);
  const dragScope = `tree:${parentId}`;
  const moveFolder = React.useCallback(
    (
      overNodeId: string,
      placement: 'before' | 'inside' | 'after',
      target?: MobileSidebarDragTargetData,
    ) => {
      if (!reorderSidebar) return;
      if (placement === 'inside' && target?.folderPath) {
        const insertAtStart = target.insidePosition === 'start';
        const firstChildNodeId = firstMobileSidebarInsertionTarget(
          target.childItemIds,
          nodeId,
        );
        reorderSidebar({
          kind: 'move-into-folder',
          itemKind: 'folder',
          repoPath,
          sourceGroup: folder.path,
          sourceNodeId: nodeId,
          sourceParentId: parentId,
          sourceSiblingNodeIds: siblingNodeIds,
          targetGroup: target.folderPath,
          targetParentId: overNodeId,
          targetSiblingNodeIds: target.childItemIds ?? [],
          targetOverNodeId: insertAtStart ? firstChildNodeId : undefined,
          placement: insertAtStart ? 'before' : placement,
        });
        return;
      }
      if (placement === 'inside') return;
      if (target?.parentId && target.parentId !== parentId) {
        reorderSidebar({
          kind: 'move-into-folder',
          itemKind: 'folder',
          repoPath,
          sourceGroup: folder.path,
          sourceNodeId: nodeId,
          sourceParentId: parentId,
          sourceSiblingNodeIds: siblingNodeIds,
          targetGroup: target.parentGroupPath ?? null,
          targetParentId: target.parentId,
          targetSiblingNodeIds: target.siblingItemIds ?? [],
          targetOverNodeId: overNodeId,
          placement,
        });
        return;
      }
      reorderSidebar({
        kind: 'tree-entry',
        parentId,
        siblingNodeIds,
        activeNodeId: nodeId,
        overNodeId,
        placement,
      });
    },
    [folder.path, nodeId, parentId, repoPath, reorderSidebar, siblingNodeIds],
  );
  const moveFolderAccessibility = React.useCallback(
    (direction: 'up' | 'down') => {
      const index = siblingNodeIds.indexOf(nodeId);
      const overNodeId = siblingNodeIds[index + (direction === 'up' ? -1 : 1)];
      if (!overNodeId) return;
      moveFolder(overNodeId, direction === 'up' ? 'before' : 'after');
    },
    [moveFolder, nodeId, siblingNodeIds],
  );
  return (
    <View>
      <MobileSidebarDragTarget
        scope={dragScope}
        treeScope={treeScope}
        itemId={nodeId}
        data={{
          parentId,
          parentGroupPath,
          siblingItemIds: siblingNodeIds,
          childItemIds: childNodeIds,
          folderPath: folder.path,
        }}
        canDropInside={(activeItemId) => {
          if (!activeItemId.startsWith('folder:')) return true;
          return nodeId !== activeItemId && !nodeId.startsWith(`${activeItemId}/`);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={`${folder.label} group${muted ? ', muted' : ''}`}
          delayLongPress={600}
          onLongPress={() => {
            if (!muteContext?.openActions) return;
            suppressPressAfterLongPressRef.current = true;
            muteContext.openActions({ kind: 'group', folder });
          }}
          onPressOut={() => {
            if (!suppressPressAfterLongPressRef.current) return;
            setTimeout(() => {
              suppressPressAfterLongPressRef.current = false;
            }, 0);
          }}
          onPress={() => {
            if (suppressPressAfterLongPressRef.current) {
              suppressPressAfterLongPressRef.current = false;
              return;
            }
            onToggleFolder(folder.id);
          }}
          style={({ pressed }) => [
            styles.groupRow,
            { paddingLeft: drawerTreeRowPaddingLeft(depth) },
            pressed && styles.sidebarRowPressed,
          ]}
        >
          <View style={styles.folderChevronSlot}>
            <SidebarTreeChevronIcon
              color={colors.sidebarMutedDim}
              size={16}
              strokeWidth={1.25}
              expanded={!collapsed}
              style={styles.folderChevron}
            />
          </View>
          {reorderSidebar ? (
            <MobileSidebarDragArea
              scope={dragScope}
              treeScope={treeScope}
              itemId={nodeId}
              label={`${folder.label} group`}
              onDrop={moveFolder}
              onMoveAccessibility={moveFolderAccessibility}
            >
              <Text numberOfLines={1} style={[styles.groupName, styles.draggableRowLabel]}>
                {folder.label}
              </Text>
            </MobileSidebarDragArea>
          ) : (
            <Text numberOfLines={1} style={styles.groupName}>
              {folder.label}
            </Text>
          )}
          {muted ? <MutedStatusIndicator /> : collapsed ? <DroneStateCounts summary={stateSummary} compact /> : null}
        </Pressable>
      </MobileSidebarDragTarget>
      {!collapsed ? (
        <View style={styles.groupChildren}>
          {hasSelectedDirectDrone ? (
            <View
              pointerEvents="none"
              style={[styles.groupChildrenGuide, { left: drawerTreeRowPaddingLeft(depth) + 8 }]}
            />
          ) : null}
          {folder.entries.map((entry) => (
            <DrawerDroneEntry
              key={
                entry.kind === 'drone'
                  ? `drone:${entry.node.drone.id}`
                  : `folder:${entry.folder.id}`
              }
              entry={entry}
              depth={depth + 1}
              parentId={sidebarFolderNodeId(folder.id)}
              siblingNodeIds={childNodeIds}
              treeScope={treeScope}
              repoPath={repoPath}
              parentGroupPath={folder.path}
              expandedFolderIds={expandedFolderIds}
              collapsedDroneIds={collapsedDroneIds}
              selectedContainerDroneId={selectedContainerDroneId}
              sidebarChatOrderByDrone={sidebarChatOrderByDrone}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              droneOperationById={droneOperationById}
              onToggleFolder={onToggleFolder}
              onToggleDrone={onToggleDrone}
              onSelectContainer={onSelectContainer}
              onOpenChatActions={onOpenChatActions}
              onSelect={onSelect}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DrawerDroneEntry({
  entry,
  depth,
  parentId,
  siblingNodeIds,
  treeScope,
  repoPath,
  parentGroupPath,
  expandedFolderIds,
  collapsedDroneIds,
  selectedContainerDroneId,
  sidebarChatOrderByDrone,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleFolder,
  onToggleDrone,
  onSelectContainer,
  onOpenChatActions,
  onSelect,
}: {
  entry: MobileDroneSidebarEntry;
  depth: number;
  parentId: string;
  siblingNodeIds: string[];
  treeScope: string;
  repoPath: string;
  parentGroupPath: string | null;
  expandedFolderIds: ReadonlySet<string>;
  collapsedDroneIds: ReadonlySet<string>;
  selectedContainerDroneId: string;
  sidebarChatOrderByDrone: Record<string, string[]>;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onToggleFolder(folderId: string): void;
  onToggleDrone(droneId: string): void;
  onSelectContainer(droneId: string): void;
  onOpenChatActions?(target: DrawerChatActionTarget): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  return entry.kind === 'drone' ? (
    <DrawerDroneNode
      node={entry.node}
      depth={depth}
      parentId={parentId}
      siblingNodeIds={siblingNodeIds}
      treeScope={treeScope}
      repoPath={repoPath}
      parentGroupPath={parentGroupPath}
      sidebarChatOrderByDrone={sidebarChatOrderByDrone}
      collapsedDroneIds={collapsedDroneIds}
      selectedContainerDroneId={selectedContainerDroneId}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onToggleDrone={onToggleDrone}
      onSelectContainer={onSelectContainer}
      onOpenChatActions={onOpenChatActions}
      onSelect={onSelect}
    />
  ) : (
    <DrawerDroneFolder
      folder={entry.folder}
      depth={depth}
      parentId={parentId}
      siblingNodeIds={siblingNodeIds}
      treeScope={treeScope}
      repoPath={repoPath}
      parentGroupPath={parentGroupPath}
      expandedFolderIds={expandedFolderIds}
      collapsedDroneIds={collapsedDroneIds}
      selectedContainerDroneId={selectedContainerDroneId}
      sidebarChatOrderByDrone={sidebarChatOrderByDrone}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onToggleFolder={onToggleFolder}
      onToggleDrone={onToggleDrone}
      onSelectContainer={onSelectContainer}
      onOpenChatActions={onOpenChatActions}
      onSelect={onSelect}
    />
  );
}

function DrawerPinnedDrones({
  drones,
  placement,
  collapsed,
  separateFromRepositoryList,
  repoLabelByPath,
  sidebarChatOrderByDrone,
  collapsedDroneIds,
  selectedContainerDroneId,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleDrone,
  onSelectContainer,
  onOpenChatActions,
  onSelect,
  onToggleCollapsed,
  onTogglePlacement,
}: {
  drones: MobileDroneSummary[];
  placement: PinnedSidebarPlacement;
  collapsed: boolean;
  separateFromRepositoryList: boolean;
  repoLabelByPath: ReadonlyMap<string, string>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  collapsedDroneIds: ReadonlySet<string>;
  selectedContainerDroneId: string;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onToggleDrone(droneId: string): void;
  onSelectContainer(droneId: string): void;
  onOpenChatActions?(target: DrawerChatActionTarget): void;
  onSelect(droneId: string, chatName: string): void;
  onToggleCollapsed(): void;
  onTogglePlacement(): void;
}) {
  if (drones.length === 0) return null;
  return (
    <View
      style={[
        styles.pinnedSection,
        placement === 'top' && separateFromRepositoryList && styles.pinnedSectionTop,
        placement === 'bottom' && styles.pinnedSectionBottom,
      ]}
      accessibilityLabel="Pinned drones"
    >
      <View style={styles.pinnedHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand pinned drones' : 'Collapse pinned drones'}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggleCollapsed}
          style={({ pressed }) => [styles.pinnedHeaderToggle, pressed && styles.sidebarRowPressed]}
        >
          <SidebarPinIcon
            color={colors.sidebarMutedDim}
            size={14}
            strokeWidth={1.7}
            style={styles.pinnedHeaderIcon}
          />
          <Text style={styles.pinnedHeaderText}>Pinned</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            placement === 'top' ? 'Move pinned drones to bottom' : 'Move pinned drones to top'
          }
          accessibilityState={{ selected: placement === 'bottom' }}
          onPress={onTogglePlacement}
          style={({ pressed }) => [
            styles.pinnedPlacementToggle,
            pressed && styles.sidebarRowPressed,
          ]}
        >
          {placement === 'top' ? (
            <SidebarChevronIcon
              color={colors.sidebarMutedDim}
              size={14}
              strokeWidth={2}
              direction="down"
            />
          ) : (
            <SidebarChevronIcon
              color={colors.sidebarMutedDim}
              size={14}
              strokeWidth={2}
              direction="up"
            />
          )}
        </Pressable>
      </View>
      {!collapsed
        ? drones.map((drone) => (
            <DrawerDroneNode
              key={`pinned:${drone.id}`}
              node={{ drone, children: [] }}
              depth={0}
              parentId="pinned"
              siblingNodeIds={drones.map((item) => item.id)}
              pinnedDroneIds={drones.map((item) => item.id)}
              contextLabel={repoLabelByPath.get(drone.repoPath) ?? 'Ungrouped'}
              sidebarChatOrderByDrone={sidebarChatOrderByDrone}
              collapsedDroneIds={collapsedDroneIds}
              selectedContainerDroneId={selectedContainerDroneId}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              droneOperationById={droneOperationById}
              onToggleDrone={onToggleDrone}
              onSelectContainer={onSelectContainer}
              onOpenChatActions={onOpenChatActions}
              onSelect={onSelect}
            />
          ))
        : null}
    </View>
  );
}

export function AppDrawer(props: AppDrawerProps) {
  const registerDrawer = React.useContext(AppDrawerHostContext);

  React.useLayoutEffect(() => {
    registerDrawer?.(props);
  }, [props, registerDrawer]);

  React.useLayoutEffect(
    () => () => {
      registerDrawer?.(null);
    },
    [registerDrawer],
  );

  if (registerDrawer) return null;
  return <AppDrawerView {...props} />;
}

function DrawerVoiceRecordingIndicator() {
  const companion = useMobileCompanion();
  const { error, session, discardRecording, stopRecordingForTranscript } =
    useSharedMobileChatVoiceRecorder();
  const status = session.kind === 'single-shot' ? session.status : ('idle' as const);
  const durationMillis = session.kind === 'single-shot' ? session.durationMillis : 0;
  const [copying, setCopying] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');
  const actionTokenRef = React.useRef(0);
  const recorderErrorRef = React.useRef(error);
  recorderErrorRef.current = error;
  const canStop = status === 'recording' || status === 'paused' || status === 'stopped';
  const visible = status !== 'idle' || copying || Boolean(error) || Boolean(copyError);
  const statusText =
    error ||
    copyError ||
    (copying && status === 'idle' ? 'Copying…' : mobileVoiceStatusLabel(status));
  const durationText = formatMobileVoiceDuration(durationMillis);

  React.useEffect(() => {
    if (status !== 'starting') return;
    actionTokenRef.current += 1;
    setCopying(false);
    setCopyError('');
  }, [status]);

  React.useEffect(
    () => () => {
      actionTokenRef.current += 1;
    },
    [],
  );

  const cancel = React.useCallback(() => {
    actionTokenRef.current += 1;
    setCopying(false);
    setCopyError('');
    void discardRecording('single-shot');
  }, [discardRecording]);

  const stopAndCopy = React.useCallback(async () => {
    if (!canStop || copying) return;
    const actionToken = actionTokenRef.current + 1;
    actionTokenRef.current = actionToken;
    setCopying(true);
    setCopyError('');
    try {
      const transcript = (await stopRecordingForTranscript('single-shot')).trim();
      if (actionTokenRef.current !== actionToken) return;
      if (!transcript) {
        if (!recorderErrorRef.current) setCopyError('No speech detected.');
        return;
      }
      await Clipboard.setStringAsync(transcript);
      if (actionTokenRef.current !== actionToken) return;
      if (Number(Platform.Version) < 33) {
        ToastAndroid.show('Transcription copied to clipboard.', ToastAndroid.SHORT);
      }
    } catch (nextError: any) {
      if (actionTokenRef.current !== actionToken) return;
      setCopyError(
        String(
          nextError?.message ??
            nextError ??
            'Transcription finished, but it could not be copied to the clipboard.',
        ),
      );
    } finally {
      if (actionTokenRef.current === actionToken) setCopying(false);
    }
  }, [canStop, copying, stopRecordingForTranscript]);

  if (!visible || session.kind === 'companion' || companion.status !== 'idle') return null;
  return (
    <View style={styles.voiceFooter}>
      <View style={styles.voiceFooterStatus}>
        <View
          style={[
            styles.voiceFooterDot,
            status === 'paused' && styles.voiceFooterDotPaused,
            status === 'transcribing' && styles.voiceFooterDotTranscribing,
            Boolean(error || copyError) && styles.voiceFooterDotError,
          ]}
        />
        <View style={styles.voiceFooterCopy}>
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={2}
            style={[
              styles.voiceFooterLabel,
              Boolean(error || copyError) && styles.voiceFooterLabelError,
            ]}
          >
            {statusText}
          </Text>
          {status !== 'idle' ? (
            <Text accessibilityLabel={`${durationText} elapsed`} style={styles.voiceFooterTimer}>
              {durationText}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.voiceFooterActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel voice recording"
          onPress={cancel}
          style={({ pressed }) => [
            styles.voiceFooterButton,
            styles.voiceFooterCancel,
            pressed && styles.pressed,
          ]}
        >
          <X color={colors.danger} size={15} strokeWidth={2.3} />
          <Text style={[styles.voiceFooterButtonText, styles.voiceFooterCancelText]}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop recording and copy transcription"
          accessibilityState={{ disabled: !canStop || copying }}
          disabled={!canStop || copying}
          onPress={() => void stopAndCopy()}
          style={({ pressed }) => [
            styles.voiceFooterButton,
            styles.voiceFooterStop,
            (!canStop || copying) && styles.voiceFooterButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {status === 'transcribing' || copying ? (
            <ActivityIndicator color={colors.online} size="small" />
          ) : (
            <Square color={colors.online} size={14} strokeWidth={2.3} />
          )}
          <Text style={[styles.voiceFooterButtonText, styles.voiceFooterStopText]}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DrawerCompanionButton({ onClose }: { onClose(): void }) {
  const companion = useMobileCompanion();
  const busy =
    companion.status === 'starting' ||
    companion.status === 'transcribing';
  return (
    <View style={styles.companionFooter}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          companion.available ? 'Toggle Companion microphone' : companion.unavailableReason
        }
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => {
          onClose();
          void companion.toggle();
        }}
        style={({ pressed }) => [
          styles.companionButton,
          companion.status === 'recording' && styles.companionButtonRecording,
          !companion.available && styles.companionButtonUnavailable,
          busy && styles.companionButtonDisabled,
          pressed && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <Mic
            color={companion.status === 'recording' ? colors.online : colors.sidebarActionFg}
            size={18}
            strokeWidth={2.1}
          />
        )}
        <Text
          style={[
            styles.companionButtonText,
            companion.status === 'recording' && styles.companionButtonTextRecording,
          ]}
        >
          {companion.status === 'recording' ? 'Listening' : 'Companion'}
        </Text>
      </Pressable>
    </View>
  );
}

function AppDrawerView({
  open,
  navigationItems,
  showDrones = false,
  drones = [],
  droneSidebarOrder = EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  activeDroneId = '',
  activeChatName = 'default',
  companionHighlightedDroneIds = [],
  droneOperationById = {},
  dronesLoading = false,
  dronesReachable = true,
  dronesError = null,
  devicePickerItems = [],
  activeDeviceId = '',
  onCreateDrone,
  onRetryDrones,
  onSelectDroneChat,
  onCreateDroneChat,
  onRenameDroneChat,
  onDeleteDroneChat,
  onReorderSidebar,
  onSelectDevice,
  onClose,
}: AppDrawerProps) {
  const insets = useSafeAreaInsets();
  const [pinnedSidebarPlacement, setPinnedSidebarPlacement] =
    React.useState<PinnedSidebarPlacement>('bottom');
  const [pinnedSidebarCollapsed, setPinnedSidebarCollapsed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PINNED_SIDEBAR_PLACEMENT_KEY)
      .then((stored) => {
        if (active && (stored === 'top' || stored === 'bottom')) {
          setPinnedSidebarPlacement(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  React.useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(PINNED_SIDEBAR_COLLAPSED_KEY)
      .then((stored) => {
        if (active) setPinnedSidebarCollapsed(stored === 'true');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const togglePinnedSidebarPlacement = React.useCallback(() => {
    setPinnedSidebarPlacement((current) => {
      const next = current === 'top' ? 'bottom' : 'top';
      void AsyncStorage.setItem(PINNED_SIDEBAR_PLACEMENT_KEY, next).catch(() => undefined);
      return next;
    });
  }, []);
  const togglePinnedSidebarCollapsed = React.useCallback(() => {
    setPinnedSidebarCollapsed((current) => {
      const next = !current;
      void AsyncStorage.setItem(PINNED_SIDEBAR_COLLAPSED_KEY, next ? 'true' : 'false').catch(
        () => undefined,
      );
      return next;
    });
  }, []);
  const workingPhase = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!open) return;
    workingPhase.setValue(0);
    const animation = Animated.loop(
      Animated.timing(workingPhase, {
        toValue: 1,
        duration: DRAWER_WORKING_SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [open, workingPhase]);
  const droneGroups = React.useMemo(
    () => buildMobileDroneRepoGroups(drones, droneSidebarOrder),
    [droneSidebarOrder, drones],
  );
  const mutedSidebarGroupIdSet = React.useMemo(
    () => new Set(droneSidebarOrder.mutedSidebarGroupIds),
    [droneSidebarOrder.mutedSidebarGroupIds],
  );
  const mutedDroneIdSet = React.useMemo(
    () => new Set(droneSidebarOrder.mutedDroneIds),
    [droneSidebarOrder.mutedDroneIds],
  );
  const mutedChatIdSet = React.useMemo(
    () => new Set(droneSidebarOrder.mutedChatIds),
    [droneSidebarOrder.mutedChatIds],
  );
  const { effectiveMutedGroupIds, effectiveMutedDroneIds } = React.useMemo(() => {
    const effectiveGroups = new Set<string>();
    const effectiveDrones = new Set(mutedDroneIdSet);
    const visitDrone = (node: MobileDroneTreeNode, inheritedMuted: boolean) => {
      const muted = inheritedMuted || effectiveDrones.has(node.drone.id);
      if (muted) effectiveDrones.add(node.drone.id);
      for (const child of node.children) visitDrone(child, muted);
    };
    const visitFolder = (folder: MobileDroneGroupFolder, inheritedMuted: boolean) => {
      const folderId = sidebarFolderNodeId(folder.id);
      const muted = inheritedMuted || mutedSidebarGroupIdSet.has(folder.muteId);
      if (muted) effectiveGroups.add(folderId);
      for (const root of folder.roots) visitDrone(root, muted);
      for (const child of folder.children) visitFolder(child, muted);
    };
    for (const group of droneGroups) {
      for (const root of group.roots) visitDrone(root, false);
      for (const folder of group.folders) visitFolder(folder, false);
    }
    return { effectiveMutedGroupIds: effectiveGroups, effectiveMutedDroneIds: effectiveDrones };
  }, [droneGroups, mutedDroneIdSet, mutedSidebarGroupIdSet]);
  const repoStateSummaries = React.useMemo(
    () =>
      new Map(
        droneGroups.map((group) => [
          group.id,
          summarizeDroneScope(
            group.roots,
            group.folders,
            effectiveMutedDroneIds,
            mutedChatIdSet,
          ),
        ]),
      ),
    [droneGroups, effectiveMutedDroneIds, mutedChatIdSet],
  );
  const [activeRepoId, setActiveRepoId] = React.useState<string | null>(null);
  const alignedActiveDroneSelectionKeyRef = React.useRef<string | null>(null);
  const {
    expandedFolderIds,
    toggleFolder,
    rewriteFolderPrefix,
    removeFolderPrefix,
  } = useMobileSidebarExpandedFolderIds();
  const { collapsedDroneIds, toggleDrone } = useMobileSidebarCollapsedDroneIds();
  const [selectedContainerDroneId, setSelectedContainerDroneId] = React.useState('');
  const [chatActionTarget, setChatActionTarget] = React.useState<DrawerChatActionTarget | null>(
    null,
  );
  const [chatGroupActionTarget, setChatGroupActionTarget] = React.useState<DrawerChatGroupActionTarget | null>(null);
  const [selectedChatNodeIds, setSelectedChatNodeIds] = React.useState<Set<string>>(new Set());
  const [chatGroupEditor, setChatGroupEditor] = React.useState<{
    mode: 'create' | 'rename';
    drone: MobileDroneSummary;
    parentPath: string | null;
    path: string | null;
    value: string;
  } | null>(null);
  const [muteActionTarget, setMuteActionTarget] = React.useState<DrawerMuteActionTarget | null>(null);
  const [chatEditor, setChatEditor] = React.useState<{
    mode: 'create' | 'rename';
    target: DrawerChatActionTarget;
    value: string;
    groupPath?: string | null;
  } | null>(null);
  const [deleteChatTarget, setDeleteChatTarget] = React.useState<DrawerChatActionTarget | null>(
    null,
  );
  const [chatMutationBusy, setChatMutationBusy] = React.useState(false);
  const [chatMutationError, setChatMutationError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setSelectedContainerDroneId('');
  }, [activeChatName, activeDeviceId, activeDroneId]);
  React.useEffect(() => {
    setChatActionTarget(null);
    setChatEditor(null);
    setDeleteChatTarget(null);
    setChatMutationError(null);
    setMuteActionTarget(null);
    setChatGroupActionTarget(null);
    setChatGroupEditor(null);
    setSelectedChatNodeIds(new Set());
  }, [activeDeviceId]);
  React.useEffect(() => {
    if (open || chatMutationBusy) return;
    setChatActionTarget(null);
    setChatEditor(null);
    setDeleteChatTarget(null);
    setChatMutationError(null);
    setChatGroupActionTarget(null);
    setChatGroupEditor(null);
    setMuteActionTarget(null);
    setSelectedChatNodeIds(new Set());
  }, [chatMutationBusy, open]);
  React.useEffect(() => {
    const available = new Set(
      drones.flatMap((drone) =>
        orderedMobileDroneChats(
          drone,
          droneSidebarOrder.sidebarChatOrderByDrone[drone.id],
        ).map((chatName) => sidebarChatNodeId(drone.id, chatName))),
    );
    setSelectedChatNodeIds((current) => {
      const next = new Set([...current].filter((nodeId) => available.has(nodeId)));
      return next.size === current.size ? current : next;
    });
  }, [droneSidebarOrder.sidebarChatOrderByDrone, drones]);
  const activeRepo = droneGroups.find((group) => group.id === activeRepoId) ?? null;
  const globalPinnedDrones = React.useMemo(
    () => resolvePinnedSidebarDrones(drones, droneSidebarOrder.pinnedDroneIds),
    [droneSidebarOrder.pinnedDroneIds, drones],
  );
  const repoLabelByPath = React.useMemo(
    () => new Map(droneGroups.map((group) => [group.repoPath, group.label])),
    [droneGroups],
  );
  const companionHighlightSet = React.useMemo(
    () => new Set(companionHighlightedDroneIds),
    [companionHighlightedDroneIds],
  );
  const resolveDroneRepoId = React.useCallback(
    (droneId: string): string | null => {
      const drone = drones.find((item) => item.id === droneId);
      if (!drone) return null;
      return droneGroups.find((group) => group.repoPath === drone.repoPath)?.id ?? null;
    },
    [droneGroups, drones],
  );
  const selectPinnedDroneChat = React.useCallback(
    (droneId: string, chatName: string) => {
      setSelectedContainerDroneId('');
      const repoId = resolveDroneRepoId(droneId);
      if (repoId) setActiveRepoId(repoId);
      onSelectDroneChat?.(droneId, chatName);
    },
    [onSelectDroneChat, resolveDroneRepoId],
  );
  const openChatActions = React.useCallback(
    (target: DrawerChatActionTarget) => {
      if (!dronesReachable || (!onCreateDroneChat && !onRenameDroneChat && !onDeleteDroneChat && !onReorderSidebar))
        return;
      setChatMutationError(null);
      setChatActionTarget(target);
    },
    [dronesReachable, onCreateDroneChat, onDeleteDroneChat, onRenameDroneChat, onReorderSidebar],
  );
  const toggleChatSelection = React.useCallback((droneId: string, chatName: string) => {
    const nodeId = sidebarChatNodeId(droneId, chatName);
    const droneChatNodeIds = new Set(
      (drones.find((drone) => drone.id === droneId)?.chats ?? [])
        .map((name) => sidebarChatNodeId(droneId, name)),
    );
    setSelectedChatNodeIds((current) => {
      const next = new Set([...current].filter((id) => droneChatNodeIds.has(id)));
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, [drones]);
  const chatTreeContextValue = React.useMemo(() => ({
    sidebar: droneSidebarOrder,
    expandedGroupIds: expandedFolderIds,
    selectedChatNodeIds,
    toggleGroup: toggleFolder,
    toggleChatSelection,
    clearChatSelection: () => setSelectedChatNodeIds(new Set()),
    openGroupActions: setChatGroupActionTarget,
  }), [droneSidebarOrder, expandedFolderIds, selectedChatNodeIds, toggleChatSelection, toggleFolder]);
  const submitChatEditor = React.useCallback(async () => {
    if (!chatEditor || chatMutationBusy) return;
    const nextName = chatEditor.value.trim();
    if (!nextName) {
      setChatMutationError('Enter a chat name.');
      return;
    }
    const duplicate = chatEditor.target.drone.chats.some(
      (chatName) =>
        chatName === nextName &&
        (chatEditor.mode === 'create' || chatName !== chatEditor.target.chatName),
    );
    if (duplicate) {
      setChatMutationError(`A chat named “${nextName}” already exists.`);
      return;
    }
    setChatMutationBusy(true);
    setChatMutationError(null);
    try {
      let applied = false;
      if (chatEditor.mode === 'create') {
        applied =
          (await onCreateDroneChat?.(
            chatEditor.target.drone.id,
            nextName,
            chatEditor.target.chatName,
          )) === true;
      } else {
        applied =
          (await onRenameDroneChat?.(
            chatEditor.target.drone.id,
            chatEditor.target.chatName,
            nextName,
          )) === true;
      }
      if (!applied) return;
      const previousNodeId = sidebarChatNodeId(chatEditor.target.drone.id, chatEditor.target.chatName);
      const destinationPath = chatEditor.groupPath !== undefined
        ? chatEditor.groupPath
        : droneSidebarOrder.sidebarChatGroupByChat[previousNodeId] ?? null;
      const nextNodeId = sidebarChatNodeId(chatEditor.target.drone.id, nextName);
      if (previousNodeId !== nextNodeId && onReorderSidebar) {
        const tree = buildSidebarChatTree({
          droneId: chatEditor.target.drone.id,
          chatNames: [...chatEditor.target.drone.chats, nextName],
          groupPaths: droneSidebarOrder.sidebarChatGroupPathsByDrone[chatEditor.target.drone.id] ?? [],
          groupByChat: droneSidebarOrder.sidebarChatGroupByChat,
          nodeOrderByParent: droneSidebarOrder.sidebarChatNodeOrderByParent,
        });
        const targetParentId = destinationPath
          ? sidebarChatGroupNodeId(chatEditor.target.drone.id, destinationPath)
          : tree.rootId;
        onReorderSidebar({
          kind: 'chat-tree-move',
          droneId: chatEditor.target.drone.id,
          itemKind: 'chat',
          activeNodeId: nextNodeId,
          sourcePath: null,
          sourceSiblingNodeIds: [nextNodeId, ...tree.rootChildIds],
          targetPath: destinationPath,
          targetSiblingNodeIds: tree.childIdsByParent[targetParentId] ?? [],
          overNodeId: previousNodeId,
          placement: 'before',
        });
      }
      if (
        chatEditor.mode === 'rename' &&
        previousNodeId !== nextNodeId &&
        onReorderSidebar
      ) {
        onReorderSidebar({
          kind: 'chat-tree-remove',
          droneId: chatEditor.target.drone.id,
          nodeIds: [previousNodeId],
        });
      }
      setSelectedContainerDroneId('');
      onSelectDroneChat?.(chatEditor.target.drone.id, nextName);
      setChatEditor(null);
    } catch (error: any) {
      setChatMutationError(String(error?.message ?? error ?? 'Chat action failed.'));
    } finally {
      setChatMutationBusy(false);
    }
  }, [chatEditor, chatMutationBusy, droneSidebarOrder, onCreateDroneChat, onRenameDroneChat, onReorderSidebar, onSelectDroneChat]);
  const deleteChatPlan = React.useMemo(() => {
    if (!deleteChatTarget) return { chatNames: [], defaultChatKept: false };
    return resolveMobileChatDeletePlan({
      droneId: deleteChatTarget.drone.id,
      chatNames: deleteChatTarget.drone.chats,
      targetChatName: deleteChatTarget.chatName,
      selectedChatNodeIds,
    });
  }, [deleteChatTarget, selectedChatNodeIds]);
  const confirmDeleteChat = React.useCallback(async () => {
    if (!deleteChatTarget || chatMutationBusy || !onDeleteDroneChat) return;
    setChatMutationBusy(true);
    setChatMutationError(null);
    try {
      const failedNames: string[] = [];
      for (const name of deleteChatPlan.chatNames) {
        const deleted = await onDeleteDroneChat(deleteChatTarget.drone.id, name);
        if (deleted && onReorderSidebar) {
          onReorderSidebar({
            kind: 'chat-tree-remove',
            droneId: deleteChatTarget.drone.id,
            nodeIds: [sidebarChatNodeId(deleteChatTarget.drone.id, name)],
          });
        }
        if (!deleted) failedNames.push(name);
      }
      if (failedNames.length) {
        setSelectedChatNodeIds(new Set(failedNames.map((name) =>
          sidebarChatNodeId(deleteChatTarget.drone.id, name))));
        setDeleteChatTarget({ ...deleteChatTarget, chatName: failedNames[0]! });
        setChatMutationError(
          failedNames.length === 1
            ? `Could not delete “${failedNames[0]}”.`
            : `Could not delete ${failedNames.length} chats.`,
        );
        return;
      }
      setSelectedChatNodeIds(new Set());
      setDeleteChatTarget(null);
    } catch (error: any) {
      setChatMutationError(String(error?.message ?? error ?? 'Could not delete chat.'));
    } finally {
      setChatMutationBusy(false);
    }
  }, [chatMutationBusy, deleteChatPlan, deleteChatTarget, onDeleteDroneChat, onReorderSidebar]);
  const chatContextActions = React.useMemo<ContextMenuAction[]>(() => {
    if (!chatActionTarget) return [];
    const actions: ContextMenuAction[] = [];
    const chatNodeId = sidebarChatNodeId(chatActionTarget.drone.id, chatActionTarget.chatName);
    const defaultChatNodeId = sidebarChatNodeId(chatActionTarget.drone.id, 'default');
    const droneChatNodeIds = new Set(chatActionTarget.drone.chats.map((name) =>
      sidebarChatNodeId(chatActionTarget.drone.id, name)));
    const selectedInDrone = selectedChatNodeIds.has(chatNodeId)
      ? [...selectedChatNodeIds].filter((id) => droneChatNodeIds.has(id))
      : [];
    actions.push({
      label: selectedChatNodeIds.has(chatNodeId) ? 'Deselect chat' : 'Select chat',
      onPress: () => toggleChatSelection(chatActionTarget.drone.id, chatActionTarget.chatName),
    });
    if (onReorderSidebar) {
      const targetId = mobileSidebarChatId(chatActionTarget.drone.id, chatActionTarget.chatName);
      const directlyMuted = mutedChatIdSet.has(targetId);
      actions.push({
        label: directlyMuted ? 'Unmute chat' : 'Mute chat',
        onPress: () => onReorderSidebar({
          kind: 'set-muted',
          targetKind: 'chat',
          targetId,
          muted: !directlyMuted,
        }),
      });
    }
    if (onCreateDroneChat) {
      actions.push({
        label: 'Create chat',
        onPress: () => {
          setChatMutationError(null);
          setChatEditor({
            mode: 'create',
            target: chatActionTarget,
            value: suggestNextMobileDroneChatName(chatActionTarget.drone.chats),
          });
        },
      });
    }
    if (onReorderSidebar && chatActionTarget.drone.chats.length > 1) {
      actions.push({
        label: 'Create group',
        onPress: () => setChatGroupEditor({
          mode: 'create',
          drone: chatActionTarget.drone,
          parentPath: droneSidebarOrder.sidebarChatGroupByChat[chatNodeId] ?? null,
          path: null,
          value: '',
        }),
      });
    }
    if (chatActionTarget.chatName !== 'default' && onRenameDroneChat) {
      actions.push({
        label: 'Rename chat',
        onPress: () => {
          setChatMutationError(null);
          setChatEditor({
            mode: 'rename',
            target: chatActionTarget,
            value: chatActionTarget.chatName,
          });
        },
      });
    }
    if ((chatActionTarget.chatName !== 'default' || selectedInDrone.some((id) => id !== defaultChatNodeId)) && onDeleteDroneChat) {
      actions.push({
        label: selectedInDrone.filter((id) => id !== defaultChatNodeId).length > 1
          ? `Delete ${selectedInDrone.filter((id) => id !== defaultChatNodeId).length} selected chats`
          : 'Delete chat',
        destructive: true,
        onPress: () => {
          setChatMutationError(null);
          setDeleteChatTarget(chatActionTarget);
        },
      });
    }
    return actions;
  }, [chatActionTarget, droneSidebarOrder.sidebarChatGroupByChat, mutedChatIdSet, onCreateDroneChat, onDeleteDroneChat, onRenameDroneChat, onReorderSidebar, selectedChatNodeIds, toggleChatSelection]);

  const chatGroupContextActions = React.useMemo<ContextMenuAction[]>(() => {
    if (!chatGroupActionTarget || !onReorderSidebar) return [];
    const { drone, path } = chatGroupActionTarget;
    const actions: ContextMenuAction[] = [];
    if (path && onCreateDroneChat) {
      actions.push({
        label: 'Create chat',
        onPress: () => setChatEditor({
          mode: 'create',
          target: { drone, chatName: drone.chats[0] ?? 'default' },
          value: suggestNextMobileDroneChatName(drone.chats),
          groupPath: path,
        }),
      });
    }
    if (drone.chats.length > 1) {
      actions.push({
        label: 'Create group',
        onPress: () => setChatGroupEditor({ mode: 'create', drone, parentPath: path, path: null, value: '' }),
      });
    }
    if (path) {
      actions.push({
        label: 'Rename group',
        onPress: () => setChatGroupEditor({
          mode: 'rename',
          drone,
          parentPath: sidebarChatGroupParentPath(path),
          path,
          value: sidebarChatGroupBaseName(path),
        }),
      });
      actions.push({
        label: 'Delete group',
        destructive: true,
        onPress: () => {
          onReorderSidebar({ kind: 'chat-group-delete', droneId: drone.id, path });
          removeFolderPrefix(sidebarChatGroupNodeId(drone.id, path));
        },
      });
    }
    return actions;
  }, [chatGroupActionTarget, onCreateDroneChat, onReorderSidebar, removeFolderPrefix]);

  const submitChatGroupEditor = React.useCallback(() => {
    if (!chatGroupEditor || !onReorderSidebar) return;
    const name = normalizeSidebarChatGroupPath(chatGroupEditor.value);
    if (!name || name.includes('/')) {
      setChatMutationError('Enter one group name without slashes.');
      return;
    }
    const nextPath = [chatGroupEditor.parentPath, name].filter(Boolean).join('/');
    const existingTree = buildSidebarChatTree({
      droneId: chatGroupEditor.drone.id,
      chatNames: chatGroupEditor.drone.chats,
      groupPaths: droneSidebarOrder.sidebarChatGroupPathsByDrone[chatGroupEditor.drone.id] ?? [],
      groupByChat: droneSidebarOrder.sidebarChatGroupByChat,
      nodeOrderByParent: droneSidebarOrder.sidebarChatNodeOrderByParent,
    });
    if (chatGroupEditor.mode === 'rename' && nextPath === chatGroupEditor.path) {
      setChatGroupEditor(null);
      setChatMutationError(null);
      return;
    }
    if (existingTree.nodesById[sidebarChatGroupNodeId(chatGroupEditor.drone.id, nextPath)]) {
      setChatMutationError('A group with that name already exists.');
      return;
    }
    onReorderSidebar(chatGroupEditor.mode === 'create'
      ? { kind: 'chat-group-create', droneId: chatGroupEditor.drone.id, path: nextPath }
      : { kind: 'chat-group-rename', droneId: chatGroupEditor.drone.id, path: chatGroupEditor.path!, newPath: nextPath });
    if (chatGroupEditor.mode === 'rename' && chatGroupEditor.path) {
      const oldGroupId = sidebarChatGroupNodeId(chatGroupEditor.drone.id, chatGroupEditor.path);
      rewriteFolderPrefix(
        oldGroupId,
        sidebarChatGroupNodeId(chatGroupEditor.drone.id, nextPath),
      );
    }
    setChatGroupEditor(null);
    setChatMutationError(null);
  }, [chatGroupEditor, droneSidebarOrder, onReorderSidebar, rewriteFolderPrefix]);
  const muteContextActions = React.useMemo<ContextMenuAction[]>(() => {
    if (!muteActionTarget || !onReorderSidebar) return [];
    if (muteActionTarget.kind === 'drone') {
      const targetId = muteActionTarget.drone.id;
      const directlyMuted = mutedDroneIdSet.has(targetId);
      const actions: ContextMenuAction[] = [{
        label: directlyMuted ? 'Unmute drone' : 'Mute drone',
        onPress: () => onReorderSidebar({
          kind: 'set-muted', targetKind: 'drone', targetId, muted: !directlyMuted,
        }),
      }];
      const chats = orderedMobileDroneChats(
        muteActionTarget.drone,
        droneSidebarOrder.sidebarChatOrderByDrone[targetId],
      );
      if (chats.length > 1) {
        actions.push({
          label: 'Create group',
          onPress: () => setChatGroupEditor({
            mode: 'create',
            drone: muteActionTarget.drone,
            parentPath: null,
            path: null,
            value: '',
          }),
        });
      }
      if (chats.length === 1) {
        const chatTargetId = mobileSidebarChatId(targetId, chats[0]!);
        if (mutedChatIdSet.has(chatTargetId)) {
          actions.push({
            label: 'Unmute chat',
            onPress: () => onReorderSidebar({
              kind: 'set-muted',
              targetKind: 'chat',
              targetId: chatTargetId,
              muted: false,
            }),
          });
        }
      }
      return actions;
    }
    if (muteActionTarget.kind === 'group') {
      const targetId = muteActionTarget.folder.muteId;
      const directlyMuted = mutedSidebarGroupIdSet.has(targetId);
      return [{
        label: directlyMuted ? 'Unmute group' : 'Mute group',
        onPress: () => onReorderSidebar({
          kind: 'set-muted', targetKind: 'group', targetId, muted: !directlyMuted,
        }),
      }];
    }
    return [];
  }, [
    droneSidebarOrder.sidebarChatOrderByDrone,
    muteActionTarget,
    mutedChatIdSet,
    mutedDroneIdSet,
    mutedSidebarGroupIdSet,
    onReorderSidebar,
  ]);
  const muteContextValue = React.useMemo(() => ({
    effectiveGroupIds: effectiveMutedGroupIds,
    effectiveDroneIds: effectiveMutedDroneIds,
    mutedChatIds: mutedChatIdSet,
    openActions: onReorderSidebar ? setMuteActionTarget : undefined,
  }), [effectiveMutedDroneIds, effectiveMutedGroupIds, mutedChatIdSet, onReorderSidebar]);
  const pinnedDronesSection = (
    <DrawerPinnedDrones
      drones={globalPinnedDrones}
      placement={pinnedSidebarPlacement}
      collapsed={pinnedSidebarCollapsed}
      separateFromRepositoryList={!activeRepo}
      repoLabelByPath={repoLabelByPath}
      sidebarChatOrderByDrone={droneSidebarOrder.sidebarChatOrderByDrone}
      collapsedDroneIds={collapsedDroneIds}
      selectedContainerDroneId={selectedContainerDroneId}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onToggleDrone={toggleDrone}
      onSelectContainer={setSelectedContainerDroneId}
      onOpenChatActions={openChatActions}
      onSelect={selectPinnedDroneChat}
      onToggleCollapsed={togglePinnedSidebarCollapsed}
      onTogglePlacement={togglePinnedSidebarPlacement}
    />
  );
  React.useEffect(() => {
    if (activeRepoId && !droneGroups.some((group) => group.id === activeRepoId)) {
      setActiveRepoId(null);
    }
  }, [activeRepoId, droneGroups]);
  React.useEffect(() => {
    setActiveRepoId(null);
  }, [activeDeviceId]);
  React.useEffect(() => {
    const alignment = resolveMobileSidebarRepositoryAlignment({
      open,
      activeDeviceId,
      activeDroneId,
      resolvedRepoId: open && activeDroneId ? resolveDroneRepoId(activeDroneId) : null,
      alignedSelectionKey: alignedActiveDroneSelectionKeyRef.current,
    });
    alignedActiveDroneSelectionKeyRef.current = alignment.alignedSelectionKey;
    if (alignment.repoIdToOpen) setActiveRepoId(alignment.repoIdToOpen);
  }, [activeDeviceId, activeDroneId, open, resolveDroneRepoId]);
  const listStatus =
    dronesLoading && drones.length === 0 ? (
      <View
        accessibilityLabel="Loading projects and drones"
        accessibilityRole="progressbar"
        style={styles.drawerLoading}
      >
        <ActivityIndicator color={colors.sidebarActionFg} size="small" />
        <Text accessibilityLiveRegion="polite" style={styles.drawerLoadingText}>
          Loading projects and drones…
        </Text>
      </View>
    ) : !dronesLoading && !dronesReachable ? (
      <View style={styles.drawerOffline}>
        <View style={styles.deviceDot} />
        <View style={styles.drawerOfflineCopy}>
          <Text style={styles.drawerOfflineTitle}>Device offline</Text>
          <Text style={styles.drawerOfflineBody}>Drones will appear when it reconnects.</Text>
        </View>
        {onRetryDrones ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetryDrones}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    ) : !dronesLoading && dronesError ? (
      <View style={styles.drawerError}>
        <Text style={styles.drawerErrorText}>{dronesError}</Text>
        {onRetryDrones ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetryDrones}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    ) : !dronesLoading && drones.length === 0 ? (
      <Text style={styles.empty}>No drones are available on this device.</Text>
    ) : null;
  const dronesNavigationItem = navigationItems.find((item) => item.id === 'drones');
  const devicesNavigationItem = navigationItems.find((item) => item.id === 'devices');
  const settingsNavigationItem = navigationItems.find((item) => item.id === 'settings');

  return (
    <DrawerWorkingPhaseContext.Provider value={workingPhase}>
      <DrawerSidebarReorderContext.Provider value={onReorderSidebar ?? null}>
        <DrawerSidebarMuteContext.Provider value={muteContextValue}>
          <DrawerChatTreeContext.Provider value={chatTreeContextValue}>
          <DrawerCompanionHighlightContext.Provider value={companionHighlightSet}>
            <MobileSidebarDragDropProvider>
          <View
            renderToHardwareTextureAndroid
            style={[
              styles.drawerContent,
              {
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              },
            ]}
          >
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open project list"
                disabled={!dronesNavigationItem}
                onPress={() => {
                  setActiveRepoId(null);
                  dronesNavigationItem?.onPress();
                }}
                style={({ pressed }) => [styles.headerCopy, pressed && styles.pressed]}
              >
                <Text style={styles.title}>Drone Hub</Text>
              </Pressable>
              {devicesNavigationItem ? (
                <DrawerDevicePicker
                  devices={devicePickerItems}
                  activeDeviceId={activeDeviceId}
                  onSelect={onSelectDevice}
                  onOpenDeviceSettings={devicesNavigationItem?.onPress}
                />
              ) : null}
              {settingsNavigationItem ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open settings"
                  accessibilityState={{ selected: settingsNavigationItem.active }}
                  onPress={settingsNavigationItem.onPress}
                  style={({ pressed }) => [
                    styles.headerSettings,
                    settingsNavigationItem.active && styles.headerSettingsActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <SidebarSettingsIcon
                    color={settingsNavigationItem.active ? colors.accent : colors.sidebarActionFg}
                    size={16}
                    strokeWidth={settingsNavigationItem.active ? 2.2 : 1.9}
                  />
                </Pressable>
              ) : null}
            </View>
            {showDrones ? (
              <>
                {pinnedSidebarPlacement === 'top' ? pinnedDronesSection : null}
                {activeRepo ? (
                  <FlatList<MobileDroneSidebarEntry>
                    key={`repo:${activeRepo.id}`}
                    style={styles.scroll}
                    contentContainerStyle={styles.droneList}
                    data={activeRepo.entries}
                    keyExtractor={(entry) =>
                      entry.kind === 'drone'
                        ? `drone:${entry.node.drone.id}`
                        : `folder:${entry.folder.id}`
                    }
                    renderItem={({ item: entry }) => (
                      <DrawerDroneEntry
                        entry={entry}
                        depth={0}
                        parentId={sidebarFolderNodeId(activeRepo.id)}
                        siblingNodeIds={activeRepo.entries.map(mobileSidebarEntryNodeId)}
                        treeScope={`repo:${activeRepo.id}`}
                        repoPath={activeRepo.repoPath}
                        parentGroupPath={null}
                        expandedFolderIds={expandedFolderIds}
                        collapsedDroneIds={collapsedDroneIds}
                        selectedContainerDroneId={selectedContainerDroneId}
                        sidebarChatOrderByDrone={droneSidebarOrder.sidebarChatOrderByDrone}
                        activeDroneId={activeDroneId}
                        activeChatName={activeChatName}
                        droneOperationById={droneOperationById}
                        onToggleFolder={toggleFolder}
                        onToggleDrone={toggleDrone}
                        onSelectContainer={setSelectedContainerDroneId}
                        onOpenChatActions={openChatActions}
                        onSelect={(droneId, chatName) => {
                          setSelectedContainerDroneId('');
                          onSelectDroneChat?.(droneId, chatName);
                        }}
                      />
                    )}
                    ListHeaderComponent={
                      <>
                        <View
                          style={[
                            styles.repoNavigationHead,
                            pinnedSidebarPlacement === 'top' &&
                              globalPinnedDrones.length > 0 &&
                              styles.repoNavigationHeadBelowPinned,
                          ]}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Back to repositories"
                            onPress={() => setActiveRepoId(null)}
                            style={({ pressed }) => [
                              styles.repoNavigationBack,
                              pressed && styles.pressed,
                            ]}
                          >
                            <View style={styles.groupIcon}>
                              <SidebarFolderGitIcon
                                color={colors.sidebarActionFg}
                                size={14}
                                strokeWidth={1.9}
                              />
                              <View style={styles.groupChevron}>
                                <SidebarChevronIcon
                                  color={colors.sidebarActionFg}
                                  size={10}
                                  strokeWidth={2.3}
                                  direction="left"
                                />
                              </View>
                            </View>
                            <View style={styles.repoCopy}>
                              <Text numberOfLines={1} style={styles.repoNavigationTitle}>
                                {activeRepo.label}
                              </Text>
                              <Text numberOfLines={1} style={styles.repoNavigationPath}>
                                {activeRepo.repoPath || 'No repository'}
                              </Text>
                            </View>
                            <DroneStateCounts
                              summary={
                                repoStateSummaries.get(activeRepo.id) ??
                                EMPTY_MOBILE_DRONE_STATE_SUMMARY
                              }
                              compact
                            />
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Create drone in ${activeRepo.label}`}
                            accessibilityState={{ disabled: !onCreateDrone }}
                            disabled={!onCreateDrone}
                            onPress={() => onCreateDrone?.(activeRepo.repoPath)}
                            style={({ pressed }) => [
                              styles.repoCreate,
                              !onCreateDrone && styles.repoCreateDisabled,
                              pressed && styles.pressed,
                            ]}
                          >
                            <SidebarPlusIcon color={colors.accent} size={16} />
                          </Pressable>
                        </View>
                      </>
                    }
                    ListFooterComponent={listStatus}
                    stickyHeaderIndices={[0]}
                    initialNumToRender={10}
                    maxToRenderPerBatch={8}
                    updateCellsBatchingPeriod={24}
                    windowSize={7}
                    removeClippedSubviews={Platform.OS === 'android'}
                    keyboardShouldPersistTaps="handled"
                  />
                ) : (
                  <FlatList<MobileDroneRepoGroup>
                    key="repositories"
                    style={styles.scroll}
                    contentContainerStyle={styles.droneList}
                    data={droneGroups}
                    keyExtractor={(group) => group.id}
                    renderItem={({ item: group }) => {
                      const stateSummary =
                        repoStateSummaries.get(group.id) ?? EMPTY_MOBILE_DRONE_STATE_SUMMARY;
                      const containsSelectedDrone =
                        droneTreeContains(group.roots, activeDroneId) ||
                        group.folders.some((folder) => droneFolderContains(folder, activeDroneId));
                      const isUngrouped = !group.repoPath;
                      return (
                        <View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${group.label} repository`}
                            accessibilityState={{ selected: containsSelectedDrone }}
                            onPress={() => setActiveRepoId(group.id)}
                            style={({ pressed }) => [
                              styles.repoRow,
                              containsSelectedDrone && styles.repoRowActive,
                              pressed && !containsSelectedDrone && styles.sidebarRowPressed,
                            ]}
                          >
                            {containsSelectedDrone ? (
                              <View style={styles.sidebarSelectionEdge} />
                            ) : null}
                            <View style={styles.repoIconSlot}>
                              {isUngrouped ? (
                                <SidebarFolderOutlineIcon
                                  color={
                                    containsSelectedDrone ? colors.accent : colors.sidebarMetaFg
                                  }
                                  size={14}
                                />
                              ) : (
                                <SidebarFolderGitIcon
                                  color={
                                    containsSelectedDrone ? colors.accent : colors.sidebarActionFg
                                  }
                                  size={14}
                                  strokeWidth={1.9}
                                />
                              )}
                            </View>
                            <View style={styles.repoCopy}>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.repoName,
                                  containsSelectedDrone && styles.repoNameActive,
                                ]}
                              >
                                {group.label}
                              </Text>
                              <Text numberOfLines={1} style={styles.repoPath}>
                                {group.repoPath || 'Drones without a repository'}
                              </Text>
                            </View>
                            <DroneStateCounts summary={stateSummary} compact />
                          </Pressable>
                          {isUngrouped ? <View style={styles.repoUngroupedDivider} /> : null}
                        </View>
                      );
                    }}
                    ListFooterComponent={listStatus}
                    initialNumToRender={10}
                    maxToRenderPerBatch={8}
                    updateCellsBatchingPeriod={24}
                    windowSize={7}
                    removeClippedSubviews={Platform.OS === 'android'}
                    keyboardShouldPersistTaps="handled"
                  />
                )}
                {pinnedSidebarPlacement === 'bottom' ? pinnedDronesSection : null}
              </>
            ) : (
              <View style={styles.drawerFill} />
            )}
            <DrawerCompanionButton onClose={onClose} />
            <DrawerVoiceRecordingIndicator />
          </View>
          <ContextMenu
            visible={Boolean(chatActionTarget)}
            title={
              chatActionTarget
                ? `${chatActionTarget.drone.name} / ${chatActionTarget.chatName}`
                : 'Chat actions'
            }
            actions={chatContextActions}
            onClose={() => setChatActionTarget(null)}
          />
          <ContextMenu
            visible={Boolean(muteActionTarget)}
            title={
              muteActionTarget?.kind === 'drone'
                ? muteActionTarget.drone.name
                : muteActionTarget?.kind === 'group'
                  ? muteActionTarget.folder.label
                  : 'Mute actions'
            }
            actions={muteContextActions}
            onClose={() => setMuteActionTarget(null)}
          />
          <ContextMenu
            visible={Boolean(chatGroupActionTarget)}
            title={chatGroupActionTarget?.path ? sidebarChatGroupBaseName(chatGroupActionTarget.path) : 'Chat groups'}
            actions={chatGroupContextActions}
            onClose={() => setChatGroupActionTarget(null)}
          />
          <TextInputDialog
            visible={Boolean(chatEditor)}
            title={chatEditor?.mode === 'rename' ? 'Rename chat' : 'Create chat'}
            message={
              chatEditor?.mode === 'rename'
                ? `Choose a new name for “${chatEditor.target.chatName}”.`
                : `Create a chat in ${chatEditor?.target.drone.name ?? 'this drone'}.`
            }
            value={chatEditor?.value ?? ''}
            error={chatMutationError}
            confirmLabel={chatEditor?.mode === 'rename' ? 'Rename' : 'Create'}
            confirmDisabled={
              chatEditor?.mode === 'rename' &&
              chatEditor.value.trim() === chatEditor.target.chatName
            }
            busy={chatMutationBusy}
            maxLength={64}
            onChangeText={(value) => {
              setChatMutationError(null);
              setChatEditor((current) => (current ? { ...current, value } : current));
            }}
            onCancel={() => {
              if (!chatMutationBusy) {
                setChatEditor(null);
                setChatMutationError(null);
              }
            }}
            onConfirm={() => void submitChatEditor()}
          />
          <TextInputDialog
            visible={Boolean(chatGroupEditor)}
            title={chatGroupEditor?.mode === 'rename' ? 'Rename group' : 'Create group'}
            message={chatGroupEditor?.parentPath ? `Inside ${sidebarChatGroupBaseName(chatGroupEditor.parentPath)}` : `Organize chats in ${chatGroupEditor?.drone.name ?? 'this drone'}.`}
            value={chatGroupEditor?.value ?? ''}
            error={chatMutationError}
            confirmLabel={chatGroupEditor?.mode === 'rename' ? 'Rename' : 'Create'}
            maxLength={64}
            onChangeText={(value) => {
              setChatMutationError(null);
              setChatGroupEditor((current) => current ? { ...current, value } : current);
            }}
            onCancel={() => { setChatGroupEditor(null); setChatMutationError(null); }}
            onConfirm={submitChatGroupEditor}
          />
          <ConfirmDialog
            visible={Boolean(deleteChatTarget)}
            title={deleteChatPlan.chatNames.length > 1
              ? `Delete ${deleteChatPlan.chatNames.length} chats?`
              : 'Delete chat?'}
            message={
              chatMutationError ||
              (deleteChatPlan.chatNames.length > 1
                ? `Delete ${deleteChatPlan.chatNames.length} selected chats from ${deleteChatTarget?.drone.name ?? 'this drone'}?${deleteChatPlan.defaultChatKept ? ' The default chat will be kept.' : ''}`
                : `Delete “${deleteChatPlan.chatNames[0] ?? ''}” from ${deleteChatTarget?.drone.name ?? 'this drone'}?`)
            }
            confirmLabel={deleteChatPlan.chatNames.length > 1 ? 'Delete chats' : 'Delete'}
            destructive
            busy={chatMutationBusy}
            onCancel={() => {
              if (!chatMutationBusy) {
                setDeleteChatTarget(null);
                setChatMutationError(null);
              }
            }}
            onConfirm={() => void confirmDeleteChat()}
          />
            </MobileSidebarDragDropProvider>
          </DrawerCompanionHighlightContext.Provider>
          </DrawerChatTreeContext.Provider>
        </DrawerSidebarMuteContext.Provider>
      </DrawerSidebarReorderContext.Provider>
    </DrawerWorkingPhaseContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  backdrop: {
    backgroundColor: colors.overlay,
  },
  drawer: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    elevation: 8,
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 10, height: 0 },
    overflow: 'hidden',
  },
  drawerContent: { flex: 1, backgroundColor: colors.panel },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderBottomColor: colors.sidebarHeaderBorder,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
    zIndex: 30,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerSettings: {
    width: 32,
    height: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  headerSettingsActive: { backgroundColor: colors.whiteWashSoft },
  title: {
    color: colors.textStrong,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  scroll: { flex: 1 },
  empty: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 12 },
  drawerLoading: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  drawerLoadingText: { color: colors.sidebarSubitemFg, fontSize: 12 },
  drawerError: { gap: 10, padding: 12 },
  drawerErrorText: { color: colors.danger, fontSize: 11, lineHeight: 17 },
  retry: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  retryText: { color: colors.accent, fontSize: 10, fontWeight: '600' },
  drawerOffline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: 12,
  },
  drawerOfflineCopy: { flex: 1, minWidth: 0 },
  drawerOfflineTitle: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  drawerOfflineBody: { color: colors.mutedDim, fontSize: 9, lineHeight: 14, marginTop: 2 },
  devicePickerSection: {
    position: 'relative',
    width: '55%',
    minWidth: 0,
    maxWidth: 220,
    alignItems: 'flex-end',
    zIndex: 40,
  },
  devicePicker: {
    minHeight: 44,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  devicePickerOpen: { backgroundColor: colors.whiteWash },
  devicePickerPressed: { backgroundColor: colors.whiteWashSoft },
  devicePickerTriggerCopy: { flexShrink: 1, minWidth: 0 },
  devicePickerCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  devicePickerName: { color: colors.text, fontSize: 12, fontWeight: '400' },
  devicePickerDetail: {
    color: colors.sidebarMetaFg,
    fontSize: 10,
    fontWeight: '400',
    marginTop: 1,
  },
  deviceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.sidebarMutedDim,
    backgroundColor: 'transparent',
  },
  deviceDotOnline: {
    borderColor: colors.online,
    backgroundColor: colors.online,
    shadowColor: colors.online,
    shadowOpacity: 0.3,
    shadowRadius: 2.5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  deviceOptions: {
    position: 'absolute',
    top: 46,
    right: 0,
    width: 232,
    maxHeight: 208,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.panel,
    elevation: 8,
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  deviceOptionsContent: {
    padding: 0,
  },
  deviceOptionsList: { maxHeight: 162 },
  deviceOption: {
    position: 'relative',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingLeft: 10,
    paddingRight: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  deviceOptionActive: { backgroundColor: colors.sidebarSelectionWash },
  deviceOptionLast: { borderBottomWidth: 0 },
  deviceOptionActiveEdge: {
    position: 'absolute',
    top: 7,
    bottom: 7,
    left: 0,
    width: 2,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: colors.sidebarSelectionEdge,
  },
  deviceOptionName: { color: colors.sidebarFg, fontSize: 12, fontWeight: '400' },
  deviceOptionNameActive: { color: colors.sidebarFgActive },
  devicePlatform: {
    width: 52,
    flexShrink: 0,
    color: colors.sidebarMetaFg,
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'right',
  },
  deviceSettingsAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  deviceSettingsActionLabel: {
    color: colors.sidebarFg,
    fontSize: 12,
    fontWeight: '500',
  },
  repoNavigationHead: {
    minHeight: 48,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.panel,
  },
  repoNavigationHeadBelowPinned: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  repoNavigationBack: {
    minHeight: 48,
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  repoNavigationTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  repoNavigationPath: {
    marginTop: 2,
    color: colors.sidebarMetaFg,
    fontSize: 9,
    fontFamily: 'monospace',
  },
  repoCreate: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  repoCreateDisabled: { opacity: 0.42 },
  fleetStates: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  fleetStatesCompact: { flexShrink: 0, gap: 6 },
  fleetState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fleetStateText: {
    minWidth: 11,
    color: colors.muted,
    fontSize: 9,
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  fleetStateTextApproval: { color: colors.warning },
  fleetStateTextWorking: { color: colors.warning },
  fleetStateTextUnread: { color: colors.online },
  droneList: { paddingBottom: 24 },
  pinnedSection: {
    flexShrink: 0,
    paddingBottom: 4,
  },
  pinnedSectionTop: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  pinnedSectionBottom: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    borderBottomWidth: 0,
  },
  pinnedHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  pinnedHeaderToggle: {
    minHeight: 32,
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pinnedHeaderText: {
    flex: 1,
    color: colors.sidebarMutedDim,
    fontSize: 10.5,
    fontWeight: '400',
  },
  pinnedHeaderIcon: { opacity: 0.72 },
  pinnedPlacementToggle: {
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
  },
  repoRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    position: 'relative',
  },
  repoRowActive: { backgroundColor: colors.sidebarSelectionWash },
  repoCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  repoIconSlot: {
    width: 20,
    height: 18,
    flexShrink: 0,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  repoName: { color: colors.sidebarHeadingFg, fontSize: 13, fontWeight: '600' },
  repoNameActive: { color: colors.sidebarDroneActiveFg, fontWeight: '600' },
  repoPath: {
    marginTop: 2,
    color: colors.sidebarMetaFg,
    fontSize: 8.5,
    fontFamily: 'monospace',
    opacity: 0.55,
  },
  repoUngroupedDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
    backgroundColor: colors.borderSubtle,
  },
  droneNode: { position: 'relative' },
  switchItemRow: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    position: 'relative',
  },
  switchItemRowActive: { backgroundColor: colors.sidebarSelectionWash },
  switchItemRowCompanionHighlighted: {
    backgroundColor: colors.accentWash,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  switchItemMain: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: DRAWER_TREE_LEADING_GAP,
  },
  droneChevronSlot: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  droneChevron: { opacity: 0.75 },
  droneRuntimeIconSlot: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchItemTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.sidebarDroneFg,
    fontSize: 13,
    fontWeight: '400',
  },
  draggableRowLabel: { flex: 0 },
  switchItemTitleActive: { color: colors.sidebarDroneActiveFg },
  switchItemDraftBadge: {
    flexShrink: 0,
    color: colors.accent,
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 10,
    letterSpacing: 0.2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: colors.accentDark,
  },
  switchItemContextBadge: {
    maxWidth: 76,
    flexShrink: 1,
    color: colors.sidebarFgActive,
    fontSize: 7,
    fontWeight: '500',
    lineHeight: 8,
    letterSpacing: 0.1,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    backgroundColor: colors.sidebarSurfaceInset,
  },
  switchItemStatus: {
    width: DRAWER_TREE_LEADING_SLOT_WIDTH,
    height: DRAWER_TREE_LEADING_SLOT_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchStateIndicator: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyStateAnchor: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.sidebarMutedDim,
    opacity: 0.7,
  },
  switchStateDot: { width: 6, height: 6, borderRadius: 3 },
  workingStatusIndicator: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  operationStatusIndicator: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  operationStatusGlyph: { position: 'absolute' },
  stateStatusIndicator: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  quietBlockedStatusIndicator: { opacity: 0.7 },
  unreadStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.online,
    shadowColor: colors.onlineBorder,
    shadowOpacity: 1,
    shadowRadius: 2.5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  sidebarSelectionEdge: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    width: 2,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: colors.sidebarSelectionEdge,
  },
  sidebarRowPressed: { backgroundColor: colors.whiteWash },
  droneChatRail: {
    marginRight: 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'transparent',
  },
  droneChatRailVisible: { borderLeftColor: colors.borderSubtle },
  droneChatRow: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 6,
    position: 'relative',
  },
  droneChatSelectionWash: {
    position: 'absolute',
    top: 0,
    right: -4,
    bottom: 0,
    backgroundColor: colors.sidebarSelectionWash,
  },
  droneChatLabel: {
    flex: 1,
    minWidth: 0,
    color: colors.sidebarSubitemFg,
    fontSize: 13,
    fontWeight: '400',
  },
  droneChatLabelActive: { color: colors.sidebarDroneFg },
  droneChatDraftBadge: {
    flexShrink: 0,
    color: colors.accent,
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.accentAlt,
    borderRadius: 3,
  },
  droneChildren: {
    position: 'relative',
  },
  groupRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DRAWER_TREE_LEADING_GAP,
    paddingRight: 10,
    borderRadius: 4,
  },
  groupIcon: {
    width: 16,
    height: 16,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  folderChevronSlot: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderChevron: { opacity: 0.72 },
  groupChevron: {
    position: 'absolute',
    left: -4,
    top: 2,
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    backgroundColor: colors.panel,
  },
  groupName: { color: colors.sidebarHeadingFg, fontSize: 13, fontWeight: '400', flex: 1 },
  groupChildren: { position: 'relative' },
  groupChildrenGuide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
  },
  drawerFill: { flex: 1 },
  companionFooter: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  companionButton: {
    width: '100%',
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 10,
    borderRadius: 7,
  },
  companionButtonRecording: {
    borderWidth: 1,
    borderColor: colors.onlineBorder,
    backgroundColor: colors.onlineDark,
  },
  companionButtonUnavailable: { opacity: 0.62 },
  companionButtonDisabled: { opacity: 0.48 },
  companionButtonText: { color: colors.sidebarFg, fontSize: 12, fontWeight: '600' },
  companionButtonTextRecording: { color: colors.online },
  voiceFooter: {
    flexShrink: 0,
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.accentBorder,
    backgroundColor: colors.panelRaised,
  },
  voiceFooterStatus: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  voiceFooterDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  voiceFooterDotPaused: { backgroundColor: colors.warning },
  voiceFooterDotTranscribing: { backgroundColor: colors.accent },
  voiceFooterDotError: { backgroundColor: colors.danger },
  voiceFooterCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  voiceFooterLabel: { flex: 1, color: colors.accent, fontSize: 11, fontWeight: '600' },
  voiceFooterLabelError: { color: colors.danger },
  voiceFooterTimer: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  voiceFooterActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceFooterButton: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 6,
    borderWidth: 1,
  },
  voiceFooterCancel: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  voiceFooterStop: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  voiceFooterButtonDisabled: { opacity: 0.42 },
  voiceFooterButtonText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  voiceFooterCancelText: { color: colors.danger },
  voiceFooterStopText: { color: colors.online },
  pressed: { opacity: 0.65 },
});
