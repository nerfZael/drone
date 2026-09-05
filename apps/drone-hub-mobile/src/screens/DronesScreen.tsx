import React from 'react';
import {
  beginMobileChatLoad,
  finishMobileChatLoad,
  markMobileChatLoad,
  mobileChatApplied,
  mobileChatCommitted,
  observeMobileChatRequest,
} from '../diagnostics/mobile-chat-load';
import { fromByteArray } from 'base64-js';
import {
  buildModelCatalogChoices,
  normalizePromptQueueInterruption,
  type AssistantMessage,
  type ChatQuestionRequest,
  type ChatQuestionResponse,
} from '@drone/assistant-chat';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChatFilesCarousel } from '../drones/ChatFilesCarousel';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmDialog, ErrorBanner, TextInputDialog } from '../components/Ui';
import { RenderErrorBoundary } from '../components/RenderErrorBoundary';
import {
  AppDrawer,
  type AppDrawerNavigationItem,
  type DrawerDevicePickerItem,
} from '../local-assistant/AppDrawer';
import { AssistantComposer } from '../local-assistant/AssistantComposer';
import { MobileDictationComposer } from '../local-assistant/MobileDictationComposer';
import { resolveMobileDictationTarget } from '../local-assistant/mobile-dictation-target';
import type {
  MobileDictationDestination,
  MobileDictationSendResult,
  MobileDictationTarget,
} from '../local-assistant/mobile-dictation-types';
import { useMobileDictation } from '../local-assistant/use-mobile-dictation';
import { MobileLoadingState } from '../local-assistant/MobileLoadingState';
import { useMobileCompanionWorkspaceTarget } from '../local-assistant/use-mobile-companion-workspace-target';
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
  type MobileDroneApprovalPolicy,
  type MobileDroneAgentPermissionMode,
  type MobileDroneCreateDefaults,
  type MobileDroneCreatePayload,
  type MobileNewDroneDraftContent,
} from '../drones/NewDroneScreen';
import { DroneRuntimeIndicator } from '../drones/NewDroneRuntimePicker';
import { DroneBranchIndicator } from '../drones/DroneBranchIndicator';
import { ChatSubscriptionIndicator } from '../drones/ChatSubscriptionIndicator';
import { clientTimeZone } from '../drones/client-time-zone';
import { mobileDroneChatErrorMessage } from '../drones/mobile-drone-chat-error';
import {
  normalizeMobileChatSubscriptions,
  type MobileChatSubscription,
} from '../drones/chat-subscriptions';
import {
  mobileDroneCreatePreferencesFromPayload,
  resolveMobileDroneCreateDefaults,
  type MobileDroneCreatePreferences,
} from '../drones/create-preferences-model';
import {
  loadMobileDroneCreatePreferences,
  saveMobileDroneCreatePreferences,
} from '../drones/create-preferences-storage';
import {
  EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  mobileDroneTurnsToAssistantMessages,
  normalizeMobileDroneCreateRepo,
  normalizeMobileDroneCreateModelCatalog,
  normalizeMobileDroneChatModelCatalog,
  normalizeMobileDrone,
  normalizeMobileNativeChatHistory,
  normalizeMobileDroneListPayload,
  resolveMobileDroneListSnapshot,
  suggestMobileDroneCloneName,
  suggestNextMobileDroneChatName,
  type MobileDroneCreateRepo,
  type MobileDroneCreateModel,
  type MobileChatHistoryPage,
  type MobileDroneListSnapshot,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
} from '../drones/drone-sidebar-model';
import { loadMobileDroneList } from '../drones/load-mobile-drone-list';
import {
  applyOptimisticMobileSidebarMove,
  mobileSidebarMoveDestination,
  type MobileSidebarMutationRequest,
} from '../drones/mobile-sidebar-reorder';
import {
  appendSidebarOptimisticCommand,
  applySidebarMove,
  createSidebarCommandQueue,
  createSidebarOptimisticJournal,
  replaceSidebarConfirmedState,
  settleSidebarOptimisticCommand,
  sidebarOptimisticJournalValue,
  type SidebarOptimisticJournal,
  type SidebarMoveIntent,
} from '@drone/hub-model/sidebar';
import {
  withMobileApprovalRequired,
  withOptimisticMobileBusyChat,
} from '../drones/drone-state-summary';
import {
  confirmOptimisticMobilePendingPrompt,
  confirmedMobilePendingPromptState,
  hasActiveMobileDronePendingPrompt,
  latestActiveMobileAgentPrompt,
  mergeOptimisticMobilePendingPrompts,
  mobileChatRespondingStatus,
  mobileDronePendingPrompts,
  optimisticMobilePendingPrompt,
} from '../drones/mobile-pending-prompts';
import { MobileChatReadCoordinator } from '../drones/mobile-chat-read-coordinator';
import { BoundedSwrCache } from '../drones/bounded-swr-cache';
import {
  invalidateMobileChatCache,
  mobileChatCacheScopeIncludes,
  mobileChatCacheKey,
} from '../drones/mobile-chat-cache';
import {
  loadMobileChatWithListRecovery,
  mobileChatRefreshPlan,
} from '../drones/mobile-chat-refresh';
import { isMobileDroneStarting } from '../drones/isMobileDroneStarting';
import { useDroneLinkedPullRequests } from '../drones/use-drone-linked-pull-requests';
import { useLocalDroneControl } from '../drones/local-drone-control';
import { mobileDeviceConnectionState } from '../drones/mobile-device-reachability';
import { ChatAttachmentStrip } from '../drones/ChatAttachmentStrip';
import { FilePreviewModal } from '../drones/FilePreviewModal';
import { useFilePreview } from '../drones/use-file-preview';
import {
  pickChatImages,
  type MobileChatAttachment,
  type MobileChatImage,
} from '../drones/pick-chat-images';
import { pickChatFiles } from '../drones/pick-chat-files';
import {
  mobileDroneRenameErrorMessage,
  validateMobileDroneRename,
} from '../drones/mobile-drone-rename';
import { isGranted, type DroneControlOperation } from '@drone/device-protocol';
import { useLocalAssistant } from '../local-assistant/LocalAssistantContext';
import { LocalWorkspaceEditor } from '../local-assistant/LocalWorkspaceEditor';
import {
  AssistantApprovalCard,
  type MobileAssistantApproval,
} from '../local-assistant/AssistantApprovalCard';
import { MobileQuestionRequestCard } from '../local-assistant/MobileQuestionRequestCard';
import { MobileQuestionResultCard } from '../local-assistant/MobileQuestionResultCard';
import { CodexApprovalCard } from '../drones/CodexApprovalCard';
import type { CodexApprovalDecision, CodexPendingApproval } from '@drone/assistant-chat';

const APP_HEADER_HEIGHT = 58;
const EMPTY_CHAT_HISTORY_PAGE: MobileChatHistoryPage = {
  beforeCursor: null,
  hasOlder: false,
  responseTruncated: false,
  contentTruncated: false,
};

function mobileMutedChatId(droneId: string, chatName: string): string {
  return `chat:${String(droneId).trim()}:${String(chatName).trim() || 'default'}`;
}

type MobileSidebarJournalState = {
  drones: MobileDroneSummary[];
  sidebar: MobileDroneSidebarOrder;
};

function applyMobileSidebarJournalCommand(
  state: MobileSidebarJournalState,
  request: SidebarMoveIntent,
): MobileSidebarJournalState {
  return {
    drones:
      request.kind === 'move-into-folder'
        ? applyOptimisticMobileSidebarMove(state.drones, request)
        : state.drones,
    sidebar: applySidebarMove(state.sidebar, request),
  };
}

function inlinePromptAttachments(attachments: readonly MobileChatAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.bytes.byteLength,
    dataBase64: fromByteArray(attachment.bytes),
  }));
}

function normalizedChatMutationList(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const chats = [...new Set(raw.map((value) => String(value ?? '').trim()).filter(Boolean))];
  return chats.length > 0 ? chats : [...fallback];
}

function applyChatMutationToDrone(
  drone: MobileDroneSummary,
  nextChats: readonly string[],
  rename?: { from: string; to: string },
): MobileDroneSummary {
  const projectName = (chatName: string) =>
    rename && chatName === rename.from ? rename.to : chatName;
  const allowed = new Set(nextChats);
  const projectList = (chatNames: readonly string[] | undefined) => [
    ...new Set((chatNames ?? []).map(projectName).filter((chatName) => allowed.has(chatName))),
  ];
  const projectMap = <T,>(source: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!source) return undefined;
    return Object.fromEntries(
      Object.entries(source)
        .map(([chatName, value]) => [projectName(chatName), value] as const)
        .filter(([chatName]) => allowed.has(chatName)),
    );
  };
  return {
    ...drone,
    chats: [...nextChats],
    busyChats: projectList(drone.busyChats),
    approvalChats: projectList(drone.approvalChats),
    unreadChats: projectList(drone.unreadChats),
    draftChats: projectMap(drone.draftChats),
    chatReadStates: projectMap(drone.chatReadStates),
  };
}

function nativeUserMessageMatchesOptimisticPrompt(
  messages: readonly AssistantMessage[],
  pending: any,
): boolean {
  if (pending?.optimisticSent !== true) return false;
  const pendingText = String(pending?.prompt ?? '').trim();
  const pendingAt = Date.parse(String(pending?.at ?? ''));
  const pendingAttachmentCount = Math.max(
    0,
    Number(pending?.attachmentCount ?? pending?.imageCount) || 0,
  );
  const pendingImageCount = Math.max(0, Number(pending?.imageCount) || 0);
  return messages.some((message: any) => {
    if (message?.role !== 'user') return false;
    const messageAt = Date.parse(String(message?.createdAt ?? message?.timestamp ?? ''));
    if (Number.isFinite(pendingAt) && Number.isFinite(messageAt) && messageAt < pendingAt - 2_000)
      return false;
    const parts = Array.isArray(message?.content) ? message.content : [];
    const messageText = (
      typeof message?.content === 'string'
        ? message.content
        : parts
            .filter((part: any) => part?.type === 'text')
            .map((part: any) => String(part?.text ?? ''))
            .join('\n')
    ).trim();
    const imageCount = parts.filter((part: any) => part?.type === 'image').length;
    return (
      (pendingText &&
        (messageText === pendingText ||
          messageText.startsWith(`${pendingText}\n\nAttached files:\n`))) ||
      (!pendingText &&
        pendingAttachmentCount > 0 &&
        ((pendingImageCount > 0 && imageCount === pendingImageCount) ||
          messageText.startsWith('Attached files:\n')))
    );
  });
}

export type DronesAppHeaderState = {
  title: string;
  subtitle?: string;
  backNavigation?: boolean;
  onNewDrone?(): void;
  onNewChat?(): void;
  onOpenFiles?(): void;
  onClone?(): void;
  cloneDisabled?: boolean;
  onRename?(): void;
  pinned?: boolean;
  pinDisabled?: boolean;
  onTogglePinned?(): void;
  onDelete?(): void;
  accessOpen?: boolean;
  accessDisabled?: boolean;
  onToggleAccess?(): void;
  autoApprove?: boolean;
  onToggleAutoApprove?(): void;
  agentAccessOptions?: DronesHeaderChoice[];
  approvalPolicyOptions?: DronesHeaderChoice[];
};

export type DronesHeaderChoice = {
  id: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect(): void;
};

function mobileDroneAgentId(value: unknown): MobileDroneAgentId | null {
  const id = String(value ?? '').trim();
  return ['native', 'cursor', 'codex', 'claude', 'opencode', 'pi', 'blip'].includes(id)
    ? (id as MobileDroneAgentId)
    : null;
}

