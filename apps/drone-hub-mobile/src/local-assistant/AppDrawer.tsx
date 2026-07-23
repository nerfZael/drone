import React from 'react';
import * as Clipboard from 'expo-clipboard';
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
import MessageCircle from 'lucide-react-native/icons/message-circle';
import Network from 'lucide-react-native/icons/network';
import Plus from 'lucide-react-native/icons/plus';
import Settings from 'lucide-react-native/icons/settings';
import LoaderCircle from 'lucide-react-native/icons/loader-circle';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import FolderGit2 from 'lucide-react-native/icons/folder-git-2';
import Folder from 'lucide-react-native/icons/folder';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import Pin from 'lucide-react-native/icons/pin';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { Drawer } from 'react-native-drawer-layout';
import { colors } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RelativeMessageTimestamp } from './RelativeMessageTimestamp';
import { useSharedMobileChatVoiceRecorder } from './MobileChatVoiceRecorderContext';
import {
  formatMobileVoiceDuration,
  mobileVoiceStatusLabel,
} from './mobile-voice-transcription-model';
import {
  buildMobileDroneRepoGroups,
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  excludePinnedMobileDrones,
  type MobileDroneGroupFolder,
  type MobileDroneRepoGroup,
  type MobileDroneSidebarEntry,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
  type MobileDroneTreeNode,
} from '../drones/drone-sidebar-model';
import { resolvePinnedSidebarDronesForRepo } from '@drone/hub-model/sidebar';
import {
  addMobileDroneToStateSummary,
  EMPTY_MOBILE_DRONE_STATE_SUMMARY,
  mobileDroneDisplayState,
  type MobileDroneDisplayState,
  type MobileDroneStateSummary,
} from '../drones/drone-state-summary';

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
const DRAWER_TREE_ROW_PADDING_LEFT = 7;
const DRAWER_TREE_DEPTH_INDENT = 14;
const DRAWER_TREE_LEADING_SLOT_WIDTH = 12;
const DRAWER_TREE_LEADING_GAP = 6;

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
}: {
  devices: DrawerDevicePickerItem[];
  activeDeviceId: string;
  onSelect?(deviceId: string): void;
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
        <ChevronDown
          color={open ? colors.accent : colors.subtle}
          size={14}
          strokeWidth={2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {open ? (
        <ScrollView
          style={styles.deviceOptions}
          contentContainerStyle={styles.deviceOptionsContent}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {devices.map((device) => {
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
                  active && styles.deviceOptionActive,
                  pressed && styles.pressed,
                ]}
              >
                {active ? <View style={styles.deviceOptionActiveEdge} /> : null}
                <View style={[styles.deviceDot, device.connected && styles.deviceDotOnline]} />
                <View style={styles.devicePickerCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.deviceOptionName, active && styles.activeText]}
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
      ) : null}
    </View>
  );
}

function QuadDroneIcon({
  color = colors.text,
  size = 18,
  strokeWidth = 1.9,
}: {
  color?: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <Svg height={size} width={size} viewBox="0 0 16 16" fill="none">
      <Rect x="5" y="5" width="6" height="6" rx="1" stroke={color} strokeWidth={strokeWidth} />
      <Line x1="2" y1="2" x2="5" y2="5" stroke={color} strokeWidth={strokeWidth} />
      <Line x1="14" y1="2" x2="11" y2="5" stroke={color} strokeWidth={strokeWidth} />
      <Line x1="2" y1="14" x2="5" y2="11" stroke={color} strokeWidth={strokeWidth} />
      <Line x1="14" y1="14" x2="11" y2="11" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="2" cy="2" r="1" fill={color} />
      <Circle cx="14" cy="2" r="1" fill={color} />
      <Circle cx="2" cy="14" r="1" fill={color} />
      <Circle cx="14" cy="14" r="1" fill={color} />
    </Svg>
  );
}

