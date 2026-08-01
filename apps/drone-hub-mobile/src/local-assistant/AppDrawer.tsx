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
  type MobileDroneGroupFolder,
  type MobileDroneRepoGroup,
  type MobileDroneSidebarEntry,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
  type MobileDroneTreeNode,
} from '../drones/drone-sidebar-model';
import { resolvePinnedSidebarDrones } from '@drone/hub-model/sidebar';
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
  SidebarNetworkIcon,
  SidebarPinIcon,
  SidebarPlusIcon,
  SidebarSettingsIcon,
  SidebarTreeChevronIcon,
  SidebarWorkingIcon,
} from './SidebarIcons';
import { useMobileSidebarExpandedFolderIds } from './use-mobile-sidebar-expanded-folder-ids';

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
  detail?: string;
  platform: string;
};

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
  onSelectDevice?(deviceId: string): void;
};

type RegisterDrawer = (props: AppDrawerProps | null) => void;

const AppDrawerHostContext = React.createContext<RegisterDrawer | null>(null);
const DrawerWorkingPhaseContext = React.createContext<Animated.Value | null>(null);
const DRAWER_WORKING_SPIN_DURATION_MS = 1_600;
const RECENT_BLOCKED_EMPHASIS_MS = 30_000;
const DRAWER_TREE_ROW_PADDING_LEFT = 12;
const DRAWER_TREE_DEPTH_INDENT = 10;
const DRAWER_TREE_LEADING_SLOT_WIDTH = 12;
const DRAWER_TREE_LEADING_GAP = 6;
const PINNED_SIDEBAR_PLACEMENT_KEY = 'droneHubMobile.pinnedSidebarPlacement';
type PinnedSidebarPlacement = 'top' | 'bottom';

function drawerTreeRowPaddingLeft(depth: number): number {
  return DRAWER_TREE_ROW_PADDING_LEFT + Math.max(0, depth) * DRAWER_TREE_DEPTH_INDENT;
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
        accessibilityLabel={`${activeDevice?.name ?? 'Choose device'}, ${activeDevice?.connected ? 'online' : 'offline'}. Choose device.`}
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
                  accessibilityLabel={`${device.name}, ${device.connected ? 'online' : 'offline'}, ${devicePlatformLabel(device.platform)}`}
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
              style={({ pressed }) => [
                styles.deviceSettingsAction,
                pressed && styles.pressed,
              ]}
            >
              <SidebarNetworkIcon color={colors.sidebarActionFg} size={16} strokeWidth={1.9} />
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
): void {
  for (const node of nodes) {
    addMobileDroneToStateSummary(summary, node.drone);
    addDroneNodesToStateSummary(summary, node.children);
  }
}

function addDroneFoldersToStateSummary(
  summary: MobileDroneStateSummary,
  folders: MobileDroneGroupFolder[],
): void {
  for (const folder of folders) {
    addDroneNodesToStateSummary(summary, folder.roots);
    addDroneFoldersToStateSummary(summary, folder.children);
  }
}