export function DronesScreen({
  drawerOpen,
  workspaceVisible,
  navigationItems,
  onDrawerOpenChange,
  onHeaderChange,
  selectedDeviceId,
  devicePickerItems,
  onDeviceChange,
}: {
  drawerOpen: boolean;
  workspaceVisible: boolean;
  navigationItems: AppDrawerNavigationItem[];
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
  const activeTarget = mesh.devices.find((target) => target.id === targetId);
  const phoneTarget = Boolean(targetId && targetId === mesh.identity?.id);
  const targetSupportsDrones = phoneTarget || targets.some((target) => target.id === targetId);
  const targetDroneControlCapability = mesh.profile?.capabilitiesByDevice[targetId]?.find(
    (capability) => capability.id === 'drone-control' && capability.version === 1,
  );
  const selfDevice = mesh.devices.find((device) => device.id === mesh.identity?.id);
  const targetCanReorderSidebar =
    phoneTarget ||
    (Boolean(targetDroneControlCapability?.operations.includes('sidebar.move')) &&
      Boolean(selfDevice && isGranted(selfDevice.grants, 'drone-control', 1, 'sidebar.move')));
  const targetCanCloneDrone =
    !phoneTarget &&
    Boolean(targetDroneControlCapability?.operations.includes('drone.create.container')) &&
    Boolean(
      selfDevice && isGranted(selfDevice.grants, 'drone-control', 1, 'drone.create.container'),
    );
  const targetConnectionState = mobileDeviceConnectionState({
    targetDeviceId: targetId,
    selfDeviceId: mesh.identity?.id,
    connectionStatesByDevice: mesh.connectionStatesByDevice,
  });
  const targetReachable = targetConnectionState === 'connected';
  const targetReconnecting =
    targetConnectionState === 'reconnecting' || targetConnectionState === 'suspended';
  const requestDroneControl = React.useCallback(
    (
      destinationId: string,
      operation: DroneControlOperation,
      payload?: any,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) {
        return Promise.reject(
          Object.assign(new Error('The request was cancelled'), {
            name: 'AbortError',
          }),
        );
      }
      if (destinationId !== mesh.identity?.id)
        return mesh.request(destinationId, 'drone-control', operation, payload, signal);
      const observation = observeMobileChatRequest(
        destinationId,
        operation,
        payload,
        `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      return localDroneControl.request(operation, payload).then(
        (value) => {
          observation?.finish('completed');
          return value;
        },
        (error) => {
          observation?.finish('error');
          throw error;
        },
      );
    },
    [localDroneControl.request, mesh.identity?.id, mesh.request],
  );
  const [chatLoadCommit, setChatLoadCommit] =
    React.useState<ReturnType<typeof mobileChatApplied>>(null);
  React.useLayoutEffect(() => {
    mobileChatCommitted(chatLoadCommit);
  }, [chatLoadCommit]);
  React.useEffect(() => () => finishMobileChatLoad('superseded'), []);
  const [droneListSnapshot, setDroneListSnapshot] = React.useState<MobileDroneListSnapshot>(
    EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
  );
  const droneListSnapshotRef = React.useRef<MobileDroneListSnapshot>(
    EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
  );
  const activeDroneListSnapshot =
    droneListSnapshot.targetId === targetId
      ? droneListSnapshot
      : {
          ...EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
          targetId,
        };
  const drones = activeDroneListSnapshot.drones;
  const droneSidebarOrder = activeDroneListSnapshot.sidebar;
  const droneSidebarOrderRef = React.useRef<MobileDroneSidebarOrder>(
    EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  );
  const sidebarPreferenceVersionRef = React.useRef<number | null>(null);
  const commitDroneListSnapshot = React.useCallback((next: MobileDroneListSnapshot) => {
    droneListSnapshotRef.current = next;
    droneSidebarOrderRef.current = next.sidebar;
    sidebarPreferenceVersionRef.current = next.sidebarPreferenceVersion;
    setDroneListSnapshot(next);
  }, []);
  const setDrones = React.useCallback(
    (update: React.SetStateAction<MobileDroneSummary[]>) => {
      const current = droneListSnapshotRef.current;
      if (current.targetId !== targetId) return;
      const nextDrones =
        typeof update === 'function'
          ? (update as (value: MobileDroneSummary[]) => MobileDroneSummary[])(current.drones)
          : update;
      commitDroneListSnapshot({ ...current, drones: nextDrones });
    },
    [commitDroneListSnapshot, targetId],
  );
  const sidebarWriteQueueRef = React.useRef<ReturnType<typeof createSidebarCommandQueue> | null>(
    null,
  );
  if (!sidebarWriteQueueRef.current) sidebarWriteQueueRef.current = createSidebarCommandQueue();
  const sidebarJournalRef = React.useRef<
    SidebarOptimisticJournal<MobileSidebarJournalState, SidebarMoveIntent>
  >(
    createSidebarOptimisticJournal({
      drones: [],
      sidebar: EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
    }),
  );
  const sidebarWriteGenerationRef = React.useRef(0);
  const [selected, setSelected] = React.useState<MobileDroneSummary | null>(null);
  const [chats, setChats] = React.useState<string[]>([]);
  const [chatName, setChatName] = React.useState('default');
  const [chatModel, setChatModel] = React.useState('');
  const [chatReasoning, setChatReasoning] = React.useState('');
  const [chatModelProvider, setChatModelProvider] = React.useState('drone');
  const [chatAgentId, setChatAgentId] = React.useState<MobileDroneAgentId | null>(null);
  const [chatAgentPermissionMode, setChatAgentPermissionMode] =
    React.useState<MobileDroneAgentPermissionMode>('execute');
  const [chatApprovalPolicy, setChatApprovalPolicy] =
    React.useState<MobileDroneApprovalPolicy>('ask');
  const [chatModels, setChatModels] = React.useState<AssistantModelChoice[]>([]);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [modelBusy, setModelBusy] = React.useState(false);
  const [turns, setTurns] = React.useState<any[]>([]);
  const [nativeMessages, setNativeMessages] = React.useState<AssistantMessage[] | null>(null);
  const [chatHistoryPage, setChatHistoryPage] =
    React.useState<MobileChatHistoryPage>(EMPTY_CHAT_HISTORY_PAGE);
  const [olderHistoryBusy, setOlderHistoryBusy] = React.useState(false);
  const [, setChatReadRevision] = React.useState(0);
  const [fullMessageBusyId, setFullMessageBusyId] = React.useState('');
  const [nativeChatId, setNativeChatId] = React.useState('');
  const [chatSubscriptions, setChatSubscriptions] = React.useState<MobileChatSubscription[]>([]);
  const [nativeThread, setNativeThread] = React.useState<any | null>(null);
  const [accessOpen, setAccessOpen] = React.useState(false);
  const [accessDirty, setAccessDirty] = React.useState(false);
  const [confirmAccessDiscard, setConfirmAccessDiscard] = React.useState(false);
  const [pendingApprovals, setPendingApprovals] = React.useState<MobileAssistantApproval[]>([]);
  const [approvalBusyId, setApprovalBusyId] = React.useState('');
  const [questionRequests, setQuestionRequests] = React.useState<ChatQuestionRequest[]>([]);
  const [questionBusyId, setQuestionBusyId] = React.useState('');
  const [resolvedCodexApprovalIds, setResolvedCodexApprovalIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [pendingPrompts, setPendingPrompts] = React.useState<any[]>([]);
  const [cancellingPromptId, setCancellingPromptId] = React.useState('');
  const [resolvingInterruptionId, setResolvingInterruptionId] = React.useState('');
  const [creatingQueuedChatId, setCreatingQueuedChatId] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [promptAttachments, setPromptAttachments] = React.useState<MobileChatAttachment[]>([]);
  const promptRef = React.useRef(prompt);
  const promptAttachmentsRef = React.useRef(promptAttachments);
  promptRef.current = prompt;
  promptAttachmentsRef.current = promptAttachments;
  const [createRepos, setCreateRepos] = React.useState<MobileDroneCreateRepo[]>([]);
  const [createOptionsLoading, setCreateOptionsLoading] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const [dronesLoaded, setDronesLoaded] = React.useState(false);
  const [droneListError, setDroneListError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const visibleChatError = mobileDroneChatErrorMessage(error);
  const chatReadErrorRef = React.useRef<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = React.useState<MobileDroneSummary | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [renameCandidate, setRenameCandidate] = React.useState<MobileDroneSummary | null>(null);
  const [renameName, setRenameName] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [deleteMode, setDeleteMode] = React.useState<'archive' | 'permanent'>('permanent');
  const [droneOperationById, setDroneOperationById] = React.useState<
    Record<string, 'archiving' | 'deleting'>
  >({});
  const [pinningDroneIds, setPinningDroneIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [newDroneDefaults, setNewDroneDefaults] = React.useState<MobileDroneCreateDefaults | null>(
    null,
  );
  const [newDroneScreenVersion, setNewDroneScreenVersion] = React.useState(0);
  const newDroneDraftContentRef = React.useRef<MobileNewDroneDraftContent | null>(null);
  const newDroneDraftSavePromiseRef = React.useRef<Promise<void> | null>(null);
  const [composerFocusKey, setComposerFocusKey] = React.useState('');
  const [restingChatComposerHeight, setRestingChatComposerHeight] = React.useState(98);
  const targetIdRef = React.useRef(targetId);
  const selectedRef = React.useRef(selected);
  const chatNameRef = React.useRef(chatName);
  const realtimeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const droneListVersion = React.useRef(0);
  const chatReadVersion = React.useRef(0);
  const fullMessageAbortRef = React.useRef<AbortController | null>(null);
  const openDroneVersion = React.useRef(0);
  const runVersion = React.useRef(0);
  const busyVersion = React.useRef(0);
  const modelRequestVersion = React.useRef(0);
  const createDefaultsRequestVersion = React.useRef(0);
  const createOptionsRequestVersion = React.useRef(0);
  const createRepoBranchesCache = React.useRef(new Map<string, MobileDroneCreateRepo>());
  const loadedDronesTargetIdRef = React.useRef('');
  const loadDronesRef = React.useRef<(quiet?: boolean) => Promise<void>>(async () => {});
  const readChatRef = React.useRef<(droneId: string, chatName: string) => Promise<void>>(
    async () => {},
  );
  const chatReadCoordinatorRef = React.useRef<MobileChatReadCoordinator | null>(null);
  const chatReadCacheRef = React.useRef<BoundedSwrCache<any> | null>(null);
  const appliedChatReadRef = React.useRef<{ key: string; result: any } | null>(null);
  if (!chatReadCoordinatorRef.current) {
    chatReadCoordinatorRef.current = new MobileChatReadCoordinator(() =>
      setChatReadRevision((value) => value + 1),
    );
  }
  if (!chatReadCacheRef.current) {
    chatReadCacheRef.current = new BoundedSwrCache({ maxEntries: 8, maxAgeMs: 2 * 60_000 });
  }
  targetIdRef.current = targetId;
  droneSidebarOrderRef.current = droneSidebarOrder;
  selectedRef.current = selected;
  chatNameRef.current = chatName;

  React.useEffect(() => {
    fullMessageAbortRef.current?.abort();
    fullMessageAbortRef.current = null;
    setFullMessageBusyId('');
  }, [chatName, selected?.id, targetId]);

  React.useEffect(() => () => fullMessageAbortRef.current?.abort(), []);

  const invalidateChatReadCache = React.useCallback(
    (scope: { targetId: string; droneId?: string; chatName?: string }) => {
      const activeDroneId = selectedRef.current?.id ?? '';
      if (
        activeDroneId &&
        mobileChatCacheScopeIncludes(scope, {
          targetId: targetIdRef.current,
          droneId: activeDroneId,
          chatName: chatNameRef.current,
        })
      ) {
        // Do not let a read that started before invalidation repopulate or apply stale data.
        chatReadVersion.current += 1;
      }
      invalidateMobileChatCache(chatReadCacheRef.current!, scope);
    },
    [],
  );

  const resetActiveChatState = React.useCallback(() => {
    appliedChatReadRef.current = null;
    setChatModel('');
    setChatReasoning('');
    setChatModelProvider('drone');
    setChatAgentId(null);
    setChatAgentPermissionMode('execute');
    setChatApprovalPolicy('ask');
    setChatModels([]);
    setTurns([]);
    setNativeMessages(null);
    setNativeChatId('');
    setNativeThread(null);
    setPendingApprovals([]);
    setQuestionRequests([]);
    setPendingPrompts([]);
    setAccessOpen(false);
    setAccessDirty(false);
  }, []);

  const transitionToChat = React.useCallback(
    (nextChat: string) => {
      chatNameRef.current = nextChat;
      setChatName(nextChat);
      resetActiveChatState();
    },
    [resetActiveChatState],
  );

  const transitionToDroneChat = React.useCallback(
    (nextDrone: MobileDroneSummary | null, nextChat = nextDrone?.chats[0] ?? 'default') => {
      selectedRef.current = nextDrone;
      setSelected(nextDrone);
      setChats(nextDrone?.chats ?? []);
      transitionToChat(nextChat);
    },
    [transitionToChat],
  );

  React.useEffect(() => {
    setChatHistoryPage(EMPTY_CHAT_HISTORY_PAGE);
    setOlderHistoryBusy(false);
    setPromptAttachments([]);
    setChatSubscriptions([]);
  }, [chatName, selected?.id, targetId]);

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
      if (!quiet) setError(null);
      try {
        const normalized = await loadMobileDroneList(requestDroneControl, targetId, quiet);
        if (targetIdRef.current !== targetId || droneListVersion.current !== requestVersion) return;
        const confirmedSnapshot = resolveMobileDroneListSnapshot({
          current: droneListSnapshotRef.current,
          targetId,
          payload: normalized,
          keepCurrentSidebar: false,
        });
        sidebarJournalRef.current = replaceSidebarConfirmedState(sidebarJournalRef.current, {
          drones: confirmedSnapshot.drones,
          sidebar: confirmedSnapshot.sidebar,
        });
        const visibleSidebar = sidebarOptimisticJournalValue(
          sidebarJournalRef.current,
          applyMobileSidebarJournalCommand,
        );
        const nextDrones = visibleSidebar.drones;
        setDeleteMode(normalized.deleteMode);
        if (!quiet || normalized.createRepos.length > 0) {
          setCreateRepos((current) => {
            const currentByPath = new Map(current.map((repo) => [repo.path, repo]));
            return normalized.createRepos.map(
              (repo) =>
                createRepoBranchesCache.current.get(`${targetId}:${repo.path}`) ??
                currentByPath.get(repo.path) ??
                repo,
            );
          });
        }
        loadedDronesTargetIdRef.current = targetId;
        commitDroneListSnapshot({
          ...confirmedSnapshot,
          drones: nextDrones,
          sidebar: visibleSidebar.sidebar,
        });
        const currentSelected = selectedRef.current;
        const nextSelected = currentSelected
          ? (nextDrones.find((drone) => drone.id === currentSelected.id) ?? null)
          : null;
        if (!nextSelected) {
          if (currentSelected) transitionToDroneChat(null);
        } else {
          selectedRef.current = nextSelected;
          setSelected(nextSelected);
          const nextChats = nextSelected.chats;
          setChats(nextChats);
          if (nextChats.length === 0) {
            transitionToChat('');
          }
          if (!nextChats.includes(chatNameRef.current)) {
            const fallbackChat = nextChats[0];
            if (fallbackChat) {
              transitionToChat(fallbackChat);
              void readChatRef.current(nextSelected.id, fallbackChat).catch(() => undefined);
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
      } catch (nextError: any) {
        if (targetIdRef.current === targetId && droneListVersion.current === requestVersion) {
          const message = nextError?.message ?? String(nextError);
          if (!quiet) {
            setDroneListError(message);
            setError(message);
          }
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
    [
      commitDroneListSnapshot,
      requestDroneControl,
      targetId,
      targetSupportsDrones,
      transitionToChat,
      transitionToDroneChat,
    ],
  );
  loadDronesRef.current = loadDrones;

  const reorderSidebar = React.useCallback(
    (request: MobileSidebarMutationRequest) => {
      const destinationId = targetId;
      const current = droneListSnapshotRef.current;
      if (current.targetId !== destinationId) return Promise.resolve(false);
      if (request.kind === 'move-into-folder' && !mobileSidebarMoveDestination(request)) {
        return Promise.resolve(false);
      }
      const generation = sidebarWriteGenerationRef.current + 1;
      sidebarWriteGenerationRef.current = generation;
      const commandId = `sidebar:${destinationId}:${Date.now()}:${generation}`;
      if (sidebarJournalRef.current.pending.length === 0) {
        sidebarJournalRef.current = replaceSidebarConfirmedState(sidebarJournalRef.current, {
          drones: current.drones,
          sidebar: current.sidebar,
        });
      }
      sidebarJournalRef.current = appendSidebarOptimisticCommand(sidebarJournalRef.current, {
        id: commandId,
        command: request,
      });
      const visible = sidebarOptimisticJournalValue(
        sidebarJournalRef.current,
        applyMobileSidebarJournalCommand,
      );
      droneSidebarOrderRef.current = visible.sidebar;
      commitDroneListSnapshot({ ...current, ...visible });

      const write = async () => {
        let saved = false;
        try {
          if (targetIdRef.current !== destinationId) return false;
          const result = await requestDroneControl(destinationId, 'sidebar.move', {
            mutationId: commandId,
            intent: request,
          });
          if (targetIdRef.current !== destinationId) return false;
          if (result?.ok !== true) {
            throw new Error(String(result?.error ?? 'Sidebar move failed'));
          }
          const savedVersion =
            Number.isSafeInteger(result?.version) && Number(result.version) >= 0
              ? Number(result.version)
              : sidebarPreferenceVersionRef.current;
          sidebarPreferenceVersionRef.current = savedVersion;
          saved = true;
        } catch (nextError: any) {
          if (targetIdRef.current === destinationId) {
            setError(nextError?.message ?? String(nextError));
          }
        } finally {
          sidebarJournalRef.current = settleSidebarOptimisticCommand(
            sidebarJournalRef.current,
            commandId,
          );
        }
        if (targetIdRef.current === destinationId) await loadDronesRef.current(true);
        return saved;
      };
      const pending = sidebarWriteQueueRef.current!.enqueue(write);
      void pending;
      return pending;
    },
    [commitDroneListSnapshot, requestDroneControl, targetId],
  );

  React.useEffect(() => {
    const createDefaultsVersion = ++createDefaultsRequestVersion.current;
    sidebarJournalRef.current = createSidebarOptimisticJournal({
      drones: [],
      sidebar: EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
    });
    commitDroneListSnapshot({
      ...EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
      targetId,
    });
    transitionToDroneChat(null);
    setConfirmAccessDiscard(false);
    setApprovalBusyId('');
    setResolvedCodexApprovalIds(new Set());
    setCancellingPromptId('');
    setPrompt('');
    setPromptAttachments([]);
    promptRef.current = '';
    promptAttachmentsRef.current = [];
    setCreateRepos([]);
    setCreateOptionsLoading(false);
    setBusy('');
    setDronesLoaded(false);
    setDroneListError(null);
    setError(null);
    setModelOpen(false);
    setModelBusy(false);
    setDeleteCandidate(null);
    setDeleting(false);
    setRenameCandidate(null);
    setRenameName('');
    setRenameError(null);
    setRenaming(false);
    setDeleteMode('permanent');
    setDroneOperationById({});
    setNewDroneDefaults(null);
    newDroneDraftContentRef.current = null;
    setNewDroneScreenVersion((value) => value + 1);
    setComposerFocusKey('');
    droneListVersion.current += 1;
    chatReadVersion.current += 1;
    chatReadErrorRef.current = null;
    chatReadCoordinatorRef.current?.reset();
    openDroneVersion.current += 1;
    runVersion.current += 1;
    busyVersion.current += 1;
    modelRequestVersion.current += 1;
    createOptionsRequestVersion.current += 1;
    loadedDronesTargetIdRef.current = '';
    if (targetSupportsDrones) {
      void loadMobileDroneCreatePreferences(targetId, '').then((remembered) => {
        if (
          targetIdRef.current !== targetId ||
          createDefaultsRequestVersion.current !== createDefaultsVersion ||
          selectedRef.current
        ) {
          return;
        }
        const defaults = resolveMobileDroneCreateDefaults({ remembered });
        setNewDroneDefaults(defaults);
        setNewDroneScreenVersion((value) => value + 1);
      });
    }
  }, [commitDroneListSnapshot, targetId, targetSupportsDrones, transitionToDroneChat]);
  React.useEffect(() => {
    if (targetReachable && targetSupportsDrones) {
      // Callback identities change while the local assistant and mesh hydrate. Refresh only when
      // the resource key or route changes, and keep already-loaded content visible on reconnect.
      void loadDronesRef.current(loadedDronesTargetIdRef.current === targetId);
    }
  }, [targetReachable, targetId, targetSupportsDrones]);

  const activateDrone = async (
    drone: MobileDroneSummary,
    requestedChat?: string,
    options: { deferChatLoad?: boolean } = {},
  ): Promise<void> => {
    createDefaultsRequestVersion.current += 1;
    const destinationId = targetId;
    const requestVersion = ++openDroneVersion.current;
    chatReadVersion.current += 1;
    const knownChats = drone.chats;
    const knownChat =
      requestedChat && knownChats.includes(requestedChat) ? requestedChat : (knownChats[0] ?? '');
    const loadTarget = {
      targetDeviceId: destinationId,
      droneId: drone.id,
      chatName: knownChat || 'default',
    };
    beginMobileChatLoad(loadTarget, true);
    transitionToDroneChat(drone, knownChat);
    markMobileChatLoad(loadTarget, 'selectionApplied');
    // Starting clones publish a chat change when their copied chats are ready. Reading now
    // returns a transient conflict and replaces the useful starting state with an error.
    if (options.deferChatLoad) return;
    try {
      await loadMobileChatWithListRecovery({
        initialChat: knownChat,
        knownChats,
        requestedChat,
        listChats: async () => {
          const result = await requestDroneControl(destinationId, 'chats.list', {
            droneId: drone.id,
          });
          return result?.chats;
        },
        readChat: (nextChat) => {
          beginMobileChatLoad({ ...loadTarget, chatName: nextChat }, true);
          return readChat(drone.id, nextChat, { useCache: true });
        },
        isCurrent: () =>
          targetIdRef.current === destinationId && openDroneVersion.current === requestVersion,
        applyListedSelection(nextChats, nextChat) {
          setChats(nextChats);
          if (nextChat === chatNameRef.current) return;
          chatReadVersion.current += 1;
          transitionToChat(nextChat);
        },
      });
    } catch (error) {
      if (openDroneVersion.current === requestVersion) finishMobileChatLoad('error');
      throw error;
    }
  };

  const openDrone = (drone: MobileDroneSummary, requestedChat?: string) =>
    run('chats', () => activateDrone(drone, requestedChat));

  const readChat = (
    droneId: string,
    nextChat: string,
    options: { useCache?: boolean } = {},
  ): Promise<void> => {
    const destinationId = targetId;
    const key = mobileChatCacheKey(destinationId, droneId, nextChat);
    const loadTarget = { targetDeviceId: destinationId, droneId, chatName: nextChat };
    markMobileChatLoad(loadTarget, 'readRequested');
    if (options.useCache) {
      const cached = chatReadCacheRef.current!.get(key);
      if (
        cached &&
        targetIdRef.current === destinationId &&
        selectedRef.current?.id === droneId &&
        chatNameRef.current === nextChat
      ) {
        applyChatReadResult(cached, droneId, nextChat);
        setChatLoadCommit(mobileChatApplied(loadTarget, 'cached'));
      }
    }
    return chatReadCoordinatorRef.current!.request(key, async () => {
      if (
        targetIdRef.current !== destinationId ||
        selectedRef.current?.id !== droneId ||
        chatNameRef.current !== nextChat
      ) {
        return;
      }
      const requestVersion = ++chatReadVersion.current;
      markMobileChatLoad(loadTarget, 'coordinatorStarted');
      try {
        const result = await requestDroneControl(destinationId, 'chat.read', {
          droneId,
          chatName: nextChat,
        });
        markMobileChatLoad(loadTarget, 'freshResponse');
        if (
          targetIdRef.current !== destinationId ||
          selectedRef.current?.id !== droneId ||
          chatNameRef.current !== nextChat ||
          chatReadVersion.current !== requestVersion
        )
          return;
        const retained = chatReadCacheRef.current!.set(
          key,
          result,
          (current, next) => JSON.stringify(current) === JSON.stringify(next),
        );
        applyChatReadResult(retained, droneId, nextChat);
        setChatLoadCommit(mobileChatApplied(loadTarget, 'fresh'));
        const previousChatReadError = chatReadErrorRef.current;
        chatReadErrorRef.current = null;
        if (previousChatReadError) {
          setError((current) => (current === previousChatReadError ? null : current));
        }
      } catch (nextError: any) {
        if (
          targetIdRef.current === destinationId &&
          selectedRef.current?.id === droneId &&
          chatNameRef.current === nextChat &&
          chatReadVersion.current === requestVersion
        ) {
          const message = nextError?.message ?? String(nextError);
          chatReadErrorRef.current = message;
          setError(message);
        }
        throw nextError;
      }
    });
  };

  const applyChatReadResult = (result: any, droneId: string, nextChat: string) => {
    const resultKey = mobileChatCacheKey(targetIdRef.current, droneId, nextChat);
    if (
      appliedChatReadRef.current?.key === resultKey &&
      appliedChatReadRef.current.result === result
    ) {
      return;
    }
    appliedChatReadRef.current = { key: resultKey, result };
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
      result?.agentPermissionMode === 'read' || result?.agentPermissionMode === 'write'
        ? result.agentPermissionMode
        : 'execute',
    );
    setChatApprovalPolicy(
      result?.approvalPolicy === 'auto' || result?.approvalPolicy === 'none'
        ? result.approvalPolicy
        : result?.thread?.approvalPolicy === 'none' || result?.thread?.autoApprove === true
          ? 'none'
          : 'ask',
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
    const nativeHistory = normalizeMobileNativeChatHistory(result?.history);
    const streamingEntries = Array.isArray(result?.streamingMessages)
      ? result.streamingMessages
      : [];
    const richMessages =
      result?.historyKind === 'messages'
        ? ([...nativeHistory.messages, ...streamingEntries] as AssistantMessage[])
        : null;
    setNativeMessages(richMessages);
    setNativeChatId(String(result?.nativeChatId ?? '').trim());
    if (Array.isArray(result?.subscriptions)) {
      setChatSubscriptions(normalizeMobileChatSubscriptions(result.subscriptions));
    }
    setNativeThread(result?.thread ?? null);
    setPendingApprovals(Array.isArray(result?.pendingApprovals) ? result.pendingApprovals : []);
    setQuestionRequests(
      Array.isArray(result?.questionRequests)
        ? result.questionRequests
        : Array.isArray(result?.pendingQuestionRequests)
          ? result.pendingQuestionRequests
          : [],
    );
    const nextTurns = Array.isArray(result?.turns) ? result.turns : [];
    setTurns(nextTurns);
    const page = result?.historyKind === 'messages' ? nativeHistory.page : result?.page;
    const beforeCursor = Number(page?.beforeCursor);
    setChatHistoryPage({
      beforeCursor: Number.isSafeInteger(beforeCursor) && beforeCursor > 0 ? beforeCursor : null,
      hasOlder: page?.hasOlder === true,
      responseTruncated: page?.responseTruncated === true,
      contentTruncated: page?.contentTruncated === true,
    });
    setPendingPrompts((current) =>
      mergeOptimisticMobilePendingPrompts({
        serverPrompts: result?.pending,
        localPrompts: richMessages
          ? current.filter(
              (prompt) => !nativeUserMessageMatchesOptimisticPrompt(richMessages, prompt),
            )
          : current,
        turns: nextTurns,
      }),
    );
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

  const loadOlderChatHistory = async () => {
    if (!selected || !chatHistoryPage.hasOlder || !chatHistoryPage.beforeCursor || olderHistoryBusy)
      return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    setOlderHistoryBusy(true);
    setError(null);
    try {
      const result = await requestDroneControl(destinationId, 'chat.read', {
        droneId,
        chatName: activeChat,
        before: chatHistoryPage.beforeCursor,
      });
      if (
        targetIdRef.current !== destinationId ||
        selectedRef.current?.id !== droneId ||
        chatNameRef.current !== activeChat
      )
        return;
      if (result?.historyKind === 'messages') {
        const older = normalizeMobileNativeChatHistory(result?.history);
        setNativeMessages((current) => {
          const latest = current ?? [];
          const existingIds = new Set(latest.map((message: any) => String(message?.id ?? '')));
          return [
            ...older.messages.filter((message: any) => !existingIds.has(String(message?.id ?? ''))),
            ...latest,
          ];
        });
        setChatHistoryPage((current) => ({
          ...older.page,
          contentTruncated: current.contentTruncated || older.page.contentTruncated,
        }));
      } else {
        const olderTurns = Array.isArray(result?.turns) ? result.turns : [];
        setTurns((current) => {
          const existingIds = new Set(
            current.map((turn: any) => String(turn?.id ?? turn?.turn ?? '')),
          );
          return [
            ...olderTurns.filter(
              (turn: any) => !existingIds.has(String(turn?.id ?? turn?.turn ?? '')),
            ),
            ...current,
          ];
        });
        const beforeCursor = Number(result?.page?.beforeCursor);
        setChatHistoryPage((current) => ({
          beforeCursor:
            Number.isSafeInteger(beforeCursor) && beforeCursor > 0 ? beforeCursor : null,
          hasOlder: result?.page?.hasOlder === true,
          responseTruncated: result?.page?.responseTruncated === true,
          contentTruncated: current.contentTruncated || result?.page?.contentTruncated === true,
        }));
      }
    } catch (nextError: any) {
      if (targetIdRef.current === destinationId) setError(nextError?.message ?? String(nextError));
    } finally {
      setOlderHistoryBusy(false);
    }
  };

  const loadFullChatMessage = async (message: AssistantMessage) => {
    if (!selected || !message.id || fullMessageBusyId) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    const messageId = message.id;
    const native = nativeMessages !== null;
    const turnId = native ? '' : messageId.replace(/:(?:user|assistant)$/, '');
    const turnNumber = native
      ? null
      : Number(turns.find((turn) => String(turn?.id ?? turn?.turn ?? '') === turnId)?.turn);
    setFullMessageBusyId(messageId);
    setError(null);
    const controller = new AbortController();
    fullMessageAbortRef.current = controller;
    try {
      const result = await requestDroneControl(
        destinationId,
        'chat.read',
        {
          droneId,
          chatName: activeChat,
          ...(native
            ? { messageId }
            : {
                turnId,
                ...(Number.isSafeInteger(turnNumber) && Number(turnNumber) > 0
                  ? { turnNumber }
                  : {}),
              }),
        },
        controller.signal,
      );
      const content = result?.content;

      if (
        targetIdRef.current !== destinationId ||
        selectedRef.current?.id !== droneId ||
        chatNameRef.current !== activeChat
      )
        return;
      if (native) {
        const fullMessage = content?.message;
        if (!fullMessage || typeof fullMessage !== 'object')
          throw new Error('The remote message was invalid');
        setNativeMessages((current) =>
          (current ?? []).map((item) =>
            item.id === messageId ? { ...fullMessage, id: messageId, meshTruncated: false } : item,
          ),
        );
      } else {
        setTurns((current) =>
          current.map((turn) =>
            String(turn?.id ?? turn?.turn ?? '') === turnId
              ? { ...content, meshTruncated: false }
              : turn,
          ),
        );
      }
    } catch (nextError: any) {
      if (
        !controller.signal.aborted &&
        targetIdRef.current === destinationId &&
        selectedRef.current?.id === droneId &&
        chatNameRef.current === activeChat
      ) {
        setError(nextError?.message ?? String(nextError));
      }
    } finally {
      if (fullMessageAbortRef.current === controller) {
        fullMessageAbortRef.current = null;
        setFullMessageBusyId('');
      }
    }
  };

  readChatRef.current = readChat;

  React.useEffect(() => {
    if (!phoneTarget || !selectedRef.current) return;
    void readChatRef.current(selectedRef.current.id, chatNameRef.current).catch(() => undefined);
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
          void readChatRef.current(activeDrone.id, activeChat).catch(() => undefined);
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
      if (String(event.payload?.reason ?? '').trim() === 'registry_write') {
        invalidateChatReadCache({ targetId });
        chatChanged = true;
      }
      dronesChanged = true;
      schedule();
    });
    const unsubscribeChat = mesh.subscribe('drone-control', 'chat.changed', (event) => {
      if (event.sourceDeviceId !== targetId) return;
      const activeDrone = selectedRef.current;
      const activeChat = chatNameRef.current;
      const eventDroneId = String(event.payload?.droneId ?? '').trim();
      const eventChatName = String(event.payload?.chatName ?? '').trim();
      const reason = String(event.payload?.reason ?? '').trim();
      if (reason === 'registry_write') {
        invalidateChatReadCache({ targetId });
      } else if (eventDroneId && eventChatName) {
        invalidateChatReadCache({
          targetId,
          droneId: eventDroneId,
          chatName: eventChatName,
        });
      }
      const plan = mobileChatRefreshPlan({
        reason,
        eventDroneId,
        eventChatName,
        activeDroneId: activeDrone?.id ?? '',
        activeChatName: activeChat,
      });
      dronesChanged ||= plan.refreshDrones;
      chatChanged ||= plan.refreshChat;
      schedule();
    });
    return () => {
      unsubscribeDrones();
      unsubscribeChat();
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = null;
    };
  }, [invalidateChatReadCache, mesh.subscribe, targetId, targetSupportsDrones]);

  const addPromptImages = async () => {
    try {
      setError(null);
      const images = await pickChatImages(promptAttachments);
      if (images.length > 0) setPromptAttachments((current) => [...current, ...images]);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    }
  };

  const addPromptFiles = async () => {
    try {
      setError(null);
      const files = await pickChatFiles(promptAttachments);
      if (files.length > 0) setPromptAttachments((current) => [...current, ...files]);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    }
  };

  const addPromptAttachment = () => {
    if (phoneTarget || !nativeChatId) {
      void addPromptImages();
      return;
    }
    Alert.alert('Add attachment', 'Choose where to add it from.', [
      { text: 'Photo library', onPress: () => void addPromptImages() },
      { text: 'Files', onPress: () => void addPromptFiles() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const abortRemoteChatAttachments = async (
    input: { destinationId: string; droneId: string; chatName: string },
    attachmentIds: readonly string[],
  ): Promise<void> => {
    await Promise.all(
      attachmentIds.map((uploadId) =>
        requestDroneControl(input.destinationId, 'chat.prompt', {
          droneId: input.droneId,
          chatName: input.chatName,
          attachmentTransfer: { action: 'abort', uploadId },
        }).catch(() => undefined),
      ),
    );
  };

  const uploadRemoteChatAttachments = async (input: {
    destinationId: string;
    droneId: string;
    chatName: string;
    attachments: readonly MobileChatAttachment[];
  }): Promise<string[]> => {
    const attachmentIds: string[] = [];
    try {
      for (const item of input.attachments) {
        const attachment = await mesh.uploadChatAttachment({
          targetDeviceId: input.destinationId,
          droneId: input.droneId,
          chatName: input.chatName,
          name: item.name,
          mime: item.mime,
          bytes: item.bytes,
        });
        attachmentIds.push(attachment.attachmentId);
      }
      return attachmentIds;
    } catch (error) {
      await abortRemoteChatAttachments(input, attachmentIds);
      throw error;
    }
  };

  const sendChatPromptWithAttachments = async (input: {
    destinationId: string;
    droneId: string;
    chatName: string;
    prompt: string;
    attachments: readonly MobileChatAttachment[];
    deliveryMode?: 'queue' | 'asap';
    promptId?: string;
  }) => {
    const userTimeZone = clientTimeZone();
    if (input.destinationId === mesh.identity?.id) {
      return await requestDroneControl(input.destinationId, 'chat.prompt', {
        droneId: input.droneId,
        chatName: input.chatName,
        prompt: input.prompt,
        ...(input.deliveryMode ? { deliveryMode: input.deliveryMode } : {}),
        ...(input.promptId ? { promptId: input.promptId } : {}),
        ...(userTimeZone ? { userTimeZone } : {}),
        ...(input.attachments.length > 0
          ? { attachments: inlinePromptAttachments(input.attachments) }
          : {}),
      });
    }

    const attachmentIds = await uploadRemoteChatAttachments(input);
    try {
      return await requestDroneControl(input.destinationId, 'chat.prompt', {
        droneId: input.droneId,
        chatName: input.chatName,
        prompt: input.prompt,
        ...(input.deliveryMode ? { deliveryMode: input.deliveryMode } : {}),
        ...(input.promptId ? { promptId: input.promptId } : {}),
        ...(userTimeZone ? { userTimeZone } : {}),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
    } catch (error) {
      await abortRemoteChatAttachments(input, attachmentIds);
      throw error;
    }
  };

  const sendPrompt = async (
    promptOverride?: string,
    deliveryMode?: 'queue' | 'asap',
    requestedPromptId?: string,
    preserveComposer = false,
  ): Promise<boolean> => {
    const nextPrompt = String(promptOverride ?? prompt);
    const attachments = preserveComposer ? [] : promptAttachments;
    if (!selected || (!nextPrompt.trim() && attachments.length === 0)) return false;
    let accepted = false;
    const optimisticId =
      requestedPromptId || `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const promptSummary = nextPrompt.trim();
    if (!preserveComposer) {
      setPrompt('');
      setPromptAttachments([]);
      promptRef.current = '';
      promptAttachmentsRef.current = [];
    }
    setPendingPrompts((current) => {
      const optimistic = optimisticMobilePendingPrompt({
        id: optimisticId,
        prompt: promptSummary,
        attachmentCount: attachments.length,
        imageCount: attachments.filter((attachment) => attachment.mime.startsWith('image/')).length,
        state: running && deliveryMode !== 'asap' ? 'queued' : 'sending',
        deliveryMode,
      });
      // A continuous-voice retry reuses its delivery ID. Replace any failed
      // optimistic row from the prior attempt instead of rendering a duplicate.
      return [...current.filter((item) => String(item?.id ?? '') !== optimisticId), optimistic];
    });
    await run('prompt', async () => {
      const destinationId = targetId;
      const droneId = selected.id;
      const activeChat = chatName;
      let result: any;
      try {
        result = await sendChatPromptWithAttachments({
          destinationId,
          droneId,
          chatName: activeChat,
          prompt: nextPrompt,
          attachments,
          deliveryMode,
          promptId: requestedPromptId,
        });
      } catch (nextError: any) {
        setPendingPrompts((current) =>
          current.map((item) =>
            item?.id === optimisticId
              ? {
                  ...item,
                  state: 'failed',
                  error: nextError?.message ?? String(nextError),
                }
              : item,
          ),
        );
        if (
          !preserveComposer &&
          targetIdRef.current === destinationId &&
          selectedRef.current?.id === droneId &&
          chatNameRef.current === activeChat &&
          !promptRef.current &&
          promptAttachmentsRef.current.length === 0
        ) {
          promptRef.current = nextPrompt;
          promptAttachmentsRef.current = attachments;
          setPrompt(nextPrompt);
          setPromptAttachments(attachments);
        }
        throw nextError;
      }
      accepted = true;
      if (targetIdRef.current !== destinationId) return;
      const promptId = String(result?.promptId ?? '').trim();
      const queuedPromptId = String(result?.queuedPrompt?.id ?? '').trim();
      const acceptedPromptId = promptId || queuedPromptId;
      const acceptedPromptState = confirmedMobilePendingPromptState({
        pendingState: result?.pendingState,
        queuedPromptId,
        optimisticState: running && deliveryMode !== 'asap' ? 'queued' : 'sending',
      });
      if (acceptedPromptId)
        setPendingPrompts((current) =>
          confirmOptimisticMobilePendingPrompt(current, {
            optimisticId,
            confirmedId: acceptedPromptId,
            state: acceptedPromptState,
          }),
        );
      if (targetIdRef.current !== destinationId) return;
      await readChat(droneId, activeChat);
      await loadDrones(true);
    });
    return accepted;
  };

  const createDrone = async (
    payload: MobileDroneCreatePayload,
    preferences?: MobileDroneCreatePreferences,
    initialImages: readonly MobileChatImage[] = [],
    options: {
      selectCreatedDrone?: boolean;
      onCreated?: (created: { droneId: string; droneName: string }) => void;
    } = {},
  ): Promise<boolean> => {
    const selectCreatedDrone = options.selectCreatedDrone !== false;
    let created = false;
    await run(`create-${payload.runtime}`, async () => {
      const destinationId = targetId;
      const localTarget = destinationId === mesh.identity?.id;
      const attachmentUploadKey = `new-drone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const attachmentIds =
        initialImages.length > 0 && !localTarget
          ? await uploadRemoteChatAttachments({
              destinationId,
              droneId: attachmentUploadKey,
              chatName: 'default',
              attachments: initialImages,
            })
          : [];
      const createPayload = {
        ...payload,
        ...(initialImages.length > 0 && localTarget
          ? { seedAttachments: inlinePromptAttachments(initialImages) }
          : {}),
        ...(attachmentIds.length > 0
          ? {
              seedAttachmentIds: attachmentIds,
              seedAttachmentUploadKey: attachmentUploadKey,
            }
          : {}),
      };
      let result: any;
      try {
        result = await requestDroneControl(
          destinationId,
          `drone.create.${payload.runtime}`,
          createPayload,
        );
      } catch (error) {
        await abortRemoteChatAttachments(
          { destinationId, droneId: attachmentUploadKey, chatName: 'default' },
          attachmentIds,
        );
        throw error;
      }
      created = true;
      const createdDroneId = String(
        result?.id ?? result?.droneId ?? result?.drone?.id ?? '',
      ).trim();
      const createdDroneName =
        String(result?.name ?? result?.drone?.name ?? payload.name ?? createdDroneId).trim() ||
        createdDroneId;
      if (createdDroneId) {
        options.onCreated?.({ droneId: createdDroneId, droneName: createdDroneName });
      }
      const startsWithChat = Boolean(payload.seedAgent);
      const initialPromptSummary =
        String(payload.seedPrompt ?? '').trim() ||
        (initialImages.length > 0
          ? `Attached ${initialImages.length} image${initialImages.length === 1 ? '' : 's'}`
          : '');
      if (targetIdRef.current === destinationId && createdDroneId && startsWithChat) {
        const isDraft =
          payload.draft === true ||
          result?.draft === true ||
          result?.phase === 'draft' ||
          result?.drone?.draft === true ||
          result?.drone?.phase === 'draft';
        const optimisticDrone = normalizeMobileDrone({
          id: createdDroneId,
          name: createdDroneName,
          runtime: payload.runtime,
          group: payload.group,
          repoPath: payload.repoPath,
          chats: ['default'],
          ...(result?.drone && typeof result.drone === 'object' ? result.drone : {}),
          phase: isDraft ? 'draft' : (result?.drone?.phase ?? result?.phase ?? 'starting'),
          status: isDraft ? 'Draft' : (result?.drone?.status ?? 'Starting…'),
          busyChats: isDraft
            ? []
            : Array.isArray(result?.drone?.busyChats)
              ? result.drone.busyChats
              : ['default'],
          draft: isDraft,
          groupId: result?.drone?.groupId ?? result?.groupId,
          createdAt:
            result?.drone?.createdAt ??
            result?.createdAt ??
            payload.seedSubmittedAt ??
            new Date().toISOString(),
        });
        if (optimisticDrone) {
          setDrones((current) => [
            optimisticDrone,
            ...current.filter((drone) => drone.id !== optimisticDrone.id),
          ]);
          if (selectCreatedDrone) {
            const optimisticPromptId =
              String(result?.initialMessage?.promptId ?? '').trim() ||
              `mobile-create-${createdDroneId}-${Date.now()}`;
            selectedRef.current = optimisticDrone;
            chatNameRef.current = 'default';
            setSelected(optimisticDrone);
            setChats(['default']);
            setChatName('default');
            setChatModel(String(payload.seedModel ?? ''));
            setChatReasoning(String(payload.seedReasoning ?? ''));
            setChatModelProvider(
              String(payload.seedProvider ?? payload.seedAgent?.kind ?? 'drone'),
            );
            setChatAgentId(
              payload.seedAgent?.kind === 'builtin'
                ? mobileDroneAgentId(payload.seedAgent.id)
                : null,
            );
            setChatAgentPermissionMode(
              payload.seedAgentPermissionMode === 'read' ||
                payload.seedAgentPermissionMode === 'write'
                ? payload.seedAgentPermissionMode
                : 'execute',
            );
            setChatApprovalPolicy(payload.seedApprovalPolicy ?? 'ask');
            setTurns([]);
            setNativeMessages(null);
            setNativeChatId('');
            setNativeThread(null);
            setPendingApprovals([]);
            setPendingPrompts(
              initialPromptSummary
                ? [
                    optimisticMobilePendingPrompt({
                      id: optimisticPromptId,
                      prompt: initialPromptSummary,
                      imageCount: initialImages.length,
                      at: payload.seedSubmittedAt,
                    }),
                  ]
                : [],
            );
            setPrompt('');
            setPromptAttachments([]);
            setComposerFocusKey(`${createdDroneId}:default:${Date.now()}`);
          }
        }
      }
      await saveMobileDroneCreatePreferences(
        destinationId,
        String(payload.repoPath ?? '').trim(),
        preferences ?? mobileDroneCreatePreferencesFromPayload(payload),
      ).catch(() => undefined);
      if (targetIdRef.current !== destinationId) return;
      await loadDrones();
    });
    if (created && payload.draft !== true) newDroneDraftContentRef.current = null;
    return created;
  };

  const rememberNewDroneDraftContent = React.useCallback((content: MobileNewDroneDraftContent) => {
    newDroneDraftContentRef.current = content.hasContent ? content : null;
  }, []);

  const saveNewDroneDraftBeforeNavigation = React.useCallback(async (): Promise<void> => {
    if (newDroneDraftSavePromiseRef.current) {
      await newDroneDraftSavePromiseRef.current;
      return;
    }
    const content = newDroneDraftContentRef.current;
    if (!content?.hasContent) return;
    newDroneDraftContentRef.current = null;
    const savePromise = (async () => {
      const saved = await createDrone(
        { ...content.payload, draft: true },
        content.preferences,
        content.initialImages,
        { selectCreatedDrone: false },
      );
      if (saved) {
        setNewDroneScreenVersion((value) => value + 1);
      } else {
        newDroneDraftContentRef.current = content;
      }
    })();
    newDroneDraftSavePromiseRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      newDroneDraftSavePromiseRef.current = null;
    }
  }, [createDrone]);

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
      const result = await requestDroneControl(destinationId, 'drones.list', {
        createModelAgent: agent,
        createModelRuntime: runtime,
        refreshCreateModels: refresh,
      });
      if (targetIdRef.current !== destinationId) return [];
      const catalog = result?.createModelCatalog;
      const models = normalizeMobileDroneCreateModelCatalog(catalog, agent);
      if (models.length === 0 && catalog?.error) {
        throw new Error(String(catalog.error));
      }
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
        if (
          targetIdRef.current !== destinationId ||
          selectedRef.current?.id !== droneId ||
          chatNameRef.current !== activeChat
        )
          return;
        setPendingPrompts((current) =>
          current.filter((item) => String(item?.id ?? '') !== promptId),
        );
        await readChat(droneId, activeChat);
        await loadDrones(true);
      })
      .catch((nextError: any) => {
        if (
          targetIdRef.current === destinationId &&
          selectedRef.current?.id === droneId &&
          chatNameRef.current === activeChat
        )
          setError(nextError?.message ?? String(nextError));
      })
      .finally(() => setCancellingPromptId((current) => (current === promptId ? '' : current)));
  };

  const resolvePendingPromptInterruption = (
    promptId: string,
    resolution: import('@drone/assistant-chat').PromptQueueInterruptionResolution,
  ) => {
    if (!selected || !promptId || resolvingInterruptionId) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    setResolvingInterruptionId(promptId);
    setError(null);
    void requestDroneControl(destinationId, 'chat.interruption.resolve', {
      droneId,
      chatName: activeChat,
      promptId,
      resolution,
    })
      .then(async () => {
        if (
          targetIdRef.current !== destinationId ||
          selectedRef.current?.id !== droneId ||
          chatNameRef.current !== activeChat
        )
          return;
        await readChat(droneId, activeChat);
        await loadDrones(true);
      })
      .catch((nextError: any) => {
        if (
          targetIdRef.current === destinationId &&
          selectedRef.current?.id === droneId &&
          chatNameRef.current === activeChat
        )
          setError(nextError?.message ?? String(nextError));
      })
      .finally(() =>
        setResolvingInterruptionId((current) => (current === promptId ? '' : current)),
      );
  };

  const createQueuedChatNow = (actionId: string) => {
    if (!selected || !actionId || creatingQueuedChatId) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const sourceChatName = chatName;
    setCreatingQueuedChatId(actionId);
    setError(null);
    void requestDroneControl(destinationId, 'chat.create', {
      droneId,
      queuedActionId: actionId,
      sourceChatName,
    })
      .then(async (result: any) => {
        if (
          targetIdRef.current !== destinationId ||
          selectedRef.current?.id !== droneId ||
          chatNameRef.current !== sourceChatName
        )
          return;
        const targetChatName = String(result?.targetChatName ?? '').trim();
        if (!targetChatName) {
          await readChat(droneId, sourceChatName);
          return;
        }
        const currentDrone = selectedRef.current!;
        invalidateChatReadCache({
          targetId: destinationId,
          droneId,
          chatName: targetChatName,
        });
        const nextChats = [...new Set([...currentDrone.chats, targetChatName])];
        const updatedDrone = { ...currentDrone, chats: nextChats };
        setDrones((current) => current.map((item) => (item.id === droneId ? updatedDrone : item)));
        transitionToDroneChat(updatedDrone, targetChatName);
        await readChat(droneId, targetChatName);
        await loadDrones(true);
      })
      .catch((nextError: any) => setError(nextError?.message ?? String(nextError)))
      .finally(() => setCreatingQueuedChatId((current) => (current === actionId ? '' : current)));
  };

  const openNewDroneScreen = async (
    overrides: MobileDroneCreateDefaults | null = null,
  ): Promise<void> => {
    const destinationId = targetId;
    const requestVersion = ++createDefaultsRequestVersion.current;
    const contextualRepoPath = overrides?.repoPath ?? selected?.repoPath ?? '';
    const optionsRequestVersion = ++createOptionsRequestVersion.current;
    setCreateOptionsLoading(true);
    void requestDroneControl(destinationId, 'drones.list', { includeCreateOptions: true })
      .then((result) => {
        if (
          targetIdRef.current !== destinationId ||
          createDefaultsRequestVersion.current !== requestVersion ||
          createOptionsRequestVersion.current !== optionsRequestVersion
        )
          return;
        const options = normalizeMobileDroneListPayload(result);
        setDeleteMode(options.deleteMode);
        setCreateRepos(
          options.createRepos.map(
            (repo) => createRepoBranchesCache.current.get(`${destinationId}:${repo.path}`) ?? repo,
          ),
        );
      })
      .catch((nextError: any) => {
        if (
          targetIdRef.current === destinationId &&
          createOptionsRequestVersion.current === optionsRequestVersion
        )
          setError(`Creation options are unavailable: ${nextError?.message ?? String(nextError)}`);
      })
      .finally(() => {
        if (
          targetIdRef.current === destinationId &&
          createOptionsRequestVersion.current === optionsRequestVersion
        )
          setCreateOptionsLoading(false);
      });
    const remembered = await loadMobileDroneCreatePreferences(destinationId, contextualRepoPath);
    if (
      targetIdRef.current !== destinationId ||
      createDefaultsRequestVersion.current !== requestVersion
    ) {
      return;
    }
    const defaults = resolveMobileDroneCreateDefaults({
      remembered,
      repoPath: contextualRepoPath,
      overrides,
    });
    setNewDroneDefaults(defaults);
    setNewDroneScreenVersion((value) => value + 1);
    chatReadVersion.current += 1;
    openDroneVersion.current += 1;
    transitionToDroneChat(null);
    setCancellingPromptId('');
    setPrompt('');
    setModelOpen(false);
    setComposerFocusKey('');
  };

  const openNewDroneFromCurrent = () => {
    if (!selected) return;
    void openNewDroneScreen({
      mode: 'with-chat',
      runtime: selected.runtime === 'host' ? 'host' : 'container',
      group: selected.group ?? '',
      repoPath: selected.repoPath,
      ...(chatAgentId ? { agent: chatAgentId } : {}),
      agentPermissionMode: chatAgentPermissionMode,
      approvalPolicy: chatApprovalPolicy,
      ...(chatModelProvider ? { provider: chatModelProvider } : {}),
      ...(chatModel ? { model: chatModel } : {}),
      ...(chatReasoning ? { reasoning: chatReasoning } : {}),
    });
  };

  const commitDrawerChatMutation = (
    droneId: string,
    nextChats: readonly string[],
    rename?: { from: string; to: string },
  ) => {
    setDrones((current) =>
      current.map((drone) =>
        drone.id === droneId ? applyChatMutationToDrone(drone, nextChats, rename) : drone,
      ),
    );
    const currentSelected = selectedRef.current;
    if (currentSelected?.id !== droneId) return;
    const nextSelected = applyChatMutationToDrone(currentSelected, nextChats, rename);
    selectedRef.current = nextSelected;
    setSelected(nextSelected);
    setChats([...nextChats]);
  };

  const createDrawerChat = async (droneId: string, nextChatName: string, copyFrom: string) => {
    const destinationId = targetId;
    const result = await requestDroneControl(destinationId, 'chat.create', {
      droneId,
      name: nextChatName,
      ...(copyFrom ? { copyFrom } : {}),
    });
    if (targetIdRef.current !== destinationId) return false;
    invalidateChatReadCache({
      targetId: destinationId,
      droneId,
      chatName: nextChatName,
    });
    const currentDrone = droneListSnapshotRef.current.drones.find((drone) => drone.id === droneId);
    const fallbackChats = currentDrone
      ? [...new Set([...currentDrone.chats, nextChatName])]
      : [nextChatName];
    commitDrawerChatMutation(droneId, normalizedChatMutationList(result?.chats, fallbackChats));
    await loadDrones(true);
    return targetIdRef.current === destinationId;
  };

  const renameDrawerChat = async (droneId: string, currentChatName: string, newName: string) => {
    const destinationId = targetId;
    const previousMuteId = mobileMutedChatId(droneId, currentChatName);
    const wasMuted = droneSidebarOrderRef.current.mutedChatIds.includes(previousMuteId);
    const result = await requestDroneControl(destinationId, 'chat.rename', {
      droneId,
      chatName: currentChatName,
      newName,
    });
    if (targetIdRef.current !== destinationId) return false;
    invalidateChatReadCache({
      targetId: destinationId,
      droneId,
      chatName: currentChatName,
    });
    invalidateChatReadCache({ targetId: destinationId, droneId, chatName: newName });
    if (selectedRef.current?.id === droneId && chatNameRef.current === currentChatName) {
      chatNameRef.current = newName;
      setChatName(newName);
    }
    const currentDrone = droneListSnapshotRef.current.drones.find((drone) => drone.id === droneId);
    const fallbackChats = (currentDrone?.chats ?? []).map((chatName) =>
      chatName === currentChatName ? newName : chatName,
    );
    commitDrawerChatMutation(droneId, normalizedChatMutationList(result?.chats, fallbackChats), {
      from: currentChatName,
      to: newName,
    });
    await loadDrones(true);
    if (wasMuted && targetIdRef.current === destinationId) {
      const nextMuteId = mobileMutedChatId(droneId, newName);
      const migrated = await reorderSidebar({
        kind: 'set-muted',
        targetKind: 'chat',
        targetId: nextMuteId,
        muted: true,
      });
      if (migrated) {
        await reorderSidebar({
          kind: 'set-muted',
          targetKind: 'chat',
          targetId: previousMuteId,
          muted: false,
        });
      }
    }
    return targetIdRef.current === destinationId;
  };

  const deleteDrawerChat = async (droneId: string, chatToDelete: string) => {
    const destinationId = targetId;
    const deletedMuteId = mobileMutedChatId(droneId, chatToDelete);
    const wasMuted = droneSidebarOrderRef.current.mutedChatIds.includes(deletedMuteId);
    const result = await requestDroneControl(destinationId, 'chat.delete', {
      droneId,
      chatName: chatToDelete,
    });
    if (targetIdRef.current !== destinationId) return false;
    invalidateChatReadCache({
      targetId: destinationId,
      droneId,
      chatName: chatToDelete,
    });
    const currentDrone = droneListSnapshotRef.current.drones.find((drone) => drone.id === droneId);
    const fallbackChats = (currentDrone?.chats ?? []).filter(
      (chatName) => chatName !== chatToDelete,
    );
    const nextChats = normalizedChatMutationList(result?.chats, fallbackChats);
    commitDrawerChatMutation(droneId, nextChats);
    await loadDrones(true);
    if (wasMuted && targetIdRef.current === destinationId) {
      await reorderSidebar({
        kind: 'set-muted',
        targetKind: 'chat',
        targetId: deletedMuteId,
        muted: false,
      });
    }
    if (selectedRef.current?.id === droneId && chatNameRef.current === chatToDelete) {
      const fallbackChat = nextChats[0] ?? '';
      transitionToChat(fallbackChat);
      if (fallbackChat) await readChat(droneId, fallbackChat);
    }
    return targetIdRef.current === destinationId;
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
      if (
        targetIdRef.current !== destinationId ||
        selectedRef.current?.id !== drone.id ||
        chatNameRef.current !== sourceChat
      )
        return;
      const createdChat = String(result?.chatName ?? nextChat).trim() || nextChat;
      invalidateChatReadCache({
        targetId: destinationId,
        droneId: drone.id,
        chatName: createdChat,
      });
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
      transitionToDroneChat(updatedDrone, createdChat);
      setPrompt('');
      setPromptAttachments([]);
      setComposerFocusKey(`${drone.id}:${createdChat}:${Date.now()}`);
      await readChat(drone.id, createdChat);
      await loadDrones(true);
    });

  const resolveDictationTarget = (destination: MobileDictationDestination) =>
    resolveMobileDictationTarget({
      destination,
      deviceId: targetId,
      targetReachable,
      selectedDrone: selected,
      chatName,
      agent: chatAgentId,
      agentPermissionMode: chatAgentPermissionMode,
      approvalPolicy: chatApprovalPolicy,
      provider: chatModelProvider,
      model: chatModel,
      reasoning: chatReasoning,
    });

  const sendDictationToChat = async (
    target: Extract<MobileDictationTarget, { droneId: string }>,
    text: string,
  ): Promise<MobileDictationSendResult> => {
    let destinationChat = target.chatName;
    let updatedDrone: MobileDroneSummary | null = null;
    if (target.destination === 'new-chat' || target.destination === 'clone-chat') {
      const sourceDrone = droneListSnapshotRef.current.drones.find(
        (drone) => drone.id === target.droneId,
      );
      const suggestedChat = suggestNextMobileDroneChatName(sourceDrone?.chats ?? target.chatNames);
      const result = await requestDroneControl(target.deviceId, 'chat.create', {
        droneId: target.droneId,
        name: suggestedChat,
        copyFrom: target.chatName,
        mode: target.destination === 'clone-chat' ? 'fork' : 'copy-config',
      });
      destinationChat = String(result?.chatName ?? suggestedChat).trim() || suggestedChat;
      if (sourceDrone) {
        const nextChats = normalizedChatMutationList(result?.chats, [
          ...new Set([...sourceDrone.chats, destinationChat]),
        ]);
        updatedDrone = { ...sourceDrone, chats: nextChats };
        if (targetIdRef.current === target.deviceId) {
          const optimisticDrone = updatedDrone;
          setDrones((current) =>
            current.map((drone) => (drone.id === optimisticDrone.id ? optimisticDrone : drone)),
          );
        }
      }
    }

    const userTimeZone = clientTimeZone();
    await requestDroneControl(target.deviceId, 'chat.prompt', {
      droneId: target.droneId,
      chatName: destinationChat,
      prompt: text,
      deliveryMode: 'queue',
      submittedAt: new Date().toISOString(),
      ...(userTimeZone ? { userTimeZone } : {}),
    });

    if (targetIdRef.current === target.deviceId) {
      const destinationDrone =
        updatedDrone ??
        droneListSnapshotRef.current.drones.find((drone) => drone.id === target.droneId) ??
        null;
      if (destinationDrone) {
        transitionToDroneChat(destinationDrone, destinationChat);
        await readChat(destinationDrone.id, destinationChat);
      }
      await loadDrones(true);
    }
    return { ok: true };
  };

  const sendDictationToDrone = async (
    target: Extract<MobileDictationTarget, { repoPath: string }>,
    text: string,
  ): Promise<MobileDictationSendResult> => {
    if (targetIdRef.current !== target.deviceId) {
      return {
        ok: false,
        error: 'Return to the original Drone Hub device before creating the new drone.',
      };
    }
    const remembered = await loadMobileDroneCreatePreferences(target.deviceId, target.repoPath);
    const runtime = target.runtime;
    const useRemoteBranch =
      runtime === 'container' &&
      remembered?.repoBranchSource === 'remote' &&
      Boolean(remembered.repoCreateRemoteBranch);
    const payload: MobileDroneCreatePayload = {
      runtime,
      ...(target.group ? { group: target.group } : {}),
      ...(runtime === 'container' ? { persistVolume: remembered?.persistVolume ?? false } : {}),
      ...(target.repoPath ? { repoPath: target.repoPath } : {}),
      repoBranchSource: useRemoteBranch ? 'remote' : 'host',
      ...(useRemoteBranch ? { remoteBranch: remembered!.repoCreateRemoteBranch } : {}),
      seedAgent:
        target.agent === 'native' ? { kind: 'native' } : { kind: 'builtin', id: target.agent },
      ...(target.agent === 'native' && target.provider ? { seedProvider: target.provider } : {}),
      ...(target.model ? { seedModel: target.model } : {}),
      ...(target.reasoning ? { seedReasoning: target.reasoning } : {}),
      ...(target.agentPermissionMode !== 'execute'
        ? { seedAgentPermissionMode: target.agentPermissionMode }
        : {}),
      ...(target.approvalPolicy !== 'ask' ? { seedApprovalPolicy: target.approvalPolicy } : {}),
      seedPrompt: text,
      seedSubmittedAt: new Date().toISOString(),
      autoRename: true,
    };
    const preferences: MobileDroneCreatePreferences = {
      mode: 'with-chat',
      runtime,
      persistVolume: runtime === 'container' && (remembered?.persistVolume ?? false),
      agent: target.agent,
      agentPermissionMode: target.agentPermissionMode,
      approvalPolicy: target.approvalPolicy,
      model: target.model,
      provider: target.provider,
      reasoning: target.reasoning,
      repoBranchSource: useRemoteBranch ? 'remote' : 'host',
      repoCreateRemoteBranch: useRemoteBranch ? remembered!.repoCreateRemoteBranch : '',
    };
    const created = await createDrone(payload, preferences);
    return created ? { ok: true } : { ok: false, error: 'The new drone could not be created.' };
  };

  const sendMobileDictation = async (
    target: MobileDictationTarget,
    text: string,
  ): Promise<MobileDictationSendResult> => {
    try {
      return 'droneId' in target
        ? await sendDictationToChat(target, text)
        : await sendDictationToDrone(target, text);
    } catch (sendError: unknown) {
      return {
        ok: false,
        error: sendError instanceof Error ? sendError.message : String(sendError),
      };
    }
  };

  const dictation = useMobileDictation({
    resolveTarget: resolveDictationTarget,
    send: sendMobileDictation,
  });

  const transcriptMessages = React.useMemo(
    () => nativeMessages ?? mobileDroneTurnsToAssistantMessages(turns, pendingPrompts),
    [nativeMessages, pendingPrompts, turns],
  );
  const visiblePendingPrompts = React.useMemo(
    () => mobileDronePendingPrompts(pendingPrompts, turns, transcriptMessages),
    [pendingPrompts, transcriptMessages, turns],
  );
  const codexPendingApprovals = React.useMemo(
    () =>
      pendingPrompts.flatMap((pending: any) =>
        Array.isArray(pending?.approvals)
          ? pending.approvals.filter(
              (approval: any): approval is CodexPendingApproval =>
                approval?.status === 'pending' &&
                !resolvedCodexApprovalIds.has(String(approval?.id ?? '')),
            )
          : [],
      ),
    [pendingPrompts, resolvedCodexApprovalIds],
  );
  const linkedPullRequests = useDroneLinkedPullRequests({
    targetDeviceId: targetId,
    droneId: selected?.id ?? '',
    messages: transcriptMessages,
  });
  const subscribeFileChanges = React.useCallback(
    (listener: (payload: Record<string, any>) => void) =>
      mesh.subscribe('drone-control', 'file.changed', (event) => {
        if (event.sourceDeviceId === targetId) listener(event.payload ?? {});
      }),
    [mesh.subscribe, targetId],
  );
  const filePreview = useFilePreview({
    targetId,
    selectedDrone: selected,
    chatName,
    phoneTarget,
    requestDroneControl,
    subscribeFileChanges,
  });
  const [filesPageOpen, setFilesPageOpen] = React.useState(false);
  const prepareFilesPage = React.useCallback(() => {
    if (!filePreview.visible) filePreview.openExplorer();
  }, [filePreview.visible, filePreview.openExplorer]);
  const openFilesPage = React.useCallback(() => {
    Keyboard.dismiss();
    prepareFilesPage();
    setFilesPageOpen(true);
  }, [prepareFilesPage]);
  const openFileReference = React.useCallback(
    (reference: Parameters<typeof filePreview.open>[0]) => {
      filePreview.open(reference);
      setFilesPageOpen(true);
    },
    [filePreview.open],
  );
  React.useEffect(() => {
    setFilesPageOpen(false);
  }, [targetId, selected?.id, chatName, workspaceVisible]);
  const companionHighlightedDroneIds = useMobileCompanionWorkspaceTarget({
    targetDeviceId: targetId,
    targetName: activeTarget?.name ?? 'Drone Hub',
    targetReachable,
    phoneTarget,
    drones,
    selectedDrone: selected,
    composerAvailable: Boolean(
      workspaceVisible &&
      selected &&
      chats.length > 0 &&
      !(accessOpen && phoneTarget && nativeChatId),
    ),
    workspaceVisible,
    chatName,
    prompt,
    setPrompt,
    openFile: {
      visible: workspaceVisible && filesPageOpen && filePreview.visible,
      path: filePreview.displayPath,
      kind: filePreview.preview?.kind ?? 'loading',
    },
    createDrone: async (payload, preferences) => {
      let created: { droneId: string; droneName: string } | null = null;
      const ok = await createDrone(payload, preferences, [], {
        selectCreatedDrone: false,
        onCreated: (result) => {
          created = result;
        },
      });
      return ok ? created : null;
    },
    requestDroneControl: async (operation, payload) =>
      await requestDroneControl(targetId, operation, payload),
    openChat: async (drone, requestedChat) => {
      await saveNewDroneDraftBeforeNavigation();
      navigationItems.find((item) => item.id === 'drones')?.onPress();
      onDrawerOpenChange(false);
      await activateDrone(drone, requestedChat);
    },
  });
  const loadRunFileDiff = React.useCallback(
    async ({ artifactId, path }: { artifactId: string; path: string }) => {
      if (!selected || phoneTarget) {
        throw new Error('Historical diffs are unavailable for this chat.');
      }
      const response: any = await requestDroneControl(targetId, 'chat.read', {
        droneId: selected.id,
        chatName,
        diffArtifactId: artifactId,
        diffPath: path,
      });
      return {
        patch: String(response?.diff?.patch ?? ''),
        truncated: response?.diff?.truncated === true,
      };
    },
    [chatName, phoneTarget, requestDroneControl, selected, targetId],
  );
  const loadRunFiles = React.useCallback(
    async ({
      artifactId,
      offset,
      limit,
    }: {
      artifactId: string;
      offset: number;
      limit: number;
    }) => {
      if (!selected || phoneTarget) {
        throw new Error('Historical file changes are unavailable for this chat.');
      }
      const response: any = await requestDroneControl(targetId, 'chat.read', {
        droneId: selected.id,
        chatName,
        diffArtifactId: artifactId,
        diffList: true,
        diffListOffset: offset,
        diffListLimit: limit,
      });
      return {
        entries: Array.isArray(response?.files?.entries) ? response.files.entries : [],
        nextOffset: Number.isSafeInteger(response?.files?.nextOffset)
          ? Number(response.files.nextOffset)
          : null,
        metadataTruncated: response?.files?.metadataTruncated === true,
      };
    },
    [chatName, phoneTarget, requestDroneControl, selected, targetId],
  );
  const activeChatReadKey = selected ? `${targetId}\u0000${selected.id}\u0000${chatName}` : '';
  const chatLoading =
    busy === 'chats' ||
    busy === 'chat' ||
    busy === 'create-chat' ||
    (chatReadCoordinatorRef.current!.isActive(activeChatReadKey) &&
      nativeMessages === null &&
      turns.length === 0);
  const latestMessageScroll = useLatestMessageScroll(
    selected ? `${selected.id}:${chatName}` : '',
    chatLoading,
    {
      onReachTop: chatHistoryPage.hasOlder && !olderHistoryBusy ? loadOlderChatHistory : undefined,
    },
  );
  const latestModel = React.useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const model = String(turns[index]?.model ?? '').trim();
      if (model) return model;
    }
    return undefined;
  }, [turns]);
  const hasActivePendingPrompt = React.useMemo(
    () => hasActiveMobileDronePendingPrompt(pendingPrompts, turns),
    [pendingPrompts, turns],
  );
  const running = mobileChatRespondingStatus({
    localActivity:
      busy === 'prompt' ||
      busy === 'stop' ||
      hasActivePendingPrompt ||
      Boolean(latestActiveMobileAgentPrompt(visiblePendingPrompts)),
    nativeRuntimeActive:
      nativeThread?.status === 'running' ||
      nativeThread?.status === 'waiting_for_approval' ||
      nativeThread?.status === 'waiting_for_input' ||
      nativeThread?.status === 'waiting_for_chats_idle',
    nativeTranscriptLoaded: nativeMessages !== null,
    serverChatBusy: Boolean(selected?.busyChats.some((chat) => chat === chatName)),
  });
  const awaitingApproval =
    pendingApprovals.length > 0 ||
    codexPendingApprovals.length > 0 ||
    nativeThread?.status === 'waiting_for_approval';
  const approvalStartedAt = [...pendingApprovals, ...codexPendingApprovals]
    .map((approval) => Date.parse(String(approval.createdAt ?? '')))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right)[0];
  const dronesLoading =
    targetReachable && targetSupportsDrones && (!dronesLoaded || busy === 'drones');
  const displayedModel = chatModel || latestModel || 'Model';
  const visibleChats = chats;
  const selectedChatOptimisticallyBusy = running;
  const drawerDrones = React.useMemo(
    () =>
      drones.map((drone) => {
        if (drone.id !== selected?.id) return drone;
        return withMobileApprovalRequired(
          withOptimisticMobileBusyChat(drone, chatName, selectedChatOptimisticallyBusy),
          pendingApprovals.length > 0 ||
            codexPendingApprovals.length > 0 ||
            nativeThread?.status === 'waiting_for_approval',
        );
      }),
    [
      chatName,
      drones,
      nativeThread?.status,
      codexPendingApprovals.length,
      pendingApprovals.length,
      selected?.id,
      selectedChatOptimisticallyBusy,
    ],
  );
  const openDroneRename = React.useCallback((drone: MobileDroneSummary) => {
    setRenameCandidate(drone);
    setRenameName(drone.name);
    setRenameError(null);
  }, []);
  const cloneDrone = async (source: MobileDroneSummary): Promise<void> => {
    if (source.runtime.trim().toLowerCase() === 'host') {
      setError('Host runtime drones cannot be cloned.');
      return;
    }
    const destinationId = targetId;
    await run(`clone-${source.id}`, async () => {
      const name = suggestMobileDroneCloneName(source.name, drones);
      const result = await requestDroneControl(destinationId, 'drone.create.container', {
        name,
        group: source.group,
        repoPath: source.repoAttached === false ? '' : source.repoPath,
        persistVolume: source.persistVolume !== false,
        cloneFrom: source.id,
        cloneChats: true,
      });
      if (targetIdRef.current !== destinationId) return;
      const clonedDroneId = String(result?.id ?? result?.droneId ?? result?.drone?.id ?? '').trim();
      if (!clonedDroneId) throw new Error('The Drone Hub did not return the cloned drone id.');
      const clonedDrone = normalizeMobileDrone({
        group: source.group,
        groupId: source.groupId,
        repoPath: source.repoAttached === false ? '' : source.repoPath,
        repoAttached: source.repoAttached !== false && Boolean(source.repoPath),
        persistVolume: source.persistVolume !== false,
        fleetParentId: null,
        chats: source.chats,
        busyChats: [],
        unreadChats: [],
        chatReadStates: {},
        ...(result?.drone && typeof result.drone === 'object' ? result.drone : {}),
        id: clonedDroneId,
        name: result?.name ?? result?.drone?.name ?? name,
        runtime: 'container',
        phase: result?.phase ?? result?.drone?.phase ?? 'starting',
        status: result?.status ?? result?.drone?.status ?? 'Starting…',
        createdAt: result?.createdAt ?? result?.drone?.createdAt ?? new Date().toISOString(),
        draft: false,
      });
      if (!clonedDrone) throw new Error('The Drone Hub returned an invalid cloned drone.');
      setDrones((current) => [
        clonedDrone,
        ...current.filter((drone) => drone.id !== clonedDrone.id),
      ]);
      const nextChat = clonedDrone.chats.includes('default') ? 'default' : clonedDrone.chats[0]!;
      await activateDrone(clonedDrone, nextChat, {
        deferChatLoad: isMobileDroneStarting(clonedDrone),
      });
      await loadDrones(true);
    });
  };
  const setDronePinned = React.useCallback(
    (droneId: string, pinned: boolean): Promise<void> => {
      const destinationId = targetId;
      const current = droneListSnapshotRef.current;
      if (current.targetId !== destinationId) return Promise.resolve();
      const generation = sidebarWriteGenerationRef.current + 1;
      sidebarWriteGenerationRef.current = generation;
      const commandId = `sidebar-pin:${destinationId}:${Date.now()}:${generation}`;
      const intent = { kind: 'set-pinned' as const, droneIds: [droneId], pinned };
      if (sidebarJournalRef.current.pending.length === 0) {
        sidebarJournalRef.current = replaceSidebarConfirmedState(sidebarJournalRef.current, {
          drones: current.drones,
          sidebar: current.sidebar,
        });
      }
      sidebarJournalRef.current = appendSidebarOptimisticCommand(sidebarJournalRef.current, {
        id: commandId,
        command: intent,
      });
      const visible = sidebarOptimisticJournalValue(
        sidebarJournalRef.current,
        applyMobileSidebarJournalCommand,
      );
      droneSidebarOrderRef.current = visible.sidebar;
      commitDroneListSnapshot({ ...current, ...visible });
      setPinningDroneIds((currentIds) => new Set(currentIds).add(droneId));

      const write = async () => {
        try {
          if (targetIdRef.current !== destinationId) return;
          const result = await requestDroneControl(destinationId, 'sidebar.move', {
            mutationId: commandId,
            intent,
          });
          if (result?.ok !== true) {
            throw new Error(String(result?.error ?? 'Sidebar move failed'));
          }
          if (targetIdRef.current === destinationId) {
            const savedPreferenceVersion =
              Number.isSafeInteger(result?.version) && Number(result.version) >= 0
                ? Number(result.version)
                : undefined;
            if (savedPreferenceVersion !== undefined) {
              sidebarPreferenceVersionRef.current = savedPreferenceVersion;
            }
          }
        } catch (nextError: any) {
          if (targetIdRef.current === destinationId) {
            setError(nextError?.message ?? String(nextError));
          }
        } finally {
          sidebarJournalRef.current = settleSidebarOptimisticCommand(
            sidebarJournalRef.current,
            commandId,
          );
          setPinningDroneIds((currentIds) => {
            const next = new Set(currentIds);
            next.delete(droneId);
            return next;
          });
        }
        if (targetIdRef.current === destinationId) await loadDronesRef.current(true);
      };
      return sidebarWriteQueueRef.current!.enqueue(write);
    },
    [commitDroneListSnapshot, requestDroneControl, targetId],
  );
  React.useEffect(() => {
    if (!targetReachable && targetSupportsDrones) {
      onHeaderChange({
        title: selected?.name ?? activeTarget?.name ?? 'Device offline',
        subtitle: 'Offline · reconnecting automatically',
      });
      return;
    }
    if (dronesLoading && !selected) {
      onHeaderChange({
        title: activeTarget?.name ?? 'Drone Hub',
        subtitle: 'Loading drones…',
      });
      return;
    }
    onHeaderChange(
      selected
        ? {
            title: selected.name,
            backNavigation: true,
            onNewDrone: openNewDroneFromCurrent,
            onNewChat: () => void createNewChat(),
            onOpenFiles: openFilesPage,
            ...(targetCanCloneDrone
              ? {
                  onClone: () => void cloneDrone(selected),
                  cloneDisabled:
                    busy.startsWith('clone-') ||
                    selected.runtime.trim().toLowerCase() === 'host' ||
                    selected.draft === true ||
                    isMobileDroneStarting(selected),
                }
              : {}),
            onRename: () => openDroneRename(selected),
            pinned: droneSidebarOrder.pinnedDroneIds.includes(selected.id),
            pinDisabled: pinningDroneIds.has(selected.id),
            onTogglePinned: () =>
              void setDronePinned(
                selected.id,
                !droneSidebarOrder.pinnedDroneIds.includes(selected.id),
              ),
            onDelete: () => setDeleteCandidate(selected),
            ...(nativeMessages !== null
              ? {
                  accessOpen,
                  accessDisabled: running,
                  ...(phoneTarget
                    ? {
                        onToggleAccess: () => {
                          if (accessOpen && accessDirty) setConfirmAccessDiscard(true);
                          else setAccessOpen((value) => !value);
                        },
                      }
                    : {}),
                }
              : {}),
            ...(nativeMessages !== null || chatAgentId === 'codex' || chatAgentId === 'blip'
              ? {
                  agentAccessOptions: (
                    [
                      ['read', 'Read'],
                      ['write', 'Write'],
                      ['execute', 'Execute'],
                    ] as Array<[MobileDroneAgentPermissionMode, string]>
                  ).map(([mode, label]) => ({
                    id: mode,
                    label,
                    selected: chatAgentPermissionMode === mode,
                    disabled: running,
                    onSelect: () => {
                      void requestDroneControl(targetId, 'chat.update', {
                        droneId: selected.id,
                        chatName,
                        nativeChatId,
                        agentPermissionMode: mode,
                      })
                        .then(() => readChat(selected.id, chatName))
                        .catch((nextError: any) =>
                          setError(nextError?.message ?? String(nextError)),
                        );
                    },
                  })),
                }
              : {}),
            ...(nativeMessages !== null || chatAgentId === 'codex'
              ? {
                  approvalPolicyOptions: (
                    [
                      {
                        policy: 'ask',
                        label: 'Ask',
                      },
                      ...(chatAgentId === 'codex'
                        ? [
                            {
                              policy: 'auto' as const,
                              label: 'Auto',
                            },
                          ]
                        : []),
                      { policy: 'none', label: 'Never ask' },
                    ] as Array<{
                      policy: MobileDroneApprovalPolicy;
                      label: string;
                      disabled?: boolean;
                    }>
                  ).map(({ policy, label, disabled }) => ({
                    id: policy,
                    label,
                    selected: chatApprovalPolicy === policy,
                    disabled: running || disabled,
                    onSelect: () => {
                      void requestDroneControl(targetId, 'chat.update', {
                        droneId: selected.id,
                        chatName,
                        nativeChatId,
                        approvalPolicy: policy,
                      })
                        .then(() => readChat(selected.id, chatName))
                        .catch((nextError: any) =>
                          setError(nextError?.message ?? String(nextError)),
                        );
                    },
                  })),
                }
              : {}),
          }
        : targetSupportsDrones
          ? {
              title: 'New drone',
              subtitle: `Create on ${activeTarget?.name ?? 'this device'}`,
            }
          : null,
    );
  }, [
    activeTarget?.name,
    onHeaderChange,
    openDroneRename,
    selected?.id,
    selected?.group,
    selected?.name,
    selected?.repoPath,
    selected?.runtime,
    chatAgentId,
    chatAgentPermissionMode,
    chatApprovalPolicy,
    chatModel,
    chatReasoning,
    chatName,
    chats,
    busy,
    droneSidebarOrder.pinnedDroneIds,
    drones,
    dronesLoading,
    pinningDroneIds,
    targetSupportsDrones,
    targetCanCloneDrone,
    targetReachable,
    accessOpen,
    accessDirty,
    nativeMessages,
    nativeThread?.autoApprove,
    phoneTarget,
    requestDroneControl,
    running,
    openFilesPage,
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
      const options: AssistantModelChoice[] = buildModelCatalogChoices(
        normalizeMobileDroneChatModelCatalog(result, fallbackProvider),
        fallbackProvider,
      );
      setChatModels(options);
      const configuredModel = String(result?.model ?? '').trim() || options[0]?.id || '';
      if (configuredModel) setChatModel(configuredModel);
      const configuredProvider = String(result?.provider ?? '').trim();
      if (configuredProvider) setChatModelProvider(configuredProvider);
      else {
        const configuredChoice = options.find(
          (option: AssistantModelChoice) => option.id === configuredModel,
        );
        setChatModelProvider(configuredChoice?.provider ?? fallbackProvider);
      }
      const configuredReasoning = String(result?.reasoning ?? '').trim();
      if (configuredReasoning) setChatReasoning(configuredReasoning);
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
        if (
          targetIdRef.current !== destinationId ||
          selectedRef.current?.id !== droneId ||
          chatNameRef.current !== activeChat
        )
          return;
        setPendingApprovals((current) => current.filter((item) => item.id !== approval.id));
        await readChat(droneId, activeChat);
      })
      .catch((nextError: any) => {
        if (
          targetIdRef.current === destinationId &&
          selectedRef.current?.id === droneId &&
          chatNameRef.current === activeChat
        )
          setError(nextError?.message ?? String(nextError));
      })
      .finally(() => setApprovalBusyId((current) => (current === approval.id ? '' : current)));
  };

  const resolveQuestionRequest = (
    request: ChatQuestionRequest,
    resolution:
      | { action: 'submit'; responses: ChatQuestionResponse[]; notes?: string }
      | { action: 'skip'; notes?: string },
  ) => {
    if (!selected || questionBusyId) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    setQuestionBusyId(request.id);
    setError(null);
    void requestDroneControl(destinationId, 'chat.questions.resolve', {
      droneId,
      chatName: activeChat,
      requestId: request.id,
      ...resolution,
    })
      .then(async (response: any) => {
        if (
          targetIdRef.current !== destinationId ||
          selectedRef.current?.id !== droneId ||
          chatNameRef.current !== activeChat
        )
          return;
        setQuestionRequests((current) =>
          current.map((item) =>
            item.id === request.id && response?.result
              ? {
                  ...item,
                  status: response.result.status,
                  result: response.result,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        await readChat(droneId, activeChat);
      })
      .catch((nextError: any) => {
        if (
          targetIdRef.current === destinationId &&
          selectedRef.current?.id === droneId &&
          chatNameRef.current === activeChat
        )
          setError(nextError?.message ?? String(nextError));
      })
      .finally(() => setQuestionBusyId((current) => (current === request.id ? '' : current)));
  };

  const resolveCodexApproval = (
    approval: CodexPendingApproval,
    decision: CodexApprovalDecision,
  ) => {
    if (!selected || approvalBusyId) return;
    const destinationId = targetId;
    const droneId = selected.id;
    const activeChat = chatName;
    setApprovalBusyId(approval.id);
    setError(null);
    void requestDroneControl(destinationId, 'chat.approval.resolve', {
      droneId,
      chatName: activeChat,
      promptId: approval.promptId,
      approvalId: approval.id,
      decision,
    })
      .then(async () => {
        if (
          targetIdRef.current !== destinationId ||
          selectedRef.current?.id !== droneId ||
          chatNameRef.current !== activeChat
        )
          return;
        setPendingPrompts((current) =>
          current.map((pending) =>
            String(pending?.id ?? '') === approval.promptId
              ? {
                  ...pending,
                  approvals: Array.isArray(pending?.approvals)
                    ? pending.approvals.filter((item: any) => item?.id !== approval.id)
                    : [],
                }
              : pending,
          ),
        );
        setResolvedCodexApprovalIds((current) => new Set(current).add(approval.id));
        await readChat(droneId, activeChat);
      })
      .catch((nextError: any) => {
        if (
          targetIdRef.current === destinationId &&
          selectedRef.current?.id === droneId &&
          chatNameRef.current === activeChat
        )
          setError(nextError?.message ?? String(nextError));
      })
      .finally(() => setApprovalBusyId((current) => (current === approval.id ? '' : current)));
  };

  const confirmDroneRename = async () => {
    if (!renameCandidate || renaming) return;
    const newName = renameName.trim();
    const validationError = validateMobileDroneRename(newName, renameCandidate.name);
    if (validationError) {
      setRenameError(validationError);
      return;
    }
    const destinationId = targetId;
    const droneId = renameCandidate.id;
    setRenaming(true);
    setRenameError(null);
    try {
      await requestDroneControl(destinationId, 'drone.rename', { droneId, newName });
      if (targetIdRef.current !== destinationId) return;
      setDrones((current) =>
        current.map((drone) => (drone.id === droneId ? { ...drone, name: newName } : drone)),
      );
      setSelected((current) => (current?.id === droneId ? { ...current, name: newName } : current));
      setRenameCandidate(null);
      setRenameName('');
      await loadDrones(true);
    } catch (nextError: any) {
      if (targetIdRef.current === destinationId) {
        setRenameError(mobileDroneRenameErrorMessage(nextError));
      }
    } finally {
      if (targetIdRef.current === destinationId) setRenaming(false);
    }
  };

  const renameValidationError = renameCandidate
    ? validateMobileDroneRename(renameName, renameCandidate.name)
    : null;
  const navigateToDrones = () => {
    navigationItems.find((item) => item.id === 'drones')?.onPress();
  };
  const draftAwareNavigationItems = navigationItems.map((item) =>
    item.id === 'drones'
      ? item
      : {
          ...item,
          onPress: () => {
            void saveNewDroneDraftBeforeNavigation().finally(item.onPress);
          },
        },
  );

  return (
    <View style={styles.screen}>
      <AppDrawer
        open={drawerOpen}
        swipeEnabled={!filesPageOpen}
        navigationItems={draftAwareNavigationItems}
        showDrones
        drones={drawerDrones}
        droneSidebarOrder={droneSidebarOrder}
        activeDroneId={selected?.id ?? ''}
        activeChatName={chatName}
        companionHighlightedDroneIds={companionHighlightedDroneIds}
        droneOperationById={droneOperationById}
        dronesLoading={dronesLoading}
        dronesReachable={targetReachable}
        dronesError={droneListError}
        devicePickerItems={devicePickerItems}
        activeDeviceId={targetId}
        onOpen={() => onDrawerOpenChange(true)}
        onClose={() => onDrawerOpenChange(false)}
        onCreateDrone={
          targetSupportsDrones && targetReachable
            ? (repoPath) => {
                navigateToDrones();
                onDrawerOpenChange(false);
                void saveNewDroneDraftBeforeNavigation().then(() =>
                  openNewDroneScreen({ repoPath }),
                );
              }
            : undefined
        }
        onRetryDrones={() =>
          void (targetReachable ? loadDrones() : mesh.retryDeviceConnection(targetId))
        }
        onSelectDevice={(deviceId) => {
          finishMobileChatLoad('superseded');
          void saveNewDroneDraftBeforeNavigation().then(() => {
            chatReadVersion.current += 1;
            openDroneVersion.current += 1;
            setDronesLoaded(false);
            setDroneListError(null);
            onDeviceChange(deviceId);
            commitDroneListSnapshot({
              ...EMPTY_MOBILE_DRONE_LIST_SNAPSHOT,
              targetId: deviceId,
            });
            transitionToDroneChat(null);
          });
        }}
        onSelectDroneChat={(droneId, nextChat) => {
          const drone = drones.find((item) => item.id === droneId);
          if (!drone) return;
          beginMobileChatLoad({ targetDeviceId: targetId, droneId, chatName: nextChat });
          navigateToDrones();
          onDrawerOpenChange(false);
          void saveNewDroneDraftBeforeNavigation().then(() => openDrone(drone, nextChat));
        }}
        onCreateDroneChat={createDrawerChat}
        onRenameDroneChat={renameDrawerChat}
        onDeleteDroneChat={deleteDrawerChat}
        onReorderSidebar={targetReachable && targetCanReorderSidebar ? reorderSidebar : undefined}
      />
      <ChatFilesCarousel
        open={filesPageOpen}
        enabled={Boolean(selected && workspaceVisible && !drawerOpen)}
        onOpenChange={setFilesPageOpen}
        onReveal={prepareFilesPage}
        renderFiles={(active) => (
          <FilePreviewModal
            embedded
            visible={active && workspaceVisible}
            preview={filePreview.preview}
            displayPath={filePreview.displayPath}
            line={filePreview.line}
            loading={filePreview.loading}
            error={filePreview.error}
            refreshError={filePreview.refreshError}
            saving={filePreview.saving}
            saveError={filePreview.saveError}
            targetId={targetId}
            droneId={selected?.id ?? ''}
            chatName={chatName}
            rootPath={filePreview.rootPath}
            workspaceName={selected?.name ?? ''}
            selectedPath={filePreview.selectedPath}
            requestDroneControl={requestDroneControl}
            onOpenPath={(path) => filePreview.open({ raw: path, path, line: null, column: null })}
            onSave={filePreview.save}
            onClose={() => setFilesPageOpen(false)}
            onRetry={filePreview.retry}
            onPreviewPathsChanged={filePreview.invalidatePaths}
          />
        )}
      >
        <KeyboardAvoidingView
          style={styles.content}
          behavior={Platform.OS === 'android' ? 'height' : 'padding'}
          keyboardVerticalOffset={insets.top + APP_HEADER_HEIGHT}
        >
          {!targetReachable && targetSupportsDrones && !selected ? (
            <View style={styles.deviceOffline}>
              <View style={styles.deviceOfflineIcon}>
                {targetReconnecting ? (
                  <ActivityIndicator color={colors.warning} size="small" />
                ) : (
                  <WifiOff color={colors.warning} size={28} strokeWidth={1.7} />
                )}
                <View style={styles.deviceOfflineIndicator} />
              </View>
              <Text style={styles.deviceOfflineTitle}>
                {targetConnectionState === 'reconnecting'
                  ? `Reconnecting to ${activeTarget?.name ?? 'this device'}`
                  : targetConnectionState === 'suspended'
                    ? `${activeTarget?.name ?? 'This device'} connection paused`
                    : `${activeTarget?.name ?? 'This device'} is offline`}
              </Text>
              <Text style={styles.deviceOfflineBody}>
                {targetReconnecting
                  ? 'Drone Hub is restoring the secure connection. This normally takes a moment.'
                  : 'Drone Hub can’t reach this device. Make sure the app is running there and that both devices are connected to the internet or the same local network.'}
              </Text>
              {!targetReconnecting ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void mesh.retryDeviceConnection(targetId)}
                  style={({ pressed }) => [
                    styles.deviceOfflineRetry,
                    pressed && styles.chatTabPressed,
                  ]}
                >
                  <Text style={styles.deviceOfflineRetryText}>Retry connection</Text>
                </Pressable>
              ) : null}
              <View style={styles.deviceOfflineAutomatic}>
                <View style={styles.deviceOfflinePulse} />
                <Text style={styles.deviceOfflineAutomaticText}>Checking automatically</Text>
              </View>
            </View>
          ) : dronesLoading && !selected ? (
            <MobileLoadingState accessibilityLabel="Loading drones" label="Loading drones…" />
          ) : selected ? (
            <View style={styles.chatWorkspace}>
              {!targetReachable ? (
                <View style={styles.offlineChatNotice}>
                  <View style={styles.deviceOfflineIndicator} />
                  <View style={styles.offlineChatNoticeCopy}>
                    <Text style={styles.offlineChatNoticeTitle}>
                      {targetConnectionState === 'reconnecting'
                        ? 'Reconnecting to device'
                        : targetConnectionState === 'suspended'
                          ? 'Connection paused'
                          : 'Device offline'}
                    </Text>
                    <Text style={styles.offlineChatNoticeBody}>
                      {targetReconnecting
                        ? 'This chat is readable. Sending will resume as soon as the secure connection is restored.'
                        : 'This chat is readable. Sending will resume when it reconnects.'}
                    </Text>
                  </View>
                </View>
              ) : null}
              {visibleChats.length === 0 ? (
                <View style={styles.emptyDrone}>
                  <MessageCircle color={colors.muted} size={28} strokeWidth={1.6} />
                  <Text style={styles.emptyDroneTitle}>This drone has no chats yet.</Text>
                  <Text style={styles.emptyDroneBody}>
                    Create a chat to start working with the Built-in agent.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!targetReachable || busy === 'create-chat'}
                    onPress={() => void createNewChat()}
                    style={({ pressed }) => [
                      styles.emptyDroneButton,
                      !targetReachable && styles.disabledAction,
                      pressed && styles.chatTabPressed,
                    ]}
                  >
                    {busy === 'create-chat' ? (
                      <ActivityIndicator color={colors.onAccent} size="small" />
                    ) : (
                      <Text style={styles.emptyDroneButtonText}>Create chat</Text>
                    )}
                  </Pressable>
                  {visibleChatError ? <ErrorBanner message={visibleChatError} /> : null}
                </View>
              ) : (
                <>
                  {accessOpen && phoneTarget && nativeChatId ? (
                    <ScrollView
                      style={styles.transcriptScroll}
                      contentContainerStyle={styles.transcriptContent}
                    >
                      {localAssistant.threads.find((thread) => thread.id === nativeChatId) ? (
                        <LocalWorkspaceEditor
                          thread={
                            localAssistant.threads.find((thread) => thread.id === nativeChatId)!
                          }
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
                  ) : (
                    <>
                      {visibleChatError || nativeThread?.error ? (
                        <View style={styles.chatError}>
                          <ErrorBanner
                            message={visibleChatError || String(nativeThread?.error ?? '')}
                          />
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
                        {chatHistoryPage.hasOlder || olderHistoryBusy ? (
                          <View
                            accessibilityLiveRegion="polite"
                            accessibilityRole={olderHistoryBusy ? 'progressbar' : undefined}
                            accessibilityLabel={
                              olderHistoryBusy ? 'Loading older chat messages' : undefined
                            }
                            style={styles.loadOlderStatus}
                          >
                            {olderHistoryBusy ? (
                              <ActivityIndicator color={colors.accent} size="small" />
                            ) : null}
                          </View>
                        ) : null}
                        <RenderErrorBoundary
                          key={`${targetId}:${selected.id}:${chatName}`}
                          fallback={
                            <ErrorBanner message="This transcript could not be rendered safely. Switch chats and return to retry." />
                          }
                        >
                          <MobileAssistantTranscript
                            messages={transcriptMessages}
                            loading={chatLoading}
                            running={running}
                            awaitingApproval={awaitingApproval}
                            approvalStartedAt={approvalStartedAt}
                            emptyTitle="This drone chat is ready."
                            emptyBody="Send a prompt to start the conversation."
                            assistantLabel="Agent"
                            queuedPrompts={visiblePendingPrompts}
                            cancellingPromptId={cancellingPromptId}
                            onCancelQueuedPrompt={cancelPendingPrompt}
                            creatingQueuedChatId={creatingQueuedChatId}
                            onCreateQueuedChatNow={createQueuedChatNow}
                            resolvingInterruptionId={resolvingInterruptionId}
                            onResolveInterruption={resolvePendingPromptInterruption}
                            queueInterruption={normalizePromptQueueInterruption(
                              nativeThread?.queueInterruption,
                            )}
                            interruptedPromptId={String(nativeThread?.interruptedPromptId ?? '')}
                            linkedPullRequests={linkedPullRequests}
                            onLoadFullMessage={(message) => void loadFullChatMessage(message)}
                            fullMessageLoadingId={fullMessageBusyId}
                            onOpenFileReference={openFileReference}
                            onLoadRunFileDiff={loadRunFileDiff}
                            onLoadRunFiles={loadRunFiles}
                            questionRequests={questionRequests}
                            renderQuestionRequest={(request) =>
                              request.status === 'pending' ? (
                                <MobileQuestionRequestCard
                                  request={request}
                                  busy={questionBusyId === request.id}
                                  disabled={!targetReachable}
                                  onSubmit={({ responses, notes }) =>
                                    resolveQuestionRequest(request, {
                                      action: 'submit',
                                      responses,
                                      ...(notes ? { notes } : {}),
                                    })
                                  }
                                  onSkip={(notes) =>
                                    resolveQuestionRequest(request, {
                                      action: 'skip',
                                      ...(notes ? { notes } : {}),
                                    })
                                  }
                                />
                              ) : (
                                <MobileQuestionResultCard request={request} />
                              )
                            }
                            onDeleteMessageRequest={
                              nativeMessages !== null
                                ? ({ message, deleteFollowing }) => {
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
                                      .catch((nextError: any) =>
                                        setError(nextError?.message ?? String(nextError)),
                                      );
                                  }
                                : undefined
                            }
                          />
                        </RenderErrorBoundary>
                        {pendingApprovals.map((approval) => (
                          <AssistantApprovalCard
                            key={approval.id}
                            approval={approval}
                            busy={approvalBusyId === approval.id}
                            disabled={!targetReachable}
                            onResolve={(approved) => resolveNativeApproval(approval, approved)}
                          />
                        ))}
                        {codexPendingApprovals.map((approval) => (
                          <CodexApprovalCard
                            key={approval.id}
                            approval={approval}
                            busy={approvalBusyId === approval.id}
                            disabled={!targetReachable}
                            onResolve={(decision) => resolveCodexApproval(approval, decision)}
                          />
                        ))}
                      </ScrollView>
                      <View style={dictation.open && styles.dictationComposerStack}>
                        <View
                          pointerEvents={dictation.open ? 'none' : 'auto'}
                          onLayout={(event) => {
                            const nextHeight = event.nativeEvent.layout.height;
                            if (
                              nextHeight > 0 &&
                              Math.abs(nextHeight - restingChatComposerHeight) > 0.5
                            )
                              setRestingChatComposerHeight(nextHeight);
                          }}
                          style={dictation.open && styles.dictationComposerBackdrop}
                        >
                          <View style={styles.composerMetadataRow}>
                            <View style={styles.composerMetadataLeading}>
                              <DroneRuntimeIndicator
                                runtime={selected.runtime === 'host' ? 'host' : 'container'}
                              />
                              <ChatSubscriptionIndicator subscriptions={chatSubscriptions} />
                            </View>
                            <DroneBranchIndicator branch={selected.repoBranch} />
                          </View>
                          <AssistantComposer
                            focusKey={composerFocusKey}
                            voiceResetKey={`${targetId}:${selected.id}:${chatName}`}
                            value={prompt}
                            onChangeText={setPrompt}
                            onSend={async (
                              promptOverride,
                              deliveryMode,
                              promptId,
                              preserveComposer,
                            ) =>
                              await sendPrompt(
                                promptOverride,
                                deliveryMode,
                                promptId,
                                preserveComposer,
                              )
                            }
                            onStop={() => void stopChat()}
                            onOpenDictation={() => {
                              // Keep text attached to images/files in the normal
                              // composer; dictation destinations only send text.
                              const initialPrompt =
                                promptAttachmentsRef.current.length === 0 ? promptRef.current : '';
                              void dictation.openAndStart(initialPrompt).then((adopted) => {
                                if (
                                  !adopted ||
                                  promptRef.current !== initialPrompt ||
                                  promptAttachmentsRef.current.length > 0
                                )
                                  return;
                                promptRef.current = '';
                                setPrompt('');
                              });
                            }}
                            onOpenModel={() => void openModelPicker()}
                            modelLabel={displayedModel}
                            reasoningLabel={chatReasoning}
                            sending={busy === 'prompt'}
                            running={running}
                            editable={targetReachable}
                            queueWhileRunning={targetReachable}
                            placeholder={
                              targetReachable
                                ? 'Ask the agent'
                                : targetReconnecting
                                  ? 'Reconnecting…'
                                  : 'Device offline'
                            }
                            hasAttachments={promptAttachments.length > 0}
                            onAddAttachment={addPromptAttachment}
                            attachmentActionsDisabled={!targetReachable || (phoneTarget && running)}
                            sendBlocked={
                              !targetReachable ||
                              (phoneTarget && running && promptAttachments.length > 0)
                            }
                            footer={
                              promptAttachments.length > 0 ? (
                                <ChatAttachmentStrip
                                  attachments={promptAttachments}
                                  disabled={!targetReachable || busy === 'prompt'}
                                  onRemove={(id) =>
                                    setPromptAttachments((current) =>
                                      current.filter((attachment) => attachment.id !== id),
                                    )
                                  }
                                />
                              ) : undefined
                            }
                          />
                        </View>
                        {dictation.open ? (
                          <MobileDictationComposer
                            value={dictation.text}
                            deviceName={activeTarget?.name ?? 'This device'}
                            droneName={selected.name}
                            chatName={chatName}
                            groupName={selected.group}
                            recordingStatus={dictation.recordingStatus}
                            recordingDurationMillis={dictation.recordingDurationMillis}
                            pendingCount={dictation.pendingCount}
                            error={dictation.error}
                            notice={dictation.notice}
                            failedTranscriptionError={dictation.failedClip?.error}
                            finalizing={dictation.finalizing}
                            networkSending={dictation.networkSending}
                            microphoneUnavailable={dictation.microphoneUnavailable}
                            onChangeText={dictation.setText}
                            onClose={() => {
                              Keyboard.dismiss();
                              setComposerFocusKey('');
                              return dictation.discardAndClose();
                            }}
                            onToggleRecording={dictation.toggleRecording}
                            onTogglePause={dictation.togglePause}
                            onCancelRecording={dictation.cancelRecording}
                            onRetryFailedTranscription={dictation.retryFailedClip}
                            onDiscardFailedTranscription={dictation.discardFailedClip}
                            onDestinationPress={dictation.requestSend}
                            morphToComposer
                            morphTargetHeight={Math.max(52, restingChatComposerHeight - 14)}
                          />
                        ) : null}
                      </View>
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
                    </>
                  )}
                </>
              )}
            </View>
          ) : targetSupportsDrones ? (
            <NewDroneScreen
              key={`${targetId}:${newDroneScreenVersion}`}
              repos={createRepos}
              loadingOptions={
                targetReachable && (!dronesLoaded || busy === 'drones' || createOptionsLoading)
              }
              busy={busy.startsWith('create-')}
              requestError={dronesLoading ? null : error}
              initialValues={newDroneDefaults ?? undefined}
              localDevice={phoneTarget}
              onDetectModels={detectCreateModels}
              onLoadRepoBranches={loadCreateRepoBranches}
              onLoadRepoPreferences={(repoPath) =>
                loadMobileDroneCreatePreferences(targetId, repoPath)
              }
              onDraftContentChange={rememberNewDroneDraftContent}
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
      </ChatFilesCarousel>
      <TextInputDialog
        visible={Boolean(renameCandidate)}
        title="Rename drone"
        message={`Choose the name shown for this drone on ${activeTarget?.name ?? 'the selected device'}.`}
        value={renameName}
        error={renameError}
        confirmLabel="Rename"
        confirmDisabled={Boolean(renameValidationError)}
        busy={renaming}
        maxLength={80}
        onChangeText={(value) => {
          setRenameName(value);
          setRenameError(null);
        }}
        onCancel={() => {
          if (renaming) return;
          setRenameCandidate(null);
          setRenameName('');
          setRenameError(null);
        }}
        onConfirm={() => void confirmDroneRename()}
      />
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
        title={deleteMode === 'archive' ? 'Archive drone?' : 'Delete drone?'}
        message={
          deleteMode === 'archive'
            ? `Archive “${deleteCandidate?.name ?? 'this drone'}” on ${activeTarget?.name ?? 'the selected device'}? It will leave the active list and follow the Hub’s archive retention settings.`
            : `Permanently delete “${deleteCandidate?.name ?? 'this drone'}” from ${activeTarget?.name ?? 'the selected device'}?`
        }
        confirmLabel={deleteMode === 'archive' ? 'Archive drone' : 'Delete drone'}
        destructive
        busy={deleting}
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={() => {
          if (!deleteCandidate) return;
          const destinationId = targetId;
          const droneId = deleteCandidate.id;
          const operation = deleteMode === 'archive' ? 'archiving' : 'deleting';
          setDeleting(true);
          setError(null);
          setDroneOperationById((current) => ({ ...current, [droneId]: operation }));
          requestAnimationFrame(() => {
            if (targetIdRef.current !== destinationId) return;
            setDeleteCandidate(null);
            setDeleting(false);
          });
          void requestDroneControl(destinationId, 'drone.delete', { droneId })
            .then(async () => {
              if (targetIdRef.current !== destinationId) return;
              setDrones((current) => current.filter((drone) => drone.id !== droneId));
              if (selectedRef.current?.id === droneId) {
                chatReadVersion.current += 1;
                openDroneVersion.current += 1;
                transitionToDroneChat(null);
              }
              await loadDrones(true);
            })
            .catch((nextError: any) => {
              if (targetIdRef.current === destinationId)
                setError(nextError?.message ?? String(nextError));
            })
            .finally(() => {
              if (targetIdRef.current !== destinationId) return;
              setDeleting(false);
              setDroneOperationById((current) => {
                if (!current[droneId]) return current;
                const next = { ...current };
                delete next[droneId];
                return next;
              });
            });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  unavailable: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  unavailableText: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  deviceOffline: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  deviceOfflineIcon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningDark,
    position: 'relative',
    marginBottom: 20,
  },
  deviceOfflineIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.mutedDim,
    backgroundColor: 'transparent',
  },
  deviceOfflineTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  deviceOfflineBody: {
    maxWidth: 340,
    marginTop: 9,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  deviceOfflineRetry: {
    minHeight: 40,
    marginTop: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.whiteWashSoft,
  },
  deviceOfflineRetryText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  deviceOfflineAutomatic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 14,
  },
  deviceOfflinePulse: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.mutedDim,
    opacity: 0.7,
  },
  deviceOfflineAutomaticText: { color: colors.mutedDim, fontSize: 9 },
  chatWorkspace: { flex: 1, backgroundColor: colors.background },
  offlineChatNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.whiteWashSoft,
  },
  offlineChatNoticeCopy: { flex: 1, minWidth: 0 },
  offlineChatNoticeTitle: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  offlineChatNoticeBody: { color: colors.mutedDim, fontSize: 9, lineHeight: 14, marginTop: 1 },
  disabledAction: { opacity: 0.4 },
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
  emptyDroneButtonText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  chatTabPressed: { opacity: 0.72 },
  chatError: { paddingHorizontal: 12, paddingTop: 9 },
  transcriptScroll: { flex: 1 },
  transcriptContent: { flexGrow: 1 },
  transcriptContentHidden: { opacity: 0 },
  loadOlderStatus: {
    minHeight: 38,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  composerMetadataRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    gap: 8,
    paddingHorizontal: 17,
  },
  dictationComposerStack: { position: 'relative' },
  dictationComposerBackdrop: { position: 'absolute', top: 0, right: 0, left: 0 },
  composerMetadataLeading: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
});
