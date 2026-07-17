import React from 'react';
import type { AssistantMessage } from '@drone/assistant-chat';
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
  type MobileDroneAgentId,
  type MobileDroneAgentPermissionMode,
  type MobileDroneCreateDefaults,
  type MobileDroneCreatePayload,
} from '../drones/NewDroneScreen';
import {
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  mobileRepoLabel,
  mobileDroneTurnsToAssistantMessages,
  normalizeMobileDroneCreateRepo,
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
import { useDroneLinkedPullRequests } from '../drones/use-drone-linked-pull-requests';
import { useLocalDroneControl } from '../drones/local-drone-control';
import { useLocalAssistant } from '../local-assistant/LocalAssistantContext';
import { LocalWorkspaceEditor } from '../local-assistant/LocalWorkspaceEditor';
import {
  AssistantApprovalCard,
  type MobileAssistantApproval,
} from '../local-assistant/AssistantApprovalCard';

const APP_HEADER_HEIGHT = 58;

export type DronesAppHeaderState = {
  title: string;
  subtitle: string;
  draft?: boolean;
  draftDisabled?: boolean;
  onToggleDraft?(): void;
  onNewDrone?(): void;
  onNewChat?(): void;
  onDelete?(): void;
  accessOpen?: boolean;
  accessDisabled?: boolean;
  onToggleAccess?(): void;
  autoApprove?: boolean;
  onToggleAutoApprove?(): void;
};

function mobileDroneAgentId(value: unknown): MobileDroneAgentId | null {
  const id = String(value ?? '').trim();
  return ['native', 'cursor', 'codex', 'claude', 'opencode', 'pi', 'blip'].includes(id)
    ? (id as MobileDroneAgentId)
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
  const localDroneControl = useLocalDroneControl();
  const localAssistant = useLocalAssistant();
  const insets = useSafeAreaInsets();
  const targets = mesh.devices.filter(
    (device) =>
      !device.revokedAt &&
      (device.id === mesh.identity?.id ||
        (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
          (capability) => capability.id === 'drone-control',
        )),
  );
  const targetId = selectedDeviceId;
  const phoneTarget = Boolean(targetId && targetId === mesh.identity?.id);
  const targetSupportsDrones = phoneTarget || targets.some((target) => target.id === targetId);
  const meshRouteAvailable = phoneTarget || mesh.connectedDeviceIds.length > 0;
  const requestDroneControl = React.useCallback(
    (destinationId: string, operation: string, payload?: any) =>
      destinationId === mesh.identity?.id
        ? localDroneControl.request(operation, payload)
        : mesh.request(destinationId, 'drone-control', operation, payload),
    [localDroneControl.request, mesh.identity?.id, mesh.request],
  );
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
  const [chatAgentId, setChatAgentId] = React.useState<MobileDroneAgentId | null>(null);
  const [chatAgentPermissionMode, setChatAgentPermissionMode] =
    React.useState<MobileDroneAgentPermissionMode>('full-access');
  const [chatModels, setChatModels] = React.useState<AssistantModelChoice[]>([]);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [modelBusy, setModelBusy] = React.useState(false);
  const [turns, setTurns] = React.useState<any[]>([]);
  const [nativeMessages, setNativeMessages] = React.useState<AssistantMessage[] | null>(null);
  const [nativeChatId, setNativeChatId] = React.useState('');
  const [nativeThread, setNativeThread] = React.useState<any | null>(null);
  const [accessOpen, setAccessOpen] = React.useState(false);
  const [accessDirty, setAccessDirty] = React.useState(false);
  const [confirmAccessDiscard, setConfirmAccessDiscard] = React.useState(false);
  const [pendingApprovals, setPendingApprovals] = React.useState<MobileAssistantApproval[]>([]);
  const [approvalBusyId, setApprovalBusyId] = React.useState('');
  const [pendingPrompts, setPendingPrompts] = React.useState<any[]>([]);
  const [cancellingPromptId, setCancellingPromptId] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [createRepos, setCreateRepos] = React.useState<MobileDroneCreateRepo[]>([]);
  const [busy, setBusy] = React.useState('');
  const [dronesLoaded, setDronesLoaded] = React.useState(false);
  const [droneListError, setDroneListError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = React.useState<MobileDroneSummary | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [newDroneDefaults, setNewDroneDefaults] = React.useState<MobileDroneCreateDefaults | null>(
    null,
  );
  const [newDroneScreenVersion, setNewDroneScreenVersion] = React.useState(0);
  const [newDroneDraft, setNewDroneDraft] = React.useState(false);
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
  const chatTabsRef = React.useRef<ScrollView>(null);
  const createModelCatalogCache = React.useRef(new Map<string, MobileDroneCreateModel[]>());
  const createRepoBranchesCache = React.useRef(new Map<string, MobileDroneCreateRepo>());
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
      if (!quiet) setDroneListError(null);
      setError(null);
      try {
        const result = await requestDroneControl(targetId, 'drones.list', {
          includeCreateOptions: false,
        });
        if (targetIdRef.current !== targetId || droneListVersion.current !== requestVersion) return;
        if (!result || typeof result !== 'object' || !Array.isArray(result.drones)) {
          throw new Error('The selected Drone Hub returned an invalid drone list');
        }
        const normalized = normalizeMobileDroneListPayload(result);
        const nextDrones = normalized.drones;
        setDrones(nextDrones);
        setDroneSidebarOrder(normalized.sidebar);
        const currentSelected = selectedRef.current;
        const nextSelected = currentSelected
          ? (nextDrones.find((drone) => drone.id === currentSelected.id) ?? null)
          : null;
        setSelected(nextSelected);
        if (nextSelected) {
          const nextChats = nextSelected.chats;
          setChats(nextChats);
          if (nextChats.length === 0) {
            setChatName('');
            setChatModel('');
            setChatReasoning('');
            setChatModels([]);
            setTurns([]);
            setNativeMessages(null);
            setNativeChatId('');
            setNativeThread(null);
            setPendingApprovals([]);
            setPendingPrompts([]);
          }
          if (!nextChats.includes(chatNameRef.current)) {
            const fallbackChat = nextChats[0];
            if (fallbackChat) {
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
        if (!quiet) {
          try {
            const optionsResult = await requestDroneControl(targetId, 'drones.list', {
              includeCreateOptions: true,
            });
            if (targetIdRef.current !== targetId || droneListVersion.current !== requestVersion)
              return;
            const options = normalizeMobileDroneListPayload(optionsResult);
            setCreateRepos(
              options.createRepos.map(
                (repo) => createRepoBranchesCache.current.get(`${targetId}:${repo.path}`) ?? repo,
              ),
            );
          } catch (nextError: any) {
            if (targetIdRef.current === targetId && droneListVersion.current === requestVersion) {
              setError(
                `Drones loaded, but creation options are unavailable: ${nextError?.message ?? String(nextError)}`,
              );
            }
          }
        }
      } catch (nextError: any) {
        if (targetIdRef.current === targetId && droneListVersion.current === requestVersion) {
          const message = nextError?.message ?? String(nextError);
          if (!quiet) setDroneListError(message);
          setError(message);
        }
      } finally {
        if (targetIdRef.current === targetId && droneListVersion.current === requestVersion)
          setDronesLoaded(true);
        if (
          !quiet &&
          targetIdRef.current === targetId &&
          busyVersion.current === busyRequestVersion
        )
          setBusy('');
      }
    },
    [requestDroneControl, targetId, targetSupportsDrones],
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
    setNativeMessages(null);
    setNativeChatId('');
    setNativeThread(null);
    setAccessOpen(false);
    setAccessDirty(false);
    setConfirmAccessDiscard(false);
    setPendingApprovals([]);
    setApprovalBusyId('');
    setPendingPrompts([]);
    setCancellingPromptId('');
    setPrompt('');
    setCreateRepos([]);
    setBusy('');
    setDronesLoaded(false);
    setDroneListError(null);
    setError(null);
    setModelOpen(false);
    setModelBusy(false);
    setDeleteCandidate(null);
    setDeleting(false);
    setNewDroneDefaults(null);
    setNewDroneDraft(false);
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
    if (meshRouteAvailable && targetSupportsDrones) void loadDrones();
  }, [loadDrones, meshRouteAvailable, targetSupportsDrones]);

  const openDrone = (drone: MobileDroneSummary, requestedChat?: string) =>
    run('chats', async () => {
      const destinationId = targetId;
      const requestVersion = ++openDroneVersion.current;
      const knownChats = drone.chats;
      const knownChat =
        requestedChat && knownChats.includes(requestedChat)
          ? requestedChat
          : (knownChats[0] ?? '');
      setSelected(drone);
      setChats(knownChats);
      setChatName(knownChat);
      setChatModel('');
      setChatReasoning('');
      setChatAgentId(null);
      setChatAgentPermissionMode('full-access');
      setChatModels([]);
      setTurns([]);
      setNativeMessages(null);
      setNativeChatId('');
      setNativeThread(null);
      setPendingApprovals([]);
      setAccessOpen(false);
      setAccessDirty(false);
      setPendingPrompts([]);
      const result = await requestDroneControl(destinationId, 'chats.list', {
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
          : (nextChats[0] ?? '');
      setChats(nextChats);
      setChatName(nextChat);
      if (nextChat) await readChat(drone.id, nextChat);
    });

  const readChat = async (droneId: string, nextChat: string) => {
    const destinationId = targetId;
    const requestVersion = ++chatReadVersion.current;
    const result = await requestDroneControl(destinationId, 'chat.read', {
      droneId,
      chatName: nextChat,
    });
    if (targetIdRef.current !== destinationId || chatReadVersion.current !== requestVersion) return;
    setChatModel(String(result?.model ?? '').trim());
    setChatReasoning(String(result?.reasoning ?? '').trim());
    setChatAgentId(
      result?.agent?.kind === 'native'
        ? null
        : result?.agent?.kind === 'builtin'
        ? mobileDroneAgentId(result.agent.id)
        : mobileDroneAgentId(result?.agent?.id),
    );
    setChatAgentPermissionMode(
      result?.agentPermissionMode === 'read-only' ? 'read-only' : 'full-access',
    );
    setChatModelProvider(
      String(
        result?.thread?.provider ??
          result?.provider ??
          result?.agent?.id ??
          result?.agent?.kind ??
          'drone',
      ).trim() || 'drone',
    );
    const historyEntries = Array.isArray(result?.history?.entries)
      ? result.history.entries
      : Array.isArray(result?.history)
        ? result.history
        : [];
    const streamingEntries = Array.isArray(result?.streamingMessages)
      ? result.streamingMessages
      : [];
    const richMessages = result?.historyKind === 'messages'
      ? [...historyEntries, ...streamingEntries] as AssistantMessage[]
      : null;
    setNativeMessages(richMessages);
    setNativeChatId(String(result?.nativeChatId ?? '').trim());
    setNativeThread(result?.thread ?? null);
    setPendingApprovals(
      Array.isArray(result?.pendingApprovals) ? result.pendingApprovals : [],
    );
    setTurns(Array.isArray(result?.turns) ? result.turns : []);
    setPendingPrompts(Array.isArray(result?.pending) ? result.pending : []);
    if (result?.readState?.unread === false) {
      const clearUnreadChat = (drone: MobileDroneSummary): MobileDroneSummary =>
        drone.id !== droneId || !(drone.unreadChats ?? []).includes(nextChat)
          ? drone
          : {
              ...drone,
              unreadChats: (drone.unreadChats ?? []).filter((chat) => chat !== nextChat),
              chatReadStates: {
                ...(drone.chatReadStates ?? {}),
                [nextChat]: {
                  unread: false,
                  latestAgentTurnId:
                    String(result?.readState?.latestAgentTurnId ?? '').trim() || null,
                  latestAgentRevision:
                    Number.isSafeInteger(result?.readState?.latestAgentRevision) &&
                    Number(result.readState.latestAgentRevision) >= 0
                      ? Number(result.readState.latestAgentRevision)
                      : 0,
                },
              },
            };
      setDrones((current) => current.map(clearUnreadChat));
      setSelected((current) => (current ? clearUnreadChat(current) : current));
    }
  };

  const loadDronesRef = React.useRef(loadDrones);
  loadDronesRef.current = loadDrones;
  readChatRef.current = readChat;

  React.useEffect(() => {
    if (!phoneTarget || !selectedRef.current) return;
    void readChatRef.current(selectedRef.current.id, chatNameRef.current).catch((nextError: any) => {
      setError(nextError?.message ?? String(nextError));
    });
  }, [localDroneControl.revision, phoneTarget]);

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
      setNativeMessages(null);
      setNativeChatId('');
      setNativeThread(null);
      setPendingApprovals([]);
      setAccessOpen(false);
      setAccessDirty(false);
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
      const result = await requestDroneControl(destinationId, 'chat.prompt', {
        droneId,
        chatName: activeChat,
        prompt: nextPrompt,
      });
      if (targetIdRef.current !== destinationId) return;
      setPrompt('');
      const promptId = String(result?.promptId ?? '').trim();
      const queuedPromptId = String(result?.queuedPrompt?.id ?? '').trim();
      const acceptedPromptId = promptId || queuedPromptId;
      if (acceptedPromptId) {
        setPendingPrompts((current) => [
          ...current.filter((item) => String(item?.id ?? '') !== acceptedPromptId),
          {
            id: acceptedPromptId,
            at: new Date().toISOString(),
            prompt: nextPrompt.trim(),
            state:
              queuedPromptId || result?.pendingState === 'queued' ? 'queued' : 'sending',
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
      await requestDroneControl(
        destinationId,
        `drone.create.${payload.runtime}`,
        payload,
      );
      if (targetIdRef.current !== destinationId) return;
      created = true;
      await loadDrones();
    });
    return created;
  };

  const loadCreateRepoBranches = React.useCallback(
    async (repoPath: string, refresh = false): Promise<MobileDroneCreateRepo> => {
      const destinationId = targetId;
      const cacheKey = `${destinationId}:${repoPath}`;
      if (!refresh) {
        const cached = createRepoBranchesCache.current.get(cacheKey);
        if (cached) return cached;
      }

      let cursor = 0;
      let hostBranch: string | null = null;
      let branchesError: string | null = null;
      const branches = new Map<string, MobileDroneCreateRepo['remoteBranches'][number]>();
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const result = await requestDroneControl(destinationId, 'drones.list', {
          createRepoPath: repoPath,
          createRepoCursor: cursor,
        });
        if (targetIdRef.current !== destinationId)
          throw new Error('The selected Drone Hub changed while branches were loading');
        const page = normalizeMobileDroneCreateRepo(result?.createRepo);
        if (!page || page.path !== repoPath) {
          throw new Error('This Drone Hub does not support lazy repository branch loading');
        }
        hostBranch = page.hostBranch ?? hostBranch;
        branchesError = page.branchesError;
        for (const branch of page.remoteBranches) branches.set(branch.name, branch);
        const nextCursor = Number(result?.createRepo?.nextCursor);
        if (
          branchesError ||
          result?.createRepo?.nextCursor == null ||
          !Number.isSafeInteger(nextCursor)
        )
          break;
        if (nextCursor <= cursor) throw new Error('Drone Hub returned an invalid branch page');
        cursor = nextCursor;
        if (pageNumber === 99) throw new Error('Repository has too many branch pages');
      }

      const repo: MobileDroneCreateRepo = {
        path: repoPath,
        hostBranch,
        remoteBranches: [...branches.values()],
        branchesError,
        branchesLoaded: true,
      };
      createRepoBranchesCache.current.set(cacheKey, repo);
      setCreateRepos((current) =>
        current.some((item) => item.path === repoPath)
          ? current.map((item) => (item.path === repoPath ? repo : item))
          : [...current, repo],
      );
      return repo;
    },
    [requestDroneControl, targetId],
  );

  const detectCreateModels = React.useCallback(
    async (
      agent: MobileDroneAgentId,
      runtime: 'container' | 'host',
      refresh = false,
    ): Promise<MobileDroneCreateModel[]> => {
      const destinationId = targetId;
      const cacheKey = `${destinationId}:${runtime}:${agent}`;
      if (!refresh) {
        const cached = createModelCatalogCache.current.get(cacheKey);
        if (cached) return cached;
      }
      const result = await requestDroneControl(destinationId, 'drones.list', {
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
    [requestDroneControl, targetId],
  );

  const stopChat = () =>
    selected &&
    run('stop', async () => {
      const destinationId = targetId;
      const droneId = selected.id;
      const activeChat = chatName;
      await requestDroneControl(destinationId, 'chat.stop', {
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
    void requestDroneControl(destinationId, 'chat.stop', {
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
    setNewDroneDraft(false);
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
    setNativeMessages(null);
    setNativeChatId('');
    setNativeThread(null);
    setAccessOpen(false);
    setAccessDirty(false);
    setPendingApprovals([]);
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
      const result = await requestDroneControl(destinationId, 'chat.create', {
        droneId: drone.id,
        name: nextChat,
        ...(sourceChat && chats.includes(sourceChat) ? { copyFrom: sourceChat } : {}),
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
      setNativeMessages(null);
      setNativeChatId('');
      setNativeThread(null);
      setPendingApprovals([]);
      setAccessOpen(false);
      setAccessDirty(false);
      setPendingPrompts([]);
      setPrompt('');
      setComposerFocusKey(`${drone.id}:${createdChat}:${Date.now()}`);
      await readChat(drone.id, createdChat);
      await loadDrones(true);
    });

  const normalizedTurns = React.useMemo(() => normalizeMobileDroneTurns(turns), [turns]);
  const transcriptMessages = React.useMemo(
    () => nativeMessages ?? mobileDroneTurnsToAssistantMessages(turns),
    [nativeMessages, turns],
  );
  const visiblePendingPrompts = React.useMemo(
    () => mobileDronePendingPrompts(pendingPrompts, turns),
    [pendingPrompts, turns],
  );
  const linkedPullRequests = useDroneLinkedPullRequests({
    targetDeviceId: targetId,
    droneId: selected?.id ?? '',
    messages: transcriptMessages,
  });
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
    nativeThread?.status === 'running' ||
    nativeThread?.status === 'waiting_for_approval' ||
    nativeThread?.status === 'waiting_for_chats_idle' ||
    Boolean(selected?.busyChats.some((chat) => chat === chatName));
  const activeTarget = mesh.devices.find((target) => target.id === targetId);
  const displayedModel = chatModel || latestModel || 'Model';
  const visibleChats = chats;
  React.useEffect(() => {
    const frame = requestAnimationFrame(() =>
      chatTabsRef.current?.scrollToEnd({ animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selected?.id, visibleChats.length]);
  React.useEffect(() => {
    onHeaderChange(
      selected
        ? {
            title: selected.name,
            subtitle: `${mobileRepoLabel(selected.repoPath)} · ${selected.runtime}${activeTarget ? ` · ${activeTarget.name}` : ''}`,
            onNewDrone: openNewDroneFromCurrent,
            onNewChat: () => void createNewChat(),
            onDelete: () => setDeleteCandidate(selected),
            ...(nativeMessages !== null
              ? {
                  accessOpen,
                  accessDisabled: running,
                  ...(phoneTarget ? { onToggleAccess: () => {
                    if (accessOpen && accessDirty) setConfirmAccessDiscard(true);
                    else setAccessOpen((value) => !value);
                  } } : {}),
                  autoApprove: nativeThread?.autoApprove === true,
                  onToggleAutoApprove: () => {
                    const destinationId = targetId;
                    void requestDroneControl(destinationId, 'chat.update', {
                      droneId: selected.id,
                      chatName,
                      nativeChatId,
                      autoApprove: nativeThread?.autoApprove !== true,
                    }).then(() => readChat(selected.id, chatName));
                  },
                }
              : {}),
          }
        : targetSupportsDrones
          ? {
              title: 'New drone',
              subtitle: `Create on ${activeTarget?.name ?? 'this device'}`,
              draft: newDroneDraft,
              draftDisabled: busy.startsWith('create-'),
              onToggleDraft: () => setNewDroneDraft((value) => !value),
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
    busy,
    newDroneDraft,
    targetSupportsDrones,
    accessOpen,
    accessDirty,
    nativeMessages,
    nativeThread?.autoApprove,
    phoneTarget,
    requestDroneControl,
    running,
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
      const result = await requestDroneControl(destinationId, 'chat.models', {
        droneId,
        chatName: activeChat,
        nativeChatId,
        refresh: true,
      });
      if (
        targetIdRef.current !== destinationId ||
        selectedRef.current?.id !== droneId ||
        chatNameRef.current !== activeChat ||
        modelRequestVersion.current !== requestVersion
      )
        return;
      const fallbackProvider =
        String(result?.agent?.id ?? result?.agent?.kind ?? chatModelProvider).trim() || 'drone';
      const options = (Array.isArray(result?.models) ? result.models : [])
        .flatMap((model: any): AssistantModelChoice[] => {
          const provider = String(model?.provider ?? fallbackProvider).trim() || fallbackProvider;
          const base = {
            provider,
            id: String(model?.id ?? '').trim(),
            name: String(model?.label ?? model?.name ?? model?.id ?? '').trim(),
          };
          const levels = Array.isArray(model?.reasoningLevels)
            ? model.reasoningLevels.map((level: unknown) => String(level ?? '').trim()).filter(Boolean)
            : [];
          return levels.length > 0
            ? levels.map((thinkingLevel: string) => ({ ...base, thinkingLevel }))
            : [{ ...base, thinkingLevel: String(model?.thinkingLevel ?? '').trim() || undefined }];
        })
        .filter((model: AssistantModelChoice) => Boolean(model.id));
      setChatModels(options);
      const configuredModel = String(result?.model ?? '').trim();
      if (configuredModel) setChatModel(configuredModel);
      const configuredProvider = String(result?.provider ?? '').trim();
      if (configuredProvider) setChatModelProvider(configuredProvider);
      else {
        const configuredChoice = options.find(
          (option: AssistantModelChoice) => option.id === configuredModel,
        );
        setChatModelProvider(configuredChoice?.provider ?? fallbackProvider);
      }
      const discoveryError = String(result?.error ?? '').trim();
      if (discoveryError && options.length === 0) setError(discoveryError);
    } catch (nextError: any) {
      if (targetIdRef.current === destinationId && modelRequestVersion.current === requestVersion)
        setError(nextError?.message ?? String(nextError));
    } finally {
      if (modelRequestVersion.current === requestVersion) setModelBusy(false);
    }
  };

  const updateChatModel = async (
    choice: AssistantModelChoice,
    selection: 'model' | 'reasoning',
  ) => {
    if (!selected) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    const requestVersion = ++modelRequestVersion.current;
    setModelBusy(true);
    setError(null);
    try {
      await requestDroneControl(destinationId, 'chat.update', {
        droneId,
        chatName: activeChat,
        nativeChatId,
        provider: choice.provider,
        model: choice.id,
        thinkingLevel: choice.thinkingLevel,
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
      if (choice.thinkingLevel) setChatReasoning(choice.thinkingLevel);
      if (selection === 'reasoning') setModelOpen(false);
    } catch (nextError: any) {
      if (targetIdRef.current === destinationId && modelRequestVersion.current === requestVersion)
        setError(nextError?.message ?? String(nextError));
    } finally {
      if (modelRequestVersion.current === requestVersion) setModelBusy(false);
    }
  };

  const resolveNativeApproval = (approval: MobileAssistantApproval, approved: boolean) => {
    if (!selected || approvalBusyId) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    setApprovalBusyId(approval.id);
    setError(null);
    void requestDroneControl(destinationId, 'chat.approval.resolve', {
      droneId,
      chatName: activeChat,
      nativeChatId,
      approvalId: approval.id,
      approved,
    })
      .then(async () => {
        if (targetIdRef.current !== destinationId) return;
        setPendingApprovals((current) => current.filter((item) => item.id !== approval.id));
        await readChat(droneId, activeChat);
      })
      .catch((nextError: any) => setError(nextError?.message ?? String(nextError)))
      .finally(() => setApprovalBusyId(''));
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
          meshRouteAvailable && targetSupportsDrones && (!dronesLoaded || busy === 'drones')
        }
        dronesReachable={meshRouteAvailable}
        dronesError={droneListError}
        devicePickerItems={devicePickerItems}
        activeDeviceId={targetId}
        onClose={() => onDrawerOpenChange(false)}
        onSelect={() => {}}
        onCreate={() => {}}
        onCreateDrone={
          targetSupportsDrones && meshRouteAvailable
            ? () => {
                onDrawerOpenChange(false);
                openNewDroneScreen();
              }
            : undefined
        }
        onRetryDrones={() => void loadDrones()}
        onSelectDevice={(deviceId) => {
          setDronesLoaded(false);
          setDroneListError(null);
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
            {visibleChats.length === 0 ? (
              <View style={styles.emptyDrone}>
                <MessageCircle color={colors.muted} size={28} strokeWidth={1.6} />
                <Text style={styles.emptyDroneTitle}>This drone has no chats yet.</Text>
                <Text style={styles.emptyDroneBody}>
                  Create a chat to start working with the Built-in agent.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy === 'create-chat'}
                  onPress={() => void createNewChat()}
                  style={({ pressed }) => [
                    styles.emptyDroneButton,
                    pressed && styles.chatTabPressed,
                  ]}
                >
                  {busy === 'create-chat' ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Text style={styles.emptyDroneButtonText}>Create chat</Text>
                  )}
                </Pressable>
                {error ? <ErrorBanner message={error} /> : null}
              </View>
            ) : (
            <>
            {accessOpen && phoneTarget && nativeChatId ? (
              <ScrollView style={styles.transcriptScroll} contentContainerStyle={styles.transcriptContent}>
                {localAssistant.threads.find((thread) => thread.id === nativeChatId) ? (
                  <LocalWorkspaceEditor
                    thread={localAssistant.threads.find((thread) => thread.id === nativeChatId)!}
                    onRequestClose={() => {
                      if (accessDirty) setConfirmAccessDiscard(true);
                      else setAccessOpen(false);
                    }}
                    onApplied={() => {
                      setAccessDirty(false);
                      setAccessOpen(false);
                    }}
                    onDirtyChange={setAccessDirty}
                  />
                ) : null}
              </ScrollView>
            ) : <>
            {visibleChats.length > 1 ? (
              <View style={styles.chatTabsFrame}>
                <ScrollView
                  ref={chatTabsRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chats}
                >
                  {visibleChats.map((chat) => {
                    const active = chat === chatName;
                    const chatBusy = selected.busyChats.includes(chat);
                    const chatUnread = !active && (selected.unreadChats ?? []).includes(chat);
                    return (
                      <Pressable
                        key={chat}
                        accessibilityLabel={`${chat}${chatUnread ? ', unread' : ''}`}
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
                        ) : chatUnread ? (
                          <View accessible={false} style={styles.chatUnreadDot} />
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
                linkedPullRequests={linkedPullRequests}
                onDeleteMessageRequest={nativeMessages !== null ? ({ message, deleteFollowing }) => {
                  const messageId = String((message as any)?.id ?? '').trim();
                  if (!selected || !messageId) return;
                  const destinationId = targetId;
                  void requestDroneControl(destinationId, 'chat.message.delete', {
                    droneId: selected.id,
                    chatName,
                    nativeChatId,
                    messageId,
                    deleteFollowing,
                  })
                    .then(() => readChat(selected.id, chatName))
                    .catch((nextError: any) => setError(nextError?.message ?? String(nextError)));
                } : undefined}
              />
              <QueuedPromptRows
                prompts={visiblePendingPrompts}
                cancellingId={cancellingPromptId}
                onCancel={cancelPendingPrompt}
              />
              {pendingApprovals.map((approval) => (
                <AssistantApprovalCard
                  key={approval.id}
                  approval={approval}
                  busy={approvalBusyId === approval.id}
                  onResolve={(approved) => resolveNativeApproval(approval, approved)}
                />
              ))}
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
              currentThinkingLevel={chatReasoning}
              options={chatModels}
              busy={modelBusy}
              onClose={() => setModelOpen(false)}
              onSelect={(choice, selection) => void updateChatModel(choice, selection)}
            />
            </>}
            </>
            )}
          </View>
        ) : targetSupportsDrones ? (
          <NewDroneScreen
            key={`${targetId}:${newDroneScreenVersion}`}
            repos={createRepos}
            loadingOptions={meshRouteAvailable && (!dronesLoaded || busy === 'drones')}
            busy={busy.startsWith('create-')}
            draft={newDroneDraft}
            requestError={error}
            initialValues={newDroneDefaults ?? undefined}
            localDevice={phoneTarget}
            onDetectModels={detectCreateModels}
            onLoadRepoBranches={loadCreateRepoBranches}
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
        visible={confirmAccessDiscard}
        title="Discard workspace changes?"
        message="Your unsaved workspace access changes will be lost."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmAccessDiscard(false)}
        onConfirm={() => {
          setConfirmAccessDiscard(false);
          setAccessDirty(false);
          setAccessOpen(false);
        }}
      />
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
              await requestDroneControl(destinationId, 'drone.delete', { droneId });
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
  emptyDrone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 28,
  },
  emptyDroneTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 4 },
  emptyDroneBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyDroneButton: {
    minHeight: 42,
    minWidth: 132,
    marginTop: 8,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  emptyDroneButtonText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  chatTabsFrame: {
    minHeight: 39,
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chats: { gap: 3, paddingHorizontal: 10 },
  chatTab: {
    minHeight: 38,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  chatTabActive: {
    borderBottomColor: colors.accent,
  },
  chatTabPressed: { opacity: 0.72 },
  chatText: { flexShrink: 1, color: colors.muted, fontSize: 10, fontWeight: '800' },
  chatTextActive: { color: colors.accent },
  chatUnreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
  chatError: { paddingHorizontal: 12, paddingTop: 9 },
  transcriptScroll: { flex: 1 },
  transcriptContent: { flexGrow: 1 },
  transcriptContentHidden: { opacity: 0 },
});