function summarizeDroneScope(
  roots: MobileDroneTreeNode[],
  folders: MobileDroneGroupFolder[] = [],
): MobileDroneStateSummary {
  const summary = { ...EMPTY_MOBILE_DRONE_STATE_SUMMARY };
  addDroneNodesToStateSummary(summary, roots);
  addDroneFoldersToStateSummary(summary, folders);
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
            entity === 'chat'
              ? `${summary.working} working chats`
              : `${summary.working} working`
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
  emphasized = false,
  showReadyAnchor = true,
}: {
  state: SwitchDisplayState;
  unread?: boolean;
  emphasized?: boolean;
  showReadyAnchor?: boolean;
}) {
  const ready = showReadyAnchor && state === 'idle' && !unread;
  const working = state === 'working' || state === 'starting';
  const stateColor = switchStateColor(state);
  return (
    <View accessible={false} style={styles.switchItemStatus}>
      {ready ? (
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

function OperationStatusIndicator({
  operation,
}: {
  operation: 'archiving' | 'deleting';
}) {
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
  const color = emphasized ? colors.sidebarBlockedIndicator : colors.sidebarItemIcon;
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
  activeDroneId,
  activeChatName,
  selectionWashInset,
  onSelect,
}: {
  drone: MobileDroneSummary;
  chatName: string;
  activeDroneId: string;
  activeChatName: string;
  selectionWashInset: number;
  onSelect(droneId: string, chatName: string): void;
}) {
  const selected = drone.id === activeDroneId && chatName === activeChatName;
  const draft = drone.draftChats?.[chatName] === true;
  const unread = !selected && (drone.unreadChats?.includes(chatName) ?? false);
  const displayState = mobileDroneChatDisplayState(
    drone,
    chatName,
    selected && Boolean(drone.approvalRequired),
  );
  const stateLabel = unread && displayState === 'idle' ? 'Unread' : switchStateLabel(displayState);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${drone.name} / ${chatName}, ${stateLabel}`}
      accessibilityState={{ selected }}
      onPress={() => onSelect(drone.id, chatName)}
      style={({ pressed }) => [
        styles.droneChatRow,
        pressed && !selected && styles.sidebarRowPressed,
      ]}
    >
      {selected ? (
        <View style={[styles.droneChatSelectionWash, { left: -selectionWashInset }]} />
      ) : null}
      {selected ? <View style={styles.sidebarSelectionEdge} /> : null}
      <SwitchItemStatusIndicator state={displayState} unread={unread} showReadyAnchor={false} />
      <Text
        numberOfLines={1}
        style={[styles.droneChatLabel, selected && styles.droneChatLabelActive]}
      >
        {chatName}
      </Text>
      {draft ? <Text style={styles.droneChatDraftBadge}>Draft</Text> : null}
    </Pressable>
  );
}

function DrawerDroneNode({
  node,
  depth,
  contextLabel,
  sidebarChatOrderByDrone,
  showChats = true,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onSelect,
}: {
  node: MobileDroneTreeNode;
  depth: number;
  contextLabel?: string;
  sidebarChatOrderByDrone: Record<string, string[]>;
  showChats?: boolean;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onSelect(droneId: string, chatName: string): void;
}) {
  const { drone } = node;
  const chats = orderedMobileDroneChats(drone, sidebarChatOrderByDrone[drone.id]);
  const selected = drone.id === activeDroneId;
  const hasMultipleChats = chats.length > 1;
  const hasActiveChildChat = selected && showChats && hasMultipleChats;
  const selectedChat =
    selected && chats.includes(activeChatName) ? activeChatName : (chats[0] ?? '');
  const operation = droneOperationById[drone.id] as 'archiving' | 'deleting' | undefined;
  const displayState = operation ?? mobileDroneDisplayState(drone, !hasMultipleChats);
  const isDraft = drone.draft === true || drone.phase.trim().toLowerCase() === 'draft';
  const unread =
    !isDraft && !hasMultipleChats && (drone.unreadChats?.length ?? 0) > 0;
  const chatStateSummary = React.useMemo(
    () => summarizeMobileDroneChats(drone, selected ? activeChatName : ''),
    [activeChatName, drone, selected],
  );
  const stateLabel = isDraft
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
  const runtimeLabel = drone.runtime.trim().toLowerCase() === 'host' ? 'host' : 'container';
  const accessibilityLabel = [
    `Open ${drone.name} chat`,
    stateLabel,
    unread && stateLabel !== 'Unread' ? 'unread chat' : '',
    `${runtimeLabel} runtime`,
    contextLabel ? `${contextLabel} repository` : '',
    chats.length > 1 ? `${chats.length} chats` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.droneNode}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: Boolean(operation) }}
        accessibilityLabel={accessibilityLabel}
        disabled={Boolean(operation)}
        onPress={() => onSelect(drone.id, selectedChat)}
        style={({ pressed }) => [
          styles.switchItemRow,
          { paddingLeft: drawerTreeRowPaddingLeft(depth), paddingRight: 6 },
          selected && !hasActiveChildChat && styles.switchItemRowActive,
          pressed && (!selected || hasActiveChildChat) && styles.sidebarRowPressed,
        ]}
      >
        {selected && !hasActiveChildChat ? <View style={styles.sidebarSelectionEdge} /> : null}
        <View style={styles.switchItemMain}>
          {isDraft ? (
            <View accessible={false} style={styles.switchItemStatus} />
          ) : (
            <SwitchItemStatusIndicator
              state={displayState}
              unread={unread}
              emphasized={recentlyBlocked || selected}
            />
          )}
          <Text
            numberOfLines={1}
            style={[styles.switchItemTitle, selected && styles.switchItemTitleActive]}
          >
            {drone.name}
          </Text>
          {isDraft ? (
            <Text accessibilityLabel="Draft drone" style={styles.switchItemDraftBadge}>
              Draft
            </Text>
          ) : null}
          {contextLabel ? (
            <Text numberOfLines={1} style={styles.switchItemContextBadge}>
              {contextLabel}
            </Text>
          ) : null}
          {hasMultipleChats ? (
            <DroneStateCounts summary={chatStateSummary} compact entity="chat" />
          ) : null}
        </View>
      </Pressable>
      {showChats && chats.length > 1 ? (
        <View
          style={[
            styles.droneChatRail,
            { marginLeft: drawerTreeRowPaddingLeft(depth) + 8 },
          ]}
        >
          {chats.map((chatName) => (
            <DrawerDroneChatRow
              key={`${drone.id}:${chatName}`}
              drone={drone}
              chatName={chatName}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              selectionWashInset={drawerTreeRowPaddingLeft(depth) + 8}
              onSelect={onSelect}
            />
          ))}
        </View>
      ) : null}
      {node.children.length > 0 ? (
        <View style={styles.droneChildren}>
          {node.children.map((child) => (
            <DrawerDroneNode
              key={child.drone.id}
              node={child}
              depth={depth}
              sidebarChatOrderByDrone={sidebarChatOrderByDrone}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              droneOperationById={droneOperationById}
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
  expandedFolderIds,
  sidebarChatOrderByDrone,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleFolder,
  onSelect,
}: {
  folder: MobileDroneGroupFolder;
  depth: number;
  expandedFolderIds: ReadonlySet<string>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onToggleFolder(folderId: string): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  const collapsed = !expandedFolderIds.has(folder.id);
  const hasSelectedDirectDrone = folder.roots.some((node) => node.drone.id === activeDroneId);
  const stateSummary = React.useMemo(
    () => summarizeDroneScope(folder.roots, folder.children),
    [folder.children, folder.roots],
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => onToggleFolder(folder.id)}
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
        <Text numberOfLines={1} style={styles.groupName}>
          {folder.label}
        </Text>
        <DroneStateCounts summary={stateSummary} compact />
      </Pressable>
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
              expandedFolderIds={expandedFolderIds}
              sidebarChatOrderByDrone={sidebarChatOrderByDrone}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              droneOperationById={droneOperationById}
              onToggleFolder={onToggleFolder}
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
  expandedFolderIds,
  sidebarChatOrderByDrone,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleFolder,
  onSelect,
}: {
  entry: MobileDroneSidebarEntry;
  depth: number;
  expandedFolderIds: ReadonlySet<string>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onToggleFolder(folderId: string): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  return entry.kind === 'drone' ? (
    <DrawerDroneNode
      node={entry.node}
      depth={depth}
      sidebarChatOrderByDrone={sidebarChatOrderByDrone}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onSelect={onSelect}
    />
  ) : (
    <DrawerDroneFolder
      folder={entry.folder}
      depth={depth}
      expandedFolderIds={expandedFolderIds}
      sidebarChatOrderByDrone={sidebarChatOrderByDrone}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onToggleFolder={onToggleFolder}
      onSelect={onSelect}
    />
  );
}

function DrawerPinnedDrones({
  drones,
  placement,
  separateFromRepositoryList,
  repoLabelByPath,
  sidebarChatOrderByDrone,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onSelect,
  onTogglePlacement,
}: {
  drones: MobileDroneSummary[];
  placement: PinnedSidebarPlacement;
  separateFromRepositoryList: boolean;
  repoLabelByPath: ReadonlyMap<string, string>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onSelect(droneId: string, chatName: string): void;
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
        <SidebarPinIcon
          color={colors.sidebarMutedDim}
          size={14}
          strokeWidth={1.7}
          style={styles.pinnedHeaderIcon}
        />
        <Text style={styles.pinnedHeaderText}>Pinned</Text>
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
      {drones.map((drone) => (
        <DrawerDroneNode
          key={`pinned:${drone.id}`}
          node={{ drone, children: [] }}
          depth={0}
          contextLabel={repoLabelByPath.get(drone.repoPath) ?? 'Ungrouped'}
          sidebarChatOrderByDrone={sidebarChatOrderByDrone}
          showChats={false}
          activeDroneId={activeDroneId}
          activeChatName={activeChatName}
          droneOperationById={droneOperationById}
          onSelect={onSelect}
        />
      ))}
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
  const { error, status, durationMillis, discardRecording, stopRecordingForTranscript } =
    useSharedMobileChatVoiceRecorder();
  const [copying, setCopying] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');
  const actionTokenRef = React.useRef(0);
  const recorderErrorRef = React.useRef(error);
  recorderErrorRef.current = error;
  const canStop = status === 'recording' || status === 'paused';
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
    void discardRecording();
  }, [discardRecording]);

  const stopAndCopy = React.useCallback(async () => {
    if (!canStop || copying) return;
    const actionToken = actionTokenRef.current + 1;
    actionTokenRef.current = actionToken;
    setCopying(true);
    setCopyError('');
    try {
      const transcript = (await stopRecordingForTranscript()).trim();
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

  if (!visible) return null;
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

function AppDrawerView({
  open,
  navigationItems,
  showDrones = false,
  drones = [],
  droneSidebarOrder = EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  activeDroneId = '',
  activeChatName = 'default',
  droneOperationById = {},
  dronesLoading = false,
  dronesReachable = true,
  dronesError = null,
  devicePickerItems = [],
  activeDeviceId = '',
  onCreateDrone,
  onRetryDrones,
  onSelectDroneChat,
  onSelectDevice,
  onClose,
}: AppDrawerProps) {
  const insets = useSafeAreaInsets();
  const [pinnedSidebarPlacement, setPinnedSidebarPlacement] =
    React.useState<PinnedSidebarPlacement>('bottom');
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
  const togglePinnedSidebarPlacement = React.useCallback(() => {
    setPinnedSidebarPlacement((current) => {
      const next = current === 'top' ? 'bottom' : 'top';
      void AsyncStorage.setItem(PINNED_SIDEBAR_PLACEMENT_KEY, next).catch(() => undefined);
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
  const repoStateSummaries = React.useMemo(
    () =>
      new Map(
        droneGroups.map((group) => [group.id, summarizeDroneScope(group.roots, group.folders)]),
      ),
    [droneGroups],
  );
  const [activeRepoId, setActiveRepoId] = React.useState<string | null>(null);
  const { expandedFolderIds, toggleFolder } = useMobileSidebarExpandedFolderIds();
  const activeRepo = droneGroups.find((group) => group.id === activeRepoId) ?? null;
  const globalPinnedDrones = React.useMemo(
    () => resolvePinnedSidebarDrones(drones, droneSidebarOrder.pinnedDroneIds),
    [droneSidebarOrder.pinnedDroneIds, drones],
  );
  const repoLabelByPath = React.useMemo(
    () => new Map(droneGroups.map((group) => [group.repoPath, group.label])),
    [droneGroups],
  );
  const selectPinnedDroneChat = React.useCallback(
    (droneId: string, chatName: string) => {
      onSelectDroneChat?.(droneId, chatName);
    },
    [onSelectDroneChat],
  );
  const pinnedDronesSection = (
    <DrawerPinnedDrones
      drones={globalPinnedDrones}
      placement={pinnedSidebarPlacement}
      separateFromRepositoryList={!activeRepo}
      repoLabelByPath={repoLabelByPath}
      sidebarChatOrderByDrone={droneSidebarOrder.sidebarChatOrderByDrone}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onSelect={selectPinnedDroneChat}
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
  const listStatus =
    dronesLoading && drones.length === 0 ? (
      <View
        accessibilityLabel="Loading drones"
        accessibilityRole="progressbar"
        style={styles.drawerLoading}
      >
        <ActivityIndicator color={colors.sidebarActionFg} size="small" />
        <Text style={styles.drawerLoadingText}>Loading drones…</Text>
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
            accessibilityLabel="Open drones"
            disabled={!dronesNavigationItem}
            onPress={() => {
              dronesNavigationItem?.onPress();
              onClose();
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
                color={
                  settingsNavigationItem.active ? colors.accent : colors.sidebarActionFg
                }
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
                    expandedFolderIds={expandedFolderIds}
                    sidebarChatOrderByDrone={droneSidebarOrder.sidebarChatOrderByDrone}
                    activeDroneId={activeDroneId}
                    activeChatName={activeChatName}
                    droneOperationById={droneOperationById}
                    onToggleFolder={toggleFolder}
                    onSelect={(droneId, chatName) => onSelectDroneChat?.(droneId, chatName)}
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
                        <SidebarFolderGitIcon
                          color={colors.sidebarActionFg}
                          size={14}
                          strokeWidth={1.9}
                          style={styles.repoIcon}
                        />
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
                        </View>
                        <DroneStateCounts summary={stateSummary} compact />
                      </Pressable>
                    </View>
                  );
                }}
                ListHeaderComponent={
                  <>
                    <View style={styles.repoListSpacer} />
                  </>
                }
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
        <DrawerVoiceRecordingIndicator />
      </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  deviceSettingsActionLabel: {
    color: colors.sidebarFg,
    fontSize: 12,
    fontWeight: '500',
  },
  repoNavigationHead: {
    height: 40,
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
    height: 40,
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  repoNavigationTitle: { color: colors.text, fontSize: 12, fontWeight: '600' },
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
  repoListSpacer: { height: 4 },
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
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    position: 'relative',
  },
  repoRowActive: { backgroundColor: colors.sidebarSelectionWash },
  repoCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  repoIcon: { opacity: 0.85 },
  repoName: { color: colors.sidebarHeadingFg, fontSize: 12, fontWeight: '500' },
  repoNameActive: { color: colors.sidebarDroneActiveFg, fontWeight: '600' },
  droneNode: { position: 'relative' },
  switchItemRow: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    position: 'relative',
  },
  switchItemRowActive: { backgroundColor: colors.sidebarSelectionWash },
  switchItemMain: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: DRAWER_TREE_LEADING_GAP,
  },
  switchItemTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.sidebarDroneFg,
    fontSize: 13,
    fontWeight: '400',
  },
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
    borderColor: colors.sidebarItemIcon,
    opacity: 0.7,
  },
  switchStateDot: { width: 6, height: 6, borderRadius: 3 },
  workingStatusIndicator: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  operationStatusIndicator: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
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
    borderLeftColor: colors.borderSubtle,
  },
  droneChatRow: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DRAWER_TREE_LEADING_GAP,
    paddingHorizontal: 6,
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
    marginLeft: 4,
    marginRight: 4,
    paddingLeft: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.borderSubtle,
  },
  groupRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DRAWER_TREE_LEADING_GAP,
    paddingRight: 6,
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
