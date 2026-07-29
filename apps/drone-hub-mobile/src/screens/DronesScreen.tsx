import React from 'react';
import { fromByteArray } from 'base64-js';
import type { AssistantMessage } from '@drone/assistant-chat';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import WifiOff from 'lucide-react-native/icons/wifi-off';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConfirmDialog, ErrorBanner, TextInputDialog } from '../components/Ui';
import {
  AppDrawer,
  type AppDrawerNavigationItem,
  type DrawerDevicePickerItem,
} from '../local-assistant/AppDrawer';
import { AssistantComposer } from '../local-assistant/AssistantComposer';
import { MobileLoadingState } from '../local-assistant/MobileLoadingState';
import {
  AssistantModelPicker,
  type AssistantModelChoice,
} from '../local-assistant/AssistantModelPicker';
import { MobileAssistantTranscript } from '../local-assistant/LocalAssistantTranscript';
import { useLatestMessageScroll } from '../local-assistant/use-latest-message-scroll';
import { useMesh } from '../mesh/MeshContext';
import { readMeshJsonContent } from '../mesh/read-mesh-json-content';
import { colors } from '../theme';
import {
  NewDroneScreen,
  type MobileDroneAgentId,
  type MobileDroneApprovalPolicy,
  type MobileDroneAgentPermissionMode,
  type MobileDroneCreateDefaults,
  type MobileDroneCreatePayload,
} from '../drones/NewDroneScreen';
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
  EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  mobileDroneTurnsToAssistantMessages,
  normalizeMobileDroneCreateRepo,
  normalizeMobileDroneCreateModelCatalog,
  normalizeMobileDrone,
  normalizeMobileNativeChatHistory,
  normalizeMobileDroneListPayload,
  suggestNextMobileDroneChatName,
  type MobileDroneCreateRepo,
  type MobileDroneCreateModel,
  type MobileChatHistoryPage,
  type MobileDroneSidebarOrder,
  type MobileDroneSummary,
} from '../drones/drone-sidebar-model';
import {
  withMobileApprovalRequired,
  withOptimisticMobileBusyChat,
} from '../drones/drone-state-summary';
import {
  confirmedMobilePendingPromptState,
  hasActiveMobileDronePendingPrompt,
  mergeOptimisticMobilePendingPrompts,
  mobileChatRespondingStatus,
  mobileDronePendingPrompts,
  optimisticMobilePendingPrompt,
} from '../drones/mobile-pending-prompts';
import { useDroneLinkedPullRequests } from '../drones/use-drone-linked-pull-requests';
import { useLocalDroneControl } from '../drones/local-drone-control';
import { mobileDeviceReachable } from '../drones/mobile-device-reachability';
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
import type { DroneControlOperation } from '@drone/device-protocol';
import { useLocalAssistant } from '../local-assistant/LocalAssistantContext';
import { LocalWorkspaceEditor } from '../local-assistant/LocalWorkspaceEditor';
import {
  AssistantApprovalCard,
  type MobileAssistantApproval,
} from '../local-assistant/AssistantApprovalCard';

const APP_HEADER_HEIGHT = 58;
const NEW_DRONE_ATTACHMENT_READY_TIMEOUT_MS = 2 * 60_000;
const NEW_DRONE_ATTACHMENT_READY_POLL_MS = 750;
const EMPTY_CHAT_HISTORY_PAGE: MobileChatHistoryPage = {
  beforeCursor: null,
  hasOlder: false,
  responseTruncated: false,
  contentTruncated: false,
};

