import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import Network from 'lucide-react-native/icons/network';
import Plus from 'lucide-react-native/icons/plus';
import Settings from 'lucide-react-native/icons/settings';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import FolderGit2 from 'lucide-react-native/icons/folder-git-2';
import Folder from 'lucide-react-native/icons/folder';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { colors } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { assistantThreadsNewestFirst } from './latest-assistant-thread';
import { RelativeMessageTimestamp } from './RelativeMessageTimestamp';
import {
  buildMobileDroneRepoGroups,
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  type MobileDroneGroupFolder,
  type MobileDroneSidebarEntry,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
  type MobileDroneTreeNode,
} from '../drones/drone-sidebar-model';

export function assistantDrawerWidth(windowWidth: number): number {
  return Math.min(windowWidth, 460);
}

export type DrawerAssistantThread = {
  id: string;
  title: string;
  status: string;
  updatedAt?: string;
  model?: string;
};

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
};

export type AssistantThreadDrawerProps = {
  open: boolean;
  title: string;
  threads: DrawerAssistantThread[];
  activeThreadId: string;
  creating?: boolean;
  threadsLoading?: boolean;
  offset: Animated.Value;
  openingGestureActive?: boolean;
  navigationItems: AppDrawerNavigationItem[];
  canCreate?: boolean;
  showThreads?: boolean;
  showDrones?: boolean;
  drones?: MobileDroneSummary[];
  droneSidebarOrder?: MobileDroneSidebarOrder;
  activeDroneId?: string;
  activeChatName?: string;
  dronesLoading?: boolean;
  devicePickerItems?: DrawerDevicePickerItem[];
  activeDeviceId?: string;
  onClose(): void;
  onSelect(threadId: string): void;
  onCreate(): void;
  onSelectDroneChat?(droneId: string, chatName: string): void;
  onSelectDevice?(deviceId: string): void;
};

type RegisterDrawer = (props: AssistantThreadDrawerProps) => void;

const AssistantDrawerHostContext = React.createContext<RegisterDrawer | null>(null);