function navigationIcon(id: string) {
  if (id === 'drones') return QuadDroneIcon;
  if (id === 'devices') return Network;
  if (id === 'settings') return Settings;
  return MessageCircle;
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
}: {
  summary: MobileDroneStateSummary;
  compact?: boolean;
}) {
  return (
    <View style={[styles.fleetStates, compact && styles.fleetStatesCompact]}>
      {summary.approval > 0 ? (
        <View
          accessibilityLabel={`${summary.approval} awaiting approval`}
          style={styles.fleetState}
        >
          <ApprovalStatusIndicator />
          <Text style={[styles.fleetStateText, styles.fleetStateTextApproval]}>
            {summary.approval}
          </Text>
        </View>
      ) : null}
      {summary.unread > 0 ? (
        <View accessibilityLabel={`${summary.unread} with unread chats`} style={styles.fleetState}>
          <UnreadStatusIndicator />
          <Text style={[styles.fleetStateText, styles.fleetStateTextUnread]}>{summary.unread}</Text>
        </View>
      ) : null}
      {summary.working > 0 ? (
        <View accessibilityLabel={`${summary.working} working`} style={styles.fleetState}>
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
  if (
    state === 'working' ||
    state === 'starting' ||
    state === 'archiving' ||
    state === 'deleting'
  )
    return colors.warning;
  if (state === 'waiting') return colors.info;
  if (state === 'blocked' || state === 'offline') return colors.danger;
  if (state === 'done') return colors.online;
  return colors.muted;
}

function SwitchItemStatusIndicator({
  state,
  unread = false,
}: {
  state: SwitchDisplayState;
  unread?: boolean;
}) {
  const ready = state === 'idle' && !unread;
  const working =
    state === 'working' ||
    state === 'starting' ||
    state === 'archiving' ||
    state === 'deleting';
  const stateColor = switchStateColor(state);
  const indicatorColor = unread && state === 'idle' ? colors.online : stateColor;
  return (
    <View accessible={false} style={styles.switchItemStatus}>
      {ready ? (
        <View style={styles.readyStateAnchor} />
      ) : working ? (
        <WorkingStatusIndicator />
      ) : state === 'approval' ? (
        <ApprovalStatusIndicator />
      ) : (
        <View accessible={false} style={styles.switchStateIndicator}>
          <View style={[styles.switchStateDot, { backgroundColor: indicatorColor }]} />
        </View>
      )}
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
        <LoaderCircle color={colors.warning} size={12} strokeWidth={2.4} />
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

function UnreadStatusIndicator() {
  return (
    <View accessible={false} style={styles.stateStatusIndicator}>
      <View style={styles.unreadStatusDot} />
    </View>
  );
}

function DrawerDroneNode({
  node,
  depth,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onSelect,
}: {
  node: MobileDroneTreeNode;
  depth: number;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onSelect(droneId: string, chatName: string): void;
}) {
  const { drone } = node;
  const chats = drone.chats.length > 0 ? drone.chats : ['default'];
  const selected = drone.id === activeDroneId;
  const selectedChat = selected && chats.includes(activeChatName) ? activeChatName : chats[0]!;
  const operation = droneOperationById[drone.id] as 'archiving' | 'deleting' | undefined;
  const displayState = operation ?? mobileDroneDisplayState(drone);
  const unread = (drone.unreadChats?.length ?? 0) > 0;
  const stateLabel = unread && displayState === 'idle' ? 'Unread' : switchStateLabel(displayState);
  const runtimeLabel = drone.runtime.trim().toLowerCase() === 'host' ? 'host' : 'container';
  const accessibilityLabel = [
    `Open ${drone.name} chat`,
    stateLabel,
    unread && stateLabel !== 'Unread' ? 'unread chat' : '',
    `${runtimeLabel} runtime`,
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
          selected && styles.switchItemRowActive,
          pressed && !selected && styles.sidebarRowPressed,
        ]}
      >
        {selected ? <View style={styles.sidebarSelectionEdge} /> : null}
        <View style={styles.switchItemMain}>
          <SwitchItemStatusIndicator state={displayState} unread={unread} />
          <View style={styles.switchItemCopy}>
            <Text numberOfLines={1} style={[styles.switchItemTitle, selected && styles.activeText]}>
              {drone.name}
            </Text>
            <View style={styles.switchItemMeta}>
              <Text style={styles.switchItemState}>{stateLabel}</Text>
              {drone.lastMessageAt ? (
                <>
                  <Text style={styles.switchItemMetaSeparator}>·</Text>
                  <RelativeMessageTimestamp
                    timestamp={drone.lastMessageAt}
                    style={styles.switchItemTime}
                  />
                </>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
      {node.children.length > 0 ? (
        <View style={styles.droneChildren}>
          {node.children.map((child) => (
            <DrawerDroneNode
              key={child.drone.id}
              node={child}
              depth={depth + 1}
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
  collapsedFolderIds,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleFolder,
  onSelect,
}: {
  folder: MobileDroneGroupFolder;
  depth: number;
  collapsedFolderIds: ReadonlySet<string>;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onToggleFolder(folderId: string): void;
  onSelect(droneId: string, chatName: string): void;
}) {
  const collapsed = collapsedFolderIds.has(folder.id);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => onToggleFolder(folder.id)}
        style={({ pressed }) => [
          styles.groupRow,
          { paddingLeft: drawerTreeRowPaddingLeft(depth) },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.folderGroupIcon}>
          <Folder color={colors.muted} size={15} strokeWidth={1.8} />
          <View style={styles.groupChevron}>
            <Chevron color={colors.muted} size={10} strokeWidth={2.3} />
          </View>
        </View>
        <Text numberOfLines={1} style={styles.groupName}>
          {folder.label}
        </Text>
      </Pressable>
      {!collapsed ? (
        <>
          {folder.entries.map((entry) => (
            <DrawerDroneEntry
              key={
                entry.kind === 'drone'
                  ? `drone:${entry.node.drone.id}`
                  : `folder:${entry.folder.id}`
              }
              entry={entry}
              depth={depth + 1}
              collapsedFolderIds={collapsedFolderIds}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              droneOperationById={droneOperationById}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function DrawerDroneEntry({
  entry,
  depth,
  collapsedFolderIds,
  activeDroneId,
  activeChatName,
  droneOperationById,
  onToggleFolder,
  onSelect,
}: {
  entry: MobileDroneSidebarEntry;
  depth: number;
  collapsedFolderIds: ReadonlySet<string>;
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
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onSelect={onSelect}
    />
  ) : (
    <DrawerDroneFolder
      folder={entry.folder}
      depth={depth}
      collapsedFolderIds={collapsedFolderIds}
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
  activeDroneId,
  activeChatName,
  droneOperationById,
  onSelect,
}: {
  drones: MobileDroneSummary[];
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onSelect(droneId: string, chatName: string): void;
}) {
  if (drones.length === 0) return null;
  return (
    <View style={styles.pinnedSection} accessibilityLabel="Pinned drones">
      <View style={styles.pinnedHeader}>
        <Pin color={colors.mutedDim} size={13} strokeWidth={1.7} />
        <Text style={styles.pinnedHeaderText}>Pinned</Text>
      </View>
      {drones.map((drone) => (
        <DrawerDroneNode
          key={`pinned:${drone.id}`}
          node={{ drone, children: [] }}
          depth={0}
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
}: AppDrawerProps) {
  const insets = useSafeAreaInsets();
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
  const unpinnedDroneGroups = React.useMemo(() => {
    return buildMobileDroneRepoGroups(
      excludePinnedMobileDrones(drones, droneSidebarOrder.pinnedDroneIds),
      droneSidebarOrder,
    );
  }, [droneSidebarOrder, drones]);
  const repoStateSummaries = React.useMemo(
    () =>
      new Map(
        droneGroups.map((group) => [group.id, summarizeDroneScope(group.roots, group.folders)]),
      ),
    [droneGroups],
  );
  const [activeRepoId, setActiveRepoId] = React.useState<string | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleFolder = React.useCallback((folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);
  const activeRepo = droneGroups.find((group) => group.id === activeRepoId) ?? null;
  const activeUnpinnedRepo = unpinnedDroneGroups.find((group) => group.id === activeRepoId) ?? null;
  const activeRepoPinnedDrones = React.useMemo(
    () =>
      activeRepo
        ? resolvePinnedSidebarDronesForRepo(
            drones,
            droneSidebarOrder.pinnedDroneIds,
            activeRepo.repoPath,
          )
        : [],
    [activeRepo, droneSidebarOrder.pinnedDroneIds, drones],
  );
  React.useEffect(() => {
    if (activeRepoId && !droneGroups.some((group) => group.id === activeRepoId)) {
      setActiveRepoId(null);
    }
  }, [activeRepoId, droneGroups]);
  React.useEffect(() => {
    setActiveRepoId(null);
    setCollapsedFolderIds(new Set());
  }, [activeDeviceId]);
  const listStatus =
    !dronesLoading && !dronesReachable ? (
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
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Drone Hub</Text>
          </View>
          {devicePickerItems.length > 0 ? (
            <DrawerDevicePicker
              devices={devicePickerItems}
              activeDeviceId={activeDeviceId}
              onSelect={onSelectDevice}
            />
          ) : null}
        </View>
        <View style={styles.navigation}>
          {navigationItems.map((item) => {
            const Icon = navigationIcon(item.id);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: item.active }}
                onPress={item.onPress}
                style={({ pressed }) => [
                  styles.navigationItem,
                  item.active && styles.navigationItemActive,
                  pressed && styles.pressed,
                ]}
              >
                <Icon
                  color={item.active ? colors.accent : colors.secondary}
                  size={18}
                  strokeWidth={item.active ? 2.3 : 1.9}
                />
                <Text style={[styles.navigationLabel, item.active && styles.navigationLabelActive]}>
                  {item.label}
                </Text>
                {item.active ? <View style={styles.navigationIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
        {showDrones ? (
          <>
            {activeRepo ? (
              <View style={styles.repoNavigationHead}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to repositories"
                  onPress={() => setActiveRepoId(null)}
                  style={({ pressed }) => [styles.repoNavigationBack, pressed && styles.pressed]}
                >
                  <View style={styles.groupIcon}>
                    <FolderGit2 color={colors.mutedDim} size={16} strokeWidth={1.9} />
                    <View style={styles.groupChevron}>
                      <ChevronLeft color={colors.mutedDim} size={10} strokeWidth={2.3} />
                    </View>
                  </View>
                  <View style={styles.repoCopy}>
                    <Text numberOfLines={1} style={styles.repoNavigationTitle}>
                      {activeRepo.label}
                    </Text>
                  </View>
                  <DroneStateCounts
                    summary={
                      repoStateSummaries.get(activeRepo.id) ?? EMPTY_MOBILE_DRONE_STATE_SUMMARY
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
                  <Plus color={colors.accent} size={18} strokeWidth={2.2} />
                </Pressable>
              </View>
            ) : null}
            {activeRepo ? (
              <FlatList<MobileDroneSidebarEntry>
                key={`repo:${activeRepo.id}`}
                style={styles.scroll}
                contentContainerStyle={styles.droneList}
                data={activeUnpinnedRepo?.entries ?? []}
                keyExtractor={(entry) =>
                  entry.kind === 'drone'
                    ? `drone:${entry.node.drone.id}`
                    : `folder:${entry.folder.id}`
                }
                renderItem={({ item: entry }) => (
                  <DrawerDroneEntry
                    entry={entry}
                    depth={0}
                    collapsedFolderIds={collapsedFolderIds}
                    activeDroneId={activeDroneId}
                    activeChatName={activeChatName}
                    droneOperationById={droneOperationById}
                    onToggleFolder={toggleFolder}
                    onSelect={(droneId, chatName) => onSelectDroneChat?.(droneId, chatName)}
                  />
                )}
                ListHeaderComponent={
                  <DrawerPinnedDrones
                    drones={activeRepoPinnedDrones}
                    activeDroneId={activeDroneId}
                    activeChatName={activeChatName}
                    droneOperationById={droneOperationById}
                    onSelect={(droneId, chatName) => onSelectDroneChat?.(droneId, chatName)}
                  />
                }
                ListFooterComponent={listStatus}
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
                    <View style={styles.repoGroup}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${group.label} repository`}
                        onPress={() => setActiveRepoId(group.id)}
                        style={({ pressed }) => [
                          styles.repoRow,
                          containsSelectedDrone && styles.repoRowActive,
                          pressed && !containsSelectedDrone && styles.sidebarRowPressed,
                        ]}
                      >
                        {containsSelectedDrone ? <View style={styles.sidebarSelectionEdge} /> : null}
                        <FolderGit2 color={colors.mutedDim} size={15} strokeWidth={1.9} />
                        <View style={styles.repoCopy}>
                          <Text numberOfLines={1} style={styles.repoName}>
                            {group.label}
                          </Text>
                        </View>
                        <DroneStateCounts summary={stateSummary} compact />
                        <ChevronRight color={colors.muted} size={15} strokeWidth={2} />
                      </Pressable>
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
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
    zIndex: 30,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: {
    color: colors.textStrong,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  navigation: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  navigationItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2,
    position: 'relative',
  },
  navigationItemActive: { backgroundColor: 'transparent' },
  navigationLabel: {
    color: colors.secondary,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  navigationLabelActive: { color: colors.accentAlt },
  navigationIndicator: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 2,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: colors.accent,
  },
  scroll: { flex: 1 },
  activeText: { color: colors.text, fontWeight: '600' },
  empty: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 12 },
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
  devicePickerName: { color: colors.text, fontSize: 12, fontWeight: '600' },
  devicePickerDetail: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '500',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  deviceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.mutedDim,
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
    width: 208,
    maxHeight: 208,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
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
  deviceOption: {
    position: 'relative',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingLeft: 10,
    paddingRight: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  deviceOptionActive: { backgroundColor: colors.sidebarSelectionWash },
  deviceOptionActiveEdge: {
    position: 'absolute',
    top: 7,
    bottom: 7,
    left: 0,
    width: 2,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: colors.accent,
  },
  deviceOptionName: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  devicePlatform: {
    width: 52,
    flexShrink: 0,
    color: colors.mutedDim,
    fontSize: 8,
    fontWeight: '500',
    textAlign: 'right',
  },
  repoNavigationHead: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  repoNavigationBack: {
    minHeight: 56,
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  repoNavigationTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
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
  fleetStateText: { color: colors.muted, fontSize: 9, fontFamily: 'monospace' },
  fleetStateTextApproval: { color: colors.warning },
  fleetStateTextWorking: { color: colors.warning },
  fleetStateTextUnread: { color: colors.online },
  droneList: { paddingBottom: 24 },
  pinnedSection: {
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  pinnedHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingRight: 9,
  },
  pinnedHeaderText: {
    color: colors.mutedDim,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  repoGroup: {
    borderBottomWidth: 1,
    borderBottomColor: colors.whiteWash,
  },
  repoRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 7,
    paddingLeft: 9,
    paddingRight: 8,
    position: 'relative',
  },
  repoRowActive: { backgroundColor: colors.sidebarSelectionWash },
  repoCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  repoName: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  droneNode: { position: 'relative', marginBottom: 4 },
  switchItemRow: {
    minHeight: 48,
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
  switchItemCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 3,
  },
  switchItemTitle: {
    minWidth: 0,
    color: colors.secondary,
    fontSize: 12,
    fontWeight: '500',
  },
  switchItemMeta: {
    minHeight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  switchItemState: {
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 10,
    fontWeight: '400',
  },
  switchItemMetaSeparator: {
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 10,
    opacity: 0.55,
  },
  switchItemTime: {
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 10,
    fontFamily: 'monospace',
    fontWeight: '400',
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
    borderColor: colors.mutedDim,
    opacity: 0.35,
  },
  switchStateDot: { width: 6, height: 6, borderRadius: 3 },
  workingStatusIndicator: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  stateStatusIndicator: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  unreadStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.online },
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
  droneChildren: {},
  groupRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DRAWER_TREE_LEADING_GAP,
    paddingRight: 8,
    borderRadius: 3,
  },
  groupIcon: {
    width: 20,
    height: 20,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  folderGroupIcon: {
    width: DRAWER_TREE_LEADING_SLOT_WIDTH,
    height: 20,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  groupChevron: {
    position: 'absolute',
    left: -1,
    top: 5,
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    backgroundColor: colors.panel,
  },
  groupName: { color: colors.secondary, fontSize: 11, fontWeight: '500', flex: 1 },
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
