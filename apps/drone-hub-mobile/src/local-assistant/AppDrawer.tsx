import React from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
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
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import LoaderCircle from 'lucide-react-native/icons/loader-circle';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import FolderGit2 from 'lucide-react-native/icons/folder-git-2';
import Folder from 'lucide-react-native/icons/folder';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
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
  type MobileDroneGroupFolder,
  type MobileDroneSidebarEntry,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
  type MobileDroneTreeNode,
} from '../drones/drone-sidebar-model';

export function appDrawerWidth(windowWidth: number): number {
  return Math.min(windowWidth, 460);
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
};

export type AppDrawerProps = {
  open: boolean;
  offset: Animated.Value;
  openingGestureActive?: boolean;
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
  onClose(): void;
  onCreateDrone?(): void;
  onRetryDrones?(): void;
  onSelectDroneChat?(droneId: string, chatName: string): void;
  onSelectDevice?(deviceId: string): void;
};

type RegisterDrawer = (props: AppDrawerProps) => void;

const AppDrawerHostContext = React.createContext<RegisterDrawer | null>(null);

export function AppDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerProps, setDrawerProps] = React.useState<AppDrawerProps | null>(null);
  const registerDrawer = React.useCallback<RegisterDrawer>((nextProps) => {
    setDrawerProps(nextProps);
  }, []);

  return (
    <AppDrawerHostContext.Provider value={registerDrawer}>
      {children}
      {drawerProps ? <AppDrawerView {...drawerProps} /> : null}
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
        accessibilityLabel="Choose device"
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

type DroneDisplayState = 'working' | 'waiting' | 'starting' | 'blocked' | 'offline' | 'idle';
type SwitchDisplayState = DroneDisplayState | 'done' | 'archiving' | 'deleting';
type DroneStateSummary = { working: number; idle: number; issues: number };
const EMPTY_DRONE_STATE_SUMMARY: DroneStateSummary = { working: 0, idle: 0, issues: 0 };

function droneDisplayState(drone: MobileDroneSummary): DroneDisplayState {
  const rawState = `${drone.phase ?? ''} ${drone.status ?? ''}`.toLowerCase();
  if (drone.busyChats.length > 0) return 'working';
  if (
    rawState.includes('block') ||
    rawState.includes('error') ||
    rawState.includes('fail') ||
    rawState.includes('problem')
  )
    return 'blocked';
  if (drone.statusOk === false) return 'offline';
  if (rawState.includes('wait')) return 'waiting';
  if (rawState.includes('start') || rawState.includes('creat') || rawState.includes('seed'))
    return 'starting';
  return 'idle';
}

function addDroneToStateSummary(summary: DroneStateSummary, drone: MobileDroneSummary): void {
  const state = droneDisplayState(drone);
  if (state === 'working' || state === 'starting') summary.working += 1;
  else if (state === 'blocked' || state === 'offline') summary.issues += 1;
  else summary.idle += 1;
}

function addDroneNodesToStateSummary(
  summary: DroneStateSummary,
  nodes: MobileDroneTreeNode[],
): void {
  for (const node of nodes) {
    addDroneToStateSummary(summary, node.drone);
    addDroneNodesToStateSummary(summary, node.children);
  }
}

function addDroneFoldersToStateSummary(
  summary: DroneStateSummary,
  folders: MobileDroneGroupFolder[],
): void {
  for (const folder of folders) {
    addDroneNodesToStateSummary(summary, folder.roots);
    addDroneFoldersToStateSummary(summary, folder.children);
  }
}

function summarizeDrones(drones: MobileDroneSummary[]): DroneStateSummary {
  const summary = { working: 0, idle: 0, issues: 0 };
  for (const drone of drones) addDroneToStateSummary(summary, drone);
  return summary;
}

function summarizeDroneScope(
  roots: MobileDroneTreeNode[],
  folders: MobileDroneGroupFolder[] = [],
): DroneStateSummary {
  const summary = { working: 0, idle: 0, issues: 0 };
  addDroneNodesToStateSummary(summary, roots);
  addDroneFoldersToStateSummary(summary, folders);
  return summary;
}

function DroneStateCounts({
  summary,
  compact = false,
}: {
  summary: DroneStateSummary;
  compact?: boolean;
}) {
  return (
    <View style={[styles.fleetStates, compact && styles.fleetStatesCompact]}>
      {summary.working > 0 ? (
        <View accessibilityLabel={`${summary.working} working`} style={styles.fleetState}>
          <WorkingStatusIndicator />
          <Text style={[styles.fleetStateText, styles.fleetStateTextWorking]}>
            {summary.working}
          </Text>
        </View>
      ) : null}
      {summary.idle > 0 ? (
        <View accessibilityLabel={`${summary.idle} available`} style={styles.fleetState}>
          <CircleCheck color={colors.online} size={12} strokeWidth={2.2} />
          <Text style={[styles.fleetStateText, styles.fleetStateTextIdle]}>{summary.idle}</Text>
        </View>
      ) : null}
      {summary.issues > 0 ? (
        <View accessibilityLabel={`${summary.issues} with issues`} style={styles.fleetState}>
          <CircleAlert color={colors.danger} size={12} strokeWidth={2.2} />
          <Text style={[styles.fleetStateText, styles.fleetStateTextIssue]}>{summary.issues}</Text>
        </View>
      ) : null}
    </View>
  );
}

function switchStateLabel(state: SwitchDisplayState): string {
  if (state === 'offline') return 'Unavailable';
  if (state === 'idle') return 'Ready';
  return `${state[0]?.toUpperCase() ?? ''}${state.slice(1)}`;
}

function switchStateColor(state: SwitchDisplayState): string {
  if (state === 'working' || state === 'archiving' || state === 'deleting')
    return colors.warning;
  if (state === 'waiting' || state === 'starting') return colors.info;
  if (state === 'blocked' || state === 'offline') return colors.danger;
  if (state === 'done') return colors.online;
  return colors.muted;
}

function SwitchItemState({
  state,
  detail,
  chatCount,
  unread = false,
}: {
  state: SwitchDisplayState;
  detail?: string;
  chatCount?: number;
  unread?: boolean;
}) {
  const stateColor = switchStateColor(state);
  const indicatorColor = unread && state !== 'working' ? colors.online : stateColor;
  const stateLabel = unread && state === 'idle' ? 'Unread' : switchStateLabel(state);
  return (
    <View
      accessible
      accessibilityLabel={[
        stateLabel,
        detail,
        unread && stateLabel !== 'Unread' ? 'unread chat' : '',
        chatCount != null && chatCount > 1 ? `${chatCount} chats` : '',
      ]
        .filter(Boolean)
        .join(', ')}
      style={styles.switchItemMetaRow}
    >
      {state === 'working' || state === 'archiving' || state === 'deleting' ? (
        <WorkingStatusIndicator />
      ) : (
        <View accessible={false} style={styles.switchStateIndicator}>
          <View style={[styles.switchStateDot, { backgroundColor: indicatorColor }]} />
        </View>
      )}
      <Text numberOfLines={1} style={[styles.switchItemMeta, { color: stateColor }]}>
        <Text style={{ color: indicatorColor }}>{stateLabel}</Text>
        {detail ? ` · ${detail}` : ''}
      </Text>
      {chatCount != null && chatCount > 1 ? (
        <View
          accessibilityLabel={`${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}`}
          style={styles.chatCount}
        >
          <MessageCircle color={colors.subtle} size={11} strokeWidth={1.9} />
          <Text style={styles.chatCountText}>{chatCount}</Text>
        </View>
      ) : null}
    </View>
  );
}

function WorkingStatusIndicator() {
  const phase = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [phase]);
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
  const operation = droneOperationById[drone.id];
  const displayState = operation ?? droneDisplayState(drone);
  const unread = (drone.unreadChats?.length ?? 0) > 0;
  return (
    <View style={styles.droneNode}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: Boolean(operation) }}
        accessibilityLabel={`Open ${drone.name} chat`}
        disabled={Boolean(operation)}
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
            <Text numberOfLines={1} style={[styles.switchItemTitle, selected && styles.activeText]}>
              {drone.name}
            </Text>
            <RelativeMessageTimestamp
              timestamp={drone.lastMessageAt}
              style={styles.switchItemTime}
            />
          </View>
          <SwitchItemState
            state={displayState}
            detail={drone.runtime}
            chatCount={chats.length}
            unread={unread}
          />
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
  activeDroneId,
  activeChatName,
  droneOperationById,
  onSelect,
}: {
  folder: MobileDroneGroupFolder;
  depth: number;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
  onSelect(droneId: string, chatName: string): void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const stateSummary = React.useMemo(
    () => summarizeDroneScope(folder.roots, folder.children),
    [folder],
  );
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => setCollapsed((current) => !current)}
        style={({ pressed }) => [
          styles.groupRow,
          { paddingLeft: 8 + depth * 18 },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.groupIcon}>
          <Folder color={colors.muted} size={15} strokeWidth={1.8} />
          <View style={styles.groupChevron}>
            <Chevron color={colors.muted} size={10} strokeWidth={2.3} />
          </View>
        </View>
        <Text numberOfLines={1} style={styles.groupName}>
          {folder.label}
        </Text>
        <DroneStateCounts summary={stateSummary} compact />
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
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              droneOperationById={droneOperationById}
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
  droneOperationById,
  onSelect,
}: {
  entry: MobileDroneSidebarEntry;
  depth: number;
  activeDroneId: string;
  activeChatName: string;
  droneOperationById: Record<string, 'archiving' | 'deleting'>;
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
      activeDroneId={activeDroneId}
      activeChatName={activeChatName}
      droneOperationById={droneOperationById}
      onSelect={onSelect}
    />
  );
}

