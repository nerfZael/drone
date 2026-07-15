import React from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmDialog, ErrorBanner } from '../components/Ui';
import { QueuedPromptRows } from '../components/QueuedPromptRows';
import {
  AssistantThreadDrawer,
  type AppDrawerNavigationItem,
  type DrawerDevicePickerItem,
} from '../local-assistant/AssistantThreadDrawer';
import { AssistantComposer } from '../local-assistant/AssistantComposer';
import {
  AssistantModelPicker,
  type AssistantModelChoice,
} from '../local-assistant/AssistantModelPicker';
import { MobileAssistantTranscript } from '../local-assistant/LocalAssistantTranscript';
import { useLatestMessageScroll } from '../local-assistant/use-latest-message-scroll';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import {
  NewDroneScreen,
  type MobileBuiltinAgentId,
  type MobileDroneAgentPermissionMode,
  type MobileDroneCreateDefaults,
  type MobileDroneCreatePayload,
} from '../drones/NewDroneScreen';
import {
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  mobileRepoLabel,
  mobileDroneTurnsToAssistantMessages,
  normalizeMobileDroneCreateModelCatalog,
  normalizeMobileDroneListPayload,
  normalizeMobileDroneTurns,
  suggestNextMobileDroneChatName,
  type MobileDroneCreateRepo,
  type MobileDroneCreateModel,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
} from '../drones/drone-sidebar-model';
import { mobileDronePendingPrompts } from '../drones/mobile-pending-prompts';

const APP_HEADER_HEIGHT = 58;

export type DronesAppHeaderState = {
  title: string;
  subtitle: string;
  onNewDrone?(): void;
  onNewChat?(): void;
  onDelete?(): void;
};

function mobileBuiltinAgentId(value: unknown): MobileBuiltinAgentId | null {
  const id = String(value ?? '').trim();
  return ['cursor', 'codex', 'claude', 'opencode', 'pi', 'blip'].includes(id)
    ? (id as MobileBuiltinAgentId)
    : null;
}

