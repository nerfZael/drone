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
import { colors } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { assistantThreadsNewestFirst } from './latest-assistant-thread';

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

function navigationIcon(id: string) {
  if (id === 'drones') return Plane;
  if (id === 'devices') return Network;
  if (id === 'settings') return Settings;
  return MessageCircle;
}

export function AssistantThreadDrawer({
  open,
  title,
  threads,
  activeThreadId,
  creating,
  offset,
  openingGestureActive,
  navigationItems,
  canCreate = true,
  showThreads = true,
  onClose,
  onSelect,
  onCreate,
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
  onClose(): void;
  onSelect(threadId: string): void;
  onCreate(): void;
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
            <View style={styles.headerCopy}>
              <Text style={styles.title}>DroneHub</Text>
            </View>
            <Pressable onPress={onClose} style={styles.close}>
              <X color={colors.muted} size={20} strokeWidth={2} />
            </Pressable>
          </View>
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
              <View style={styles.threadSectionHead}>
                <View style={styles.threadSectionCopy}>
                  <Text style={[styles.sectionLabel, styles.threadSectionLabel]}>THREADS</Text>
                  <Text numberOfLines={1} style={styles.threadSectionTitle}>
                    {title}
                  </Text>
                </View>
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
    backgroundColor: 'rgba(3, 10, 12, 0.62)',
  },
  drawer: {
    flex: 1,
    backgroundColor: colors.background,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    elevation: 20,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 10, height: 0 },
    overflow: 'hidden',
  },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
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
    borderRadius: 9,
  },
  navigationItemActive: { backgroundColor: colors.panel },
  navigationLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  navigationLabelActive: { color: colors.text },
  sectionLabel: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginHorizontal: 10,
    marginBottom: 7,
  },
  threadSectionHead: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
    paddingRight: 14,
    paddingTop: 10,
  },
  threadSectionCopy: { flex: 1, minWidth: 0 },
  threadSectionLabel: { marginHorizontal: 0, marginBottom: 0 },
  threadSectionTitle: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 3 },
  create: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
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
  drawerFill: { flex: 1 },
  pressed: { opacity: 0.65 },
});