export function AppDrawer(props: AppDrawerProps) {
  const registerDrawer = React.useContext(AppDrawerHostContext);

  React.useLayoutEffect(() => {
    registerDrawer?.(props);
  }, [props, registerDrawer]);

  if (registerDrawer) return null;
  return <AppDrawerView {...props} />;
}

function DrawerVoiceRecordingIndicator() {
  const {
    error,
    status,
    durationMillis,
    discardRecording,
    stopRecordingForTranscript,
  } = useSharedMobileChatVoiceRecorder();
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
  offset,
  openingGestureActive,
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
  onClose,
  onCreateDrone,
  onRetryDrones,
  onSelectDroneChat,
  onSelectDevice,
}: AppDrawerProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = appDrawerWidth(windowWidth);
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
  const droneGroups = React.useMemo(
    () => buildMobileDroneRepoGroups(drones, droneSidebarOrder),
    [droneSidebarOrder, drones],
  );
  const fleetStatus = React.useMemo(() => summarizeDrones(drones), [drones]);
  const repoStateSummaries = React.useMemo(
    () =>
      new Map(
        droneGroups.map((group) => [group.id, summarizeDroneScope(group.roots, group.folders)]),
      ),
    [droneGroups],
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
                    {item.active ? <View style={styles.navigationIndicator} /> : null}
                  </Pressable>
                );
              })}
            </View>
            {showDrones ? (
              <>
                <View style={styles.sidebarToolbar}>
                  {dronesLoading ? (
                    <View style={styles.loadingSummary}>
                      <ActivityIndicator color={colors.accent} size="small" />
                      <Text style={styles.loadingSummaryText}>Loading drones…</Text>
                    </View>
                  ) : !dronesReachable ? (
                    <Text numberOfLines={1} style={styles.sidebarToolbarText}>
                      Device unavailable
                    </Text>
                  ) : dronesError ? (
                    <Text numberOfLines={1} style={styles.sidebarToolbarText}>
                      Could not load drones
                    </Text>
                  ) : (
                    <Text numberOfLines={1} style={styles.sidebarToolbarText}>
                      {drones.length} {drones.length === 1 ? 'drone' : 'drones'} ·{' '}
                      {droneGroups.length}{' '}
                      {droneGroups.length === 1 ? 'repository' : 'repositories'}
                    </Text>
                  )}
                  <View style={styles.sidebarToolbarActions}>
                    <DroneStateCounts summary={fleetStatus} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Create new drone"
                      accessibilityState={{ disabled: !onCreateDrone }}
                      disabled={!onCreateDrone}
                      onPress={onCreateDrone}
                      style={({ pressed }) => [
                        styles.create,
                        !onCreateDrone && styles.createDisabled,
                        pressed && styles.pressed,
                      ]}
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
                    style={({ pressed }) => [styles.repoNavigationHead, pressed && styles.pressed]}
                  >
                    <View style={styles.groupIcon}>
                      <FolderGit2 color={colors.accent} size={16} strokeWidth={1.9} />
                      <View style={styles.groupChevron}>
                        <ChevronLeft color={colors.accent} size={10} strokeWidth={2.3} />
                      </View>
                    </View>
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
                    <DroneStateCounts
                      summary={repoStateSummaries.get(activeRepo.id) ?? EMPTY_DRONE_STATE_SUMMARY}
                      compact
                    />
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
                          droneOperationById={droneOperationById}
                          onSelect={(droneId, chatName) => onSelectDroneChat?.(droneId, chatName)}
                        />
                      ))
                    : droneGroups.map((group) => {
                        const stateSummary =
                          repoStateSummaries.get(group.id) ?? EMPTY_DRONE_STATE_SUMMARY;
                        return (
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
                              <DroneStateCounts summary={stateSummary} compact />
                              <ChevronRight color={colors.muted} size={15} strokeWidth={2} />
                            </Pressable>
                          </View>
                        );
                      })}
                  {!dronesLoading && !dronesReachable ? (
                    <Text style={styles.empty}>
                      No mesh route is currently available. Connect any paired Hub and try again.
                    </Text>
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
            <DrawerVoiceRecordingIndicator />
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
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  navigationItemActive: { backgroundColor: colors.accentWash },
  navigationLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
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
  activeText: { color: colors.accent, fontWeight: '800' },
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
  retryText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
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
  devicePickerCopy: { flex: 1, minWidth: 0 },
  devicePickerName: { color: colors.text, fontSize: 12, fontWeight: '700' },
  devicePickerDetail: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  deviceDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.overlay0 },
  deviceDotOnline: { backgroundColor: colors.online },
  deviceOptions: {
    position: 'absolute',
    top: 46,
    right: 0,
    width: 220,
    maxHeight: 220,
    borderRadius: 8,
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
    padding: 5,
    gap: 2,
  },
  deviceOption: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    borderRadius: 5,
  },
  deviceOptionActive: { backgroundColor: colors.accentWash },
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
  repoNavigationTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  fleetStates: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  fleetStatesCompact: { flexShrink: 0, gap: 6 },
  fleetState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fleetStateText: { color: colors.muted, fontSize: 9, fontFamily: 'monospace' },
  fleetStateTextWorking: { color: colors.warning },
  fleetStateTextIdle: { color: colors.online },
  fleetStateTextIssue: { color: colors.danger },
  droneList: { paddingHorizontal: 8, paddingBottom: 24 },
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
    borderRadius: 4,
  },
  repoRowActive: { backgroundColor: colors.accentWash },
  repoCopy: { flex: 1, minWidth: 0 },
  repoName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  repoPath: { color: colors.muted, fontSize: 8, fontFamily: 'monospace', marginTop: 1 },
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
  switchStateIndicator: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchStateDot: { width: 6, height: 6, borderRadius: 3 },
  workingStatusIndicator: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  chatCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 2,
  },
  chatCountText: { color: colors.subtle, fontSize: 9, fontFamily: 'monospace' },
  droneChildren: {},
  groupRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 8,
    borderRadius: 3,
  },
  groupIcon: {
    width: 20,
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
    backgroundColor: colors.background,
  },
  groupName: { color: colors.muted, fontSize: 11, fontWeight: '800', flex: 1 },
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
  voiceFooterLabel: { flex: 1, color: colors.accent, fontSize: 11, fontWeight: '800' },
  voiceFooterLabelError: { color: colors.danger },
  voiceFooterTimer: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '800',
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
  voiceFooterButtonText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  voiceFooterCancelText: { color: colors.danger },
  voiceFooterStopText: { color: colors.online },
  pressed: { opacity: 0.65 },
});
