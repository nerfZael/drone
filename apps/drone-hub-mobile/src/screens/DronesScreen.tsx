import React from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { DroneChatComposer, DroneChatTranscript } from '../drones/DroneChatView';
import {
  AssistantThreadDrawer,
  type AppDrawerNavigationItem,
} from '../local-assistant/AssistantThreadDrawer';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import {
  mobileRepoLabel,
  normalizeMobileDroneListPayload,
  normalizeMobileDroneTurns,
  type MobileDroneSummary,
} from '../drones/drone-sidebar-model';

const APP_HEADER_HEIGHT = 54;

export function DronesScreen({
  drawerOpen,
  drawerOffset,
  navigationItems,
  openingGestureActive,
  onDrawerOpenChange,
}: {
  drawerOpen: boolean;
  drawerOffset: Animated.Value;
  navigationItems: AppDrawerNavigationItem[];
  openingGestureActive: boolean;
  onDrawerOpenChange(open: boolean): void;
}) {
  const mesh = useMesh();
  const insets = useSafeAreaInsets();
  const transcriptRef = React.useRef<ScrollView>(null);
  const targets = mesh.devices.filter(
    (device) =>
      device.id !== mesh.identity?.id &&
      !device.revokedAt &&
      (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
        (capability) => capability.id === 'drone-control',
      ),
  );
  const [targetId, setTargetId] = React.useState(targets[0]?.id ?? '');
  const [drones, setDrones] = React.useState<MobileDroneSummary[]>([]);
  const [selected, setSelected] = React.useState<MobileDroneSummary | null>(null);
  const [chats, setChats] = React.useState<string[]>([]);
  const [chatName, setChatName] = React.useState('default');
  const [chatModel, setChatModel] = React.useState('');
  const [turns, setTurns] = React.useState<any[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [createName, setCreateName] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const targetIdRef = React.useRef(targetId);
  targetIdRef.current = targetId;

  React.useEffect(() => {
    if (!targets.some((target) => target.id === targetId)) setTargetId(targets[0]?.id ?? '');
  }, [targetId, targets]);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy('');
    }
  };

  const loadDrones = React.useCallback(
    async (quiet = false) => {
      if (!targetId) return;
      if (!quiet) setBusy('drones');
      setError(null);
      try {
        const result = await mesh.request(targetId, 'drone-control', 'drones.list');
        if (targetIdRef.current !== targetId) return;
        const normalized = normalizeMobileDroneListPayload(result);
        const nextDrones = normalized.drones;
        setDrones(nextDrones);
        setSelected((current) =>
          current ? (nextDrones.find((drone) => drone.id === current.id) ?? null) : null,
        );
        if (
          normalized.schemaVersion !== 2 &&
          nextDrones.length > 0 &&
          nextDrones.every((drone) => !drone.repoPath)
        ) {
          setError(
            'This device returned the legacy drone list without repository metadata. Update and restart DroneHub on the selected device.',
          );
        }
      } catch (nextError: any) {
        setError(nextError?.message ?? String(nextError));
      } finally {
        if (!quiet) setBusy('');
      }
    },
    [mesh.request, targetId],
  );

  React.useEffect(() => {
    setDrones([]);
    setSelected(null);
    setChatModel('');
    setTurns([]);
    if (targetId) void loadDrones();
  }, [loadDrones, targetId]);

  const openDrone = (drone: MobileDroneSummary, requestedChat?: string) =>
    run('chats', async () => {
      const destinationId = targetId;
      setSelected(drone);
      const result = await mesh.request(destinationId, 'drone-control', 'chats.list', {
        droneId: drone.id,
      });
      if (targetIdRef.current !== destinationId) return;
      const nextChats =
        Array.isArray(result?.chats) && result.chats.length > 0
          ? result.chats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean)
          : drone.chats;
      const nextChat =
        requestedChat && nextChats.includes(requestedChat)
          ? requestedChat
          : (nextChats[0] ?? 'default');
      setChats(nextChats);
      setChatName(nextChat);
      setChatModel('');
      setTurns([]);
      const chat = await mesh.request(destinationId, 'drone-control', 'chat.read', {
        droneId: drone.id,
        chatName: nextChat,
      });
      if (targetIdRef.current !== destinationId) return;
      setChatModel(String(chat?.model ?? '').trim());
      setTurns(Array.isArray(chat?.turns) ? chat.turns : []);
    });

  const readChat = async (droneId: string, nextChat: string) => {
    const destinationId = targetId;
    const result = await mesh.request(destinationId, 'drone-control', 'chat.read', {
      droneId,
      chatName: nextChat,
    });
    if (targetIdRef.current !== destinationId) return;
    setChatModel(String(result?.model ?? '').trim());
    setTurns(Array.isArray(result?.turns) ? result.turns : []);
  };

  const loadChat = () => selected && run('chat', async () => await readChat(selected.id, chatName));

  const selectChat = (nextChat: string) =>
    selected &&
    run('chat', async () => {
      setChatName(nextChat);
      setChatModel('');
      setTurns([]);
      await readChat(selected.id, nextChat);
    });

  const sendPrompt = () =>
    selected &&
    run('prompt', async () => {
      await mesh.request(targetId, 'drone-control', 'chat.prompt', {
        droneId: selected.id,
        chatName,
        prompt,
      });
      setPrompt('');
      await readChat(selected.id, chatName);
      await loadDrones(true);
    });

  const createDrone = (runtime: 'host' | 'container') =>
    run(`create-${runtime}`, async () => {
      await mesh.request(targetId, 'drone-control', `drone.create.${runtime}`, {
        name: createName || undefined,
      });
      setCreateName('');
      await loadDrones();
    });

  const stopChat = () =>
    selected &&
    run('stop', async () => {
      await mesh.request(targetId, 'drone-control', 'chat.stop', {
        droneId: selected.id,
        chatName,
      });
      await readChat(selected.id, chatName);
      await loadDrones(true);
    });

  const normalizedTurns = React.useMemo(() => normalizeMobileDroneTurns(turns), [turns]);
  const latestModel = [...normalizedTurns].reverse().find((turn) => turn.model)?.model;
  const running =
    busy === 'prompt' ||
    busy === 'stop' ||
    Boolean(selected?.busyChats.some((chat) => chat === chatName));
  const activeTarget = targets.find((target) => target.id === targetId);

  const targetStrip = (
    <View style={styles.targetStrip}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.targets}
      >
        {targets.map((target) => (
          <Pressable
            key={target.id}
            onPress={() => {
              setTargetId(target.id);
              setDrones([]);
              setSelected(null);
            }}
            style={[styles.target, target.id === targetId && styles.targetActive]}
          >
            <View
              style={[
                styles.targetDot,
                mesh.connectedDeviceIds.includes(target.id) && styles.targetDotOnline,
              ]}
            />
            <Text style={[styles.targetText, target.id === targetId && styles.targetTextActive]}>
              {target.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.screen}>
      <AssistantThreadDrawer
        open={drawerOpen}
        title={targets.find((target) => target.id === targetId)?.name ?? 'On device'}
        threads={[]}
        activeThreadId=""
        offset={drawerOffset}
        openingGestureActive={openingGestureActive}
        navigationItems={navigationItems}
        showThreads={false}
        showDrones
        drones={drones}
        activeDroneId={selected?.id ?? ''}
        activeChatName={chatName}
        dronesLoading={busy === 'drones'}
        onClose={() => onDrawerOpenChange(false)}
        onSelect={() => {}}
        onCreate={() => {}}
        onSelectDroneChat={(droneId, nextChat) => {
          const drone = drones.find((item) => item.id === droneId);
          if (!drone) return;
          onDrawerOpenChange(false);
          void openDrone(drone, nextChat);
        }}
      />
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
        keyboardVerticalOffset={insets.top + APP_HEADER_HEIGHT}
      >
        {selected ? (
          <View style={styles.chatWorkspace}>
            {targetStrip}
            <View style={styles.chatHeader}>
              <View style={styles.chatIdentity}>
                <View style={styles.chatTitleRow}>
                  <View
                    style={[
                      styles.chatStatus,
                      selected.statusOk !== false && styles.chatStatusOnline,
                    ]}
                  />
                  <Text numberOfLines={1} style={styles.chatTitle}>
                    {selected.name}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.chatSubtitle}>
                  {mobileRepoLabel(selected.repoPath)} · {selected.runtime}
                  {activeTarget ? ` · ${activeTarget.name}` : ''}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh transcript"
                accessibilityState={{ disabled: busy === 'chat' }}
                disabled={busy === 'chat'}
                onPress={() => void loadChat()}
                style={({ pressed }) => [
                  styles.refreshButton,
                  busy === 'chat' && styles.controlDisabled,
                  pressed && styles.controlPressed,
                ]}
              >
                <RefreshCw color={colors.muted} size={16} strokeWidth={1.8} />
              </Pressable>
            </View>
            <View style={styles.chatTabsFrame}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chats}
              >
                {(chats.length > 0 ? chats : [chatName]).map((chat) => (
                  <Pressable
                    key={chat}
                    onPress={() => chat !== chatName && void selectChat(chat)}
                    style={[styles.chatTab, chat === chatName && styles.chatTabActive]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.chatText, chat === chatName && styles.chatTextActive]}
                    >
                      {chat}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            {error ? (
              <View style={styles.chatError}>
                <ErrorBanner message={error} />
              </View>
            ) : null}
            <ScrollView
              ref={transcriptRef}
              style={styles.transcriptScroll}
              contentContainerStyle={styles.transcriptContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => transcriptRef.current?.scrollToEnd({ animated: false })}
            >
              <DroneChatTranscript
                turns={normalizedTurns}
                loading={busy === 'chats' || busy === 'chat'}
                running={running}
              />
            </ScrollView>
            <DroneChatComposer
              value={prompt}
              chatName={chatName}
              model={latestModel || chatModel}
              sending={busy === 'prompt'}
              running={running}
              onChangeText={setPrompt}
              onSend={() => void sendPrompt()}
              onStop={() => void stopChat()}
            />
          </View>
        ) : (
          <View style={styles.landing}>
            {targetStrip}
            <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
              <View>
                <Label>Drone control</Label>
                <Text style={[textStyles.title, styles.title]}>Choose a drone from the menu.</Text>
                <Text style={textStyles.body}>
                  Drones are organized by repository, group, fleet hierarchy, and chat in the
                  DroneHub menu.
                </Text>
              </View>
              {targets.length === 0 ? (
                <Card>
                  <Text style={textStyles.body}>
                    No destination devices are known yet. Pair a Hub first.
                  </Text>
                </Card>
              ) : null}
              <ErrorBanner message={error} />
              {targetId ? (
                <Button onPress={() => void loadDrones()} loading={busy === 'drones'}>
                  Refresh drones
                </Button>
              ) : null}
              {drones.length > 0 ? (
                <Card>
                  <Label>Available</Label>
                  <Text style={[textStyles.heading, styles.createTitle]}>
                    {drones.length} {drones.length === 1 ? 'drone' : 'drones'} on this device
                  </Text>
                  <Text style={textStyles.body}>
                    Open the DroneHub menu and choose a drone or chat from the repository tree.
                  </Text>
                </Card>
              ) : null}
              {targetId ? (
                <Card>
                  <Label>Create</Label>
                  <Text style={[textStyles.heading, styles.createTitle]}>
                    New drone on this device
                  </Text>
                  <TextInput
                    value={createName}
                    onChangeText={setCreateName}
                    placeholder="Optional name"
                    placeholderTextColor="#5f767d"
                    style={styles.nameInput}
                  />
                  <View style={styles.createButtons}>
                    <Button
                      style={styles.flex}
                      tone="quiet"
                      onPress={() => void createDrone('container')}
                      loading={busy === 'create-container'}
                    >
                      Container
                    </Button>
                    <Button
                      style={styles.flex}
                      onPress={() => void createDrone('host')}
                      loading={busy === 'create-host'}
                    >
                      Host
                    </Button>
                  </View>
                </Card>
              ) : null}
            </ScrollView>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  landing: { flex: 1 },
  page: { padding: 20, gap: 14 },
  title: { marginTop: 6, marginBottom: 8 },
  targetStrip: {
    flexShrink: 0,
    minHeight: 51,
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  targets: { gap: 8, paddingHorizontal: 12, paddingVertical: 7 },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
  },
  targetActive: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  targetDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#53676d' },
  targetDotOnline: { backgroundColor: colors.online },
  targetText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  targetTextActive: { color: colors.text },
  chatWorkspace: { flex: 1, backgroundColor: colors.background },
  chatHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 12,
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatIdentity: { flex: 1, minWidth: 0 },
  chatTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatStatus: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  chatStatusOnline: { backgroundColor: colors.online },
  chatTitle: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '800' },
  chatSubtitle: {
    color: colors.muted,
    fontSize: 9,
    fontFamily: 'monospace',
    marginTop: 4,
    marginLeft: 15,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  refreshButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  controlDisabled: { opacity: 0.4 },
  controlPressed: { opacity: 0.7 },
  chatTabsFrame: {
    minHeight: 39,
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chats: { gap: 5, paddingHorizontal: 12, paddingVertical: 5 },
  chatTab: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 7 },
  chatTabActive: { backgroundColor: colors.accentDark },
  chatText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  chatTextActive: { color: colors.accent },
  chatError: { paddingHorizontal: 12, paddingTop: 9 },
  transcriptScroll: { flex: 1 },
  transcriptContent: { flexGrow: 1 },
  createTitle: { marginTop: 4, marginBottom: 12 },
  nameInput: {
    color: colors.text,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  createButtons: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
