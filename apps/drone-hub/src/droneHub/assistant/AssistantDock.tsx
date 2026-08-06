import React from 'react';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import { requestJson } from '../http';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import type { MarkdownTextMentionLink } from '../chat/MarkdownMessage';
import {
  AgentChatTranscript,
  ChangedFilesCard,
  ChatSurfaceComposer,
  EmptyState,
  useAgentChatSurfaceAdapter,
  usePinnedTranscriptScroll,
  type AgentChatTranscriptItem,
  type ChatComposerMenuAction,
  type ChatComposerContextConfig,
  type ChatSendContext,
  type ChatSendPayload,
  type DroneHubTask,
  type DroneHubTaskSpawnMode,
} from '../chat';
import { PendingTranscriptTurn } from '../chat/PendingTranscriptTurn';
import type { LinkedPullRequestContext } from '../chat/LinkedPullRequestCards';
import type { MarkdownFileReference } from '../chat/MarkdownMessage';
import { parseDroneHubDragData, useDroneHubActiveDrag } from '../app/drone-hub-dnd';
import { CodexConnectComposerNotice } from '../app/CodexConnectControl';
import { assignedDroneIdsFromData } from '../app/drone-hub-dnd-utils';
import { createCanvasChatNodeId } from '../app/app-config';
import { clientTimeZone } from '../app/client-time-zone';
import {
  beginLocalChatBusy,
  useDroneHubRuntimeStore,
  useLocalChatBusy,
} from '../app/use-drone-hub-runtime-store';
import {
  IconPencil,
  IconNetwork,
  IconSettings,
  IconShieldCheck,
  IconSpinner,
  IconWrench,
} from '../app/icons';
import { IconChevron, IconDrone, IconFile, IconFolder } from '../icons';
import { dispatchAssistantOpenDroneChat } from './open-drone-chat-event';
import { useBlipThreadSession } from './useBlipThreadSession';
import { latestActivityHasVisibleAssistantText } from './assistant-streaming-state';
import { AssistantThreadFilesView, selectDefaultArtifactPath } from './AssistantThreadFilesView';
import { AssistantWorkspaceAccessView } from './AssistantWorkspaceAccessView';
import {
  AssistantCompactionRow,
  AssistantCompactionWorkingRow,
  AssistantContextUsageIndicator,
} from './AssistantContextStatus';
import {
  AssistantSystemPromptModal,
  AssistantToolsPanel,
  AssistantWorkspacesPanel,
} from './AssistantSettingsPanels';
import {
  AssistantQueuedPromptRow,
  NativeAgentFailureCard,
  AssistantMessageRow,
  AssistantWorkingRow,
  AssistantRunActivity,
  ToolRunActivity,
} from './AssistantTranscript';
import { ApprovalCard } from './AssistantWorkflowCards';
import { buildNativeAgentComposerControls } from './native-agent-composer-controls';
import {
  resolveAssistantStartupPromptPresentation,
  type AssistantStartupPrompt,
} from './assistant-startup-prompt';
import { formatArtifactSize, formatUpdatedAt } from './assistant-formatters';
import {
  assistantHasEnabledMcpGroup,
  assistantMessageTimestampMs,
  assistantPromptHasVisibleUserMessage,
  assistantRequestRuns,
  assistantTranscriptHasErrorMessage,
  compactPreview,
  directAssistantRunTiming,
  isChatIdleToolName,
  lastAssistantContentBlock,
  latestThinkingText,
  messageDroneDetails,
  messageImageParts,
  messageText,
  messageVisibleText,
  normalizeAssistantWaitTargets,
  renderItemsFromMessages,
  summarizeWaitTargets,
  toolActivityTitle,
  toolCalls,
  toolDroneLookupKey,
  toolLabel,
  toolItemName,
  type AssistantMessageDroneSummary,
  type AssistantRenderItem,
  type AssistantToolCall,
  type AssistantWaitTargetLabel,
} from './assistant-message-model';
import type {
  AssistantAccessScope,
  AssistantApproval,
  AssistantArtifactFile,
  AssistantArtifactSummary,
  AssistantAttachmentPayload,
  AssistantBootstrapSnapshot,
  AssistantDefaultSettings,
  AssistantDroneNameMap,
  AssistantDroneReference,
  AssistantMessage,
  AssistantModelOption,
  AssistantProviderId,
  AssistantScopeDraft,
  AssistantScopeDrone,
  AssistantScopeMode,
  AssistantScopeUpdateResult,
  AssistantSnapshot,
  AssistantSystemPromptSettings,
  AssistantThread,
  AssistantThreadStatus,
  AssistantThreadSystemPromptSettings,
  AssistantToolSummary,
  AssistantWorkspaceSummary,
  PendingAssistantScopeSave,
} from './assistant-types';
import { DroneHubPermissionsView } from '../app/DroneHubPermissionsView';
const ASSISTANT_FILES_OPEN_STORAGE_KEY = 'droneHub.assistant.filesOpen';

const EMPTY_ASSISTANT_MODEL_OPTIONS: AssistantModelOption[] = [];
const EMPTY_ASSISTANT_TOOL_SUMMARIES: AssistantToolSummary[] = [];
const EMPTY_ASSISTANT_WORKSPACES: AssistantWorkspaceSummary[] = [];

function readInitialFilesOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ASSISTANT_FILES_OPEN_STORAGE_KEY) === '1';
}

function assistantScopeSyncKey(
  readMode: AssistantScopeMode,
  writeMode: AssistantScopeMode,
  executeMode: AssistantScopeMode,
  droneIds: string[],
): string {
  return `${readMode}\u0000${writeMode}\u0000${executeMode}\u0000${droneIds.join('\u0000')}`;
}