function inlinePromptAttachments(attachments: readonly MobileChatAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    mime: attachment.mime,
    dataBase64: fromByteArray(attachment.bytes),
  }));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  draft?: boolean;
  draftDisabled?: boolean;
  onToggleDraft?(): void;
  onNewDrone?(): void;
  onNewChat?(): void;
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
  navigationItems,
  onDrawerOpenChange,
  onHeaderChange,
  selectedDeviceId,
  devicePickerItems,
  onDeviceChange,
}: {
  drawerOpen: boolean;
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
  const phoneTarget = Boolean(targetId && targetId === mesh.identity?.id);
  const targetSupportsDrones = phoneTarget || targets.some((target) => target.id === targetId);
  const targetReachable = mobileDeviceReachable({
    targetDeviceId: targetId,
    selfDeviceId: mesh.identity?.id,
    connectedDeviceIds: mesh.connectedDeviceIds,
  });
  const requestDroneControl = React.useCallback(
    (destinationId: string, operation: DroneControlOperation, payload?: any) =>
      destinationId === mesh.identity?.id
        ? localDroneControl.request(operation, payload)
        : mesh.request(destinationId, 'drone-control', operation, payload),
    [localDroneControl.request, mesh.identity?.id, mesh.request],
  );
  const [drones, setDrones] = React.useState<MobileDroneSummary[]>([]);
  const [droneSidebarOrder, setDroneSidebarOrder] = React.useState<MobileDroneSidebarOrder>(
    EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  );
  const droneSidebarOrderRef = React.useRef<MobileDroneSidebarOrder>(
    EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
  );
  const pinWriteQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const [selected, setSelected] = React.useState<MobileDroneSummary | null>(null);
  const [chats, setChats] = React.useState<string[]>([]);
  const [chatName, setChatName] = React.useState('default');
  const [chatModel, setChatModel] = React.useState('');
  const [chatReasoning, setChatReasoning] = React.useState('');
  const [chatModelProvider, setChatModelProvider] = React.useState('drone');
  const [chatAgentId, setChatAgentId] = React.useState<MobileDroneAgentId | null>(null);
  const [chatAgentPermissionMode, setChatAgentPermissionMode] =
    React.useState<MobileDroneAgentPermissionMode>('full-access');
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
  const [fullMessageBusyId, setFullMessageBusyId] = React.useState('');
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
  const createDefaultsRequestVersion = React.useRef(0);
  const createOptionsRequestVersion = React.useRef(0);
  const chatTabsRef = React.useRef<ScrollView>(null);
  const createModelCatalogCache = React.useRef(new Map<string, MobileDroneCreateModel[]>());
  const createRepoBranchesCache = React.useRef(new Map<string, MobileDroneCreateRepo>());
  const loadedDronesTargetIdRef = React.useRef('');
  const loadDronesRef = React.useRef<(quiet?: boolean) => Promise<void>>(async () => {});
  const readChatRef = React.useRef<(droneId: string, chatName: string) => Promise<void>>(
    async () => {},
  );
  targetIdRef.current = targetId;
  droneSidebarOrderRef.current = droneSidebarOrder;
  selectedRef.current = selected;
  chatNameRef.current = chatName;

  React.useEffect(() => {
    setChatHistoryPage(EMPTY_CHAT_HISTORY_PAGE);
    setOlderHistoryBusy(false);
    setPromptAttachments([]);
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
        setDeleteMode(normalized.deleteMode);
        if (normalized.createRepos.length > 0) {
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
        setDrones(nextDrones);
        droneSidebarOrderRef.current = normalized.sidebar;
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
          const optionsRequestVersion = ++createOptionsRequestVersion.current;
          setCreateOptionsLoading(true);
          try {
            const optionsResult = await requestDroneControl(targetId, 'drones.list', {
              includeCreateOptions: true,
            });
            if (
              targetIdRef.current !== targetId ||
              droneListVersion.current !== requestVersion ||
              createOptionsRequestVersion.current !== optionsRequestVersion
            )
              return;
            const options = normalizeMobileDroneListPayload(optionsResult);
            setDeleteMode(options.deleteMode);
            setCreateRepos(
              options.createRepos.map(
                (repo) => createRepoBranchesCache.current.get(`${targetId}:${repo.path}`) ?? repo,
              ),
            );
          } catch (nextError: any) {
            if (
              targetIdRef.current === targetId &&
              droneListVersion.current === requestVersion &&
              createOptionsRequestVersion.current === optionsRequestVersion
            ) {
              setError(
                `Drones loaded, but creation options are unavailable: ${nextError?.message ?? String(nextError)}`,
              );
            }
          } finally {
            if (
              targetIdRef.current === targetId &&
              createOptionsRequestVersion.current === optionsRequestVersion
            )
              setCreateOptionsLoading(false);
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
  loadDronesRef.current = loadDrones;

  React.useEffect(() => {
    const createDefaultsVersion = ++createDefaultsRequestVersion.current;
    selectedRef.current = null;
    setDrones([]);
    droneSidebarOrderRef.current = EMPTY_MOBILE_DRONE_SIDEBAR_ORDER;
    setDroneSidebarOrder(EMPTY_MOBILE_DRONE_SIDEBAR_ORDER);
    setSelected(null);
    setChats([]);
    setChatName('default');
    setChatModel('');
    setChatReasoning('');
    setChatModelProvider('drone');
    setChatAgentId(null);
    setChatAgentPermissionMode('full-access');
    setChatApprovalPolicy('ask');
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
    setNewDroneDraft(false);
    setNewDroneScreenVersion((value) => value + 1);
    setComposerFocusKey('');
    droneListVersion.current += 1;
    chatReadVersion.current += 1;
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
        setNewDroneDraft(defaults.draft === true);
        setNewDroneScreenVersion((value) => value + 1);
      });
    }
  }, [targetId, targetSupportsDrones]);
  React.useEffect(() => {
    if (targetReachable && targetSupportsDrones) {
      // Callback identities change while the local assistant and mesh hydrate. Refresh only when
      // the resource key or route changes, and keep already-loaded content visible on reconnect.
      void loadDronesRef.current(loadedDronesTargetIdRef.current === targetId);
    }
  }, [targetReachable, targetId, targetSupportsDrones]);

  const openDrone = (drone: MobileDroneSummary, requestedChat?: string) =>
    run('chats', async () => {
      createDefaultsRequestVersion.current += 1;
      const destinationId = targetId;
      const requestVersion = ++openDroneVersion.current;
      const knownChats = drone.chats;
      const knownChat =
        requestedChat && knownChats.includes(requestedChat) ? requestedChat : (knownChats[0] ?? '');
      setSelected(drone);
      setChats(knownChats);
      setChatName(knownChat);
      setChatModel('');
      setChatReasoning('');
      setChatAgentId(null);
      setChatAgentPermissionMode('full-access');
      setChatApprovalPolicy('ask');
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
        requestedChat && nextChats.includes(requestedChat) ? requestedChat : (nextChats[0] ?? '');
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
      result?.agentPermissionMode === 'read-only' ||
        result?.agentPermissionMode === 'workspace-write'
        ? result.agentPermissionMode
        : 'full-access',
    );
    setChatApprovalPolicy(
      result?.approvalPolicy === 'agent-decides' || result?.approvalPolicy === 'never'
        ? result.approvalPolicy
        : result?.thread?.approvalPolicy === 'never' || result?.thread?.autoApprove === true
          ? 'never'
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
    setNativeThread(result?.thread ?? null);
    setPendingApprovals(Array.isArray(result?.pendingApprovals) ? result.pendingApprovals : []);
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
    setFullMessageBusyId(messageId);
    setError(null);
    try {
      const content = await readMeshJsonContent(async (contentOffset) => {
        const result = await requestDroneControl(destinationId, 'chat.read', {
          droneId,
          chatName: activeChat,
          ...(native ? { messageId } : { turnId }),
          contentOffset,
        });
        return result?.contentChunk ?? {};
      });
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
      if (targetIdRef.current === destinationId) setError(nextError?.message ?? String(nextError));
    } finally {
      setFullMessageBusyId('');
    }
  };

  readChatRef.current = readChat;

  React.useEffect(() => {
    if (!phoneTarget || !selectedRef.current) return;
    void readChatRef
      .current(selectedRef.current.id, chatNameRef.current)
      .catch((nextError: any) => {
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

  const sendChatPromptWithAttachments = async (input: {
    destinationId: string;
    droneId: string;
    chatName: string;
    prompt: string;
    attachments: readonly MobileChatAttachment[];
  }) => {
    if (input.destinationId === mesh.identity?.id) {
      return await requestDroneControl(input.destinationId, 'chat.prompt', {
        droneId: input.droneId,
        chatName: input.chatName,
        prompt: input.prompt,
        ...(input.attachments.length > 0
          ? { attachments: inlinePromptAttachments(input.attachments) }
          : {}),
      });
    }

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
      return await requestDroneControl(input.destinationId, 'chat.prompt', {
        droneId: input.droneId,
        chatName: input.chatName,
        prompt: input.prompt,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
    } catch (error) {
      await Promise.all(
        attachmentIds.map((uploadId) =>
          requestDroneControl(input.destinationId, 'chat.prompt', {
            droneId: input.droneId,
            chatName: input.chatName,
            attachmentTransfer: { action: 'abort', uploadId },
          }).catch(() => undefined),
        ),
      );
      throw error;
    }
  };

  const sendPrompt = (promptOverride?: string) => {
    const nextPrompt = String(promptOverride ?? prompt);
    const attachments = promptAttachments;
    if (!selected || (!nextPrompt.trim() && attachments.length === 0)) return;
    const optimisticId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const promptSummary = nextPrompt.trim();
    setPrompt('');
    setPromptAttachments([]);
    promptRef.current = '';
    promptAttachmentsRef.current = [];
    setPendingPrompts((current) => [
      ...current,
      optimisticMobilePendingPrompt({
        id: optimisticId,
        prompt: promptSummary,
        attachmentCount: attachments.length,
        imageCount: attachments.filter((attachment) => attachment.mime.startsWith('image/')).length,
        state: running ? 'queued' : 'sending',
      }),
    ]);
    return run('prompt', async () => {
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
      if (targetIdRef.current !== destinationId) return;
      const promptId = String(result?.promptId ?? '').trim();
      const queuedPromptId = String(result?.queuedPrompt?.id ?? '').trim();
      const acceptedPromptId = promptId || queuedPromptId;
      const acceptedPromptState = confirmedMobilePendingPromptState({
        pendingState: result?.pendingState,
        queuedPromptId,
        optimisticState: running ? 'queued' : 'sending',
      });
      if (acceptedPromptId)
        setPendingPrompts((current) =>
          current.map((item) =>
            item?.id === optimisticId
              ? {
                  ...item,
                  id: acceptedPromptId,
                  state: acceptedPromptState,
                  optimisticSent: true,
                }
              : item,
          ),
        );
      if (targetIdRef.current !== destinationId) return;
      await readChat(droneId, activeChat);
      await loadDrones(true);
    });
  };

  const waitForCreatedDrone = async (destinationId: string, droneId: string): Promise<void> => {
    const deadline = Date.now() + NEW_DRONE_ATTACHMENT_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (targetIdRef.current !== destinationId) {
        throw new Error('The selected Drone Hub changed while the drone was starting.');
      }
      const result = await requestDroneControl(destinationId, 'drones.list', {
        includeCreateOptions: false,
      });
      const drone = normalizeMobileDroneListPayload(result).drones.find(
        (candidate) => candidate.id === droneId,
      );
      if (drone?.phase === 'error' || drone?.statusOk === false) {
        throw new Error(drone.statusError || 'The drone failed while starting.');
      }
      if (drone && !['starting', 'creating', 'seeding'].includes(drone.phase)) return;
      await wait(NEW_DRONE_ATTACHMENT_READY_POLL_MS);
    }
    throw new Error('Timed out waiting for the drone to accept image attachments.');
  };

  const createDrone = async (
    payload: MobileDroneCreatePayload,
    preferences?: MobileDroneCreatePreferences,
    initialImages: readonly MobileChatImage[] = [],
  ): Promise<boolean> => {
    let created = false;
    await run(`create-${payload.runtime}`, async () => {
      const destinationId = targetId;
      const localTarget = destinationId === mesh.identity?.id;
      const createPayload =
        initialImages.length === 0 || localTarget
          ? {
              ...payload,
              ...(initialImages.length > 0
                ? { seedAttachments: inlinePromptAttachments(initialImages) }
                : {}),
            }
          : {
              ...Object.fromEntries(
                Object.entries(payload).filter(
                  ([key]) => key !== 'seedPrompt' && key !== 'seedSubmittedAt',
                ),
              ),
              // The chat prompt is sent after remote attachment upload. Keep one copy only for
              // automatic naming while the new drone starts.
              ...(payload.autoRename && payload.seedPrompt
                ? { autoRenamePrompt: payload.seedPrompt }
                : {}),
            };
      const result = await requestDroneControl(
        destinationId,
        `drone.create.${payload.runtime}`,
        createPayload,
      );
      created = true;
      const createdDroneId = String(
        result?.id ?? result?.droneId ?? result?.drone?.id ?? '',
      ).trim();
      const startsWithChat = Boolean(payload.seedAgent);
      const initialPromptSummary =
        String(payload.seedPrompt ?? '').trim() ||
        (initialImages.length > 0
          ? `Attached ${initialImages.length} image${initialImages.length === 1 ? '' : 's'}`
          : '');
      let optimisticPromptId = '';
      if (targetIdRef.current === destinationId && createdDroneId && startsWithChat) {
        const optimisticDrone = normalizeMobileDrone(
          result?.drone ?? {
            id: createdDroneId,
            name: result?.name ?? payload.name ?? createdDroneId,
            runtime: payload.runtime,
            phase: result?.phase ?? 'starting',
            status: 'Starting…',
            group: payload.group,
            repoPath: payload.repoPath,
            chats: ['default'],
            busyChats: ['default'],
          },
        );
        if (optimisticDrone) {
          optimisticPromptId =
            String(result?.initialMessage?.promptId ?? '').trim() ||
            `mobile-create-${createdDroneId}-${Date.now()}`;
          selectedRef.current = optimisticDrone;
          chatNameRef.current = 'default';
          setDrones((current) => [
            optimisticDrone,
            ...current.filter((drone) => drone.id !== optimisticDrone.id),
          ]);
          setSelected(optimisticDrone);
          setChats(['default']);
          setChatName('default');
          setChatModel(String(payload.seedModel ?? ''));
          setChatReasoning(String(payload.seedReasoning ?? ''));
          setChatModelProvider(String(payload.seedProvider ?? payload.seedAgent?.kind ?? 'drone'));
          setChatAgentId(
            payload.seedAgent?.kind === 'builtin' ? mobileDroneAgentId(payload.seedAgent.id) : null,
          );
          setChatAgentPermissionMode(
            payload.seedAgentPermissionMode === 'read-only' ||
              payload.seedAgentPermissionMode === 'workspace-write'
              ? payload.seedAgentPermissionMode
              : 'full-access',
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
      await saveMobileDroneCreatePreferences(
        destinationId,
        String(payload.repoPath ?? '').trim(),
        preferences ?? mobileDroneCreatePreferencesFromPayload(payload),
      ).catch(() => undefined);
      if (targetIdRef.current !== destinationId) return;
      try {
        if (initialImages.length > 0 && !localTarget) {
          const droneId = String(result?.id ?? result?.droneId ?? '').trim();
          if (!droneId) throw new Error('The Drone Hub did not return the new drone id.');
          await waitForCreatedDrone(destinationId, droneId);
          const promptResult = await sendChatPromptWithAttachments({
            destinationId,
            droneId,
            chatName: 'default',
            prompt: String(payload.seedPrompt ?? ''),
            attachments: initialImages,
          });
          const acceptedPromptId = String(
            promptResult?.promptId ?? promptResult?.queuedPrompt?.id ?? '',
          ).trim();
          const acceptedPromptState = confirmedMobilePendingPromptState({
            pendingState: promptResult?.pendingState,
            queuedPromptId: promptResult?.queuedPrompt?.id,
            optimisticState: 'sending',
          });
          if (acceptedPromptId && optimisticPromptId) {
            setPendingPrompts((current) =>
              current.map((item) =>
                item?.id === optimisticPromptId
                  ? {
                      ...item,
                      id: acceptedPromptId,
                      state: acceptedPromptState,
                      optimisticSent: true,
                    }
                  : item,
              ),
            );
          }
        }
      } catch (nextError: any) {
        if (targetIdRef.current === destinationId && optimisticPromptId) {
          setPendingPrompts((current) =>
            current.map((item) =>
              item?.id === optimisticPromptId
                ? {
                    ...item,
                    state: 'failed',
                    error: nextError?.message ?? String(nextError),
                  }
                : item,
            ),
          );
        }
        throw new Error(
          `Drone created, but its first message could not be sent: ${nextError?.message ?? String(nextError)}`,
        );
      } finally {
        await loadDrones();
      }
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
    setNewDroneDraft(defaults.draft === true);
    setNewDroneScreenVersion((value) => value + 1);
    setSelected(null);
    setChats([]);
    setChatName('default');
    setChatModel('');
    setChatReasoning('');
    setChatModelProvider('drone');
    setChatAgentId(null);
    setChatAgentPermissionMode('full-access');
    setChatApprovalPolicy('ask');
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
      setPromptAttachments([]);
      setComposerFocusKey(`${drone.id}:${createdChat}:${Date.now()}`);
      await readChat(drone.id, createdChat);
      await loadDrones(true);
    });

  const transcriptMessages = React.useMemo(
    () => nativeMessages ?? mobileDroneTurnsToAssistantMessages(turns, pendingPrompts),
    [nativeMessages, pendingPrompts, turns],
  );
  const visiblePendingPrompts = React.useMemo(
    () => mobileDronePendingPrompts(pendingPrompts, turns, transcriptMessages),
    [pendingPrompts, transcriptMessages, turns],
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
  const chatLoading = busy === 'chats' || busy === 'chat' || busy === 'create-chat';
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
      visiblePendingPrompts.some((item) => item.status === 'pending'),
    nativeRuntimeActive:
      nativeThread?.status === 'running' ||
      nativeThread?.status === 'waiting_for_approval' ||
      nativeThread?.status === 'waiting_for_chats_idle',
    nativeTranscriptLoaded: nativeMessages !== null,
    serverChatBusy: Boolean(selected?.busyChats.some((chat) => chat === chatName)),
  });
  const awaitingApproval =
    pendingApprovals.length > 0 || nativeThread?.status === 'waiting_for_approval';
  const approvalStartedAt = pendingApprovals
    .map((approval) => Date.parse(String(approval.createdAt ?? '')))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right)[0];
  const activeTarget = mesh.devices.find((target) => target.id === targetId);
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
          pendingApprovals.length > 0 || nativeThread?.status === 'waiting_for_approval',
        );
      }),
    [
      chatName,
      drones,
      nativeThread?.status,
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
  const setDronePinned = React.useCallback(
    (droneId: string, pinned: boolean): Promise<void> => {
      const destinationId = targetId;
      const write = async () => {
        if (targetIdRef.current !== destinationId) return;
        const previousIds = droneSidebarOrderRef.current.pinnedDroneIds;
        const nextIds = pinned
          ? previousIds.includes(droneId)
            ? previousIds
            : [...previousIds, droneId]
          : previousIds.filter((id) => id !== droneId);
        const optimisticOrder = { ...droneSidebarOrderRef.current, pinnedDroneIds: nextIds };
        droneSidebarOrderRef.current = optimisticOrder;
        setPinningDroneIds((current) => new Set(current).add(droneId));
        setDroneSidebarOrder(optimisticOrder);
        try {
          const result = await requestDroneControl(destinationId, 'drone.pin.update', {
            droneId,
            pinned,
          });
          const savedIds: string[] = Array.isArray(result?.uiPreferences?.pinnedDroneIds)
            ? [
                ...new Set<string>(
                  result.uiPreferences.pinnedDroneIds
                    .map((id: unknown) => String(id ?? '').trim())
                    .filter(Boolean),
                ),
              ]
            : nextIds;
          if (targetIdRef.current === destinationId) {
            const savedOrder = { ...droneSidebarOrderRef.current, pinnedDroneIds: savedIds };
            droneSidebarOrderRef.current = savedOrder;
            setDroneSidebarOrder(savedOrder);
          }
        } catch (nextError: any) {
          if (targetIdRef.current === destinationId) {
            const restoredOrder = {
              ...droneSidebarOrderRef.current,
              pinnedDroneIds: previousIds,
            };
            droneSidebarOrderRef.current = restoredOrder;
            setDroneSidebarOrder(restoredOrder);
            setError(nextError?.message ?? String(nextError));
          }
        } finally {
          setPinningDroneIds((current) => {
            const next = new Set(current);
            next.delete(droneId);
            return next;
          });
        }
      };
      const queued = pinWriteQueueRef.current.then(write, write);
      pinWriteQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [requestDroneControl, targetId],
  );
  React.useEffect(() => {
    const frame = requestAnimationFrame(() =>
      chatTabsRef.current?.scrollToEnd({ animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selected?.id, visibleChats.length]);
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
            onNewDrone: openNewDroneFromCurrent,
            onNewChat: () => void createNewChat(),
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
            ...((nativeMessages !== null ||
              chatAgentId === 'codex' ||
              chatAgentId === 'blip')
              ? {
                  agentAccessOptions: (
                    [
                      ['read-only', 'Read'],
                      ['workspace-write', 'Write'],
                      ['full-access', 'Execute'],
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
            ...(chatAgentPermissionMode === 'full-access' &&
            (nativeMessages !== null || chatAgentId === 'codex')
              ? {
                  approvalPolicyOptions: (
                    [
                      {
                        policy: 'ask',
                        label:
                          chatAgentId === 'codex'
                            ? 'Ask first · unavailable'
                            : 'Ask first',
                        disabled: chatAgentId === 'codex',
                      },
                      ...(chatAgentId === 'codex'
                        ? [
                            {
                              policy: 'agent-decides' as const,
                              label: 'Agent decides',
                            },
                          ]
                        : []),
                      { policy: 'never', label: 'Allow all' },
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
              draft: newDroneDraft,
              draftDisabled: busy.startsWith('create-'),
              onToggleDraft: () => setNewDroneDraft((value) => !value),
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
    dronesLoading,
    pinningDroneIds,
    newDroneDraft,
    targetSupportsDrones,
    targetReachable,
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
            ? model.reasoningLevels
                .map((level: unknown) => String(level ?? '').trim())
                .filter(Boolean)
            : [];
          return levels.length > 0
            ? levels.map((thinkingLevel: string) => ({ ...base, thinkingLevel }))
            : [{ ...base, thinkingLevel: String(model?.thinkingLevel ?? '').trim() || undefined }];
        })
        .filter((model: AssistantModelChoice) => Boolean(model.id));
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
        if (targetIdRef.current !== destinationId) return;
        setPendingApprovals((current) => current.filter((item) => item.id !== approval.id));
        await readChat(droneId, activeChat);
      })
      .catch((nextError: any) => setError(nextError?.message ?? String(nextError)))
      .finally(() => setApprovalBusyId(''));
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

  return (
    <View style={styles.screen}>
      <AppDrawer
        open={drawerOpen}
        navigationItems={navigationItems}
        showDrones
        drones={drawerDrones}
        droneSidebarOrder={droneSidebarOrder}
        activeDroneId={selected?.id ?? ''}
        activeChatName={chatName}
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
                onDrawerOpenChange(false);
                void openNewDroneScreen({ repoPath });
              }
            : undefined
        }
        onRetryDrones={() => void (targetReachable ? loadDrones() : mesh.refreshDevices())}
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
        {!targetReachable && targetSupportsDrones && !selected ? (
          <View style={styles.deviceOffline}>
            <View style={styles.deviceOfflineIcon}>
              <WifiOff color={colors.warning} size={28} strokeWidth={1.7} />
              <View style={styles.deviceOfflineIndicator} />
            </View>
            <Text style={styles.deviceOfflineTitle}>
              {activeTarget?.name ?? 'This device'} is offline
            </Text>
            <Text style={styles.deviceOfflineBody}>
              Drone Hub can’t reach this device. Make sure the app is running there and that both
              devices are connected to the internet or the same local network.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void mesh.refreshDevices()}
              style={({ pressed }) => [styles.deviceOfflineRetry, pressed && styles.chatTabPressed]}
            >
              <Text style={styles.deviceOfflineRetryText}>Retry connection</Text>
            </Pressable>
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
                  <Text style={styles.offlineChatNoticeTitle}>Device offline</Text>
                  <Text style={styles.offlineChatNoticeBody}>
                    This chat is readable. Sending will resume when it reconnects.
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
                {error ? <ErrorBanner message={error} /> : null}
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
                            const chatUnread =
                              !active && (selected.unreadChats ?? []).includes(chat);
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
                    {error || nativeThread?.error ? (
                      <View style={styles.chatError}>
                        <ErrorBanner message={error || String(nativeThread?.error ?? '')} />
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
                        linkedPullRequests={linkedPullRequests}
                        onLoadFullMessage={(message) => void loadFullChatMessage(message)}
                        fullMessageLoadingId={fullMessageBusyId}
                        onOpenFileReference={filePreview.open}
                        onLoadRunFileDiff={loadRunFileDiff}
                        onLoadRunFiles={loadRunFiles}
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
                      {pendingApprovals.map((approval) => (
                        <AssistantApprovalCard
                          key={approval.id}
                          approval={approval}
                          busy={approvalBusyId === approval.id}
                          disabled={!targetReachable}
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
                      reasoningLabel={chatReasoning}
                      sending={busy === 'prompt'}
                      running={running}
                      editable={targetReachable}
                      queueWhileRunning={targetReachable}
                      placeholder={targetReachable ? 'Ask the agent' : 'Device offline'}
                      hasAttachments={promptAttachments.length > 0}
                      onAddAttachment={addPromptAttachment}
                      attachmentActionsDisabled={!targetReachable || (phoneTarget && running)}
                      sendBlocked={
                        !targetReachable || (phoneTarget && running && promptAttachments.length > 0)
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
            draft={newDroneDraft}
            requestError={dronesLoading ? null : error}
            initialValues={newDroneDefaults ?? undefined}
            localDevice={phoneTarget}
            onDetectModels={detectCreateModels}
            onLoadRepoBranches={loadCreateRepoBranches}
            onLoadRepoPreferences={(repoPath) =>
              loadMobileDroneCreatePreferences(targetId, repoPath)
            }
            onRememberedDraftChange={setNewDroneDraft}
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
      <FilePreviewModal
        visible={filePreview.visible}
        preview={filePreview.preview}
        displayPath={filePreview.displayPath}
        line={filePreview.line}
        loading={filePreview.loading}
        error={filePreview.error}
        onClose={filePreview.close}
        onRetry={filePreview.retry}
      />
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
                selectedRef.current = null;
                setSelected(null);
                setChats([]);
                setTurns([]);
                setNativeMessages(null);
                setPendingPrompts([]);
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
  chatTabsFrame: {
    minHeight: 39,
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
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
  chatText: { flexShrink: 1, color: colors.secondary, fontSize: 10, fontWeight: '700' },
  chatTextActive: { color: colors.accent },
  chatUnreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
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
});
