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
import MessageCircle from 'lucide-react-native/icons/message-circle';
import Network from 'lucide-react-native/icons/network';
import Plane from 'lucide-react-native/icons/plane';
import Plus from 'lucide-react-native/icons/plus';
import Settings from 'lucide-react-native/icons/settings';
import X from 'lucide-react-native/icons/x';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import FolderGit2 from 'lucide-react-native/icons/folder-git-2';
import Folder from 'lucide-react-native/icons/folder';
import { colors } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { assistantThreadsNewestFirst } from './latest-assistant-thread';
import {
  buildMobileDroneRepoGroups,
  type MobileDroneGroupFolder,
  type MobileDroneSummary,
  type MobileDroneTreeNode,
} from '../drones/drone-sidebar-model';

export function assistantDrawerWidth(windowWidth: number): number {
  return Math.min(windowWidth * 0.86, 380);
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
          {activeDevice?.detail ? (
            <Text numberOfLines={1} style={styles.devicePickerDetail}>
              {activeDevice.detail}
            </Text>
          ) : null}
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

function navigationIcon(id: string) {
  if (id === 'drones') return Plane;
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
  const busy = drone.busyChats.length > 0;
  const stateLabel =
    drone.statusOk === false
      ? 'Unavailable'
      : busy
        ? 'Responding'
        : drone.phase || drone.status || drone.runtime;
  return (
    <View style={styles.droneNode}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`Open ${drone.name} chat`}
        onPress={() => onSelect(drone.id, selectedChat)}
        style={({ pressed }) => [
          styles.droneRow,
          { paddingLeft: 10 + depth * 16 },
          selected && styles.droneRowActive,
          pressed && styles.pressed,
        ]}
      >
        {selected ? <View style={styles.selectedEdge} /> : null}
        <View style={[styles.droneIcon, selected && styles.droneIconActive]}>
          <Plane color={selected ? colors.accent : colors.muted} size={14} strokeWidth={1.9} />
        </View>
        <View style={styles.droneCopy}>
          <Text numberOfLines={1} style={[styles.droneName, selected && styles.activeText]}>
            {drone.name}
          </Text>
          <Text numberOfLines={1} style={styles.droneMeta}>
            {drone.runtime} · {stateLabel}
          </Text>
        </View>
        {busy && chats.length === 1 ? (
          <ActivityIndicator color={colors.warning} size="small" />
        ) : (
          <View
            style={[
              styles.droneStatus,
              drone.statusOk === false ? styles.droneStatusError : styles.droneStatusOnline,
            ]}
          />
        )}
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
          {folder.roots.map((node) => (
            <DrawerDroneNode
              key={node.drone.id}
              node={node}
              depth={depth + 1}
              activeDroneId={activeDroneId}
              activeChatName={activeChatName}
              onSelect={onSelect}
            />
          ))}
          {folder.children.map((child) => (
            <DrawerDroneFolder
              key={child.id}
              folder={child}
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

export function AssistantThreadDrawer({
  open,
  title: _title,
  threads,
  activeThreadId,
  creating,
  offset,
  openingGestureActive,
  navigationItems,
  canCreate = true,
  showThreads = true,
  showDrones = false,
  drones = [],
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
}: {
  open: boolean;
  title: string;
  threads: DrawerAssistantThread[];
  activeThreadId: string;
  creating?: boolean;
  offset: Animated.Value;
  openingGestureActive?: boolean;
  navigationItems: AppDrawerNavigationItem[];
  canCreate?: boolean;
  showThreads?: boolean;
  showDrones?: boolean;
  drones?: MobileDroneSummary[];
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
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = assistantDrawerWidth(windowWidth);
  const closedX = -drawerWidth;
  const [visible, setVisible] = React.useState(open);
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
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          gesture.dx < -3 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dx < -3 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onPanResponderGrant: () => {
          offset.stopAnimation();
        },
        onPanResponderMove: (_event, gesture) => {
          offset.setValue(Math.max(closedX, Math.min(0, gesture.dx)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -drawerWidth * 0.3 || gesture.vx <= -0.45) {
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
        },
        onPanResponderTerminate: () => {
          Animated.spring(offset, {
            toValue: 0,
            damping: 24,
            stiffness: 260,
            mass: 0.85,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [closedX, drawerWidth, offset, onClose],
  );
  const orderedThreads = React.useMemo(() => assistantThreadsNewestFirst(threads), [threads]);
  const droneGroups = React.useMemo(() => buildMobileDroneRepoGroups(drones), [drones]);
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
      <View style={styles.layer} {...panResponder.panHandlers}>
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
          <View style={styles.header}>
            <View style={styles.brandMark}>
              <Plane color={colors.crust} size={19} strokeWidth={2.4} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Drone Hub</Text>
              <Text style={styles.brandSubtitle}>PRIVATE MESH CONTROL</Text>
            </View>
            <Pressable onPress={onClose} style={styles.close}>
              <X color={colors.muted} size={20} strokeWidth={2} />
            </Pressable>
          </View>
          {devicePickerItems.length > 0 ? (
            <DrawerDevicePicker
              devices={devicePickerItems}
              activeDeviceId={activeDeviceId}
              onSelect={onSelectDevice}
            />
          ) : null}
          <View style={styles.navigation}>
            <Text style={styles.sectionLabel}>NAVIGATION</Text>
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
              <View style={styles.threadToolbar}>
                <Text style={styles.threadCount}>
                  {threads.length} {threads.length === 1 ? 'thread' : 'threads'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create new thread"
                  disabled={creating || !canCreate}
                  onPress={onCreate}
                  style={({ pressed }) => [
                    styles.create,
                    !canCreate && styles.createDisabled,
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
                  return (
                    <Pressable
                      key={thread.id}
                      onPress={() => onSelect(thread.id)}
                      style={({ pressed }) => [styles.thread, pressed && styles.pressed]}
                    >
                      <Text
                        numberOfLines={2}
                        style={[styles.threadTitle, active && styles.activeText]}
                      >
                        {thread.title || 'Untitled thread'}
                      </Text>
                    </Pressable>
                  );
                })}
                {threads.length === 0 ? (
                  <Text style={styles.empty}>
                    No threads here yet. Create one to start a conversation.
                  </Text>
                ) : null}
              </ScrollView>
            </>
          ) : showDrones ? (
            <>
              {dronesLoading ? (
                <View style={styles.droneLoading}>
                  <ActivityIndicator color={colors.accent} size="small" />
                </View>
              ) : null}
              {activeRepo ? (
                <View style={styles.repoNavigationHead}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to repositories"
                    onPress={() => setActiveRepoId(null)}
                    style={({ pressed }) => [styles.repoBack, pressed && styles.pressed]}
                  >
                    <ChevronLeft color={colors.accent} size={18} strokeWidth={2.2} />
                  </Pressable>
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
                </View>
              ) : null}
              <ScrollView style={styles.scroll} contentContainerStyle={styles.droneList}>
                {activeRepo
                  ? [
                      ...activeRepo.roots.map((node) => (
                        <DrawerDroneNode
                          key={node.drone.id}
                          node={node}
                          depth={0}
                          activeDroneId={activeDroneId}
                          activeChatName={activeChatName}
                          onSelect={(droneId, chatName) =>
                            onSelectDroneChat?.(droneId, chatName)
                          }
                        />
                      )),
                      ...activeRepo.folders.map((folder) => (
                        <DrawerDroneFolder
                          key={folder.id}
                          folder={folder}
                          depth={0}
                          activeDroneId={activeDroneId}
                          activeChatName={activeChatName}
                          onSelect={(droneId, chatName) =>
                            onSelectDroneChat?.(droneId, chatName)
                          }
                        />
                      )),
                    ]
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
            <View style={styles.drawerFill} />
          )}
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
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
    backgroundColor: colors.accent,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.textStrong, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  brandSubtitle: {
    color: colors.subtle,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginTop: 2,
  },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  navigation: {
    gap: 2,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navigationItem: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navigationItemActive: { backgroundColor: colors.accentDark, borderColor: colors.accentBorder },
  navigationLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  navigationLabelActive: { color: colors.accentAlt },
  sectionLabel: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginHorizontal: 10,
    marginBottom: 7,
  },
  threadToolbar: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  threadCount: { color: colors.muted, fontSize: 10, fontWeight: '800' },
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
  list: { paddingHorizontal: 12, paddingBottom: 20 },
  thread: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  threadTitle: { color: colors.muted, fontSize: 13, lineHeight: 17, fontWeight: '700' },
  activeText: { color: colors.accent, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 12 },
  droneLoading: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  devicePickerSection: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  devicePicker: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  devicePickerCopy: { flex: 1, minWidth: 0 },
  devicePickerName: { color: colors.text, fontSize: 13, fontWeight: '800' },
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
    maxHeight: 220,
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
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
    borderRadius: 7,
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
    borderRadius: 8,
  },
  repoNavigationTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  droneList: { paddingHorizontal: 9, paddingBottom: 24, gap: 5 },
  repoGroup: {
    borderWidth: 1,
    borderColor: colors.whiteWash,
    borderRadius: 10,
    backgroundColor: colors.whiteWashSoft,
    overflow: 'hidden',
  },
  repoRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 7,
    borderRadius: 8,
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
  droneRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 7,
    borderRadius: 7,
  },
  droneRowActive: { backgroundColor: colors.panel },
  selectedEdge: {
    position: 'absolute',
    left: 0,
    top: 7,
    bottom: 7,
    width: 2,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  droneIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  droneIconActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  droneCopy: { flex: 1, minWidth: 0 },
  droneName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  droneMeta: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '700',
    marginTop: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  droneStatus: { width: 7, height: 7, borderRadius: 4, marginRight: 4 },
  droneStatusOnline: { backgroundColor: colors.online },
  droneStatusError: { backgroundColor: colors.danger },
  droneChildren: { borderLeftWidth: 1, borderLeftColor: colors.border },
  groupRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
    borderRadius: 6,
  },
  groupName: { color: colors.muted, fontSize: 11, fontWeight: '800', flex: 1 },
  chatList: { gap: 1 },
  chatRow: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 8,
    borderRadius: 6,
  },
  chatRowActive: { backgroundColor: colors.panel },
  chatName: { color: colors.muted, fontSize: 11, fontFamily: 'monospace', flex: 1 },
  drawerFill: { flex: 1 },
  pressed: { opacity: 0.65 },
});