export function DronesScreen({
  drawerOpen,
  drawerOffset,
  navigationItems,
  openingGestureActive,
  onDrawerOpenChange,
  onHeaderChange,
  selectedDeviceId,
  devicePickerItems,
  onDeviceChange,
}: {
  drawerOpen: boolean;
  drawerOffset: Animated.Value;
  navigationItems: AppDrawerNavigationItem[];
  openingGestureActive: boolean;
  onDrawerOpenChange(open: boolean): void;
  onHeaderChange(header: DronesAppHeaderState | null): void;
  selectedDeviceId: string;
  devicePickerItems: DrawerDevicePickerItem[];
  onDeviceChange(deviceId: string): void;
}) {
  const mesh = useMesh();
  const insets = useSafeAreaInsets();
  const targets = mesh.devices.filter(
    (device) =>
      device.id !== mesh.identity?.id &&
      !device.revokedAt &&
      (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
        (capability) => capability.id === 'drone-control',
      ),
  );
  const targetId = selectedDeviceId;
  const targetSupportsDrones = targets.some((target) => target.id === targetId);
  const targetConnected = mesh.connectedDeviceIds.includes(targetId);
  const [drones, setDrones] = React.useState<MobileDroneSummary[]>([]);
  const [droneSidebarOrder, setDroneSidebarOrder] = React.useState<MobileDroneSidebarOrder>(
    EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  );
  const [selected, setSelected] = React.useState<MobileDroneSummary | null>(null);
  const [chats, setChats] = React.useState<string[]>([]);
  const [chatName, setChatName] = React.useState('default');
  const [chatModel, setChatModel] = React.useState('');
  const [chatReasoning, setChatReasoning] = React.useState('');
  const [chatModelProvider, setChatModelProvider] = React.useState('drone');
  const [chatAgentId, setChatAgentId] = React.useState<MobileBuiltinAgentId | null>(null);
  const [chatAgentPermissionMode, setChatAgentPermissionMode] =
    React.useState<MobileDroneAgentPermissionMode>('full-access');
  const [chatModels, setChatModels] = React.useState<AssistantModelChoice[]>([]);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [modelBusy, setModelBusy] = React.useState(false);
  const [turns, setTurns] = React.useState<any[]>([]);
  const [pendingPrompts, setPendingPrompts] = React.useState<any[]>([]);
  const [cancellingPromptId, setCancellingPromptId] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [createRepos, setCreateRepos] = React.useState<MobileDroneCreateRepo[]>([]);
  const [busy, setBusy] = React.useState('');
  const [dronesLoaded, setDronesLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = React.useState<MobileDroneSummary | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [newDroneDefaults, setNewDroneDefaults] = React.useState<MobileDroneCreateDefaults | null>(
    null,
  );
  const [newDroneScreenVersion, setNewDroneScreenVersion] = React.useState(0);
  const [composerFocusKey, setComposerFocusKey] = React.useState('');
  const targetIdRef = React.useRef(targetId);
  const selectedRef = React.useRef(selected);
  const chatNameRef = React.useRef(chatName);
  const realtimeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const droneListVersion = React.useRef(0);
  const chatReadVersion = React.useRef(0);
  const openDroneVersion = React.useRef(0);
  const runVersion = React.useRef(0);
  const busyVersion = React.useRef(0);
  const modelRequestVersion = React.useRef(0);
  const createModelCatalogCache = React.useRef(new Map<string, MobileDroneCreateModel[]>());
  const readChatRef = React.useRef<(droneId: string, chatName: string) => Promise<void>>(
    async () => {},
  );
  targetIdRef.current = targetId;
  selectedRef.current = selected;
  chatNameRef.current = chatName;

  const run = async (key: string, task: () => Promise<void>) => {
    const requestVersion = ++runVersion.current;
    const busyRequestVersion = ++busyVersion.current;
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (nextError: any) {
      if (runVersion.current === requestVersion) setError(nextError?.message ?? String(nextError));
    } finally {
      if (busyVersion.current === busyRequestVersion) setBusy('');
    }
  };

  const loadDrones = React.useCallback(
    async (quiet = false) => {
      if (!targetId || !targetSupportsDrones) return;
      const requestVersion = ++droneListVersion.current;
      const busyRequestVersion = quiet ? 0 : ++busyVersion.current;
      if (!quiet) setBusy('drones');
      setError(null);
      try {
        const result = await mesh.request(targetId, 'drone-control', 'drones.list', {
          includeCreateOptions: !quiet,
        });
        if (targetIdRef.current !== targetId || droneListVersion.current !== requestVersion) return;
        const normalized = normalizeMobileDroneListPayload(result);
        const nextDrones = normalized.drones;
        setDrones(nextDrones);
        setDroneSidebarOrder(normalized.sidebar);
        if (!quiet) setCreateRepos(normalized.createRepos);
        const currentSelected = selectedRef.current;
        const nextSelected = currentSelected
          ? (nextDrones.find((drone) => drone.id === currentSelected.id) ?? null)
          : null;
        setSelected(nextSelected);
        if (nextSelected) {
          const nextChats = nextSelected.chats.length > 0 ? nextSelected.chats : ['default'];
          setChats(nextChats);
          if (!nextChats.includes(chatNameRef.current)) {
            const fallbackChat = nextChats[0] ?? 'default';
            setChatName(fallbackChat);
            setChatModel('');
            setChatReasoning('');
            setChatModels([]);
            setTurns([]);
            void readChatRef.current(nextSelected.id, fallbackChat).catch((nextError: any) => {
              if (targetIdRef.current === targetId)
                setError(nextError?.message ?? String(nextError));
            });
          }
        }
        if (
          (normalized.schemaVersion == null || normalized.schemaVersion < 2) &&
          nextDrones.length > 0 &&
          nextDrones.every((drone) => !drone.repoPath)
        ) {
          setError(
            'This device returned the legacy drone list without repository metadata. Update and restart DroneHub on the selected device.',
          );
        }
      } catch (nextError: any) {
        if (targetIdRef.current === targetId && droneListVersion.current === requestVersion)
          setError(nextError?.message ?? String(nextError));
      } finally {
        if (targetIdRef.current === targetId && droneListVersion.current === requestVersion)
          setDronesLoaded(true);
        if (
          !quiet &&
          targetIdRef.current === targetId &&
          droneListVersion.current === requestVersion &&
          busyVersion.current === busyRequestVersion
        )
          setBusy('');
      }
    },
    [mesh.request, targetId, targetSupportsDrones],
  );

  React.useEffect(() => {
    setDrones([]);
    setDroneSidebarOrder(EMPTY_MOBILE_DRONE_SIDEBAR_ORDER);
    setSelected(null);
    setChats([]);
    setChatName('default');
    setChatModel('');
    setChatReasoning('');
    setChatModelProvider('drone');
    setChatAgentId(null);
    setChatAgentPermissionMode('full-access');
    setChatModels([]);
    setTurns([]);
    setPendingPrompts([]);
    setCancellingPromptId('');
    setPrompt('');
    setCreateRepos([]);
    setBusy('');
    setDronesLoaded(false);
    setError(null);
    setModelOpen(false);
    setModelBusy(false);
    setDeleteCandidate(null);
    setDeleting(false);
    setNewDroneDefaults(null);
    setNewDroneScreenVersion((value) => value + 1);
    setComposerFocusKey('');
    droneListVersion.current += 1;
    chatReadVersion.current += 1;
    openDroneVersion.current += 1;
    runVersion.current += 1;
    busyVersion.current += 1;
    modelRequestVersion.current += 1;
  }, [targetId, targetSupportsDrones]);
  React.useEffect(() => {
    if (targetConnected && targetSupportsDrones) void loadDrones();
  }, [loadDrones, targetConnected, targetSupportsDrones]);

  const openDrone = (drone: MobileDroneSummary, requestedChat?: string) =>
    run('chats', async () => {
      const destinationId = targetId;
      const requestVersion = ++openDroneVersion.current;
      const knownChats = drone.chats.length > 0 ? drone.chats : ['default'];
      const knownChat =
        requestedChat && knownChats.includes(requestedChat)
          ? requestedChat
          : (knownChats[0] ?? 'default');
      setSelected(drone);
      setChats(knownChats);
      setChatName(knownChat);
      setChatModel('');
      setChatReasoning('');
      setChatAgentId(null);
      setChatAgentPermissionMode('full-access');
      setChatModels([]);
      setTurns([]);
      setPendingPrompts([]);
      const result = await mesh.request(destinationId, 'drone-control', 'chats.list', {
        droneId: drone.id,
      });
      if (targetIdRef.current !== destinationId || openDroneVersion.current !== requestVersion)
        return;
      const listedChats: string[] = Array.isArray(result?.chats)
        ? result.chats
            .map((chat: unknown) => String(chat ?? '').trim())
            .filter((chat: string) => Boolean(chat))
        : [];
      const nextChats = listedChats.length > 0 ? [...new Set(listedChats)] : drone.chats;
      const nextChat =
        requestedChat && nextChats.includes(requestedChat)
          ? requestedChat
          : (nextChats[0] ?? 'default');
      setChats(nextChats);
      setChatName(nextChat);
      await readChat(drone.id, nextChat);
    });

  const readChat = async (droneId: string, nextChat: string) => {
    const destinationId = targetId;
    const requestVersion = ++chatReadVersion.current;
    const result = await mesh.request(destinationId, 'drone-control', 'chat.read', {
      droneId,
      chatName: nextChat,
    });
    if (targetIdRef.current !== destinationId || chatReadVersion.current !== requestVersion) return;
    setChatModel(String(result?.model ?? '').trim());
    setChatReasoning(String(result?.reasoning ?? '').trim());
    setChatAgentId(
      result?.agent?.kind === 'builtin'
        ? mobileBuiltinAgentId(result.agent.id)
        : mobileBuiltinAgentId(result?.agent?.id),
    );
    setChatAgentPermissionMode(
      result?.agentPermissionMode === 'read-only' ? 'read-only' : 'full-access',
    );
    setChatModelProvider(
      String(result?.agent?.id ?? result?.agent?.kind ?? 'drone').trim() || 'drone',
    );
    setTurns(Array.isArray(result?.turns) ? result.turns : []);
    setPendingPrompts(Array.isArray(result?.pending) ? result.pending : []);
  };

  const loadDronesRef = React.useRef(loadDrones);
  loadDronesRef.current = loadDrones;
  readChatRef.current = readChat;

  React.useEffect(() => {
    if (!targetId || !targetSupportsDrones) return;
    let dronesChanged = false;
    let chatChanged = false;
    const flush = () => {
      realtimeTimer.current = null;
      if (dronesChanged) void loadDronesRef.current(true);
      if (chatChanged) {
        const activeDrone = selectedRef.current;
        const activeChat = chatNameRef.current;
        if (activeDrone)
          void readChatRef.current(activeDrone.id, activeChat).catch((nextError: any) => {
            if (targetIdRef.current === targetId) setError(nextError?.message ?? String(nextError));
          });
      }
      dronesChanged = false;
      chatChanged = false;
    };
    const schedule = () => {
      if (realtimeTimer.current) return;
      realtimeTimer.current = setTimeout(flush, 150);
    };
    const unsubscribeDrones = mesh.subscribe('drone-control', 'drones.changed', (event) => {
      if (event.sourceDeviceId !== targetId) return;
      dronesChanged = true;
      schedule();
    });
    const unsubscribeChat = mesh.subscribe('drone-control', 'chat.changed', (event) => {
      if (event.sourceDeviceId !== targetId) return;
      dronesChanged = true;
      const activeDrone = selectedRef.current;
      const activeChat = chatNameRef.current;
      const eventDroneId = String(event.payload?.droneId ?? '').trim();
      const eventChatName = String(event.payload?.chatName ?? '').trim();
      if (
        activeDrone &&
        (!eventDroneId || eventDroneId === activeDrone.id) &&
        (!eventChatName || eventChatName === activeChat)
      ) {
        chatChanged = true;
      }
      schedule();
    });
    return () => {
      unsubscribeDrones();
      unsubscribeChat();
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = null;
    };
  }, [mesh.subscribe, targetId, targetSupportsDrones]);

  const selectChat = (nextChat: string) =>
    selected &&
    run('chat', async () => {
      setChatName(nextChat);
      setChatModel('');
      setChatReasoning('');
      setChatModels([]);
      setTurns([]);
      setPendingPrompts([]);
      await readChat(selected.id, nextChat);
    });

  const sendPrompt = (promptOverride?: string) => {
    const nextPrompt = String(promptOverride ?? prompt);
    if (!selected || !nextPrompt.trim()) return;
    return run('prompt', async () => {
      const destinationId = targetId;
      const droneId = selected.id;
      const activeChat = chatName;
      const result = await mesh.request(destinationId, 'drone-control', 'chat.prompt', {
        droneId,
        chatName: activeChat,
        prompt: nextPrompt,
      });
      if (targetIdRef.current !== destinationId) return;
      setPrompt('');
      const promptId = String(result?.promptId ?? '').trim();
      if (promptId) {
        setPendingPrompts((current) => [
          ...current.filter((item) => String(item?.id ?? '') !== promptId),
          {
            id: promptId,
            at: new Date().toISOString(),
            prompt: nextPrompt.trim(),
            state: result?.pendingState === 'queued' ? 'queued' : 'sending',
          },
        ]);
      }
      await readChat(droneId, activeChat);
      await loadDrones(true);
    });
  };

  const createDrone = async (payload: MobileDroneCreatePayload): Promise<boolean> => {
    let created = false;
    await run(`create-${payload.runtime}`, async () => {
      const destinationId = targetId;
      await mesh.request(
        destinationId,
        'drone-control',
        `drone.create.${payload.runtime}`,
        payload,
      );
      if (targetIdRef.current !== destinationId) return;
      created = true;
      await loadDrones();
    });
    return created;
  };

  const detectCreateModels = React.useCallback(
    async (
      agent: MobileBuiltinAgentId,
      runtime: 'container' | 'host',
      refresh = false,
    ): Promise<MobileDroneCreateModel[]> => {
      const destinationId = targetId;
      const cacheKey = `${destinationId}:${runtime}:${agent}`;
      if (!refresh) {
        const cached = createModelCatalogCache.current.get(cacheKey);
        if (cached) return cached;
      }
      const result = await mesh.request(destinationId, 'drone-control', 'drones.list', {
        createModelAgent: agent,
        createModelRuntime: runtime,
        refreshCreateModels: refresh,
      });
      if (targetIdRef.current !== destinationId) return [];
      const catalog = result?.createModelCatalog;
      const models = normalizeMobileDroneCreateModelCatalog(catalog);
      if (models.length === 0 && catalog?.error) {
        throw new Error(String(catalog.error));
      }
      createModelCatalogCache.current.set(cacheKey, models);
      return models;
    },
    [mesh.request, targetId],
  );

  const stopChat = () =>
    selected &&
    run('stop', async () => {
      const destinationId = targetId;
      const droneId = selected.id;
      const activeChat = chatName;
      await mesh.request(destinationId, 'drone-control', 'chat.stop', {
        droneId,
        chatName: activeChat,
      });
      if (targetIdRef.current !== destinationId) return;
      await readChat(droneId, activeChat);
      await loadDrones(true);
    });

  const cancelPendingPrompt = (promptId: string) => {
    if (!selected || !promptId || cancellingPromptId) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    setCancellingPromptId(promptId);
    setError(null);
    void mesh
      .request(destinationId, 'drone-control', 'chat.stop', {
        droneId,
        chatName: activeChat,
        promptId,
      })
      .then(async () => {
        if (targetIdRef.current !== destinationId) return;
        setPendingPrompts((current) =>
          current.filter((item) => String(item?.id ?? '') !== promptId),
        );
        await readChat(droneId, activeChat);
        await loadDrones(true);
      })
      .catch((nextError: any) => {
        if (targetIdRef.current === destinationId)
          setError(nextError?.message ?? String(nextError));
      })
      .finally(() => setCancellingPromptId((current) => (current === promptId ? '' : current)));
  };

  const openNewDroneScreen = (defaults: MobileDroneCreateDefaults | null = null) => {
    setNewDroneDefaults(defaults);
    setNewDroneScreenVersion((value) => value + 1);
    setSelected(null);
    setChats([]);
    setChatName('default');
    setChatModel('');
    setChatReasoning('');
    setChatModelProvider('drone');
    setChatAgentId(null);
    setChatAgentPermissionMode('full-access');
    setChatModels([]);
    setTurns([]);
    setPendingPrompts([]);
    setCancellingPromptId('');
    setPrompt('');
    setModelOpen(false);
    setComposerFocusKey('');
  };

  const openNewDroneFromCurrent = () => {
    if (!selected) return;
    openNewDroneScreen({
      mode: 'with-chat',
      runtime: selected.runtime === 'host' ? 'host' : 'container',
      group: selected.group ?? '',
      repoPath: selected.repoPath,
      ...(chatAgentId ? { agent: chatAgentId } : {}),
      agentPermissionMode: chatAgentPermissionMode,
      ...(chatModel ? { model: chatModel } : {}),
      ...(chatReasoning ? { reasoning: chatReasoning } : {}),
    });
  };

  const createNewChat = () =>
    selected &&
    run('create-chat', async () => {
      const destinationId = targetId;
      const drone = selected;
      const sourceChat = chatName;
      const nextChat = suggestNextMobileDroneChatName(chats);
      const result = await mesh.request(destinationId, 'drone-control', 'chat.create', {
        droneId: drone.id,
        name: nextChat,
        copyFrom: sourceChat,
      });
      if (targetIdRef.current !== destinationId) return;
      const createdChat = String(result?.chatName ?? nextChat).trim() || nextChat;
      const nextChats: string[] = Array.isArray(result?.chats)
        ? [
            ...new Set<string>(
              result.chats
                .map((chat: unknown): string => String(chat ?? '').trim())
                .filter((chat: string) => Boolean(chat)),
            ),
          ]
        : [...new Set([...chats, createdChat])];
      const updatedDrone = { ...drone, chats: nextChats };
      setDrones((current) =>
        current.map((item) => (item.id === updatedDrone.id ? updatedDrone : item)),
      );
      setSelected(updatedDrone);
      setChats(nextChats);
      setChatName(createdChat);
      setTurns([]);
      setPendingPrompts([]);
      setPrompt('');
      setComposerFocusKey(`${drone.id}:${createdChat}:${Date.now()}`);
      await readChat(drone.id, createdChat);
      await loadDrones(true);
    });

  const normalizedTurns = React.useMemo(() => normalizeMobileDroneTurns(turns), [turns]);
  const transcriptMessages = React.useMemo(
    () => mobileDroneTurnsToAssistantMessages(turns),
    [turns],
  );
  const visiblePendingPrompts = React.useMemo(
    () => mobileDronePendingPrompts(pendingPrompts, turns),
    [pendingPrompts, turns],
  );
  const chatLoading = busy === 'chats' || busy === 'chat' || busy === 'create-chat';
  const latestMessageScroll = useLatestMessageScroll(
    selected ? `${selected.id}:${chatName}` : '',
    chatLoading,
  );
  const latestModel = [...normalizedTurns].reverse().find((turn) => turn.model)?.model;
  const running =
    busy === 'prompt' ||
    busy === 'stop' ||
    visiblePendingPrompts.some((item) => item.status === 'pending') ||
    Boolean(selected?.busyChats.some((chat) => chat === chatName));
  const activeTarget = mesh.devices.find((target) => target.id === targetId);
  const displayedModel = chatModel || latestModel || 'Model';
  const visibleChats = chats.length > 0 ? chats : [chatName];
  React.useEffect(() => {
    onHeaderChange(
      selected
        ? {
            title: selected.name,
            subtitle: `${mobileRepoLabel(selected.repoPath)} · ${selected.runtime}${activeTarget ? ` · ${activeTarget.name}` : ''}`,
            onNewDrone: openNewDroneFromCurrent,
            onNewChat: () => void createNewChat(),
            onDelete: () => setDeleteCandidate(selected),
          }
        : null,
    );
  }, [
    activeTarget?.name,
    onHeaderChange,
    selected?.id,
    selected?.group,
    selected?.name,
    selected?.repoPath,
    selected?.runtime,
    chatAgentId,
    chatAgentPermissionMode,
    chatModel,
    chatReasoning,
    chatName,
    chats,
  ]);
  React.useEffect(() => () => onHeaderChange(null), [onHeaderChange]);

  const openModelPicker = async () => {
    if (!selected || running) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    const requestVersion = ++modelRequestVersion.current;
    setModelOpen(true);
    setModelBusy(true);
    setError(null);
    try {
      const result = await mesh.request(destinationId, 'drone-control', 'chat.models', {
        droneId,
        chatName: activeChat,
        refresh: true,
      });
      if (
        targetIdRef.current !== destinationId ||
        selectedRef.current?.id !== droneId ||
        chatNameRef.current !== activeChat ||
        modelRequestVersion.current !== requestVersion
      )
        return;
      const provider =
        String(result?.agent?.id ?? result?.agent?.kind ?? chatModelProvider).trim() || 'drone';
      setChatModelProvider(provider);
      const options = (Array.isArray(result?.models) ? result.models : [])
        .map(
          (model: any): AssistantModelChoice => ({
            provider,
            id: String(model?.id ?? '').trim(),
            name: String(model?.label ?? model?.name ?? model?.id ?? '').trim(),
          }),
        )
        .filter((model: AssistantModelChoice) => Boolean(model.id));
      setChatModels(options);
      const configuredModel = String(result?.model ?? '').trim();
      if (configuredModel) setChatModel(configuredModel);
      const discoveryError = String(result?.error ?? '').trim();
      if (discoveryError && options.length === 0) setError(discoveryError);
    } catch (nextError: any) {
      if (targetIdRef.current === destinationId && modelRequestVersion.current === requestVersion)
        setError(nextError?.message ?? String(nextError));
    } finally {
      if (modelRequestVersion.current === requestVersion) setModelBusy(false);
    }
  };

  const updateChatModel = async (choice: AssistantModelChoice) => {
    if (!selected) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    const requestVersion = ++modelRequestVersion.current;
    setModelBusy(true);
    setError(null);
    try {
      await mesh.request(destinationId, 'drone-control', 'chat.update', {
        droneId,
        chatName: activeChat,
        model: choice.id,
      });
      if (
        targetIdRef.current !== destinationId ||
        selectedRef.current?.id !== droneId ||
        chatNameRef.current !== activeChat ||
        modelRequestVersion.current !== requestVersion
      )
        return;
      setChatModelProvider(choice.provider);
      setChatModel(choice.id);
      setModelOpen(false);
    } catch (nextError: any) {
      if (targetIdRef.current === destinationId && modelRequestVersion.current === requestVersion)
        setError(nextError?.message ?? String(nextError));
    } finally {
      if (modelRequestVersion.current === requestVersion) setModelBusy(false);
    }
  };

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
        droneSidebarOrder={droneSidebarOrder}
        activeDroneId={selected?.id ?? ''}
        activeChatName={chatName}
        dronesLoading={
          targetConnected && targetSupportsDrones && (!dronesLoaded || busy === 'drones')
        }
        devicePickerItems={devicePickerItems}
        activeDeviceId={targetId}
        onClose={() => onDrawerOpenChange(false)}
        onSelect={() => {}}
        onCreate={() => {}}
        onCreateDrone={
          targetSupportsDrones
            ? () => {
                onDrawerOpenChange(false);
                openNewDroneScreen();
              }
            : undefined
        }
        onSelectDevice={(deviceId) => {
          setDronesLoaded(false);
          onDeviceChange(deviceId);
          setDrones([]);
          setDroneSidebarOrder(EMPTY_MOBILE_DRONE_SIDEBAR_ORDER);
          setSelected(null);
        }}
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
            {visibleChats.length > 1 ? (
              <View style={styles.chatTabsFrame}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chats}
                >
                  {visibleChats.map((chat) => {
                    const active = chat === chatName;
                    const chatBusy = selected.busyChats.includes(chat);
                    return (
                      <Pressable
                        key={chat}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                        onPress={() => !active && void selectChat(chat)}
                        style={({ pressed }) => [
                          styles.chatTab,
                          active && styles.chatTabActive,
                          pressed && styles.chatTabPressed,
                        ]}
                      >
                        <MessageCircle
                          color={active ? colors.accent : colors.muted}
                          size={13}
                          strokeWidth={active ? 2.2 : 1.8}
                        />
                        <Text
                          numberOfLines={1}
                          style={[styles.chatText, active && styles.chatTextActive]}
                        >
                          {chat}
                        </Text>
                        {chatBusy ? (
                          <ActivityIndicator color={colors.warning} size="small" />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
            {error ? (
              <View style={styles.chatError}>
                <ErrorBanner message={error} />
              </View>
            ) : null}
            <ScrollView
              ref={latestMessageScroll.ref}
              style={styles.transcriptScroll}
              contentContainerStyle={[
                styles.transcriptContent,
                !latestMessageScroll.contentVisible && styles.transcriptContentHidden,
              ]}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              onLayout={latestMessageScroll.onLayout}
              onContentSizeChange={latestMessageScroll.onContentSizeChange}
              onScroll={latestMessageScroll.onScroll}
              scrollEventThrottle={16}
            >
              <MobileAssistantTranscript
                messages={transcriptMessages}
                loading={chatLoading}
                running={running}
                currentReasoning={running ? (normalizedTurns.at(-1)?.reasoning ?? '') : ''}
                emptyTitle="This drone chat is ready."
                emptyBody="Send a prompt to start the conversation."
                assistantLabel="Agent"
              />
              <QueuedPromptRows
                prompts={visiblePendingPrompts}
                cancellingId={cancellingPromptId}
                onCancel={cancelPendingPrompt}
              />
            </ScrollView>
            <AssistantComposer
              focusKey={composerFocusKey}
              voiceResetKey={`${targetId}:${selected.id}:${chatName}`}
              value={prompt}
              onChangeText={setPrompt}
              onSend={(promptOverride) => void sendPrompt(promptOverride)}
              onStop={() => void stopChat()}
              onOpenModel={() => void openModelPicker()}
              modelLabel={displayedModel}
              placeholder={`Message ${selected.name}…`}
              sending={busy === 'prompt'}
              running={running}
              editable
              queueWhileRunning
            />
            <AssistantModelPicker
              open={modelOpen}
              currentProvider={chatModelProvider}
              currentModel={chatModel || latestModel || ''}
              options={chatModels}
              busy={modelBusy}
              showReasoning={false}
              onClose={() => setModelOpen(false)}
              onSelect={(choice) => void updateChatModel(choice)}
            />
          </View>
        ) : targetSupportsDrones ? (
          <NewDroneScreen
            key={`${targetId}:${newDroneScreenVersion}`}
            deviceName={activeTarget?.name ?? 'this device'}
            repos={createRepos}
            loadingOptions={targetConnected && (!dronesLoaded || busy === 'drones')}
            busy={busy.startsWith('create-')}
            requestError={error}
            initialValues={newDroneDefaults ?? undefined}
            onDetectModels={detectCreateModels}
            onCreate={createDrone}
          />
        ) : (
          <View style={styles.unavailable}>
            <Text style={styles.unavailableText}>
              {activeTarget
                ? `${activeTarget.name} does not provide drone control. Choose a Drone Hub device from the drawer.`
                : 'Choose a connected Drone Hub device from the drawer.'}
            </Text>
            <ErrorBanner message={error} />
          </View>
        )}
      </KeyboardAvoidingView>
      <ConfirmDialog
        visible={Boolean(deleteCandidate)}
        title="Delete drone?"
        message={`Delete “${deleteCandidate?.name ?? 'this drone'}” from ${activeTarget?.name ?? 'the selected device'}? The Hub’s deletion settings determine whether it is archived first or permanently removed.`}
        confirmLabel="Delete drone"
        destructive
        busy={deleting}
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={() =>
          void (async () => {
            if (!deleteCandidate) return;
            const destinationId = targetId;
            const droneId = deleteCandidate.id;
            setDeleting(true);
            setError(null);
            try {
              await mesh.request(destinationId, 'drone-control', 'drone.delete', { droneId });
              if (targetIdRef.current !== destinationId) return;
              setDeleteCandidate(null);
              setDrones((current) => current.filter((drone) => drone.id !== droneId));
              if (selectedRef.current?.id === droneId) {
                setSelected(null);
                setChats([]);
                setTurns([]);
              }
              await loadDrones(true);
            } catch (nextError: any) {
              if (targetIdRef.current === destinationId)
                setError(nextError?.message ?? String(nextError));
            } finally {
              setDeleting(false);
            }
          })()
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  unavailable: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  unavailableText: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  chatWorkspace: { flex: 1, backgroundColor: colors.background },
  chatTabsFrame: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chats: { gap: 5, paddingHorizontal: 10, paddingVertical: 6 },
  chatTab: {
    minHeight: 31,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 11,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  chatTabActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDark,
  },
  chatTabPressed: { opacity: 0.72 },
  chatText: { flexShrink: 1, color: colors.muted, fontSize: 10, fontWeight: '800' },
  chatTextActive: { color: colors.accent },
  chatError: { paddingHorizontal: 12, paddingTop: 9 },
  transcriptScroll: { flex: 1 },
  transcriptContent: { flexGrow: 1 },
  transcriptContentHidden: { opacity: 0 },
});