export function AssistantDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerProps, setDrawerProps] = React.useState<AssistantThreadDrawerProps | null>(null);
  const registerDrawer = React.useCallback<RegisterDrawer>((nextProps) => {
    setDrawerProps(nextProps);
  }, []);

  return (
    <AssistantDrawerHostContext.Provider value={registerDrawer}>
      {children}
      {drawerProps ? <AssistantThreadDrawerView {...drawerProps} /> : null}
    </AssistantDrawerHostContext.Provider>
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
  const activeDevice =
    devices.find((device) => device.id === activeDeviceId) ?? devices[0];
  React.useEffect(() => setOpen(false), [activeDeviceId]);
  return (
    <View style={styles.devicePickerSection}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose device"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.devicePicker, pressed && styles.pressed]}
      >
        <View
          style={[styles.deviceDot, activeDevice?.connected && styles.deviceDotOnline]}
        />
        <View style={styles.devicePickerCopy}>
          <Text numberOfLines={1} style={styles.devicePickerName}>
            {activeDevice?.name ?? 'Choose a device'}
          </Text>
        </View>
        <ChevronDown
          color={colors.muted}
          size={15}
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
      <Rect
        x="5"
        y="5"
        width="6"
        height="6"
        rx="1"
        stroke={color}
        strokeWidth={strokeWidth}
      />
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

type DroneDisplayState =
  | 'working'
  | 'waiting'
  | 'starting'
  | 'blocked'
  | 'offline'
  | 'idle';
type SwitchDisplayState = DroneDisplayState | 'done';

function droneDisplayState(drone: MobileDroneSummary): DroneDisplayState {
  const rawState = `${drone.phase ?? ''} ${drone.status ?? ''}`.toLowerCase();
  if (drone.statusOk === false) return 'offline';
  if (drone.busyChats.length > 0) return 'working';
  if (rawState.includes('block') || rawState.includes('error')) return 'blocked';
  if (rawState.includes('wait')) return 'waiting';
  if (rawState.includes('start') || rawState.includes('creat') || rawState.includes('seed'))
    return 'starting';
  return 'idle';
}

function threadDisplayState(thread: DrawerAssistantThread): SwitchDisplayState {
  const rawState = thread.status.trim().toLowerCase();
  if (rawState.includes('error') || rawState.includes('block') || rawState.includes('approval'))
    return 'blocked';
  if (rawState.includes('waiting')) return 'waiting';
  if (rawState.includes('run') || rawState.includes('work'))
    return 'working';
  if (rawState.includes('done') || rawState.includes('complete')) return 'done';
  return 'idle';
}

function switchStateLabel(state: SwitchDisplayState): string {
  if (state === 'offline') return 'unavailable';
  if (state === 'idle') return 'ready';
  return state;
}

function switchStateColor(state: SwitchDisplayState): string {
  if (state === 'working') return colors.warning;
  if (state === 'waiting' || state === 'starting') return colors.info;
  if (state === 'blocked' || state === 'offline') return colors.danger;
  if (state === 'done') return colors.online;
  return colors.muted;
}

function SwitchItemState({
  state,
  detail,
}: {
  state: SwitchDisplayState;
  detail?: string;
}) {
  const stateColor = switchStateColor(state);
  return (
    <View style={styles.switchItemMetaRow}>
      <View style={[styles.switchStateDot, { backgroundColor: stateColor }]} />
      <Text numberOfLines={1} style={[styles.switchItemMeta, { color: stateColor }]}>
        {switchStateLabel(state)}
        {detail ? ` · ${detail}` : ''}
      </Text>
    </View>
  );
}

function DrawerDroneNode({
  node,
  depth,
  activeDroneId,
  activeChatName,
  onSelect,
}: {
  node: MobileDroneTreeNode;
  depth: number;
  activeDroneId: string;
  activeChatName: string;
  onSelect(droneId: string, chatName: string): void;
}) {
  const { drone } = node;
  const chats = drone.chats.length > 0 ? drone.chats : ['default'];
  const selected = drone.id === activeDroneId;
  const selectedChat = selected && chats.includes(activeChatName) ? activeChatName : chats[0]!;
  const displayState = droneDisplayState(drone);
  return (
    <View style={styles.droneNode}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Open ${drone.name} chat`}
        onPress={() => onSelect(drone.id, selectedChat)}
        style={({ pressed }) => [
          styles.switchItemRow,
          { paddingLeft: 10 + depth * 16, paddingRight: 7 },
          selected && styles.switchItemRowActive,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.switchItemCopy}>
          <View style={styles.switchItemTitleRow}>
            <Text
              numberOfLines={1}
              style={[styles.switchItemTitle, selected && styles.activeText]}
            >
              {drone.name}
            </Text>
            <RelativeMessageTimestamp
              timestamp={drone.lastMessageAt}
              style={styles.switchItemTime}
            />
          </View>
          <SwitchItemState state={displayState} detail={drone.runtime} />
        </View>
      </Pressable>
      {chats.length > 1 ? (
        <View style={styles.chatList}>
          {chats.map((chatName) => {
            const active = selected && chatName === activeChatName;
            const busy = drone.busyChats.includes(chatName);
            return (
              <Pressable
                key={chatName}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(drone.id, chatName)}
                style={({ pressed }) => [
                  styles.chatRow,
                  { paddingLeft: 28 + depth * 16 },
                  active && styles.chatRowActive,
                  pressed && styles.pressed,
                ]}
              >
                <MessageCircle
                  color={active ? colors.accent : colors.muted}
                  size={13}
                  strokeWidth={1.8}
                />
                <Text numberOfLines={1} style={[styles.chatName, active && styles.activeText]}>
                  {chatName}
                </Text>
                {busy ? <ActivityIndicator color={colors.warning} size="small" /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {node.children.length > 0 ? (
        <View style={[styles.droneChildren, { marginLeft: 18 + depth * 16 }]}>
          {node.children.map((child) => (
            <DrawerDroneNode
              key={child.drone.id}
              node={child}
              depth={depth + 1}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
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
  activeDroneId,
  activeChatName,
  onSelect,
}: {
  folder: MobileDroneGroupFolder;
  depth: number;
  activeDroneId: string;
  activeChatName: string;
  onSelect(droneId: string, chatName: string): void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => setCollapsed((current) => !current)}
        style={({ pressed }) => [
          styles.groupRow,
          { paddingLeft: 20 + depth * 14 },
          pressed && styles.pressed,
        ]}
      >
        <Chevron color={colors.muted} size={13} strokeWidth={2} />
        <Folder color={colors.muted} size={14} strokeWidth={1.8} />
        <Text numberOfLines={1} style={styles.groupName}>
          {folder.label}
        </Text>
        <Text style={styles.repoCount}>{folder.droneCount}</Text>
      </Pressable>
      {!collapsed ? (
        <>
          {folder.entries.map((entry) => (
            <DrawerDroneEntry
              key={entry.kind === 'drone' ? `drone:${entry.node.drone.id}` : `folder:${entry.folder.id}`}
              entry={entry}
              depth={depth + 1}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
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
  activeDroneId,
  activeChatName,
  onSelect,
}: {
  entry: MobileDroneSidebarEntry;
  depth: number;
  activeDroneId: string;
  activeChatName: string;
  onSelect(droneId: string, chatName: string): void;
}) {
  return entry.kind === 'drone' ? (
    <DrawerDroneNode
      node={entry.node}
      depth={depth}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      onSelect={onSelect}
    />
  ) : (
    <DrawerDroneFolder
      folder={entry.folder}
      depth={depth}
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      onSelect={onSelect}
    />
  );
}

export function AssistantThreadDrawer(props: AssistantThreadDrawerProps) {
  const registerDrawer = React.useContext(AssistantDrawerHostContext);

  React.useLayoutEffect(() => {
    registerDrawer?.(props);
  }, [props, registerDrawer]);

  if (registerDrawer) return null;
  return <AssistantThreadDrawerView {...props} />;
}

function AssistantThreadDrawerView({
  open,
  title: _title,
  threads,
  activeThreadId,
  creating,
  threadsLoading = false,
  offset,
  openingGestureActive,
  navigationItems,
  canCreate = true,
  showThreads = true,
  showDrones = false,
  drones = [],
  droneSidebarOrder = EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  activeDroneId = '',
  activeChatName = 'default',
  dronesLoading = false,
  devicePickerItems = [],
  activeDeviceId = '',
  onClose,
  onSelect,
  onCreate,
  onSelectDroneChat,
  onSelectDevice,
}: AssistantThreadDrawerProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = assistantDrawerWidth(windowWidth);
  const closedX = -drawerWidth;
  const closeSwipeDistance = Math.min(drawerWidth * 0.14, 52);
  const [visible, setVisible] = React.useState(open);
  const swipeRef = React.useRef({
    startX: 0,
    startY: 0,
    startedAt: 0,
    dx: 0,
    dragging: false,
  });
  React.useEffect(() => {
    if (open || openingGestureActive) {
      setVisible(true);
      if (openingGestureActive) return;
      requestAnimationFrame(() =>
        Animated.spring(offset, {
          toValue: 0,
          damping: 24,
          stiffness: 260,
          mass: 0.85,
          useNativeDriver: true,
        }).start(),
      );
      return;
    }
    Animated.timing(offset, {
      toValue: closedX,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [closedX, offset, open, openingGestureActive]);
  const settleSwipe = React.useCallback(() => {
    const swipe = swipeRef.current;
    if (!swipe.dragging) return;
    const elapsedSeconds = Math.max((Date.now() - swipe.startedAt) / 1000, 0.016);
    const velocityX = swipe.dx / elapsedSeconds;
    swipe.dragging = false;
    if (swipe.dx <= -closeSwipeDistance || velocityX <= -420) {
      onClose();
      return;
    }
    Animated.spring(offset, {
      toValue: 0,
      damping: 24,
      stiffness: 260,
      mass: 0.85,
      useNativeDriver: true,
    }).start();
  }, [closeSwipeDistance, offset, onClose]);
  const onDrawerTouchStart = React.useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number; touches: unknown[] } }) => {
      if (!open || event.nativeEvent.touches.length > 1) return;
      swipeRef.current = {
        startX: event.nativeEvent.pageX,
        startY: event.nativeEvent.pageY,
        startedAt: Date.now(),
        dx: 0,
        dragging: false,
      };
    },
    [open],
  );
  const onDrawerTouchMove = React.useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number; touches: unknown[] } }) => {
      if (!open || event.nativeEvent.touches.length > 1) return;
      const swipe = swipeRef.current;
      const dx = event.nativeEvent.pageX - swipe.startX;
      const dy = event.nativeEvent.pageY - swipe.startY;
      if (!swipe.dragging) {
        if (dx >= -5 || Math.abs(dx) <= Math.abs(dy) * 1.1) return;
        swipe.dragging = true;
        offset.stopAnimation();
      }
      swipe.dx = Math.min(0, dx);
      offset.setValue(Math.max(closedX, swipe.dx));
    },
    [closedX, offset, open],
  );
  const orderedThreads = React.useMemo(() => assistantThreadsNewestFirst(threads), [threads]);
  const droneGroups = React.useMemo(
    () => buildMobileDroneRepoGroups(drones, droneSidebarOrder),
    [droneSidebarOrder, drones],
  );
  const fleetStatus = React.useMemo(
    () =>
      drones.reduce(
        (summary, drone) => {
          const state = droneDisplayState(drone);
          if (state === 'working' || state === 'starting') summary.working += 1;
          else if (state === 'blocked' || state === 'offline') summary.issues += 1;
          else summary.idle += 1;
          return summary;
        },
        { working: 0, issues: 0, idle: 0 },
      ),
    [drones],
  );
  const [activeRepoId, setActiveRepoId] = React.useState<string | null>(null);
  const activeRepo = droneGroups.find((group) => group.id === activeRepoId) ?? null;
  React.useEffect(() => {
    if (activeRepoId && !droneGroups.some((group) => group.id === activeRepoId)) {
      setActiveRepoId(null);
    }
  }, [activeRepoId, droneGroups]);
  React.useEffect(() => {
    setActiveRepoId(null);
  }, [activeDeviceId]);
  const backdropOpacity = offset.interpolate({
    inputRange: [closedX, 0],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.layer}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close app menu"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: offset }],
            },
          ]}
        >
          <View
            {...({
              onTouchStartCapture: onDrawerTouchStart,
              onTouchMoveCapture: onDrawerTouchMove,
              onTouchEndCapture: settleSwipe,
              onTouchCancelCapture: settleSwipe,
            } as any)}
            style={styles.drawerTouchSurface}
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
                    color={item.active ? colors.accent : colors.muted}
                    size={18}
                    strokeWidth={item.active ? 2.3 : 1.9}
                  />
                  <Text
                    style={[styles.navigationLabel, item.active && styles.navigationLabelActive]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {showThreads ? (
            <>
              <View style={styles.sidebarToolbar}>
                {threadsLoading ? (
                  <View style={styles.loadingSummary}>
                    <ActivityIndicator color={colors.accent} size="small" />
                    <Text style={styles.loadingSummaryText}>Loading threads…</Text>
                  </View>
                ) : (
                  <Text style={styles.sidebarToolbarText}>
                    {threads.length} {threads.length === 1 ? 'thread' : 'threads'}
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create new thread"
                  disabled={threadsLoading || creating || !canCreate}
                  onPress={onCreate}
                  style={({ pressed }) => [
                    styles.create,
                    (threadsLoading || !canCreate) && styles.createDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {creating ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <Plus color={colors.accent} size={19} strokeWidth={2.2} />
                  )}
                </Pressable>
              </View>
              <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
                {orderedThreads.map((thread) => {
                  const active = thread.id === activeThreadId;
                  const displayState = threadDisplayState(thread);
                  return (
                    <Pressable
                      key={thread.id}
                      onPress={() => onSelect(thread.id)}
                      style={({ pressed }) => [
                        styles.switchItemRow,
                        active && styles.switchItemRowActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.switchItemCopy}>
                        <View style={styles.switchItemTitleRow}>
                          <Text
                            numberOfLines={1}
                            style={[styles.switchItemTitle, active && styles.activeText]}
                          >
                            {thread.title || 'Untitled thread'}
                          </Text>
                          <RelativeMessageTimestamp
                            timestamp={thread.updatedAt}
                            style={styles.switchItemTime}
                          />
                        </View>
                        <SwitchItemState state={displayState} detail={thread.model} />
                      </View>
                    </Pressable>
                  );
                })}
                {!threadsLoading && threads.length === 0 ? (
                  <Text style={styles.empty}>
                    No threads here yet. Create one to start a conversation.
                  </Text>
                ) : null}
              </ScrollView>
            </>
          ) : showDrones ? (
            <>
              <View style={styles.sidebarToolbar}>
                {dronesLoading ? (
                  <View style={styles.loadingSummary}>
                    <ActivityIndicator color={colors.accent} size="small" />
                    <Text style={styles.loadingSummaryText}>Loading drones…</Text>
                  </View>
                ) : (
                  <Text numberOfLines={1} style={styles.sidebarToolbarText}>
                    {drones.length} {drones.length === 1 ? 'drone' : 'drones'} · {droneGroups.length}{' '}
                    {droneGroups.length === 1 ? 'space' : 'spaces'}
                  </Text>
                )}
                <View style={styles.sidebarToolbarActions}>
                  <View style={styles.fleetStates}>
                    {fleetStatus.working > 0 ? (
                      <View style={styles.fleetState}>
                        <View style={[styles.fleetStateDot, styles.fleetStateWorking]} />
                        <Text style={styles.fleetStateText}>{fleetStatus.working}</Text>
                      </View>
                    ) : null}
                    {fleetStatus.idle > 0 ? (
                      <View style={styles.fleetState}>
                        <View style={[styles.fleetStateDot, styles.fleetStateIdle]} />
                        <Text style={styles.fleetStateText}>{fleetStatus.idle}</Text>
                      </View>
                    ) : null}
                    {fleetStatus.issues > 0 ? (
                      <View style={styles.fleetState}>
                        <View style={[styles.fleetStateDot, styles.fleetStateIssue]} />
                        <Text style={styles.fleetStateText}>{fleetStatus.issues}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create new drone"
                    accessibilityHint="Coming soon"
                    onPress={() => {}}
                    style={({ pressed }) => [styles.create, pressed && styles.pressed]}
                  >
                    <Plus color={colors.accent} size={19} strokeWidth={2.2} />
                  </Pressable>
                </View>
              </View>
              {activeRepo ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to repositories"
                  onPress={() => setActiveRepoId(null)}
                  style={({ pressed }) => [
                    styles.repoNavigationHead,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.repoBack}>
                    <ChevronLeft color={colors.accent} size={18} strokeWidth={2.2} />
                  </View>
                  <FolderGit2 color={colors.accent} size={16} strokeWidth={1.9} />
                  <View style={styles.repoCopy}>
                    <Text numberOfLines={1} style={styles.repoNavigationTitle}>
                      {activeRepo.label}
                    </Text>
                    {activeRepo.repoPath ? (
                      <Text numberOfLines={1} style={styles.repoPath}>
                        {activeRepo.repoPath}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ) : null}
              <ScrollView style={styles.scroll} contentContainerStyle={styles.droneList}>
                {activeRepo
                  ? activeRepo.entries.map((entry) => (
                      <DrawerDroneEntry
                        key={
                          entry.kind === 'drone'
                            ? `drone:${entry.node.drone.id}`
                            : `folder:${entry.folder.id}`
                        }
                        entry={entry}
                        depth={0}
                        activeDroneId={activeDroneId}
                        activeChatName={activeChatName}
                        onSelect={(droneId, chatName) =>
                          onSelectDroneChat?.(droneId, chatName)
                        }
                      />
                    ))
                  : droneGroups.map((group) => (
                    <View key={group.id} style={styles.repoGroup}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${group.label} repository`}
                        onPress={() => setActiveRepoId(group.id)}
                        style={({ pressed }) => [
                          styles.repoRow,
                          (droneTreeContains(group.roots, activeDroneId) ||
                            group.folders.some((folder) =>
                              droneFolderContains(folder, activeDroneId),
                            )) &&
                            styles.repoRowActive,
                          pressed && styles.pressed,
                        ]}
                      >
                        <FolderGit2 color={colors.accent} size={15} strokeWidth={1.9} />
                        <View style={styles.repoCopy}>
                          <Text numberOfLines={1} style={styles.repoName}>
                            {group.label}
                          </Text>
                          {group.repoPath ? (
                            <Text numberOfLines={1} style={styles.repoPath}>
                              {group.repoPath}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.repoCount}>{group.droneCount}</Text>
                        <ChevronRight color={colors.muted} size={15} strokeWidth={2} />
                      </Pressable>
                    </View>
                  ))}
                {!dronesLoading && drones.length === 0 ? (
                  <Text style={styles.empty}>No drones are available on this device.</Text>
                ) : null}
              </ScrollView>
            </>
          ) : (
            <View
              onStartShouldSetResponder={() => true}
              onResponderGrant={onDrawerTouchStart}
              onResponderMove={onDrawerTouchMove}
              onResponderRelease={settleSwipe}
              onResponderTerminate={settleSwipe}
              style={styles.drawerFill}
            />
          )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  drawer: {
    flex: 1,
    backgroundColor: colors.background,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    elevation: 20,
    shadowColor: colors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 10, height: 0 },
    overflow: 'hidden',
  },
  drawerTouchSurface: { flex: 1 },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    zIndex: 30,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: {
    color: colors.textStrong,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  navigation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: 10,
    paddingTop: 11,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navigationItem: {
    flex: 1,
    minWidth: 70,
    minHeight: 54,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navigationItemActive: { backgroundColor: colors.accentDark, borderColor: colors.accentBorder },
  navigationLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.25,
    textTransform: 'uppercase',
  },
  navigationLabelActive: { color: colors.accentAlt },
  sidebarToolbar: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panel,
  },
  sidebarToolbarText: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
  },
  sidebarToolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingSummary: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingSummaryText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  create: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  createDisabled: { opacity: 0.42 },
  scroll: { flex: 1 },
  list: { paddingHorizontal: 8, paddingBottom: 20 },
  activeText: { color: colors.accent, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 12 },
  devicePickerSection: {
    position: 'relative',
    width: 164,
    maxWidth: '55%',
    zIndex: 40,
  },
  devicePicker: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  devicePickerCopy: { flex: 1, minWidth: 0 },
  devicePickerName: { color: colors.text, fontSize: 11, fontWeight: '800' },
  devicePickerDetail: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  deviceDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.overlay0 },
  deviceDotOnline: { backgroundColor: colors.online },
  deviceOptions: {
    position: 'absolute',
    top: 42,
    right: 0,
    width: 220,
    maxHeight: 220,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
    elevation: 24,
    shadowColor: colors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  deviceOptionsContent: {
    padding: 4,
    gap: 2,
  },
  deviceOption: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  deviceOptionActive: { backgroundColor: colors.accentDark },
  deviceOptionName: { color: colors.text, fontSize: 12, fontWeight: '700' },
  repoNavigationHead: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  repoBack: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
  },
  repoNavigationTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  fleetStates: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  fleetState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fleetStateDot: { width: 6, height: 6, borderRadius: 3 },
  fleetStateWorking: { backgroundColor: colors.warning },
  fleetStateIdle: { backgroundColor: colors.online },
  fleetStateIssue: { backgroundColor: colors.danger },
  fleetStateText: { color: colors.muted, fontSize: 9, fontFamily: 'monospace' },
  droneList: { paddingHorizontal: 8, paddingBottom: 24 },
  repoGroup: {
    borderBottomWidth: 1,
    borderBottomColor: colors.whiteWash,
  },
  repoRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 7,
    borderRadius: 4,
  },
  repoRowActive: { backgroundColor: colors.accentWash },
  repoCopy: { flex: 1, minWidth: 0 },
  repoName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  repoPath: { color: colors.muted, fontSize: 8, fontFamily: 'monospace', marginTop: 1 },
  repoCount: {
    minWidth: 23,
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  droneNode: { position: 'relative' },
  switchItemRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  switchItemRowActive: { backgroundColor: colors.panelRaised },
  switchItemCopy: { flex: 1, minWidth: 0 },
  switchItemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchItemTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  switchItemTime: {
    color: colors.subtle,
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  switchItemMeta: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.1,
    fontFamily: 'monospace',
  },
  switchItemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  switchStateDot: { width: 6, height: 6, borderRadius: 3 },
  droneChildren: { borderLeftWidth: 1, borderLeftColor: colors.border },
  groupRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
    borderRadius: 3,
  },
  groupName: { color: colors.muted, fontSize: 11, fontWeight: '800', flex: 1 },
  chatList: { gap: 1 },
  chatRow: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 8,
    borderRadius: 3,
  },
  chatRowActive: { backgroundColor: colors.panel },
  chatName: { color: colors.muted, fontSize: 11, fontFamily: 'monospace', flex: 1 },
  drawerFill: { flex: 1 },
  pressed: { opacity: 0.65 },
});