function cleanAssistantScopeIds(ids: unknown[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
}

function cleanAssistantScopeDrones(drones: AssistantScopeDrone[]): AssistantScopeDrone[] {
  const byId = new Map<string, AssistantScopeDrone>();
  for (const drone of drones) {
    const id = String(drone.id ?? '').trim();
    if (!id) continue;
    byId.set(id, { id, name: String(drone.name ?? id).trim() || id });
  }
  return Array.from(byId.values());
}

function cleanAssistantDroneReferences(
  drones: AssistantDroneReference[],
): AssistantDroneReference[] {
  return cleanAssistantScopeDrones(drones).map((drone) => ({ id: drone.id, name: drone.name }));
}

function assistantDroneReferenceBlock(drones: AssistantDroneReference[]): string {
  const clean = cleanAssistantDroneReferences(drones);
  if (clean.length === 0) return '';
  return [
    'Referenced drones:',
    ...clean.map((drone) => `- ${drone.name || drone.id} (id: ${drone.id})`),
  ].join('\n');
}

function appendAssistantDroneReferences(
  promptRaw: string,
  drones: AssistantDroneReference[],
): string {
  const prompt = String(promptRaw ?? '').trim();
  const referenceBlock = assistantDroneReferenceBlock(drones);
  if (!referenceBlock) return prompt;
  return prompt ? `${prompt}\n\n${referenceBlock}` : referenceBlock;
}

function assistantScopeDroneIds(
  readMode: AssistantScopeMode,
  writeMode: AssistantScopeMode,
  executeMode: AssistantScopeMode,
  drones: AssistantScopeDrone[],
): string[] {
  if (readMode !== 'selected' && writeMode !== 'selected' && executeMode !== 'selected') return [];
  return cleanAssistantScopeDrones(drones).map((drone) => drone.id);
}

function assistantDroneDropTargetFromDragData(
  data: ReturnType<typeof parseDroneHubDragData>,
): { ids: string[]; fallbackLabel: string } | null {
  if (!data) return null;
  if (data.type === 'sidebar-drone') {
    return {
      ids: data.droneIds,
      fallbackLabel: data.droneIds.length === 1 ? data.label : '',
    };
  }
  if (data.type === 'sidebar-group') {
    return { ids: data.droneIds, fallbackLabel: '' };
  }
  if (data.type === 'sidebar-chat') {
    return {
      ids: [data.droneId],
      fallbackLabel: data.label.split('/')[0]?.trim() || '',
    };
  }
  return null;
}

function assistantScopeKeyFromScope(scope: AssistantAccessScope): string {
  const readMode: AssistantScopeMode = scope.readMode === 'selected' ? 'selected' : 'all';
  const writeMode: AssistantScopeMode = scope.writeMode === 'selected' ? 'selected' : 'all';
  const executeMode: AssistantScopeMode = scope.executeMode === 'selected' ? 'selected' : 'all';
  const ids =
    readMode === 'selected' || writeMode === 'selected' || executeMode === 'selected'
      ? cleanAssistantScopeIds(scope.droneIds)
      : [];
  return assistantScopeSyncKey(readMode, writeMode, executeMode, ids);
}

function assistantScopeUpdatedAtMs(scope: AssistantAccessScope | null | undefined): number {
  const ms = Date.parse(String(scope?.updatedAt ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

async function readNdjson(response: Response, onEvent: (event: any) => void): Promise<void> {
  if (!response.ok || !response.body) {
    let data: any = null;
    try {
      data = await response.json();
    } catch {
      // ignore
    }
    throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
      newline = buffer.indexOf('\n');
    }
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest));
}

export type NativeChatBinding = {
  droneId: string;
  chatName: string;
};

export type AssistantMessageFeatures = {
  onSpawnTask: (
    mode: DroneHubTaskSpawnMode,
    task: DroneHubTask,
  ) => Promise<{ ok: boolean; error?: string | null }>;
  linkedPullRequestContext: LinkedPullRequestContext;
  droneId: string;
  droneHomePath: string;
  onOpenFileReference: (ref: MarkdownFileReference) => void;
  onOpenLink: (href: string) => boolean;
};

export function AssistantDock({
  nativeChat,
  messageFeatures,
  onHistoryChange,
  startupPrompt,
  onStartupPromptReconciled,
  onSendPromptInNewChat,
  onCreateQueuedNewChatNow,
  focusedNewChatActionId = '',
  onCreateNewChatAutoFocusHandled,
  promotingNewChatActionById = {},
  promoteNewChatActionErrorById = {},
  composerTopAction,
}: {
  nativeChat: NativeChatBinding;
  messageFeatures: AssistantMessageFeatures;
  onHistoryChange?: (hasHistory: boolean) => void;
  startupPrompt?: AssistantStartupPrompt | null;
  onStartupPromptReconciled?: () => void;
  onSendPromptInNewChat?: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onCreateQueuedNewChatNow?: (promptId: string) => Promise<void>;
  focusedNewChatActionId?: string;
  onCreateNewChatAutoFocusHandled?: (promptId: string) => void;
  promotingNewChatActionById?: Record<string, true>;
  promoteNewChatActionErrorById?: Record<string, string>;
  composerTopAction?: React.ReactNode;
}) {
  const chatSurfaceAdapter = useAgentChatSurfaceAdapter();
  const nativeDroneId = nativeChat.droneId;
  const nativeChatName = nativeChat.chatName;
  const nativeChatNodeId = createCanvasChatNodeId(nativeDroneId, nativeChatName);
  const setApprovalRequiredByChatNodeId = useDroneHubRuntimeStore(
    (state) => state.setApprovalRequiredByChatNodeId,
  );
  const [snapshot, setSnapshot] = React.useState<AssistantSnapshot | null>(null);
  const [bootstrapHistory, setBootstrapHistory] = React.useState<
    AssistantBootstrapSnapshot['initialHistory'] | null
  >(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [referencedDrones, setReferencedDrones] = React.useState<AssistantDroneReference[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [filesOpen, setFilesOpen] = React.useState(readInitialFilesOpen);
  const [artifactFiles, setArtifactFiles] = React.useState<AssistantArtifactSummary[]>([]);
  const [selectedArtifactPath, setSelectedArtifactPath] = React.useState<string | null>(null);
  const [selectedArtifactFile, setSelectedArtifactFile] =
    React.useState<AssistantArtifactFile | null>(null);
  const [artifactsLoading, setArtifactsLoading] = React.useState(false);
  const [artifactsError, setArtifactsError] = React.useState<string | null>(null);
  const [scopeReadMode, setScopeReadMode] = React.useState<AssistantScopeMode>('all');
  const [scopeWriteMode, setScopeWriteMode] = React.useState<AssistantScopeMode>('all');
  const [scopeExecuteMode, setScopeExecuteMode] = React.useState<AssistantScopeMode>('all');
  const [scopeDrones, setScopeDrones] = React.useState<AssistantScopeDrone[]>([]);
  const [scopeSyncBusy, setScopeSyncBusy] = React.useState(false);
  const [scopeSyncError, setScopeSyncError] = React.useState<string | null>(null);
  const [droneNameById, setDroneNameById] = React.useState<AssistantDroneNameMap>({});
  const [approvalBusyId, setApprovalBusyId] = React.useState<string | null>(null);
  const [queuedPromptBusyId, setQueuedPromptBusyId] = React.useState<string | null>(null);
  const [assistantStopBusy, setAssistantStopBusy] = React.useState(false);
  const [assistantRetryBusy, setAssistantRetryBusy] = React.useState(false);
  const [defaultModelBusy, setDefaultModelBusy] = React.useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = React.useState(false);
  const [workspacesPanelOpen, setWorkspacesPanelOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [workspaceAccessOpen, setWorkspaceAccessOpen] = React.useState(false);
  const [droneHubPermissionsOpen, setDroneHubPermissionsOpen] = React.useState(false);
  const [enabledToolDraftNames, setEnabledToolDraftNames] = React.useState<string[]>([]);
  const [enabledWorkspaceDraftIds, setEnabledWorkspaceDraftIds] = React.useState<string[]>([]);
  const [defaultEnabledToolDraftNames, setDefaultEnabledToolDraftNames] = React.useState<string[]>(
    [],
  );
  const [defaultToolsBusy, setDefaultToolsBusy] = React.useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = React.useState(false);
  const [systemPromptMode, setSystemPromptMode] = React.useState<'thread' | 'global'>('thread');
  const [systemPromptSettings, setSystemPromptSettings] =
    React.useState<AssistantSystemPromptSettings | null>(null);
  const [systemPromptDraft, setSystemPromptDraft] = React.useState('');
  const [threadSystemPromptSettings, setThreadSystemPromptSettings] =
    React.useState<AssistantThreadSystemPromptSettings | null>(null);
  const [threadSystemPromptDraft, setThreadSystemPromptDraft] = React.useState('');
  const [systemPromptLoading, setSystemPromptLoading] = React.useState(false);
  const [systemPromptSaving, setSystemPromptSaving] = React.useState(false);
  const [threadSystemPromptSaving, setThreadSystemPromptSaving] = React.useState(false);
  const [promoteSystemPromptSaving, setPromoteSystemPromptSaving] = React.useState(false);
  const [systemPromptError, setSystemPromptError] = React.useState<string | null>(null);
  const [systemPromptNotice, setSystemPromptNotice] = React.useState<string | null>(null);
  const activeDroneHubDrag = useDroneHubActiveDrag();
  const referencedDronesRef = React.useRef<AssistantDroneReference[]>([]);
  const refocusInputWhenIdleRef = React.useRef(false);
  const activeThreadIdRef = React.useRef('');
  const currentScopeKeyRef = React.useRef('');
  const currentScopeDraftRef = React.useRef<AssistantScopeDraft>({
    readMode: 'all',
    writeMode: 'all',
    executeMode: 'all',
    drones: [],
  });
  const persistedScopeDraftRef = React.useRef<AssistantScopeDraft>({
    readMode: 'all',
    writeMode: 'all',
    executeMode: 'all',
    drones: [],
  });
  const lastSyncedScopeKeyRef = React.useRef('');
  const lastSyncedScopeUpdatedAtMsRef = React.useRef(0);
  const scopeSaveRequestIdRef = React.useRef(0);
  const scopeSyncPromiseRef = React.useRef<PendingAssistantScopeSave | null>(null);
  const queuedScopeSaveRef = React.useRef<{
    readMode: AssistantScopeMode;
    writeMode: AssistantScopeMode;
    executeMode: AssistantScopeMode;
    droneIds: string[];
    key: string;
  } | null>(null);
  const updateThreadRequestRef = React.useRef(0);
  const snapshotRequestSeqRef = React.useRef(0);
  const enabledToolDraftNamesRef = React.useRef<string[]>([]);
  const enabledWorkspaceDraftIdsRef = React.useRef<string[]>([]);
  const defaultEnabledToolDraftNamesRef = React.useRef<string[]>([]);
  const nativeChangeRefreshRef = React.useRef<() => void>(() => {});
  const { isOver: scopeDropIsOver, setNodeRef: setScopeDropNodeRef } = useDroppable({
    id: 'assistant-drone-scope-drop',
    data: { type: 'assistant-drone-scope-drop' },
  });
  const scopeDropActive =
    scopeDropIsOver && assignedDroneIdsFromData(activeDroneHubDrag).length > 0;

  const activeThread = snapshot?.threads[0] ?? null;
  const activeThreadId = activeThread?.id ?? '';
  activeThreadIdRef.current = activeThreadId;
  React.useEffect(() => {
    scopeSaveRequestIdRef.current += 1;
    scopeSyncPromiseRef.current = null;
    queuedScopeSaveRef.current = null;
    currentScopeKeyRef.current = '';
    lastSyncedScopeKeyRef.current = '';
    lastSyncedScopeUpdatedAtMsRef.current = 0;
    const emptyDraft: AssistantScopeDraft = {
      readMode: 'all',
      writeMode: 'all',
      executeMode: 'all',
      drones: [],
    };
    currentScopeDraftRef.current = emptyDraft;
    persistedScopeDraftRef.current = emptyDraft;
    setScopeReadMode('all');
    setScopeWriteMode('all');
    setScopeExecuteMode('all');
    setScopeDrones([]);
    setScopeSyncBusy(false);
    setScopeSyncError(null);
    setDroneHubPermissionsOpen(false);
  }, [activeThreadId]);
  const autoApprove = Boolean(activeThread?.autoApprove);
  const blipSession = useBlipThreadSession({
    threadId: activeThreadId,
    enabled: Boolean(activeThread),
    onNativeChange: () => {
      nativeChangeRefreshRef.current();
    },
    initialHistory: bootstrapHistory,
  });
  const startupPromptPresentation = React.useMemo(
    () =>
      resolveAssistantStartupPromptPresentation({
        startupPrompt,
        messages: blipSession.messages as AssistantMessage[],
        queuedPrompts: activeThread?.queuedPrompts ?? [],
      }),
    [activeThread?.queuedPrompts, blipSession.messages, startupPrompt],
  );
  React.useEffect(() => {
    if (!startupPrompt) return;
    if (!startupPromptPresentation.reconciled && !error) return;
    onStartupPromptReconciled?.();
  }, [error, onStartupPromptReconciled, startupPrompt, startupPromptPresentation.reconciled]);
  const hasHistory =
    blipSession.messages.length > 0 ||
    Boolean(activeThread?.queuedPrompts?.length) ||
    startupPromptPresentation.showOptimistic;
  React.useEffect(() => {
    if (hasHistory) onHistoryChange?.(true);
  }, [hasHistory, onHistoryChange]);
  React.useEffect(() => {
    if (activeThreadId) void blipSession.refreshHistory({ quiet: true });
  }, [activeThread?.updatedAt, activeThreadId, blipSession.refreshHistory]);
  const activeAccessScope: AssistantAccessScope | null =
    activeThread?.accessScope ?? snapshot?.accessScope ?? null;
  const activeAccessScopeDroneIdsKey = activeAccessScope?.droneIds?.join('\u0000') ?? '';
  const activePendingApprovals = React.useMemo(
    () =>
      (snapshot?.pendingApprovals ?? []).filter(
        (approval) => approval.threadId === activeThread?.id && approval.status === 'pending',
      ),
    [activeThread?.id, snapshot?.pendingApprovals],
  );
  const activeApprovalStartedAt = React.useMemo(() => {
    const timestamps = activePendingApprovals
      .map((approval) => Date.parse(approval.createdAt))
      .filter((timestamp) => Number.isFinite(timestamp));
    return timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  }, [activePendingApprovals]);
  React.useEffect(() => {
    if (!nativeChatNodeId) return;
    const approvalRequired = activePendingApprovals.length > 0;
    setApprovalRequiredByChatNodeId((current) => {
      if (Boolean(current[nativeChatNodeId]) === approvalRequired) return current;
      if (approvalRequired) return { ...current, [nativeChatNodeId]: true };
      const next = { ...current };
      delete next[nativeChatNodeId];
      return next;
    });
  }, [activePendingApprovals.length, nativeChatNodeId, setApprovalRequiredByChatNodeId]);
  const visibleQueuedPrompts = React.useMemo(
    () =>
      (activeThread?.queuedPrompts ?? []).filter(
        (prompt) =>
          (prompt.id !== startupPromptPresentation.matchingQueuedPrompt?.id ||
            !startupPromptPresentation.showOptimistic) &&
          (prompt.status !== 'running' ||
            !assistantPromptHasVisibleUserMessage(blipSession.messages, prompt)),
      ),
    [activeThread?.queuedPrompts, blipSession.messages, startupPromptPresentation],
  );
  const running =
    blipSession.running ||
    activeThread?.status === 'running' ||
    activeThread?.status === 'waiting_for_approval';
  useLocalChatBusy(nativeChatNodeId, running);
  const transcriptContentVersion = React.useMemo(
    () => [
      blipSession.messages,
      activeThread?.queuedPrompts,
      snapshot?.pendingApprovals,
      running,
      error,
      blipSession.runError,
      blipSession.historyError,
      blipSession.compactionInProgress,
    ],
    [
      activeThread?.queuedPrompts,
      blipSession.historyError,
      blipSession.compactionInProgress,
      blipSession.messages,
      blipSession.runError,
      error,
      running,
      snapshot?.pendingApprovals,
    ],
  );
  const {
    bindContentRef: bindScrollContentRef,
    bindScrollRef,
    preserveScrollOnPrepend,
    scrollRef,
    scrollToBottom: scrollAssistantToBottom,
  } = usePinnedTranscriptScroll({
    contextKey: `${nativeDroneId}:${nativeChatName}:${activeThreadId}`,
    contentVersion: transcriptContentVersion,
    enabled: !filesOpen,
  });
  const loadOlderMessages = React.useCallback(async () => {
    await preserveScrollOnPrepend(() => blipSession.loadOlder());
  }, [blipSession.loadOlder, preserveScrollOnPrepend]);
  const olderHistoryTriggerArmedRef = React.useRef(true);
  React.useEffect(() => {
    olderHistoryTriggerArmedRef.current = true;
  }, [activeThreadId]);
  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node || !blipSession.hasOlder) return;
    const loadAtTop = () => {
      if (node.scrollTop > 96) {
        olderHistoryTriggerArmedRef.current = true;
        return;
      }
      if (node.scrollTop > 40 || !olderHistoryTriggerArmedRef.current || blipSession.olderLoading) {
        return;
      }
      olderHistoryTriggerArmedRef.current = false;
      void loadOlderMessages();
    };
    node.addEventListener('scroll', loadAtTop, { passive: true });
    return () => node.removeEventListener('scroll', loadAtTop);
  }, [blipSession.hasOlder, blipSession.olderLoading, loadOlderMessages, scrollRef]);
  const droneMentionLinks = React.useMemo<MarkdownTextMentionLink[]>(() => {
    const nameCounts = new Map<string, number>();
    for (const name of Object.values(droneNameById)) {
      const label = String(name ?? '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    return Object.entries(droneNameById)
      .map(([droneId, name]) => ({
        droneId: String(droneId ?? '').trim(),
        name: String(name ?? '').trim(),
      }))
      .filter(({ droneId, name }) =>
        Boolean(droneId && name && nameCounts.get(name.toLowerCase()) === 1),
      )
      .map(({ droneId, name }) => ({
        key: droneId,
        label: name,
        title: `Ctrl-click to open ${name}`,
      }));
  }, [droneNameById]);
  const openDroneMention = React.useCallback(
    (mention: MarkdownTextMentionLink) => {
      const droneId = String(mention.key ?? '').trim();
      if (!droneId || !droneNameById[droneId]) return;
      dispatchAssistantOpenDroneChat(droneId, 'default');
    },
    [droneNameById],
  );
  const droneReferenceControlsLocked = !activeThread;
  const { isOver: droneReferenceDropIsOver, setNodeRef: setDroneReferenceDropNodeRef } =
    useDroppable({
      id: 'assistant-message-drone-reference-drop',
      data: { type: 'assistant-message-drone-reference-drop' },
      disabled: droneReferenceControlsLocked,
    });
  const droneReferenceDropActive =
    droneReferenceDropIsOver && assignedDroneIdsFromData(activeDroneHubDrag).length > 0;
  const visibleMessages = blipSession.messages as AssistantMessage[];
  const visibleItems = React.useMemo(() => {
    return renderItemsFromMessages(visibleMessages);
  }, [visibleMessages]);
  const requestRuns = React.useMemo(() => assistantRequestRuns(visibleItems), [visibleItems]);
  const latestActivityItemKey = React.useMemo(() => {
    return visibleItems[visibleItems.length - 1]?.key ?? '';
  }, [visibleItems]);
  const latestUserItemIndex = React.useMemo(() => {
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      if (item?.type !== 'message' || item.message.role !== 'user') continue;
      return index;
    }
    return -1;
  }, [visibleItems]);
  const hasActiveToolRun = React.useMemo(() => {
    return visibleItems.some(
      (item, index) =>
        index > latestUserItemIndex && (item.type === 'tool' || item.type === 'toolGroup'),
    );
  }, [latestUserItemIndex, visibleItems]);
  const latestUserStartedAt = React.useMemo(() => {
    const latestUser = visibleItems[latestUserItemIndex];
    return latestUser?.type === 'message'
      ? assistantMessageTimestampMs(latestUser.message)
      : undefined;
  }, [latestUserItemIndex, visibleItems]);
  const latestActivityShowsReasoning = React.useMemo(() => {
    if (!running || !latestActivityItemKey) return false;
    const item = visibleItems.find((candidate) => candidate.key === latestActivityItemKey);
    if (item?.type !== 'message' || item.message.role !== 'assistant') return false;
    if (lastAssistantContentBlock(item.message)?.type !== 'thinking') return false;
    return Boolean(latestThinkingText(item.message).trim());
  }, [latestActivityItemKey, running, visibleItems]);
  const showWorking =
    running &&
    !startupPromptPresentation.showOptimistic &&
    activePendingApprovals.length === 0 &&
    !hasActiveToolRun &&
    !latestActivityShowsReasoning &&
    !latestActivityHasVisibleAssistantText(visibleItems);
  const toolDroneKey = React.useMemo(() => toolDroneLookupKey(visibleItems), [visibleItems]);

  const applySnapshot = React.useCallback((next: AssistantSnapshot) => setSnapshot(next), []);

  const beginSnapshotMutation = React.useCallback(() => {
    snapshotRequestSeqRef.current += 1;
    return snapshotRequestSeqRef.current;
  }, []);

  const snapshotMutationCurrent = React.useCallback(
    (requestSeq: number) => snapshotRequestSeqRef.current === requestSeq,
    [],
  );

  const refresh = React.useCallback(
    async (options: { silent?: boolean; includeHistory?: boolean } = {}) => {
      if (!options.silent) {
        setLoading(true);
        setError(null);
      }
      const requestSeq = snapshotRequestSeqRef.current;
      try {
        const next = await requestJson<AssistantBootstrapSnapshot>(
          `/api/drones/${encodeURIComponent(nativeDroneId)}/chats/${encodeURIComponent(nativeChatName)}/native${
            options.includeHistory ? '?includeHistory=1' : ''
          }`,
          { method: 'POST' },
        );
        if (snapshotRequestSeqRef.current !== requestSeq) return;
        const nativeChatId = String(next.nativeChatId ?? next.chatId ?? '').trim();
        activeThreadIdRef.current = nativeChatId;
        if (options.includeHistory) {
          setBootstrapHistory(
            next.initialHistory?.threadId === nativeChatId ? next.initialHistory : null,
          );
        }
        applySnapshot(next);
      } catch (err: any) {
        if (!options.silent) setError(err?.message ?? String(err));
      } finally {
        if (!options.silent) setLoading(false);
      }
    },
    [applySnapshot, nativeChatName, nativeDroneId],
  );
  nativeChangeRefreshRef.current = () => {
    void refresh({ silent: true });
  };

  React.useEffect(() => {
    referencedDronesRef.current = referencedDrones;
  }, [referencedDrones]);

  React.useEffect(() => {
    setAttachmentError(null);
    setReferencedDrones([]);
  }, [activeThreadId]);

  const loadSystemPromptSettings = React.useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    setSystemPromptLoading(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const [data, threadData] = await Promise.all([
        requestJson<AssistantSystemPromptSettings>('/api/assistant/system-prompt'),
        threadId
          ? requestJson<AssistantThreadSystemPromptSettings>(
              `/api/assistant/threads/${encodeURIComponent(threadId)}/system-prompt`,
            )
          : Promise.resolve(null),
      ]);
      setSystemPromptSettings(data);
      setSystemPromptDraft(data.assistantSystemPrompt.prompt);
      setThreadSystemPromptSettings(threadData);
      setThreadSystemPromptDraft(threadData?.threadSystemPrompt.prompt ?? '');
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setSystemPromptLoading(false);
    }
  }, []);

  const openSystemPromptEditor = React.useCallback(() => {
    setDroneHubPermissionsOpen(false);
    setSystemPromptMode('thread');
    setSystemPromptOpen(true);
    void loadSystemPromptSettings();
  }, [loadSystemPromptSettings]);

  const saveSystemPromptSettings = React.useCallback(async () => {
    setSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await requestJson<AssistantSystemPromptSettings>(
        '/api/assistant/system-prompt',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: systemPromptDraft }),
        },
      );
      setSystemPromptSettings(data);
      setSystemPromptDraft(data.assistantSystemPrompt.prompt);
      setThreadSystemPromptSettings((prev) => {
        if (!prev) return prev;
        const savedSettings = data.assistantSystemPrompt;
        const promptSource =
          prev.threadSystemPrompt.prompt === savedSettings.prompt
            ? savedSettings.promptSource === 'default'
              ? 'default'
              : 'global'
            : 'thread';
        return {
          ...prev,
          threadSystemPrompt: {
            ...prev.threadSystemPrompt,
            promptSource,
            globalPrompt: savedSettings.prompt,
            globalPromptSource: savedSettings.promptSource,
            updatedAt: promptSource === 'thread' ? prev.threadSystemPrompt.updatedAt : null,
          },
        };
      });
      setSystemPromptNotice('Saved. New Built-in chats will use this prompt.');
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setSystemPromptSaving(false);
    }
  }, [systemPromptDraft]);

  const saveThreadSystemPromptSettings = React.useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;
    setThreadSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await requestJson<AssistantThreadSystemPromptSettings>(
        `/api/assistant/threads/${encodeURIComponent(threadId)}/system-prompt`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: threadSystemPromptDraft }),
        },
      );
      setThreadSystemPromptSettings(data);
      setThreadSystemPromptDraft(data.threadSystemPrompt.prompt);
      setSystemPromptNotice('Saved. Only this Built-in chat will use this prompt.');
      void refresh();
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setThreadSystemPromptSaving(false);
    }
  }, [refresh, threadSystemPromptDraft]);

  const promoteThreadSystemPrompt = React.useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;
    const confirmed = window.confirm(
      'Promote this chat system prompt to the matching global prompt for new Built-in chats? Existing chats keep their own prompts.',
    );
    if (!confirmed) return;
    setPromoteSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await requestJson<AssistantSystemPromptSettings>(
        `/api/assistant/threads/${encodeURIComponent(threadId)}/promote-system-prompt`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: threadSystemPromptDraft }),
        },
      );
      setSystemPromptSettings(data);
      setSystemPromptDraft(data.assistantSystemPrompt.prompt);
      await loadSystemPromptSettings();
      setSystemPromptNotice('Promoted. New Built-in chats will use this prompt.');
      void refresh();
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setPromoteSystemPromptSaving(false);
    }
  }, [loadSystemPromptSettings, refresh, threadSystemPromptDraft]);

  React.useEffect(() => {
    activeThreadIdRef.current = '';
    setSnapshot(null);
    setBootstrapHistory(null);
    void refresh({ includeHistory: true });
  }, [nativeChatName, nativeDroneId, refresh]);

  React.useEffect(() => {
    let cancelled = false;
    void requestJson<{ ok: true; drones?: Array<{ id?: string; name?: string }> }>('/api/drones')
      .then((data) => {
        if (cancelled) return;
        const next: AssistantDroneNameMap = {};
        for (const drone of Array.isArray(data?.drones) ? data.drones : []) {
          const id = String(drone?.id ?? '').trim();
          const name = String(drone?.name ?? '').trim();
          if (id && name) next[id] = name;
        }
        setDroneNameById(next);
      })
      .catch(() => {
        // Tool rows can still show the tool-provided target labels.
      });
    return () => {
      cancelled = true;
    };
  }, [toolDroneKey]);

  React.useEffect(() => {
    if (!systemPromptOpen) return;
    void loadSystemPromptSettings();
  }, [activeThreadId, loadSystemPromptSettings, systemPromptOpen]);

  const resolveScopeDroneNames = React.useCallback(
    async (ids: string[], fallbackLabel?: string): Promise<AssistantScopeDrone[]> => {
      const cleanIds = Array.from(
        new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)),
      );
      if (cleanIds.length === 0) return [];
      try {
        const data = await requestJson<{
          ok: true;
          drones?: Array<{ id?: string; name?: string }>;
        }>('/api/drones');
        const nameEntries: Array<[string, string]> = (
          Array.isArray(data?.drones) ? data.drones : []
        )
          .map((drone): [string, string] => [
            String(drone?.id ?? '').trim(),
            String(drone?.name ?? '').trim(),
          ])
          .filter(([id]) => Boolean(id));
        const nameById = new Map<string, string>(nameEntries);
        return cleanIds.map((id) => ({
          id,
          name: nameById.get(id) || (cleanIds.length === 1 ? fallbackLabel || id : id),
        }));
      } catch {
        return cleanIds.map((id) => ({
          id,
          name: cleanIds.length === 1 ? fallbackLabel || id : id,
        }));
      }
    },
    [],
  );

  React.useEffect(() => {
    const scope = activeAccessScope;
    if (!scope) return;
    let cancelled = false;
    const ids = cleanAssistantScopeIds(Array.isArray(scope.droneIds) ? scope.droneIds : []);
    const readMode: AssistantScopeMode = scope.readMode === 'selected' ? 'selected' : 'all';
    const writeMode: AssistantScopeMode = scope.writeMode === 'selected' ? 'selected' : 'all';
    const executeMode: AssistantScopeMode = scope.executeMode === 'selected' ? 'selected' : 'all';
    const incomingKey = assistantScopeKeyFromScope(scope);
    const incomingUpdatedAtMs = assistantScopeUpdatedAtMs(scope);
    const pending = scopeSyncPromiseRef.current;
    if (pending && pending.threadId === activeThreadId && incomingKey !== pending.key) {
      return;
    }
    if (
      !pending &&
      incomingUpdatedAtMs > 0 &&
      lastSyncedScopeUpdatedAtMsRef.current > 0 &&
      incomingUpdatedAtMs < lastSyncedScopeUpdatedAtMsRef.current
    ) {
      return;
    }
    lastSyncedScopeKeyRef.current = incomingKey;
    currentScopeKeyRef.current = incomingKey;
    lastSyncedScopeUpdatedAtMsRef.current = incomingUpdatedAtMs;
    setScopeReadMode(readMode);
    setScopeWriteMode(writeMode);
    setScopeExecuteMode(executeMode);
    const incomingDraft: AssistantScopeDraft = {
      readMode,
      writeMode,
      executeMode,
      drones: ids.map((id) => ({ id, name: id })),
    };
    currentScopeDraftRef.current = incomingDraft;
    persistedScopeDraftRef.current = incomingDraft;
    if (ids.length === 0) {
      setScopeDrones([]);
      return;
    }
    void resolveScopeDroneNames(ids).then((drones) => {
      if (cancelled) return;
      setScopeDrones(drones);
      if (currentScopeKeyRef.current === incomingKey) {
        const resolvedDraft: AssistantScopeDraft = {
          readMode,
          writeMode,
          executeMode,
          drones,
        };
        currentScopeDraftRef.current = resolvedDraft;
        persistedScopeDraftRef.current = resolvedDraft;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeAccessScope?.readMode,
    activeAccessScope?.writeMode,
    activeAccessScope?.executeMode,
    activeAccessScope?.updatedAt,
    activeAccessScopeDroneIdsKey,
    resolveScopeDroneNames,
    snapshot?.chatId,
  ]);

  const saveScopeDraft = React.useCallback(
    async (draft: AssistantScopeDraft): Promise<boolean> => {
      const readMode = draft.readMode === 'selected' ? 'selected' : 'all';
      const writeMode = draft.writeMode === 'selected' ? 'selected' : 'all';
      const executeMode = draft.executeMode === 'selected' ? 'selected' : 'all';
      const cleanDrones = cleanAssistantScopeDrones(draft.drones);
      const visibleDrones =
        readMode === 'selected' || writeMode === 'selected' || executeMode === 'selected'
          ? cleanDrones
          : [];
      const scopedDroneIds = assistantScopeDroneIds(
        readMode,
        writeMode,
        executeMode,
        visibleDrones,
      );
      const syncKey = assistantScopeSyncKey(readMode, writeMode, executeMode, scopedDroneIds);
      currentScopeKeyRef.current = syncKey;
      currentScopeDraftRef.current = {
        readMode,
        writeMode,
        executeMode,
        drones: visibleDrones,
      };
      setScopeReadMode(readMode);
      setScopeWriteMode(writeMode);
      setScopeExecuteMode(executeMode);
      setScopeDrones(visibleDrones);
      setScopeSyncError(null);
      if (!activeThread) return true;
      queuedScopeSaveRef.current = {
        readMode,
        writeMode,
        executeMode,
        droneIds: scopedDroneIds,
        key: syncKey,
      };
      if (lastSyncedScopeKeyRef.current === syncKey && !scopeSyncPromiseRef.current) {
        queuedScopeSaveRef.current = null;
        return true;
      }
      if (scopeSyncPromiseRef.current && scopeSyncPromiseRef.current.threadId !== activeThread.id) {
        scopeSaveRequestIdRef.current += 1;
        scopeSyncPromiseRef.current = null;
      }
      if (scopeSyncPromiseRef.current) {
        scopeSyncPromiseRef.current.key = syncKey;
        return await scopeSyncPromiseRef.current.promise;
      }
      const requestId = scopeSaveRequestIdRef.current + 1;
      scopeSaveRequestIdRef.current = requestId;
      const threadId = activeThread.id;
      setScopeSyncBusy(true);
      const promise = (async () => {
        while (queuedScopeSaveRef.current) {
          const next = queuedScopeSaveRef.current;
          queuedScopeSaveRef.current = null;
          if (lastSyncedScopeKeyRef.current === next.key) continue;
          try {
            const data = await requestJson<AssistantScopeUpdateResult>('/api/assistant/scope', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                threadId,
                readMode: next.readMode,
                writeMode: next.writeMode,
                executeMode: next.executeMode,
                droneIds: next.droneIds,
              }),
            });
            if (scopeSaveRequestIdRef.current !== requestId) return true;
            const savedScope = data.accessScope ?? {
              readMode: next.readMode,
              writeMode: next.writeMode,
              executeMode: next.executeMode,
              droneIds: next.droneIds,
              updatedAt: new Date().toISOString(),
            };
            lastSyncedScopeKeyRef.current = assistantScopeKeyFromScope(savedScope);
            lastSyncedScopeUpdatedAtMsRef.current = assistantScopeUpdatedAtMs(savedScope);
            const nameById = new Map(
              currentScopeDraftRef.current.drones.map((drone) => [drone.id, drone.name]),
            );
            persistedScopeDraftRef.current = {
              readMode: savedScope.readMode === 'selected' ? 'selected' : 'all',
              writeMode: savedScope.writeMode === 'selected' ? 'selected' : 'all',
              executeMode: savedScope.executeMode === 'selected' ? 'selected' : 'all',
              drones: cleanAssistantScopeIds(savedScope.droneIds).map((id) => ({
                id,
                name: nameById.get(id) || id,
              })),
            };
          } catch (err: any) {
            if (scopeSaveRequestIdRef.current === requestId) {
              queuedScopeSaveRef.current = null;
              const persisted = persistedScopeDraftRef.current;
              currentScopeDraftRef.current = persisted;
              currentScopeKeyRef.current = assistantScopeSyncKey(
                persisted.readMode,
                persisted.writeMode,
                persisted.executeMode,
                assistantScopeDroneIds(
                  persisted.readMode,
                  persisted.writeMode,
                  persisted.executeMode,
                  persisted.drones,
                ),
              );
              setScopeReadMode(persisted.readMode);
              setScopeWriteMode(persisted.writeMode);
              setScopeExecuteMode(persisted.executeMode);
              setScopeDrones(persisted.drones);
              setScopeSyncError(err?.message ?? String(err));
            }
            return false;
          }
        }
        return true;
      })().finally(() => {
        if (scopeSyncPromiseRef.current?.requestId === requestId) {
          scopeSyncPromiseRef.current = null;
          setScopeSyncBusy(false);
        }
      });
      scopeSyncPromiseRef.current = { requestId, threadId, key: syncKey, promise };
      return await promise;
    },
    [activeThread],
  );

  const waitForScopeSave = React.useCallback(async (): Promise<boolean> => {
    if (scopeSyncPromiseRef.current && !(await scopeSyncPromiseRef.current.promise)) return false;
    if (
      currentScopeKeyRef.current &&
      lastSyncedScopeKeyRef.current !== currentScopeKeyRef.current
    ) {
      setError('Built-in agent access changes are not saved yet.');
      return false;
    }
    return true;
  }, []);

  const addScopeDrones = React.useCallback(
    (drones: AssistantScopeDrone[]) => {
      const clean = cleanAssistantScopeDrones(drones);
      if (clean.length === 0) return;
      const byId = new Map(currentScopeDraftRef.current.drones.map((drone) => [drone.id, drone]));
      for (const drone of clean) byId.set(drone.id, drone);
      void saveScopeDraft({
        readMode: 'selected',
        writeMode: 'selected',
        executeMode: 'selected',
        drones: Array.from(byId.values()),
      });
    },
    [saveScopeDraft],
  );

  const addReferencedDrones = React.useCallback((drones: AssistantDroneReference[]) => {
    const clean = cleanAssistantDroneReferences(drones);
    if (clean.length === 0) return;
    setAttachmentError(null);
    setReferencedDrones((prev) => {
      const byId = new Map(prev.map((drone) => [drone.id, drone]));
      for (const drone of clean) byId.set(drone.id, drone);
      return Array.from(byId.values());
    });
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>('[data-chat-input-focus-id="assistant-chat"]')
        ?.focus(),
    );
  }, []);

  const removeReferencedDrone = React.useCallback((droneIdRaw: string) => {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    setReferencedDrones((prev) => prev.filter((drone) => drone.id !== droneId));
  }, []);

  const removeScopeDrone = React.useCallback(
    (droneId: string) => {
      const current = currentScopeDraftRef.current;
      void saveScopeDraft({
        ...current,
        drones: current.drones.filter((drone) => drone.id !== droneId),
      });
    },
    [saveScopeDraft],
  );

  const updateScopeReadMode = React.useCallback(
    (mode: AssistantScopeMode) => {
      void saveScopeDraft({ ...currentScopeDraftRef.current, readMode: mode });
    },
    [saveScopeDraft],
  );

  const updateScopeWriteMode = React.useCallback(
    (mode: AssistantScopeMode) => {
      void saveScopeDraft({ ...currentScopeDraftRef.current, writeMode: mode });
    },
    [saveScopeDraft],
  );

  const updateScopeExecuteMode = React.useCallback(
    (mode: AssistantScopeMode) => {
      void saveScopeDraft({ ...currentScopeDraftRef.current, executeMode: mode });
    },
    [saveScopeDraft],
  );

  useDndMonitor({
    onDragEnd: (event) => {
      const overId = String(event.over?.id ?? '');
      if (
        overId !== 'assistant-drone-scope-drop' &&
        overId !== 'assistant-message-drone-reference-drop'
      )
        return;
      const data = parseDroneHubDragData(event.active.data.current);
      const target = assistantDroneDropTargetFromDragData(data);
      if (!target || target.ids.length === 0) return;
      const droppedOnThreadId = activeThreadIdRef.current;
      void resolveScopeDroneNames(target.ids, target.fallbackLabel).then((drones) => {
        if (activeThreadIdRef.current !== droppedOnThreadId) return;
        if (overId === 'assistant-drone-scope-drop') {
          addScopeDrones(drones);
          return;
        }
        addReferencedDrones(drones);
      });
    },
  });

  React.useEffect(() => {
    if (running || !refocusInputWhenIdleRef.current) return;
    refocusInputWhenIdleRef.current = false;
    document
      .querySelector<HTMLTextAreaElement>('[data-chat-input-focus-id="assistant-chat"]')
      ?.focus();
  }, [running]);

  const updateThread = React.useCallback(
    async (
      patch: Partial<
        Pick<
          AssistantThread,
          | 'title'
          | 'model'
          | 'provider'
          | 'thinkingLevel'
          | 'autoApprove'
          | 'promptDeliveryMode'
          | 'enabledTools'
          | 'enabledWorkspaceIds'
        >
      >,
    ) => {
      if (!activeThread) return false;
      const requestId = updateThreadRequestRef.current + 1;
      updateThreadRequestRef.current = requestId;
      const requestSeq = beginSnapshotMutation();
      try {
        const next = await requestJson<AssistantSnapshot>(
          `/api/assistant/threads/${encodeURIComponent(activeThread.id)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          },
        );
        if (updateThreadRequestRef.current === requestId && snapshotMutationCurrent(requestSeq))
          applySnapshot(next);
        return true;
      } catch (err: any) {
        if (updateThreadRequestRef.current === requestId && snapshotMutationCurrent(requestSeq))
          setError(err?.message ?? String(err));
        return false;
      }
    },
    [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent],
  );

  const sendPrompt = React.useCallback(
    async (sharedPayload: ChatSendPayload, deliveryMode: 'asap' | 'queue'): Promise<boolean> => {
      if (!activeThread) return false;
      const referencedDroneSnapshot = referencedDronesRef.current.slice();
      const prompt = appendAssistantDroneReferences(sharedPayload.prompt, referencedDroneSnapshot);
      const encodedAttachments: AssistantAttachmentPayload[] = sharedPayload.attachments.map(
        (attachment) => ({
          ...attachment,
          disposition: attachment.disposition,
        }),
      );
      if (!prompt && encodedAttachments.length === 0) return false;
      const endLocalBusy = beginLocalChatBusy(nativeChatNodeId);
      try {
        const requestSeq = beginSnapshotMutation();
        setError(null);
        setAttachmentError(null);
        if (!(await waitForScopeSave())) return false;
        if (!snapshotMutationCurrent(requestSeq)) return false;
        setReferencedDrones([]);
        scrollAssistantToBottom({ force: true });
        refocusInputWhenIdleRef.current = true;
        let sentOk = true;
        try {
          const userTimeZone = clientTimeZone();
          const response = await fetch(
            `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/prompt`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                prompt,
                attachments: encodedAttachments,
                ...(userTimeZone ? { userTimeZone } : {}),
                provider: activeThread.provider,
                model: activeThread.model,
                thinkingLevel: activeThread.thinkingLevel,
                deliveryMode,
              }),
            },
          );
          await readNdjson(response, (event) => {
            if (!snapshotMutationCurrent(requestSeq)) return;
            blipSession.handleStreamEvent(event);
            if (event?.type === 'error') {
              sentOk = false;
              setError(String(event.error ?? 'Built-in agent failed.'));
            }
          });
          if (!sentOk && snapshotMutationCurrent(requestSeq)) {
            setReferencedDrones((cur) => (cur.length === 0 ? referencedDroneSnapshot : cur));
          }
        } catch (err: any) {
          sentOk = false;
          if (snapshotMutationCurrent(requestSeq)) {
            setError(err?.message ?? String(err));
            setReferencedDrones((cur) => (cur.length === 0 ? referencedDroneSnapshot : cur));
          }
        } finally {
          if (snapshotMutationCurrent(requestSeq)) {
            void blipSession.refreshHistory({ quiet: true });
            void refresh({ silent: true });
          }
          if (snapshotMutationCurrent(requestSeq) && sentOk && encodedAttachments.length > 0) {
            requestJson<{ ok: true; threadId: string; files: AssistantArtifactSummary[] }>(
              `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/artifacts`,
            )
              .then((data) => {
                if (activeThreadIdRef.current === activeThread.id)
                  setArtifactFiles(Array.isArray(data.files) ? data.files : []);
              })
              .catch(() => {});
          }
        }
        return sentOk;
      } finally {
        endLocalBusy();
      }
    },
    [
      activeThread,
      beginSnapshotMutation,
      blipSession,
      nativeChatNodeId,
      refresh,
      scrollAssistantToBottom,
      snapshotMutationCurrent,
      waitForScopeSave,
    ],
  );

  const sendPromptInNewChat = React.useCallback(
    async (sharedPayload: ChatSendPayload, context: ChatSendContext): Promise<boolean> => {
      if (!onSendPromptInNewChat) return false;
      const referencedDroneSnapshot = referencedDronesRef.current.slice();
      const prompt = appendAssistantDroneReferences(sharedPayload.prompt, referencedDroneSnapshot);
      if (!prompt && sharedPayload.attachments.length === 0) return false;
      setError(null);
      setAttachmentError(null);
      if (!(await waitForScopeSave())) return false;
      const sent = await onSendPromptInNewChat({ ...sharedPayload, prompt }, context);
      if (sent) setReferencedDrones([]);
      return sent;
    },
    [onSendPromptInNewChat, waitForScopeSave],
  );

  const stop = React.useCallback(async () => {
    if (!activeThread) return;
    const requestSeq = beginSnapshotMutation();
    setAssistantStopBusy(true);
    try {
      const next = await requestJson<AssistantSnapshot>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/stop`,
        { method: 'POST' },
      );
      if (!snapshotMutationCurrent(requestSeq)) return;
      applySnapshot(next);
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    } finally {
      setAssistantStopBusy(false);
    }
  }, [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const continueResponse = React.useCallback(async () => {
    if (!activeThread || assistantRetryBusy) return;
    const requestSeq = beginSnapshotMutation();
    const endLocalBusy = beginLocalChatBusy(nativeChatNodeId);
    setAssistantRetryBusy(true);
    setError(null);
    scrollAssistantToBottom({ force: true });
    try {
      await requestJson<{ ok: true; threadId: string; status: 'running' }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/retry`,
        { method: 'POST' },
      );
      if (!snapshotMutationCurrent(requestSeq)) return;
      await refresh({ silent: true });
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    } finally {
      setAssistantRetryBusy(false);
      endLocalBusy();
    }
  }, [
    activeThread,
    assistantRetryBusy,
    beginSnapshotMutation,
    nativeChatNodeId,
    refresh,
    scrollAssistantToBottom,
    snapshotMutationCurrent,
  ]);

  const cancelQueuedPrompt = React.useCallback(
    async (promptId: string) => {
      if (!activeThread) return;
      const requestSeq = beginSnapshotMutation();
      setQueuedPromptBusyId(promptId);
      try {
        const next = await requestJson<AssistantSnapshot>(
          `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/queued/${encodeURIComponent(promptId)}`,
          { method: 'DELETE' },
        );
        if (snapshotMutationCurrent(requestSeq)) applySnapshot(next);
      } catch (err: any) {
        if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
      } finally {
        setQueuedPromptBusyId(null);
      }
    },
    [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent],
  );

  const resolveApproval = React.useCallback(
    async (approval: AssistantApproval, approved: boolean) => {
      if (!activeThread) return;
      const requestSeq = beginSnapshotMutation();
      setApprovalBusyId(approval.id);
      try {
        const next = await requestJson<AssistantSnapshot>(
          `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/approvals/${encodeURIComponent(approval.id)}/${approved ? 'approve' : 'deny'}`,
          { method: 'POST' },
        );
        if (!snapshotMutationCurrent(requestSeq)) return;
        if (!approved) refocusInputWhenIdleRef.current = true;
        applySnapshot(next);
      } catch (err: any) {
        if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
      } finally {
        setApprovalBusyId(null);
      }
    },
    [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent],
  );

  const setActiveModelAsDefault = React.useCallback(async () => {
    if (!activeThread) return;
    if (
      snapshot?.defaultModel.provider === activeThread.provider &&
      snapshot.defaultModel.model === activeThread.model &&
      snapshot.defaultModel.thinkingLevel === activeThread.thinkingLevel
    )
      return;
    const requestSeq = beginSnapshotMutation();
    setDefaultModelBusy(true);
    try {
      const next = await requestJson<AssistantDefaultSettings>('/api/assistant/default-model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: activeThread.provider,
          model: activeThread.model,
          thinkingLevel: activeThread.thinkingLevel,
        }),
      });
      if (snapshotMutationCurrent(requestSeq)) {
        setSnapshot((current) => (current ? { ...current, ...next } : current));
      }
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    } finally {
      setDefaultModelBusy(false);
    }
  }, [activeThread, beginSnapshotMutation, snapshot?.defaultModel, snapshotMutationCurrent]);

  const availableTools = snapshot?.availableTools ?? EMPTY_ASSISTANT_TOOL_SUMMARIES;
  const availableWorkspaces = snapshot?.availableWorkspaces ?? EMPTY_ASSISTANT_WORKSPACES;
  const availableWorkspaceIdsKey = React.useMemo(
    () => availableWorkspaces.map((workspace) => workspace.id).join('\u0000'),
    [availableWorkspaces],
  );
  const snapshotEnabledWorkspaceIds = React.useMemo(() => {
    const availableIds = availableWorkspaces.map((workspace) => workspace.id);
    if (!activeThread) return [];
    const configured = Array.isArray(activeThread.enabledWorkspaceIds)
      ? activeThread.enabledWorkspaceIds
      : availableIds;
    return configured.filter((workspaceId) => availableIds.includes(workspaceId));
  }, [activeThread, availableWorkspaces]);

  React.useEffect(() => {
    const currentKey = enabledWorkspaceDraftIdsRef.current.join('\u0000');
    const nextKey = snapshotEnabledWorkspaceIds.join('\u0000');
    if (currentKey === nextKey) return;
    enabledWorkspaceDraftIdsRef.current = snapshotEnabledWorkspaceIds;
    setEnabledWorkspaceDraftIds(snapshotEnabledWorkspaceIds);
  }, [activeThreadId, availableWorkspaceIdsKey, snapshotEnabledWorkspaceIds]);
  const snapshotEnabledToolNames = React.useMemo(() => {
    const toolNames = availableTools.map((tool) => tool.name);
    if (!activeThread) return [];
    const configured = Array.isArray(activeThread.enabledTools)
      ? activeThread.enabledTools
      : toolNames.filter(
          (name) =>
            name !== 'get_system_prompt' &&
            name !== 'update_system_prompt' &&
            name !== 'set_thinking_level',
        );
    return configured.filter((name) => toolNames.includes(name));
  }, [activeThread, availableTools]);
  const availableToolNamesKey = React.useMemo(
    () => availableTools.map((tool) => tool.name).join('\u0000'),
    [availableTools],
  );

  React.useEffect(() => {
    const currentKey = enabledToolDraftNamesRef.current.join('\u0000');
    const nextKey = snapshotEnabledToolNames.join('\u0000');
    if (currentKey === nextKey) return;
    enabledToolDraftNamesRef.current = snapshotEnabledToolNames;
    setEnabledToolDraftNames(snapshotEnabledToolNames);
  }, [activeThreadId, availableToolNamesKey, snapshotEnabledToolNames]);

  React.useEffect(() => {
    const available = new Set(availableTools.map((tool) => tool.name));
    const nextTools = (snapshot?.defaultEnabledTools ?? []).filter((name) => available.has(name));
    const currentKey = defaultEnabledToolDraftNamesRef.current.join('\u0000');
    const nextKey = nextTools.join('\u0000');
    if (currentKey === nextKey) return;
    defaultEnabledToolDraftNamesRef.current = nextTools;
    setDefaultEnabledToolDraftNames(nextTools);
  }, [availableToolNamesKey, availableTools, snapshot?.defaultEnabledTools]);

  const enabledToolNames = React.useMemo(() => {
    const available = new Set(availableTools.map((tool) => tool.name));
    return enabledToolDraftNames.filter((name) => available.has(name));
  }, [availableTools, enabledToolDraftNames]);
  const showExistingDroneAccess = React.useMemo(
    () => assistantHasEnabledMcpGroup(availableTools, enabledToolNames, 'drone-hub'),
    [availableTools, enabledToolNames],
  );

  const updateEnabledTools = React.useCallback(
    (nextTools: string[]) => {
      enabledToolDraftNamesRef.current = nextTools;
      setEnabledToolDraftNames(nextTools);
      const available = new Set(availableTools.map((tool) => tool.name));
      const unavailableConfigured = (activeThread?.enabledTools ?? []).filter(
        (name) => !available.has(name),
      );
      void updateThread({ enabledTools: [...nextTools, ...unavailableConfigured] });
    },
    [activeThread?.enabledTools, availableTools, updateThread],
  );

  const toggleAssistantTool = React.useCallback(
    (toolName: string, enabled: boolean) => {
      const current = new Set(enabledToolDraftNamesRef.current);
      if (enabled) current.add(toolName);
      else current.delete(toolName);
      const ordered = availableTools.map((tool) => tool.name).filter((name) => current.has(name));
      updateEnabledTools(ordered);
    },
    [availableTools, updateEnabledTools],
  );

  const toggleAssistantTools = React.useCallback(
    (toolNames: string[], enabled: boolean) => {
      const current = new Set(enabledToolDraftNamesRef.current);
      for (const toolName of toolNames) {
        if (enabled) current.add(toolName);
        else current.delete(toolName);
      }
      const ordered = availableTools.map((tool) => tool.name).filter((name) => current.has(name));
      updateEnabledTools(ordered);
    },
    [availableTools, updateEnabledTools],
  );

  const updateEnabledWorkspaces = React.useCallback(
    (nextWorkspaceIds: string[]) => {
      enabledWorkspaceDraftIdsRef.current = nextWorkspaceIds;
      setEnabledWorkspaceDraftIds(nextWorkspaceIds);
      const available = new Set(availableWorkspaces.map((workspace) => workspace.id));
      const unavailableConfigured = (activeThread?.enabledWorkspaceIds ?? []).filter(
        (workspaceId) => !available.has(workspaceId),
      );
      const attemptedKey = nextWorkspaceIds.join('\u0000');
      void updateThread({
        enabledWorkspaceIds: [...nextWorkspaceIds, ...unavailableConfigured],
      }).then((saved) => {
        if (saved || enabledWorkspaceDraftIdsRef.current.join('\u0000') !== attemptedKey) return;
        enabledWorkspaceDraftIdsRef.current = snapshotEnabledWorkspaceIds;
        setEnabledWorkspaceDraftIds(snapshotEnabledWorkspaceIds);
      });
    },
    [
      activeThread?.enabledWorkspaceIds,
      availableWorkspaces,
      snapshotEnabledWorkspaceIds,
      updateThread,
    ],
  );

  const toggleAssistantWorkspace = React.useCallback(
    (workspaceId: string, enabled: boolean) => {
      const current = new Set(enabledWorkspaceDraftIdsRef.current);
      if (enabled) current.add(workspaceId);
      else current.delete(workspaceId);
      updateEnabledWorkspaces(
        availableWorkspaces.map((workspace) => workspace.id).filter((id) => current.has(id)),
      );
    },
    [availableWorkspaces, updateEnabledWorkspaces],
  );

  const updateDefaultEnabledTools = React.useCallback(
    async (nextTools: string[]) => {
      defaultEnabledToolDraftNamesRef.current = nextTools;
      setDefaultEnabledToolDraftNames(nextTools);
      const available = new Set(availableTools.map((tool) => tool.name));
      const unavailableConfigured = (snapshot?.defaultEnabledTools ?? []).filter(
        (name) => !available.has(name),
      );
      const persistedTools = [...nextTools, ...unavailableConfigured];
      const requestSeq = beginSnapshotMutation();
      setDefaultToolsBusy(true);
      try {
        const next = await requestJson<AssistantDefaultSettings>('/api/assistant/default-tools', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabledTools: persistedTools }),
        });
        if (snapshotMutationCurrent(requestSeq)) {
          setSnapshot((current) => (current ? { ...current, ...next } : current));
        }
      } catch (err: any) {
        if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
      } finally {
        setDefaultToolsBusy(false);
      }
    },
    [availableTools, beginSnapshotMutation, snapshot?.defaultEnabledTools, snapshotMutationCurrent],
  );

  const toggleDefaultTool = React.useCallback(
    (toolName: string, enabled: boolean) => {
      const current = new Set(defaultEnabledToolDraftNamesRef.current);
      if (enabled) current.add(toolName);
      else current.delete(toolName);
      void updateDefaultEnabledTools(
        availableTools.map((tool) => tool.name).filter((name) => current.has(name)),
      );
    },
    [availableTools, updateDefaultEnabledTools],
  );

  const toggleDefaultTools = React.useCallback(
    (toolNames: string[], enabled: boolean) => {
      const current = new Set(defaultEnabledToolDraftNamesRef.current);
      for (const toolName of toolNames) {
        if (enabled) current.add(toolName);
        else current.delete(toolName);
      }
      void updateDefaultEnabledTools(
        availableTools.map((tool) => tool.name).filter((name) => current.has(name)),
      );
    },
    [availableTools, updateDefaultEnabledTools],
  );

  const loadArtifactFiles = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      const threadId = activeThreadId;
      if (!threadId) {
        setArtifactFiles([]);
        setSelectedArtifactPath(null);
        setSelectedArtifactFile(null);
        return;
      }
      if (!options.silent) setArtifactsLoading(true);
      setArtifactsError(null);
      try {
        const data = await requestJson<{
          ok: true;
          threadId: string;
          files: AssistantArtifactSummary[];
        }>(`/api/assistant/threads/${encodeURIComponent(threadId)}/artifacts`);
        if (activeThreadIdRef.current !== threadId) return;
        setArtifactFiles(Array.isArray(data.files) ? data.files : []);
      } catch (err: any) {
        if (activeThreadIdRef.current !== threadId) return;
        setArtifactsError(err?.message ?? String(err));
      } finally {
        if (!options.silent && activeThreadIdRef.current === threadId) setArtifactsLoading(false);
      }
    },
    [activeThreadId],
  );

  const loadSelectedArtifactFile = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      const threadId = activeThreadId;
      if (!threadId || !selectedArtifactPath) {
        setSelectedArtifactFile(null);
        return;
      }
      if (!options.silent) setArtifactsLoading(true);
      setArtifactsError(null);
      try {
        const data = await requestJson<{ ok: true; threadId: string; file: AssistantArtifactFile }>(
          `/api/assistant/threads/${encodeURIComponent(threadId)}/artifacts/file?path=${encodeURIComponent(selectedArtifactPath)}`,
        );
        if (activeThreadIdRef.current !== threadId) return;
        setSelectedArtifactFile(data.file ?? null);
      } catch (err: any) {
        if (activeThreadIdRef.current !== threadId) return;
        setSelectedArtifactFile(null);
        setArtifactsError(err?.message ?? String(err));
      } finally {
        if (!options.silent && activeThreadIdRef.current === threadId) setArtifactsLoading(false);
      }
    },
    [activeThreadId, selectedArtifactPath],
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_FILES_OPEN_STORAGE_KEY, filesOpen ? '1' : '0');
  }, [filesOpen]);

  React.useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    setArtifactFiles([]);
    setSelectedArtifactPath(null);
    setSelectedArtifactFile(null);
    setArtifactsError(null);
  }, [activeThreadId]);

  React.useEffect(() => {
    if (!filesOpen || !activeThreadId) return;
    void loadArtifactFiles();
  }, [activeThread?.updatedAt, activeThreadId, filesOpen, loadArtifactFiles]);

  React.useEffect(() => {
    if (!filesOpen) return;
    if (artifactFiles.length === 0) {
      setSelectedArtifactPath(null);
      setSelectedArtifactFile(null);
      return;
    }
    setSelectedArtifactPath((prev) =>
      prev && artifactFiles.some((file) => file.path === prev)
        ? prev
        : selectDefaultArtifactPath(artifactFiles),
    );
  }, [artifactFiles, filesOpen]);

  React.useEffect(() => {
    if (!filesOpen || !selectedArtifactPath) return;
    void loadSelectedArtifactFile();
  }, [activeThread?.updatedAt, filesOpen, loadSelectedArtifactFile, selectedArtifactPath]);

  const composerMenuActions: ChatComposerMenuAction[] = [
    {
      id: 'files',
      label: filesOpen ? 'Hide thread files' : 'Thread files',
      icon: <IconFile className="h-3.5 w-3.5" />,
      badge:
        artifactFiles.length > 0
          ? artifactFiles.length > 99
            ? '99+'
            : artifactFiles.length
          : undefined,
      active: filesOpen,
      onSelect: () => {
        setDroneHubPermissionsOpen(false);
        setToolsPanelOpen(false);
        setSettingsOpen(false);
        setWorkspaceAccessOpen(false);
        setWorkspacesPanelOpen(false);
        setFilesOpen((value) => !value);
      },
    },
    {
      id: 'system-prompt',
      label: 'System prompt',
      icon: <IconPencil className="h-3.5 w-3.5" />,
      onSelect: openSystemPromptEditor,
    },
    {
      id: 'workspaces',
      label: 'Chat workspaces',
      icon: <IconFolder className="h-3.5 w-3.5" />,
      disabled: !activeThread,
      active: workspacesPanelOpen || workspaceAccessOpen,
      onSelect: () => {
        setDroneHubPermissionsOpen(false);
        setFilesOpen(false);
        setToolsPanelOpen(false);
        setSettingsOpen(false);
        setWorkspaceAccessOpen(false);
        setWorkspacesPanelOpen((value) => !value);
      },
    },
    {
      id: 'drone-hub-permissions',
      label: 'DroneHub permissions',
      title: 'Configure what this chat can access through the DroneHub MCP server.',
      icon: <IconNetwork className="h-3.5 w-3.5" />,
      disabled: !activeThread,
      active: droneHubPermissionsOpen,
      onSelect: () => {
        setFilesOpen(false);
        setToolsPanelOpen(false);
        setSettingsOpen(false);
        setWorkspaceAccessOpen(false);
        setWorkspacesPanelOpen(false);
        setDroneHubPermissionsOpen(true);
      },
    },
    {
      id: 'tools',
      label: 'Thread tools',
      icon: <IconWrench className="h-3.5 w-3.5" />,
      disabled: !activeThread,
      active: toolsPanelOpen,
      onSelect: () => {
        setDroneHubPermissionsOpen(false);
        setSettingsOpen(false);
        setWorkspaceAccessOpen(false);
        setWorkspacesPanelOpen(false);
        setToolsPanelOpen((value) => !value);
      },
    },
    {
      id: 'settings',
      label: 'Agent defaults',
      icon: <IconSettings className="h-3.5 w-3.5" />,
      active: settingsOpen,
      onSelect: () => {
        setDroneHubPermissionsOpen(false);
        setToolsPanelOpen(false);
        setWorkspaceAccessOpen(false);
        setWorkspacesPanelOpen(false);
        setSettingsOpen((value) => !value);
      },
    },
    {
      id: 'auto-approve',
      label: 'Auto-approve requests',
      icon: <IconShieldCheck className="h-4 w-4" />,
      disabled: !activeThread,
      active: autoApprove,
      onSelect: () =>
        void (async () => {
          const nextAutoApprove = !autoApprove;
          await requestJson(
            `/api/drones/${encodeURIComponent(nativeDroneId)}/chats/${encodeURIComponent(
              nativeChatName,
            )}/config`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                approvalPolicy: nextAutoApprove ? 'never' : 'ask',
              }),
            },
          );
          await updateThread({ autoApprove: nextAutoApprove });
        })(),
    },
  ];

  const nativeComposerOverlay = (
    <>
      {activeThread?.provider === 'codex' ? (
        <CodexConnectComposerNotice resetKey={`${nativeDroneId}:${nativeChatName}`} />
      ) : null}
      {toolsPanelOpen ? (
        <AssistantToolsPanel
          tools={availableTools}
          enabledTools={enabledToolNames}
          disabled={!activeThread}
          onToggleTool={toggleAssistantTool}
          onToggleTools={toggleAssistantTools}
          onEnableAll={() => updateEnabledTools(availableTools.map((tool) => tool.name))}
          onDisableAll={() => updateEnabledTools([])}
          onClose={() => setToolsPanelOpen(false)}
          placement="composer"
        />
      ) : null}
      {workspacesPanelOpen ? (
        <AssistantWorkspacesPanel
          workspaces={availableWorkspaces}
          enabledWorkspaceIds={enabledWorkspaceDraftIds}
          disabled={!activeThread}
          onToggleWorkspace={toggleAssistantWorkspace}
          onEnableAll={() =>
            updateEnabledWorkspaces(availableWorkspaces.map((workspace) => workspace.id))
          }
          onDisableAll={() => updateEnabledWorkspaces([])}
          onOpenRemoteAccess={() => {
            setWorkspacesPanelOpen(false);
            setWorkspaceAccessOpen(true);
          }}
          onClose={() => setWorkspacesPanelOpen(false)}
          placement="composer"
        />
      ) : null}
    </>
  );

  const nativeComposerContext: ChatComposerContextConfig | undefined =
    referencedDrones.length > 0 || droneReferenceDropActive
      ? {
          label:
            referencedDrones.length > 0
              ? `${referencedDrones.length} drone${referencedDrones.length === 1 ? '' : 's'} referenced`
              : 'Drop drones to reference them',
          items: referencedDrones.map((drone) => ({
            id: drone.id,
            label: drone.name || drone.id,
            meta: drone.id,
          })),
          emptyHint: 'Release to add drone names and IDs to this message.',
          disabled: droneReferenceControlsLocked,
          onRemove: removeReferencedDrone,
        }
      : undefined;

  const nativeComposerControls = {
    ...buildNativeAgentComposerControls({
      thread: activeThread,
      models: snapshot?.models ?? EMPTY_ASSISTANT_MODEL_OPTIONS,
      defaultModel: snapshot?.defaultModel,
      busy: defaultModelBusy,
      onUpdate: (patch) => void updateThread(patch),
      onSetDefault: () => void setActiveModelAsDefault(),
    }),
    menuActions: composerMenuActions,
  };

  const toolActivityVisible = chatSurfaceAdapter.capabilities.toolActivity === 'visible';
  const nativeTranscriptItems: AgentChatTranscriptItem[] = [];
  if (blipSession.olderLoading) {
    nativeTranscriptItems.push({
      key: 'native-history-older',
      kind: 'status',
      content: (
        <div
          className="text-center text-[var(--text-11)] text-[var(--muted)]"
          role="status"
          aria-live="polite"
        >
          Loading older messages…
        </div>
      ),
    });
  }
  if (startupPromptPresentation.showOptimistic && startupPrompt) {
    nativeTranscriptItems.push({
      key: 'startup-prompt',
      kind: 'pending',
      content: (
        <PendingTranscriptTurn
          item={{
            id: 'native-startup-prompt',
            at: startupPrompt.at,
            prompt: startupPrompt.prompt,
            state: 'sent',
          }}
        />
      ),
    });
  }
  const toolCallStartedAt = new Map<string, number>();
  for (const message of visibleMessages) {
    if (message.role !== 'assistant') continue;
    const timestamp = assistantMessageTimestampMs(message);
    if (timestamp === undefined) continue;
    for (const call of toolCalls(message)) toolCallStartedAt.set(call.id, timestamp);
  }
  let lastRunSummaryItemIndex = -1;
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    const candidate = visibleItems[index];
    if (lastRunSummaryItemIndex < 0 && candidate?.type === 'runSummary' && candidate.fileChanges) {
      lastRunSummaryItemIndex = index;
    }
    if (lastRunSummaryItemIndex >= 0) break;
  }
  const requestRunByFirstToolItemIndex = new Map(
    requestRuns
      .filter((run) => run.firstToolItemIndex >= 0)
      .map((run) => [run.firstToolItemIndex, run] as const),
  );
  const requestRunToolItemIndexes = new Set(
    requestRuns.flatMap((run) => {
      const indexes: number[] = [];
      for (let index = run.userItemIndex + 1; index <= run.endItemIndex; index += 1) {
        const candidate = visibleItems[index];
        if (candidate?.type === 'tool' || candidate?.type === 'toolGroup') indexes.push(index);
      }
      return indexes;
    }),
  );
  const visibleRunSummaryItemIndexes = new Set(
    requestRuns.map((run) => run.fileSummaryItemIndex).filter((index) => index >= 0),
  );

  for (let itemIndex = 0; itemIndex < visibleItems.length; itemIndex += 1) {
    const item = visibleItems[itemIndex]!;
    if (item.type === 'compaction') {
      nativeTranscriptItems.push({
        key: item.key,
        kind: 'status',
        latestActivityEligible: false,
        content: <AssistantCompactionRow details={item.details} timestamp={item.timestamp} />,
      });
      continue;
    }
    if (item.type === 'runSummary') {
      if (!visibleRunSummaryItemIndexes.has(itemIndex) || !item.fileChanges) continue;
      nativeTranscriptItems.push({
        key: item.key,
        kind: 'status',
        latestActivityEligible: false,
        content: (
          <ChangedFilesCard
            fileChanges={item.fileChanges}
            initiallyExpanded={itemIndex === lastRunSummaryItemIndex}
          />
        ),
      });
      continue;
    }
    if (item.type === 'message') {
      if (item.message.role === 'assistant' && item.message.errorMessage) {
        let hasSavedToolResults = false;
        for (let previousIndex = itemIndex - 1; previousIndex >= 0; previousIndex -= 1) {
          const previous = visibleItems[previousIndex]!;
          if (previous.type === 'message' && previous.message.role === 'user') break;
          if (previous.type === 'tool' || previous.type === 'toolGroup') {
            hasSavedToolResults = true;
            break;
          }
        }
        let hasLaterConversation = false;
        let supersededLater = false;
        for (let nextIndex = itemIndex + 1; nextIndex < visibleItems.length; nextIndex += 1) {
          const next = visibleItems[nextIndex]!;
          if (next.type !== 'message') continue;
          if (next.message.role === 'user') {
            hasLaterConversation = true;
            break;
          }
          if (next.message.role !== 'assistant') continue;
          hasLaterConversation = true;
          if (next.message.errorMessage || messageVisibleText(next.message).trim()) {
            supersededLater = true;
            break;
          }
        }
        if (supersededLater) continue;
        nativeTranscriptItems.push({
          key: item.key,
          kind: 'status',
          latestActivityEligible: true,
          content: (
            <NativeAgentFailureCard
              message={item.message}
              hasSavedToolResults={hasSavedToolResults}
              retrying={assistantRetryBusy || (running && itemIndex > latestUserItemIndex)}
              onRetry={hasLaterConversation ? undefined : () => void continueResponse()}
            />
          ),
        });
        continue;
      }
      const latestActivityEligible = Boolean(
        item.message.role === 'user' ||
        messageVisibleText(item.message).trim() ||
        messageImageParts(item.message).length > 0 ||
        item.message.errorMessage ||
        (toolActivityVisible && item.showToolCalls && toolCalls(item.message).length > 0) ||
        (running && latestThinkingText(item.message).trim()),
      );
      nativeTranscriptItems.push({
        key: item.key,
        kind: 'message',
        latestActivityEligible,
        content: ({ isLatestActivity }) => (
          <AssistantMessageRow
            message={item.message}
            autoExpandMessage={isLatestActivity}
            messageExtras={{
              messageId: `${activeThreadId}:${item.key}`,
              onSpawnTask: messageFeatures.onSpawnTask,
              linkedPullRequestContext: messageFeatures.linkedPullRequestContext,
              droneId: messageFeatures.droneId,
              droneHomePath: messageFeatures.droneHomePath,
              onOpenFileReference: messageFeatures.onOpenFileReference,
              onOpenLink: messageFeatures.onOpenLink,
              initiallyExpandLinkedPullRequests: isLatestActivity,
            }}
            droneMentionLinks={droneMentionLinks}
            onOpenDroneMention={openDroneMention}
            showToolCalls={toolActivityVisible && item.showToolCalls}
            showReasoning={running && isLatestActivity}
          />
        ),
      });
      if (item.message.role === 'user') {
        const directRun = directAssistantRunTiming(visibleItems, itemIndex);
        if (directRun) {
          const directRunActive = running && itemIndex === latestUserItemIndex;
          nativeTranscriptItems.push({
            key: `direct-run:${item.key}:${directRunActive ? 'active' : 'complete'}`,
            kind: 'status',
            content: (
              <AssistantRunActivity
                active={directRunActive}
                startedAt={directRun.startedAt}
                endedAt={directRun.endedAt}
                completedDurationMs={directRun.durationMs}
              />
            ),
          });
        }
      }
      continue;
    }

    if (!requestRunToolItemIndexes.has(itemIndex)) continue;
    const requestRun = requestRunByFirstToolItemIndex.get(itemIndex);
    if (!requestRun) continue;
    const runItems = requestRun.toolItems;
    const runStartIndex = requestRun.firstToolItemIndex;
    const userItem = visibleItems[requestRun.userItemIndex];
    const precedingUserAt =
      userItem?.type === 'message' ? assistantMessageTimestampMs(userItem.message) : undefined;
    const callStartedAt = runItems
      .map((runItem) => toolCallStartedAt.get(String(runItem.call?.id ?? '')))
      .filter((timestamp): timestamp is number => timestamp !== undefined);
    const resultEndedAt = runItems
      .map((runItem) => assistantMessageTimestampMs(runItem.result))
      .filter((timestamp): timestamp is number => timestamp !== undefined);
    let finalAssistantAt: number | undefined;
    for (let index = requestRun.userItemIndex + 1; index <= requestRun.endItemIndex; index += 1) {
      const candidate = visibleItems[index];
      if (candidate?.type !== 'message' || candidate.message.role !== 'assistant') continue;
      finalAssistantAt = assistantMessageTimestampMs(candidate.message) ?? finalAssistantAt;
    }
    const startedAt =
      precedingUserAt ?? (callStartedAt.length > 0 ? Math.min(...callStartedAt) : undefined);
    const endedAt =
      finalAssistantAt ??
      (resultEndedAt.length > 0
        ? Math.max(...resultEndedAt)
        : callStartedAt.length > 0
          ? Math.max(...callStartedAt)
          : undefined);
    const runActive = running && requestRun.userItemIndex === latestUserItemIndex;
    const runAwaitingApproval =
      requestRun.userItemIndex === latestUserItemIndex && activePendingApprovals.length > 0;
    const runKey = `tool-run:${userItem?.key ?? runStartIndex}`;
    nativeTranscriptItems.push({
      key: runKey,
      kind: 'tool',
      content: ({ isLatestActivity }) => (
        <ToolRunActivity
          key={runKey}
          items={runItems}
          active={runActive}
          startedAt={startedAt}
          endedAt={endedAt}
          completedDurationMs={requestRun.durationMs}
          droneNameById={droneNameById}
          initiallyExpanded={runActive || runAwaitingApproval || isLatestActivity}
          awaitingApproval={runAwaitingApproval}
          approvalStartedAt={activeApprovalStartedAt}
        />
      ),
    });
  }
  if (blipSession.compactionInProgress) {
    nativeTranscriptItems.push({
      key: 'native-compaction-working',
      kind: 'status',
      content: <AssistantCompactionWorkingRow />,
    });
  } else if (showWorking) {
    nativeTranscriptItems.push({
      key: 'native-working',
      kind: 'status',
      content: <AssistantWorkingRow startedAt={latestUserStartedAt} />,
    });
  }
  for (const approval of activePendingApprovals) {
    nativeTranscriptItems.push({
      key: `approval:${approval.id}`,
      kind: 'approval',
      content: (
        <ApprovalCard
          approval={approval}
          busy={approvalBusyId === approval.id}
          onApprove={() => void resolveApproval(approval, true)}
          onDeny={() => void resolveApproval(approval, false)}
        />
      ),
    });
  }
  for (const prompt of visibleQueuedPrompts) {
    nativeTranscriptItems.push({
      key: `queued:${prompt.id}`,
      kind: 'pending',
      content: (
        <AssistantQueuedPromptRow
          prompt={prompt}
          cancelling={queuedPromptBusyId === prompt.id}
          onCancel={() => void cancelQueuedPrompt(prompt.id)}
          onCreateNewChatNow={
            onCreateQueuedNewChatNow ? () => void onCreateQueuedNewChatNow(prompt.id) : undefined
          }
          creatingNewChat={Boolean(promotingNewChatActionById[prompt.id])}
          autoFocusCreateNewChat={focusedNewChatActionId === prompt.id}
          onCreateNewChatAutoFocusHandled={onCreateNewChatAutoFocusHandled}
          createNewChatError={promoteNewChatActionErrorById[prompt.id] ?? null}
        />
      ),
    });
  }
  const transcriptError = error ?? blipSession.runError ?? blipSession.historyError;
  const transcriptErrorAlreadyRendered = assistantTranscriptHasErrorMessage(
    visibleMessages,
    transcriptError,
  );
  if (transcriptError && !transcriptErrorAlreadyRendered) {
    nativeTranscriptItems.push({
      key: 'native-transcript-error',
      kind: 'status',
      content: (
        <div className="mx-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
          {transcriptError}
        </div>
      ),
    });
  }

  return (
    <div data-assistant-dock-root="true" className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col outline-none">
        {droneHubPermissionsOpen && activeThread ? (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-[var(--panel-alt)]">
            <DroneHubPermissionsView
              chatLabel={activeThread.title || nativeChatName}
              available={showExistingDroneAccess}
              loading={loading}
              saving={scopeSyncBusy}
              error={scopeSyncError}
              unavailableMessage="The DroneHub MCP tools are disabled for this chat. Enable them from Thread tools to use these permissions."
              readMode={scopeReadMode}
              writeMode={scopeWriteMode}
              executeMode={scopeExecuteMode}
              selectedDrones={scopeDrones.map((drone) => ({
                id: drone.id,
                label: drone.name || drone.id,
                removable: drone.id !== activeThread.ownerDroneId,
              }))}
              dropActive={scopeDropActive}
              dropTargetRef={setScopeDropNodeRef}
              onModeChange={(kind, mode) => {
                if (kind === 'read') updateScopeReadMode(mode);
                else if (kind === 'write') updateScopeWriteMode(mode);
                else updateScopeExecuteMode(mode);
              }}
              onRemoveDrone={removeScopeDrone}
              onBack={() => setDroneHubPermissionsOpen(false)}
            />
          </div>
        ) : null}

        {settingsOpen ? (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-[var(--panel-alt)]">
            <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div
                    className="flex items-center gap-2 text-[15px] font-[var(--weight-semibold)] text-[var(--fg)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    <IconSettings className="h-4 w-4 text-[var(--muted)]" />
                    Settings
                  </div>
                  <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">
                    Defaults apply to newly created chats. Existing chats keep their current
                    configuration.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:text-[var(--fg)]"
                  title="Close settings"
                  aria-label="Close settings"
                >
                  ×
                </button>
              </div>
              <AssistantToolsPanel
                variant="settings"
                tools={availableTools}
                enabledTools={defaultEnabledToolDraftNames}
                disabled={defaultToolsBusy}
                onToggleTool={toggleDefaultTool}
                onToggleTools={toggleDefaultTools}
                onEnableAll={() =>
                  void updateDefaultEnabledTools(availableTools.map((tool) => tool.name))
                }
                onDisableAll={() => void updateDefaultEnabledTools([])}
              />
            </div>
          </div>
        ) : null}

        {workspaceAccessOpen && activeThread ? (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-[var(--panel-alt)]">
            <AssistantWorkspaceAccessView
              key={activeThread.id}
              requestJson={requestJson}
              threadId={activeThread.id}
              threadTitle={activeThread.title}
              onClose={() => setWorkspaceAccessOpen(false)}
            />
          </div>
        ) : null}

        {filesOpen ? (
          <AssistantThreadFilesView
            threadId={activeThread?.id ?? ''}
            files={artifactFiles}
            selectedPath={selectedArtifactPath}
            selectedFile={selectedArtifactFile}
            loading={artifactsLoading}
            error={artifactsError}
            onSelectPath={setSelectedArtifactPath}
            onRefresh={() => {
              void loadArtifactFiles();
              void loadSelectedArtifactFile();
            }}
            onClose={() => setFilesOpen(false)}
          />
        ) : (
          <div
            ref={setDroneReferenceDropNodeRef}
            className={`flex min-h-0 flex-1 flex-col ${
              droneReferenceDropActive ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''
            }`}
          >
            <AgentChatTranscript
              scrollRef={bindScrollRef}
              contentRef={bindScrollContentRef}
              loading={Boolean(
                !startupPromptPresentation.showOptimistic &&
                ((loading && !snapshot) ||
                  (blipSession.historyLoading && visibleItems.length === 0)),
              )}
              loadingMessage="Loading conversation…"
              hasContent={Boolean(
                blipSession.hasOlder ||
                visibleItems.length > 0 ||
                startupPromptPresentation.showOptimistic ||
                showWorking ||
                activePendingApprovals.length > 0 ||
                visibleQueuedPrompts.length > 0 ||
                error ||
                blipSession.runError ||
                blipSession.historyError,
              )}
              emptyState={
                <EmptyState
                  icon={<IconDrone className="h-8 w-8 text-[var(--muted)]" />}
                  title="No messages yet"
                  description="Send a prompt to start the conversation. Drone messaging will ask for approval first."
                />
              }
              items={nativeTranscriptItems}
            />

            <ChatSurfaceComposer
              overlay={nativeComposerOverlay}
              resetKey={activeThreadId || nativeChatName}
              droneName="assistant"
              focusTargetId="assistant-chat"
              draftValue={draft}
              onDraftValueChange={setDraft}
              promptError={attachmentError}
              waiting={running}
              disabled={!activeThread || scopeSyncBusy}
              composerTopAction={composerTopAction}
              composerContext={nativeComposerContext}
              composerControls={nativeComposerControls}
              composerStatus={
                blipSession.contextUsage ? (
                  <AssistantContextUsageIndicator usage={blipSession.contextUsage} />
                ) : undefined
              }
              onStop={() => stop()}
              stopping={assistantStopBusy}
              onSend={async (payload, context) => await sendPrompt(payload, context.deliveryMode)}
              onSendInNewChat={onSendPromptInNewChat ? sendPromptInNewChat : undefined}
            />
          </div>
        )}
      </div>
      {systemPromptOpen ? (
        <AssistantSystemPromptModal
          mode={systemPromptMode}
          settings={systemPromptSettings}
          draft={systemPromptDraft}
          threadSettings={threadSystemPromptSettings}
          threadDraft={threadSystemPromptDraft}
          loading={systemPromptLoading}
          saving={systemPromptSaving}
          threadSaving={threadSystemPromptSaving}
          promoting={promoteSystemPromptSaving}
          error={systemPromptError}
          notice={systemPromptNotice}
          onModeChange={setSystemPromptMode}
          onDraftChange={setSystemPromptDraft}
          onThreadDraftChange={setThreadSystemPromptDraft}
          onUseGlobalForThread={() =>
            setThreadSystemPromptDraft(
              threadSystemPromptSettings?.threadSystemPrompt.globalPrompt ?? '',
            )
          }
          onUseDefaultForGlobal={() =>
            setSystemPromptDraft(systemPromptSettings?.assistantSystemPrompt.defaultPrompt ?? '')
          }
          onClose={() => setSystemPromptOpen(false)}
          onSaveGlobal={() => void saveSystemPromptSettings()}
          onSaveThread={() => void saveThreadSystemPromptSettings()}
          onPromoteThread={() => void promoteThreadSystemPrompt()}
        />
      ) : null}
    </div>
  );
}
