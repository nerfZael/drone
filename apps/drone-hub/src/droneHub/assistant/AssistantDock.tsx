import React from 'react';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import { requestJson } from '../http';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import type { MarkdownTextMentionLink } from '../chat/MarkdownMessage';
import {
  CHAT_INPUT_MAX_BYTES_EACH,
  CHAT_INPUT_MAX_BYTES_TOTAL,
  CHAT_INPUT_MAX_IMAGES,
  CHAT_INPUT_PASTE_TEXT_AS_ATTACHMENT_MIN_CHARS,
  blobToBase64,
  fileToBase64,
  filesFromClipboardData,
  formatBytes,
  imageFilesFromClipboardData,
  isLikelyImageFile,
  makeDraftImageAttachmentId,
  textByteLength,
  type DraftChatAttachment,
} from '../chat/chat-input-attachments';
import { parseDroneHubDragData, useDroneHubActiveDrag } from '../app/drone-hub-dnd';
import { assignedDroneIdsFromData } from '../app/drone-hub-dnd-utils';
import {
  IconPencil,
  IconPlus,
  IconSettings,
  IconShieldCheck,
  IconSpinner,
  IconWrench,
} from '../app/icons';
import { IconChevron, IconDrone, IconFile, IconFolder, iconForFilePath } from '../icons';
import { dispatchAssistantOpenDroneChat } from './open-drone-chat-event';
import { useBlipThreadSession } from './useBlipThreadSession';
import { AssistantThreadFilesView, selectDefaultArtifactPath } from './AssistantThreadFilesView';
import { AssistantWorkspaceAccessView } from './AssistantWorkspaceAccessView';
import {
  AssistantSystemPromptModal,
  AssistantToolsPanel,
  AssistantWorkspacesPanel,
  ScopeModeControl,
} from './AssistantSettingsPanels';
import {
  AssistantQueuedPromptRow,
  AssistantMessageRow,
  AssistantThinkingRow,
  ChatsIdleActivityRow,
  MessageDroneActivityRow,
  RepeatedToolActivityRow,
  ToolActivityRow,
} from './AssistantTranscript';
import { ApprovalCard } from './AssistantWorkflowCards';
import { NativeAgentModelControls } from './NativeAgentModelControls';
import {
  assistantThreadStatusLabel,
  assistantThreadStatusTone,
  formatArtifactSize,
  formatUpdatedAt,
} from './assistant-formatters';
import {
  assistantHasEnabledMcpGroup,
  assistantPromptHasVisibleUserMessage,
  compactPreview,
  isChatIdleToolName,
  lastAssistantContentBlock,
  latestThinkingText,
  messageDroneDetails,
  messageImageParts,
  messageText,
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
  type AssistantToolRenderItem,
  type AssistantWaitTargetLabel,
} from './assistant-message-model';
import type {
  AssistantAccessScope,
  AssistantApproval,
  AssistantArtifactFile,
  AssistantArtifactSummary,
  AssistantAttachmentPayload,
  AssistantAttachmentSource,
  AssistantDraftAttachment,
  AssistantDraftFileAttachment,
  AssistantDraftImageAttachment,
  AssistantDraftTextAttachment,
  AssistantDefaultSettings,
  AssistantDroneNameMap,
  AssistantDroneReference,
  AssistantMessage,
  AssistantModelOption,
  AssistantPromptDeliveryMode,
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
const ASSISTANT_FILES_OPEN_STORAGE_KEY = 'droneHub.assistant.filesOpen';
/** Distance from bottom (px) below which we treat the assistant transcript as "pinned" for auto-scroll. */
const ASSISTANT_SCROLL_BOTTOM_THRESHOLD_PX = 48;

const EMPTY_ASSISTANT_MODEL_OPTIONS: AssistantModelOption[] = [];
const EMPTY_ASSISTANT_TOOL_SUMMARIES: AssistantToolSummary[] = [];
const EMPTY_ASSISTANT_WORKSPACES: AssistantWorkspaceSummary[] = [];

function readInitialFilesOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ASSISTANT_FILES_OPEN_STORAGE_KEY) === '1';
}

function assistantScopeSyncKey(readMode: AssistantScopeMode, writeMode: AssistantScopeMode, executeMode: AssistantScopeMode, droneIds: string[]): string {
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

function cleanAssistantDroneReferences(drones: AssistantDroneReference[]): AssistantDroneReference[] {
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

function appendAssistantDroneReferences(promptRaw: string, drones: AssistantDroneReference[]): string {
  const prompt = String(promptRaw ?? '').trim();
  const referenceBlock = assistantDroneReferenceBlock(drones);
  if (!referenceBlock) return prompt;
  return prompt ? `${prompt}\n\n${referenceBlock}` : referenceBlock;
}

function assistantScopeDroneIds(readMode: AssistantScopeMode, writeMode: AssistantScopeMode, executeMode: AssistantScopeMode, drones: AssistantScopeDrone[]): string[] {
  if (readMode !== 'selected' && writeMode !== 'selected' && executeMode !== 'selected') return [];
  return cleanAssistantScopeDrones(drones).map((drone) => drone.id);
}

function assistantDroneDropTargetFromDragData(data: ReturnType<typeof parseDroneHubDragData>): { ids: string[]; fallbackLabel: string } | null {
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
  const ids = readMode === 'selected' || writeMode === 'selected' || executeMode === 'selected' ? cleanAssistantScopeIds(scope.droneIds) : [];
  return assistantScopeSyncKey(readMode, writeMode, executeMode, ids);
}

function assistantScopeUpdatedAtMs(scope: AssistantAccessScope | null | undefined): number {
  const ms = Date.parse(String(scope?.updatedAt ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

function attachmentMimeForFile(file: File): string {
  const mime = String((file as any).type ?? '').trim().toLowerCase();
  if (mime && (mime !== 'application/octet-stream' || !isLikelyImageFile(file))) return mime;
  const name = String((file as any).name ?? '').trim().toLowerCase();
  if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
  if (/\.gif$/.test(name)) return 'image/gif';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.svg$/.test(name)) return 'image/svg+xml';
  if (/\.avif$/.test(name)) return 'image/avif';
  if (/\.bmp$/.test(name)) return 'image/bmp';
  if (/\.tiff?$/.test(name)) return 'image/tiff';
  return isLikelyImageFile(file) ? 'image/png' : mime || 'application/octet-stream';
}

function revokeAssistantAttachmentPreviewUrls(items: AssistantDraftAttachment[]): void {
  for (const item of items) {
    if (item.kind === 'image' && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}

function makeAssistantPastedTextAttachmentName(existingCount: number): string {
  return existingCount <= 0 ? 'pasted-text.txt' : `pasted-text-${existingCount + 1}.txt`;
}

async function encodeAssistantAttachment(attachment: AssistantDraftAttachment): Promise<AssistantAttachmentPayload> {
  if (attachment.kind === 'image') {
    return {
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      dataBase64: await fileToBase64(attachment.file),
      disposition: attachment.source === 'paste' ? 'prompt' : 'artifact',
    };
  }
  if (attachment.kind === 'text') {
    return {
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      dataBase64: await blobToBase64(new Blob([attachment.text], { type: attachment.mime })),
      disposition: 'artifact',
    };
  }
  return {
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    dataBase64: await fileToBase64(attachment.file),
    disposition: 'artifact',
  };
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

export function AssistantDock({
  nativeChat,
  onHistoryChange,
}: {
  nativeChat: NativeChatBinding;
  onHistoryChange?: (hasHistory: boolean) => void;
}) {
  const nativeDroneId = nativeChat.droneId;
  const nativeChatName = nativeChat.chatName;
  const [snapshot, setSnapshot] = React.useState<AssistantSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [attachments, setAttachments] = React.useState<AssistantDraftAttachment[]>([]);
  const [referencedDrones, setReferencedDrones] = React.useState<AssistantDroneReference[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [attachmentDragActive, setAttachmentDragActive] = React.useState(false);
  const [filesOpen, setFilesOpen] = React.useState(readInitialFilesOpen);
  const [artifactFiles, setArtifactFiles] = React.useState<AssistantArtifactSummary[]>([]);
  const [selectedArtifactPath, setSelectedArtifactPath] = React.useState<string | null>(null);
  const [selectedArtifactFile, setSelectedArtifactFile] = React.useState<AssistantArtifactFile | null>(null);
  const [artifactsLoading, setArtifactsLoading] = React.useState(false);
  const [artifactsError, setArtifactsError] = React.useState<string | null>(null);
  const [scopeReadMode, setScopeReadMode] = React.useState<AssistantScopeMode>('all');
  const [scopeWriteMode, setScopeWriteMode] = React.useState<AssistantScopeMode>('all');
  const [scopeExecuteMode, setScopeExecuteMode] = React.useState<AssistantScopeMode>('all');
  const [scopeDrones, setScopeDrones] = React.useState<AssistantScopeDrone[]>([]);
  const [scopeSyncBusy, setScopeSyncBusy] = React.useState(false);
  const [droneNameById, setDroneNameById] = React.useState<AssistantDroneNameMap>({});
  const [approvalBusyId, setApprovalBusyId] = React.useState<string | null>(null);
  const [queuedPromptBusyId, setQueuedPromptBusyId] = React.useState<string | null>(null);
  const [assistantStopBusy, setAssistantStopBusy] = React.useState(false);
  const [defaultModelBusy, setDefaultModelBusy] = React.useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = React.useState(false);
  const [workspacesPanelOpen, setWorkspacesPanelOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [workspaceAccessOpen, setWorkspaceAccessOpen] = React.useState(false);
  const [enabledToolDraftNames, setEnabledToolDraftNames] = React.useState<string[]>([]);
  const [enabledWorkspaceDraftIds, setEnabledWorkspaceDraftIds] = React.useState<string[]>([]);
  const [defaultEnabledToolDraftNames, setDefaultEnabledToolDraftNames] = React.useState<string[]>([]);
  const [defaultToolsBusy, setDefaultToolsBusy] = React.useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = React.useState(false);
  const [systemPromptMode, setSystemPromptMode] = React.useState<'thread' | 'global'>('thread');
  const [systemPromptSettings, setSystemPromptSettings] = React.useState<AssistantSystemPromptSettings | null>(null);
  const [systemPromptDraft, setSystemPromptDraft] = React.useState('');
  const [threadSystemPromptSettings, setThreadSystemPromptSettings] = React.useState<AssistantThreadSystemPromptSettings | null>(null);
  const [threadSystemPromptDraft, setThreadSystemPromptDraft] = React.useState('');
  const [systemPromptLoading, setSystemPromptLoading] = React.useState(false);
  const [systemPromptSaving, setSystemPromptSaving] = React.useState(false);
  const [threadSystemPromptSaving, setThreadSystemPromptSaving] = React.useState(false);
  const [promoteSystemPromptSaving, setPromoteSystemPromptSaving] = React.useState(false);
  const [systemPromptError, setSystemPromptError] = React.useState<string | null>(null);
  const [systemPromptNotice, setSystemPromptNotice] = React.useState<string | null>(null);
  const activeDroneHubDrag = useDroneHubActiveDrag();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const scrollContentRef = React.useRef<HTMLDivElement | null>(null);
  const assistantThreadRef = React.useRef<HTMLDivElement | null>(null);
  /** When false, new transcript content must not force scroll position (user scrolled up). */
  const assistantStickToBottomRef = React.useRef(true);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const attachmentsRef = React.useRef<AssistantDraftAttachment[]>([]);
  const referencedDronesRef = React.useRef<AssistantDroneReference[]>([]);
  const refocusInputWhenIdleRef = React.useRef(false);
  const activeThreadIdRef = React.useRef('');
  const currentScopeKeyRef = React.useRef('');
  const lastSyncedScopeKeyRef = React.useRef('');
  const lastSyncedScopeUpdatedAtMsRef = React.useRef(0);
  const scopeSaveRequestIdRef = React.useRef(0);
  const scopeSyncPromiseRef = React.useRef<PendingAssistantScopeSave | null>(null);
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
  const scopeDropActive = scopeDropIsOver && assignedDroneIdsFromData(activeDroneHubDrag).length > 0;

  const updateAssistantPinned = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
    assistantStickToBottomRef.current = gap <= ASSISTANT_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollAssistantToBottom = React.useCallback((options: { force?: boolean; retries?: number } = {}) => {
    const { force = false, retries = 4 } = options;
    if (force) assistantStickToBottomRef.current = true;
    let triesRemaining = retries;
    const attempt = () => {
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) {
          if (triesRemaining > 0) {
            triesRemaining -= 1;
            attempt();
          }
          return;
        }
        if (!force && !assistantStickToBottomRef.current) return;
        node.scrollTop = node.scrollHeight;
        updateAssistantPinned(node);
        if (force) assistantStickToBottomRef.current = true;
        const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
        if (gap > 1 && triesRemaining > 0) {
          triesRemaining -= 1;
          attempt();
        }
      });
    };
    attempt();
  }, [updateAssistantPinned]);

  const activeThread = snapshot?.threads[0] ?? null;
  const activeThreadId = activeThread?.id ?? '';
  activeThreadIdRef.current = activeThreadId;
  const autoApprove = Boolean(activeThread?.autoApprove);
  const blipSession = useBlipThreadSession(activeThreadId, Boolean(activeThread), () => {
    nativeChangeRefreshRef.current();
  });
  const hasHistory =
    blipSession.messages.length > 0 ||
    Boolean(blipSession.streamingMessage) ||
    Boolean(snapshot?.streamingMessage) ||
    Boolean(snapshot?.streamingMessages?.length) ||
    Boolean(activeThread?.queuedPrompts?.length);
  React.useEffect(() => {
    if (hasHistory) onHistoryChange?.(true);
  }, [hasHistory, onHistoryChange]);
  React.useEffect(() => {
    if (activeThreadId) void blipSession.refreshHistory({ quiet: true });
  }, [activeThread?.updatedAt, activeThreadId, blipSession.refreshHistory]);
  const loadOlderMessages = React.useCallback(async () => {
    const node = scrollRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    const previousTop = node?.scrollTop ?? 0;
    await blipSession.loadOlder();
    requestAnimationFrame(() => {
      const current = scrollRef.current;
      if (!current) return;
      current.scrollTop = previousTop + Math.max(0, current.scrollHeight - previousHeight);
    });
  }, [blipSession]);
  const promptDeliveryMode: AssistantPromptDeliveryMode = activeThread?.promptDeliveryMode === 'asap' ? 'asap' : 'queue';
  const activeAccessScope: AssistantAccessScope | null = activeThread?.accessScope ?? snapshot?.accessScope ?? null;
  const activeAccessScopeDroneIdsKey = activeAccessScope?.droneIds?.join('\u0000') ?? '';
  const activePendingApprovals = React.useMemo(
    () => (snapshot?.pendingApprovals ?? []).filter((approval) => approval.threadId === activeThread?.id && approval.status === 'pending'),
    [activeThread?.id, snapshot?.pendingApprovals],
  );
  const visibleQueuedPrompts = React.useMemo(
    () =>
      (activeThread?.queuedPrompts ?? []).filter(
        (prompt) =>
          prompt.status !== 'running' ||
          !assistantPromptHasVisibleUserMessage(blipSession.messages, prompt),
      ),
    [activeThread?.queuedPrompts, blipSession.messages],
  );
  const running =
    blipSession.running ||
    activeThread?.status === 'running' ||
    activeThread?.status === 'waiting_for_approval';
  const droneMentionLinks = React.useMemo<MarkdownTextMentionLink[]>(() => {
    const nameCounts = new Map<string, number>();
    for (const name of Object.values(droneNameById)) {
      const label = String(name ?? '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    return Object.entries(droneNameById)
      .map(([droneId, name]) => ({ droneId: String(droneId ?? '').trim(), name: String(name ?? '').trim() }))
      .filter(({ droneId, name }) => Boolean(droneId && name && nameCounts.get(name.toLowerCase()) === 1))
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
  const { isOver: droneReferenceDropIsOver, setNodeRef: setDroneReferenceDropNodeRef } = useDroppable({
    id: 'assistant-message-drone-reference-drop',
    data: { type: 'assistant-message-drone-reference-drop' },
    disabled: droneReferenceControlsLocked,
  });
  const droneReferenceDropActive = droneReferenceDropIsOver && assignedDroneIdsFromData(activeDroneHubDrag).length > 0;
  const visibleMessages = React.useMemo(() => {
    const messages = blipSession.messages as AssistantMessage[];
    const snapshotStreamingMessages = Array.isArray(snapshot?.streamingMessages) && snapshot.streamingMessages.length > 0
      ? snapshot.streamingMessages
      : snapshot?.streamingMessage
        ? [snapshot.streamingMessage]
        : [];
    const streamingMessages = [
      ...snapshotStreamingMessages,
      ...(blipSession.streamingMessage ? [blipSession.streamingMessage as AssistantMessage] : []),
    ];
    const visibleStreaming = streamingMessages.filter((streaming) => streaming.role === 'assistant' || streaming.role === 'user');
    if (visibleStreaming.length === 0) return messages;
    return [...messages, ...visibleStreaming];
  }, [blipSession.messages, blipSession.streamingMessage, snapshot?.streamingMessage, snapshot?.streamingMessages]);
  const visibleItems = React.useMemo(() => {
    return renderItemsFromMessages(visibleMessages);
  }, [visibleMessages]);
  const latestActivityItemKey = React.useMemo(() => {
    return visibleItems[visibleItems.length - 1]?.key ?? '';
  }, [visibleItems]);
  const streamingAssistantSourceIndex = React.useMemo(() => {
    const snapshotStreamingMessages = Array.isArray(snapshot?.streamingMessages) && snapshot.streamingMessages.length > 0
      ? snapshot.streamingMessages
      : snapshot?.streamingMessage
        ? [snapshot.streamingMessage]
        : [];
    const streamingMessages = [
      ...snapshotStreamingMessages,
      ...(blipSession.streamingMessage ? [blipSession.streamingMessage as AssistantMessage] : []),
    ];
    const assistantStreamingOffset = streamingMessages.findIndex((streaming) => streaming.role === 'assistant');
    if (assistantStreamingOffset < 0) return -1;
    return blipSession.messages.length + assistantStreamingOffset;
  }, [blipSession.messages.length, blipSession.streamingMessage, snapshot?.streamingMessage, snapshot?.streamingMessages]);
  const streamingAssistantMessage = React.useMemo(() => {
    const snapshotStreamingMessages = Array.isArray(snapshot?.streamingMessages) && snapshot.streamingMessages.length > 0
      ? snapshot.streamingMessages
      : snapshot?.streamingMessage
        ? [snapshot.streamingMessage]
        : [];
    const streamingMessages = [
      ...snapshotStreamingMessages,
      ...(blipSession.streamingMessage ? [blipSession.streamingMessage as AssistantMessage] : []),
    ];
    return streamingMessages.find((streaming) => streaming.role === 'assistant') ?? null;
  }, [blipSession.streamingMessage, snapshot?.streamingMessage, snapshot?.streamingMessages]);
  const latestActivityShowsReasoning = React.useMemo(() => {
    if (!running || !latestActivityItemKey) return false;
    const item = visibleItems.find((candidate) => candidate.key === latestActivityItemKey);
    if (item?.type !== 'message' || item.message.role !== 'assistant') return false;
    if (lastAssistantContentBlock(item.message)?.type !== 'thinking') return false;
    return Boolean(latestThinkingText(item.message).trim() || item.sourceMessageIndex === streamingAssistantSourceIndex);
  }, [latestActivityItemKey, running, streamingAssistantSourceIndex, visibleItems]);
  const showThinking =
    running &&
    activePendingApprovals.length === 0 &&
    !latestActivityShowsReasoning &&
    !messageText(streamingAssistantMessage ?? { role: 'assistant' }).trim();
  const showEmptyAssistantThread =
    !(loading && !snapshot) &&
    !blipSession.historyLoading &&
    visibleItems.length === 0 &&
    visibleQueuedPrompts.length === 0 &&
    activePendingApprovals.length === 0 &&
    !showThinking;
  const toolDroneKey = React.useMemo(() => toolDroneLookupKey(visibleItems), [visibleItems]);

  const applySnapshot = React.useCallback((next: AssistantSnapshot) => setSnapshot(next), []);

  const beginSnapshotMutation = React.useCallback(() => {
    snapshotRequestSeqRef.current += 1;
    return snapshotRequestSeqRef.current;
  }, []);

  const snapshotMutationCurrent = React.useCallback((requestSeq: number) => snapshotRequestSeqRef.current === requestSeq, []);

  const refresh = React.useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setLoading(true);
      setError(null);
    }
    const requestSeq = snapshotRequestSeqRef.current;
    try {
      const next = await requestJson<AssistantSnapshot & { nativeChatId?: string }>(
        `/api/drones/${encodeURIComponent(nativeDroneId)}/chats/${encodeURIComponent(nativeChatName)}/native`,
        { method: 'POST' },
      );
      if (snapshotRequestSeqRef.current !== requestSeq) return;
      const nativeChatId = String(next.nativeChatId ?? next.chatId ?? '').trim();
      activeThreadIdRef.current = nativeChatId;
      applySnapshot(next);
    } catch (err: any) {
      if (!options.silent) setError(err?.message ?? String(err));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [applySnapshot, nativeChatName, nativeDroneId]);
  nativeChangeRefreshRef.current = () => {
    void refresh({ silent: true });
  };

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  React.useEffect(() => {
    referencedDronesRef.current = referencedDrones;
  }, [referencedDrones]);

  React.useEffect(() => {
    setAttachmentError(null);
    setAttachmentDragActive(false);
    setReferencedDrones([]);
    setAttachments((prev) => {
      revokeAssistantAttachmentPreviewUrls(prev);
      return [];
    });
  }, [activeThreadId]);

  React.useEffect(() => {
    return () => {
      revokeAssistantAttachmentPreviewUrls(attachmentsRef.current);
    };
  }, []);

  const loadSystemPromptSettings = React.useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    setSystemPromptLoading(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const [data, threadData] = await Promise.all([
        requestJson<AssistantSystemPromptSettings>('/api/assistant/system-prompt'),
        threadId
          ? requestJson<AssistantThreadSystemPromptSettings>(`/api/assistant/threads/${encodeURIComponent(threadId)}/system-prompt`)
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
    setSystemPromptMode('thread');
    setSystemPromptOpen(true);
    void loadSystemPromptSettings();
  }, [loadSystemPromptSettings]);

  const saveSystemPromptSettings = React.useCallback(async () => {
    setSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await requestJson<AssistantSystemPromptSettings>('/api/assistant/system-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: systemPromptDraft }),
      });
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
      const data = await requestJson<AssistantThreadSystemPromptSettings>(`/api/assistant/threads/${encodeURIComponent(threadId)}/system-prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: threadSystemPromptDraft }),
      });
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
    const confirmed = window.confirm('Promote this chat system prompt to the matching global prompt for new Built-in chats? Existing chats keep their own prompts.');
    if (!confirmed) return;
    setPromoteSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await requestJson<AssistantSystemPromptSettings>(`/api/assistant/threads/${encodeURIComponent(threadId)}/promote-system-prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: threadSystemPromptDraft }),
      });
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
    void refresh();
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

  const resolveScopeDroneNames = React.useCallback(async (ids: string[], fallbackLabel?: string): Promise<AssistantScopeDrone[]> => {
    const cleanIds = Array.from(new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
    if (cleanIds.length === 0) return [];
    try {
      const data = await requestJson<{ ok: true; drones?: Array<{ id?: string; name?: string }> }>('/api/drones');
      const nameEntries: Array<[string, string]> = (Array.isArray(data?.drones) ? data.drones : [])
        .map((drone): [string, string] => [String(drone?.id ?? '').trim(), String(drone?.name ?? '').trim()])
        .filter(([id]) => Boolean(id));
      const nameById = new Map<string, string>(nameEntries);
      return cleanIds.map((id) => ({ id, name: nameById.get(id) || (cleanIds.length === 1 ? fallbackLabel || id : id) }));
    } catch {
      return cleanIds.map((id) => ({ id, name: cleanIds.length === 1 ? fallbackLabel || id : id }));
    }
  }, []);

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
    if (!pending && incomingUpdatedAtMs > 0 && lastSyncedScopeUpdatedAtMsRef.current > 0 && incomingUpdatedAtMs < lastSyncedScopeUpdatedAtMsRef.current) {
      return;
    }
    lastSyncedScopeKeyRef.current = incomingKey;
    currentScopeKeyRef.current = incomingKey;
    lastSyncedScopeUpdatedAtMsRef.current = incomingUpdatedAtMs;
    setScopeReadMode(readMode);
    setScopeWriteMode(writeMode);
    setScopeExecuteMode(executeMode);
    if (ids.length === 0) {
      setScopeDrones([]);
      return;
    }
    void resolveScopeDroneNames(ids).then((drones) => {
      if (cancelled) return;
      setScopeDrones(drones);
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

  const saveScopeDraft = React.useCallback(async (draft: AssistantScopeDraft): Promise<boolean> => {
    const readMode = draft.readMode === 'selected' ? 'selected' : 'all';
    const writeMode = draft.writeMode === 'selected' ? 'selected' : 'all';
    const executeMode = draft.executeMode === 'selected' ? 'selected' : 'all';
    const cleanDrones = cleanAssistantScopeDrones(draft.drones);
    const visibleDrones = readMode === 'selected' || writeMode === 'selected' || executeMode === 'selected' ? cleanDrones : [];
    const scopedDroneIds = assistantScopeDroneIds(readMode, writeMode, executeMode, visibleDrones);
    const syncKey = assistantScopeSyncKey(readMode, writeMode, executeMode, scopedDroneIds);
    currentScopeKeyRef.current = syncKey;
    setScopeReadMode(readMode);
    setScopeWriteMode(writeMode);
    setScopeExecuteMode(executeMode);
    setScopeDrones(visibleDrones);
    if (!activeThread) return true;
    if (lastSyncedScopeKeyRef.current === syncKey && !scopeSyncPromiseRef.current) return true;
    if (scopeSyncPromiseRef.current?.key === syncKey) return await scopeSyncPromiseRef.current.promise;
    const requestId = scopeSaveRequestIdRef.current + 1;
    scopeSaveRequestIdRef.current = requestId;
    const threadId = activeThread.id;
    setScopeSyncBusy(true);
    const promise = requestJson<AssistantScopeUpdateResult>('/api/assistant/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId,
        readMode,
        writeMode,
        executeMode,
        droneIds: scopedDroneIds,
      }),
    })
      .then((data) => {
        if (scopeSaveRequestIdRef.current !== requestId) return true;
        const savedScope = data.accessScope ?? { readMode, writeMode, executeMode, droneIds: scopedDroneIds, updatedAt: new Date().toISOString() };
        lastSyncedScopeKeyRef.current = assistantScopeKeyFromScope(savedScope);
        lastSyncedScopeUpdatedAtMsRef.current = assistantScopeUpdatedAtMs(savedScope);
        return true;
      })
      .catch((err: any) => {
        if (scopeSaveRequestIdRef.current === requestId) setError(err?.message ?? String(err));
        return false;
      })
      .finally(() => {
        if (scopeSyncPromiseRef.current?.requestId === requestId) {
          scopeSyncPromiseRef.current = null;
          setScopeSyncBusy(false);
        }
      });
    scopeSyncPromiseRef.current = { requestId, threadId, key: syncKey, promise };
    return await promise;
  }, [activeThread]);

  const waitForScopeSave = React.useCallback(async (): Promise<boolean> => {
    if (scopeSyncPromiseRef.current && !(await scopeSyncPromiseRef.current.promise)) return false;
    if (currentScopeKeyRef.current && lastSyncedScopeKeyRef.current !== currentScopeKeyRef.current) {
      setError('Built-in agent access changes are not saved yet.');
      return false;
    }
    return true;
  }, []);

  const addScopeDrones = React.useCallback((drones: AssistantScopeDrone[]) => {
    const clean = cleanAssistantScopeDrones(drones);
    if (clean.length === 0) return;
    const byId = new Map(scopeDrones.map((drone) => [drone.id, drone]));
    for (const drone of clean) byId.set(drone.id, drone);
    void saveScopeDraft({ readMode: 'selected', writeMode: 'selected', executeMode: 'selected', drones: Array.from(byId.values()) });
  }, [saveScopeDraft, scopeDrones]);

  const addReferencedDrones = React.useCallback((drones: AssistantDroneReference[]) => {
    const clean = cleanAssistantDroneReferences(drones);
    if (clean.length === 0) return;
    setAttachmentError(null);
    setReferencedDrones((prev) => {
      const byId = new Map(prev.map((drone) => [drone.id, drone]));
      for (const drone of clean) byId.set(drone.id, drone);
      return Array.from(byId.values());
    });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const removeReferencedDrone = React.useCallback((droneIdRaw: string) => {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    setReferencedDrones((prev) => prev.filter((drone) => drone.id !== droneId));
  }, []);

  const removeScopeDrone = React.useCallback((droneId: string) => {
    void saveScopeDraft({
      readMode: scopeReadMode,
      writeMode: scopeWriteMode,
      executeMode: scopeExecuteMode,
      drones: scopeDrones.filter((drone) => drone.id !== droneId),
    });
  }, [saveScopeDraft, scopeDrones, scopeExecuteMode, scopeReadMode, scopeWriteMode]);

  const updateScopeReadMode = React.useCallback((mode: AssistantScopeMode) => {
    void saveScopeDraft({ readMode: mode, writeMode: scopeWriteMode, executeMode: scopeExecuteMode, drones: scopeDrones });
  }, [saveScopeDraft, scopeDrones, scopeExecuteMode, scopeWriteMode]);

  const updateScopeWriteMode = React.useCallback((mode: AssistantScopeMode) => {
    void saveScopeDraft({ readMode: scopeReadMode, writeMode: mode, executeMode: scopeExecuteMode, drones: scopeDrones });
  }, [saveScopeDraft, scopeDrones, scopeExecuteMode, scopeReadMode]);

  const updateScopeExecuteMode = React.useCallback((mode: AssistantScopeMode) => {
    void saveScopeDraft({ readMode: scopeReadMode, writeMode: scopeWriteMode, executeMode: mode, drones: scopeDrones });
  }, [saveScopeDraft, scopeDrones, scopeReadMode, scopeWriteMode]);

  useDndMonitor({
    onDragEnd: (event) => {
      const overId = String(event.over?.id ?? '');
      if (overId !== 'assistant-drone-scope-drop' && overId !== 'assistant-message-drone-reference-drop') return;
      const data = parseDroneHubDragData(event.active.data.current);
      const target = assistantDroneDropTargetFromDragData(data);
      if (!target || target.ids.length === 0) return;
      const droppedOnThreadId = activeThreadIdRef.current;
      void resolveScopeDroneNames(target.ids, target.fallbackLabel).then((drones) => {
        if (overId === 'assistant-drone-scope-drop') {
          addScopeDrones(drones);
          return;
        }
        if (activeThreadIdRef.current !== droppedOnThreadId) return;
        addReferencedDrones(drones);
      });
    },
  });

  React.useLayoutEffect(() => {
    scrollAssistantToBottom({ force: true });
  }, [activeThreadId, filesOpen, scrollAssistantToBottom]);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = () => updateAssistantPinned(node);
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [activeThreadId, filesOpen, updateAssistantPinned]);

  React.useEffect(() => {
    if (!assistantStickToBottomRef.current) return;
    scrollAssistantToBottom();
  }, [activePendingApprovals.length, scrollAssistantToBottom, showThinking, snapshot?.streamingMessage, visibleItems, visibleQueuedPrompts.length]);

  React.useEffect(() => {
    const node = scrollRef.current;
    const content = scrollContentRef.current;
    if ((!node && !content) || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (assistantStickToBottomRef.current) scrollAssistantToBottom({ retries: 1 });
    });
    if (node) observer.observe(node);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [activeThreadId, filesOpen, scrollAssistantToBottom]);

  React.useEffect(() => {
    if (running || !refocusInputWhenIdleRef.current) return;
    refocusInputWhenIdleRef.current = false;
    inputRef.current?.focus();
  }, [running]);

  const updateThread = React.useCallback(async (patch: Partial<Pick<AssistantThread, 'title' | 'model' | 'provider' | 'thinkingLevel' | 'autoApprove' | 'promptDeliveryMode' | 'enabledTools' | 'enabledWorkspaceIds'>>) => {
    if (!activeThread) return false;
    const requestId = updateThreadRequestRef.current + 1;
    updateThreadRequestRef.current = requestId;
    const requestSeq = beginSnapshotMutation();
    try {
      const next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (updateThreadRequestRef.current === requestId && snapshotMutationCurrent(requestSeq)) applySnapshot(next);
      return true;
    } catch (err: any) {
      if (updateThreadRequestRef.current === requestId && snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
      return false;
    }
  }, [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const attachmentControlsLocked = !activeThread;
  const imageAttachmentCount = React.useMemo(
    () => attachments.filter((attachment) => attachment.kind === 'image').length,
    [attachments],
  );
  const promptImageAttachmentCount = React.useMemo(
    () => attachments.filter((attachment) => attachment.kind === 'image' && attachment.source === 'paste').length,
    [attachments],
  );

  const openAttachmentPicker = React.useCallback(() => {
    if (attachmentControlsLocked) return;
    attachmentInputRef.current?.click();
  }, [attachmentControlsLocked]);

  const removeAttachment = React.useCallback((id: string) => {
    setAttachmentError(null);
    setAttachments((prev) => {
      const idx = prev.findIndex((attachment) => attachment.id === id);
      if (idx < 0) return prev;
      const next = prev.slice();
      const [removed] = next.splice(idx, 1);
      if (removed) revokeAssistantAttachmentPreviewUrls([removed]);
      return next;
    });
  }, []);

  const addAttachmentFiles = React.useCallback((files: File[] | FileList | null | undefined, options?: { source?: AssistantAttachmentSource }) => {
    if (attachmentControlsLocked) return;
    if (!files) return;
    const list = Array.isArray(files) ? files : Array.from(files);
    if (list.length === 0) return;
    const source = options?.source ?? 'file';
    setAttachmentError(null);
    setAttachments((prev) => {
      const next = prev.slice();
      let total = next.reduce((sum, attachment) => sum + (Number(attachment.size) || 0), 0);
      let images = next.filter((attachment) => attachment.kind === 'image').length;
      for (const file of list) {
        if (!file) continue;
        const size = Number((file as any).size ?? 0);
        if (!Number.isFinite(size) || size <= 0) {
          setAttachmentError('One selected file is empty or unreadable.');
          continue;
        }
        if (size > CHAT_INPUT_MAX_BYTES_EACH) {
          setAttachmentError(`File too large (${formatBytes(size)}). Max per file is ${formatBytes(CHAT_INPUT_MAX_BYTES_EACH)}.`);
          continue;
        }
        if (next.length >= CHAT_INPUT_MAX_IMAGES) {
          setAttachmentError(`Too many files. Max is ${CHAT_INPUT_MAX_IMAGES}.`);
          break;
        }
        if (total + size > CHAT_INPUT_MAX_BYTES_TOTAL) {
          setAttachmentError(`Attachments too large in total. Max total is ${formatBytes(CHAT_INPUT_MAX_BYTES_TOTAL)}.`);
          break;
        }
        const name = String((file as any).name ?? '').trim() || `attachment-${next.length + 1}`;
        const mime = attachmentMimeForFile(file);
        if (isLikelyImageFile(file)) {
          if (images >= CHAT_INPUT_MAX_IMAGES) {
            setAttachmentError(`Too many images. Max is ${CHAT_INPUT_MAX_IMAGES}.`);
            break;
          }
          next.push({
            kind: 'image',
            id: makeDraftImageAttachmentId(),
            file,
            name,
            mime,
            size: Math.floor(size),
            previewUrl: URL.createObjectURL(file),
            source,
          });
          images += 1;
        } else {
          next.push({
            kind: 'file',
            id: makeDraftImageAttachmentId(),
            file,
            name,
            mime,
            size: Math.floor(size),
            source: 'file',
          });
        }
        total += size;
      }
      return next;
    });
  }, [attachmentControlsLocked]);

  const addPastedTextAttachment = React.useCallback((textRaw: string) => {
    if (attachmentControlsLocked) return;
    const text = String(textRaw ?? '');
    if (!text) return;
    const size = textByteLength(text);
    setAttachmentError(null);
    setAttachments((prev) => {
      const total = prev.reduce((sum, attachment) => sum + (Number(attachment.size) || 0), 0);
      if (prev.length >= CHAT_INPUT_MAX_IMAGES) {
        setAttachmentError(`Too many files. Max is ${CHAT_INPUT_MAX_IMAGES}.`);
        return prev;
      }
      if (size > CHAT_INPUT_MAX_BYTES_EACH) {
        setAttachmentError(`Pasted text too large (${formatBytes(size)}). Max per file is ${formatBytes(CHAT_INPUT_MAX_BYTES_EACH)}.`);
        return prev;
      }
      if (total + size > CHAT_INPUT_MAX_BYTES_TOTAL) {
        setAttachmentError(`Attachments too large in total. Max total is ${formatBytes(CHAT_INPUT_MAX_BYTES_TOTAL)}.`);
        return prev;
      }
      const textCount = prev.filter((attachment) => attachment.kind === 'text').length;
      return [
        ...prev,
        {
          kind: 'text',
          id: makeDraftImageAttachmentId(),
          text,
          name: makeAssistantPastedTextAttachmentName(textCount),
          mime: 'text/plain',
          size,
          source: 'paste',
        },
      ];
    });
  }, [attachmentControlsLocked]);

  const handleAssistantPaste = React.useCallback((event: React.ClipboardEvent): boolean => {
    if (attachmentControlsLocked || filesOpen) return false;
    const clipboardData = event.clipboardData;
    const pastedImages = imageFilesFromClipboardData(clipboardData);
    if (pastedImages.length > 0) {
      event.preventDefault();
      addAttachmentFiles(pastedImages, { source: 'paste' });
      return true;
    }

    const files = filesFromClipboardData(clipboardData);
    const nonImageFiles = files.filter((file) => !isLikelyImageFile(file));
    if (nonImageFiles.length > 0) {
      event.preventDefault();
      addAttachmentFiles(nonImageFiles, { source: 'file' });
      return true;
    }

    const pastedText = String(clipboardData?.getData('text/plain') ?? '');
    if (pastedText.length >= CHAT_INPUT_PASTE_TEXT_AS_ATTACHMENT_MIN_CHARS) {
      event.preventDefault();
      addPastedTextAttachment(pastedText);
      return true;
    }
    return false;
  }, [addAttachmentFiles, addPastedTextAttachment, attachmentControlsLocked, filesOpen]);

  const focusAssistantThreadForPaste = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('button,a,input,textarea,select,[role="button"],[role="menuitem"],[contenteditable="true"]')) return;
    assistantThreadRef.current?.focus();
  }, []);

  const sendPrompt = React.useCallback(async () => {
    if (!activeThread) return;
    const draftPrompt = draft.trim();
    const attachmentSnapshot = attachmentsRef.current.slice();
    const referencedDroneSnapshot = referencedDronesRef.current.slice();
    const prompt = appendAssistantDroneReferences(draftPrompt, referencedDroneSnapshot);
    if (!prompt && attachmentSnapshot.length === 0) return;
    const requestSeq = beginSnapshotMutation();
    setError(null);
    setAttachmentError(null);
    if (!(await waitForScopeSave())) return;
    if (!snapshotMutationCurrent(requestSeq)) return;
    setDraft('');
    setAttachments([]);
    setReferencedDrones([]);
    scrollAssistantToBottom({ force: true });
    refocusInputWhenIdleRef.current = true;
    let encodedAttachments: AssistantAttachmentPayload[] = [];
    try {
      encodedAttachments = await Promise.all(attachmentSnapshot.map(encodeAssistantAttachment));
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) {
        setAttachmentError(`Failed to read attachment: ${err?.message ?? String(err)}`);
        setDraft((cur) => (cur.trim() ? cur : draftPrompt));
        setAttachments((cur) => (cur.length === 0 ? attachmentSnapshot : cur));
        setReferencedDrones((cur) => (cur.length === 0 ? referencedDroneSnapshot : cur));
      }
      return;
    }
    if (!snapshotMutationCurrent(requestSeq)) return;
    const response = await fetch(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        attachments: encodedAttachments,
        provider: activeThread.provider,
        model: activeThread.model,
        thinkingLevel: activeThread.thinkingLevel,
      }),
    });
    let sentOk = true;
    try {
      await readNdjson(response, (event) => {
        if (!snapshotMutationCurrent(requestSeq)) return;
        blipSession.handleStreamEvent(event);
        if (event?.type === 'error') {
          sentOk = false;
          setError(String(event.error ?? 'Built-in agent failed.'));
        }
      });
      if (!sentOk && snapshotMutationCurrent(requestSeq)) {
        setDraft((cur) => (cur.trim() ? cur : draftPrompt));
        setAttachments((cur) => (cur.length === 0 ? attachmentSnapshot : cur));
        setReferencedDrones((cur) => (cur.length === 0 ? referencedDroneSnapshot : cur));
      }
    } catch (err: any) {
      sentOk = false;
      if (snapshotMutationCurrent(requestSeq)) {
        setError(err?.message ?? String(err));
        setDraft((cur) => (cur.trim() ? cur : draftPrompt));
        setAttachments((cur) => (cur.length === 0 ? attachmentSnapshot : cur));
        setReferencedDrones((cur) => (cur.length === 0 ? referencedDroneSnapshot : cur));
      }
    } finally {
      if (sentOk && attachmentSnapshot.length > 0) {
        revokeAssistantAttachmentPreviewUrls(attachmentSnapshot);
      }
      if (snapshotMutationCurrent(requestSeq)) {
        void blipSession.refreshHistory({ quiet: true });
        void refresh({ silent: true });
      }
      if (snapshotMutationCurrent(requestSeq) && sentOk && attachmentSnapshot.length > 0) {
        requestJson<{ ok: true; threadId: string; files: AssistantArtifactSummary[] }>(
          `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/artifacts`,
        )
          .then((data) => {
            if (activeThreadIdRef.current === activeThread.id) setArtifactFiles(Array.isArray(data.files) ? data.files : []);
          })
          .catch(() => {});
      }
    }
  }, [activeThread, beginSnapshotMutation, blipSession, draft, refresh, scrollAssistantToBottom, snapshotMutationCurrent, waitForScopeSave]);

  const stop = React.useCallback(async () => {
    if (!activeThread) return;
    const requestSeq = beginSnapshotMutation();
    setAssistantStopBusy(true);
    try {
      const next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}/stop`, { method: 'POST' });
      if (!snapshotMutationCurrent(requestSeq)) return;
      applySnapshot(next);
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    } finally {
      setAssistantStopBusy(false);
    }
  }, [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const cancelQueuedPrompt = React.useCallback(async (promptId: string) => {
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
  }, [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const resolveApproval = React.useCallback(async (approval: AssistantApproval, approved: boolean) => {
    if (!activeThread) return;
    const requestSeq = beginSnapshotMutation();
    setApprovalBusyId(approval.id);
    try {
      const next = await requestJson<AssistantSnapshot>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/approvals/${encodeURIComponent(approval.id)}/${approved ? 'approve' : 'deny'}`,
        { method: 'POST' },
      );
      if (!snapshotMutationCurrent(requestSeq)) return;
      applySnapshot(next);
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    } finally {
      setApprovalBusyId(null);
    }
  }, [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const setActiveModelAsDefault = React.useCallback(async () => {
    if (!activeThread) return;
    if (
      snapshot?.defaultModel.provider === activeThread.provider &&
      snapshot.defaultModel.model === activeThread.model &&
      snapshot.defaultModel.thinkingLevel === activeThread.thinkingLevel
    ) return;
    const requestSeq = beginSnapshotMutation();
    setDefaultModelBusy(true);
    try {
      const next = await requestJson<AssistantDefaultSettings>('/api/assistant/default-model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: activeThread.provider, model: activeThread.model, thinkingLevel: activeThread.thinkingLevel }),
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
      : toolNames.filter((name) => name !== 'get_system_prompt' && name !== 'update_system_prompt' && name !== 'set_thinking_level');
    return configured.filter((name) => toolNames.includes(name));
  }, [activeThread, availableTools]);
  const availableToolNamesKey = React.useMemo(() => availableTools.map((tool) => tool.name).join('\u0000'), [availableTools]);

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
      const unavailableConfigured = (activeThread?.enabledTools ?? []).filter((name) => !available.has(name));
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
      const unavailableConfigured = (snapshot?.defaultEnabledTools ?? []).filter((name) => !available.has(name));
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
      void updateDefaultEnabledTools(availableTools.map((tool) => tool.name).filter((name) => current.has(name)));
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
      void updateDefaultEnabledTools(availableTools.map((tool) => tool.name).filter((name) => current.has(name)));
    },
    [availableTools, updateDefaultEnabledTools],
  );

  const loadArtifactFiles = React.useCallback(async (options: { silent?: boolean } = {}) => {
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
      const data = await requestJson<{ ok: true; threadId: string; files: AssistantArtifactSummary[] }>(
        `/api/assistant/threads/${encodeURIComponent(threadId)}/artifacts`,
      );
      if (activeThreadIdRef.current !== threadId) return;
      setArtifactFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err: any) {
      if (activeThreadIdRef.current !== threadId) return;
      setArtifactsError(err?.message ?? String(err));
    } finally {
      if (!options.silent && activeThreadIdRef.current === threadId) setArtifactsLoading(false);
    }
  }, [activeThreadId]);

  const loadSelectedArtifactFile = React.useCallback(async (options: { silent?: boolean } = {}) => {
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
  }, [activeThreadId, selectedArtifactPath]);

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
    setSelectedArtifactPath((prev) => (prev && artifactFiles.some((file) => file.path === prev) ? prev : selectDefaultArtifactPath(artifactFiles)));
  }, [artifactFiles, filesOpen]);

  React.useEffect(() => {
    if (!filesOpen || !selectedArtifactPath) return;
    void loadSelectedArtifactFile();
  }, [activeThread?.updatedAt, filesOpen, loadSelectedArtifactFile, selectedArtifactPath]);

  return (
    <div data-assistant-dock-root="true" className="flex h-full min-h-0 bg-[var(--panel-alt)]">
      <div
        ref={assistantThreadRef}
        tabIndex={-1}
        className={`relative flex min-w-0 flex-1 flex-col outline-none ${attachmentDragActive ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''}`}
        onMouseDown={focusAssistantThreadForPaste}
        onPaste={(event) => {
          handleAssistantPaste(event);
        }}
        onDragEnter={(event) => {
          if (attachmentControlsLocked || filesOpen) return;
          if (event.dataTransfer?.types?.includes?.('Files')) setAttachmentDragActive(true);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer?.types?.includes?.('Files')) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAttachmentDragActive(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer?.types?.includes?.('Files')) return;
          event.preventDefault();
          setAttachmentDragActive(false);
          if (attachmentControlsLocked || filesOpen) return;
          addAttachmentFiles(event.dataTransfer?.files ?? null, { source: 'file' });
        }}
      >
        <div className="relative flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[rgba(255,255,255,.025)] px-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-[var(--fg)]">{activeThread?.title ?? nativeChat.chatName}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {activeThread ? <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${assistantThreadStatusTone(activeThread.status)}`} /> : null}
              <span className="truncate">{assistantThreadStatusLabel(activeThread?.status, loading ? 'loading' : 'idle')}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setWorkspaceAccessOpen(false);
              setWorkspacesPanelOpen(false);
              setFilesOpen((value) => !value);
            }}
            aria-pressed={filesOpen}
            className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] ${
              filesOpen
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title={filesOpen ? 'Hide thread files' : 'Show thread files'}
            aria-label={filesOpen ? 'Hide thread files' : 'Show thread files'}
          >
            <IconFile className="h-3.5 w-3.5" />
            {artifactFiles.length > 0 ? (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full border border-[var(--panel-alt)] bg-[var(--accent)] px-1 text-center text-[9px] font-semibold leading-4 text-[var(--accent-fg)]">
                {artifactFiles.length > 9 ? '9+' : artifactFiles.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={openSystemPromptEditor}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg)]"
            title="Edit system prompt"
            aria-label="Edit system prompt"
          >
            <IconPencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-assistant-workspaces-trigger
            onClick={() => {
              setFilesOpen(false);
              setToolsPanelOpen(false);
              setSettingsOpen(false);
              setWorkspaceAccessOpen(false);
              setWorkspacesPanelOpen((value) => !value);
            }}
            disabled={!activeThread}
            aria-pressed={workspacesPanelOpen || workspaceAccessOpen}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
              workspacesPanelOpen || workspaceAccessOpen
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title="Configure chat workspaces"
            aria-label="Configure chat workspaces"
          >
            <IconFolder className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-assistant-tools-trigger
            onClick={() => {
              setSettingsOpen(false);
              setWorkspaceAccessOpen(false);
              setWorkspacesPanelOpen(false);
              setToolsPanelOpen((value) => !value);
            }}
            disabled={!activeThread}
            aria-pressed={toolsPanelOpen}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
              toolsPanelOpen
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title="Configure thread tools"
            aria-label="Configure thread tools"
          >
            <IconWrench className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsPanelOpen(false);
              setWorkspaceAccessOpen(false);
              setWorkspacesPanelOpen(false);
              setSettingsOpen((value) => !value);
            }}
            aria-pressed={settingsOpen}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] ${
              settingsOpen
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title="Built-in agent settings"
            aria-label="Built-in agent settings"
          >
            <IconSettings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void updateThread({ autoApprove: !autoApprove })}
            disabled={!activeThread}
            aria-pressed={autoApprove}
            aria-label="Toggle auto-approve requests"
            title={autoApprove ? 'Auto-approve requests is on' : 'Auto-approve requests is off'}
            className={`h-8 w-8 flex-shrink-0 rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
              autoApprove
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
          >
            <IconShieldCheck className="mx-auto h-4 w-4" />
          </button>
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
            />
          ) : null}
          {workspacesPanelOpen ? (
            <AssistantWorkspacesPanel
              workspaces={availableWorkspaces}
              enabledWorkspaceIds={enabledWorkspaceDraftIds}
              disabled={!activeThread}
              onToggleWorkspace={toggleAssistantWorkspace}
              onEnableAll={() => updateEnabledWorkspaces(availableWorkspaces.map((workspace) => workspace.id))}
              onDisableAll={() => updateEnabledWorkspaces([])}
              onOpenRemoteAccess={() => {
                setWorkspacesPanelOpen(false);
                setWorkspaceAccessOpen(true);
              }}
              onClose={() => setWorkspacesPanelOpen(false)}
            />
          ) : null}
        </div>

      {settingsOpen ? (
        <div className="absolute inset-x-0 bottom-0 top-11 z-20 overflow-y-auto bg-[var(--panel-alt)]">
          <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
            <div className="mb-4">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                <IconSettings className="h-4 w-4 text-[var(--muted)]" />
                Settings
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">Defaults apply to newly created chats. Existing chats keep their current configuration.</div>
            </div>
            <AssistantToolsPanel
              variant="settings"
              tools={availableTools}
              enabledTools={defaultEnabledToolDraftNames}
              disabled={defaultToolsBusy}
              onToggleTool={toggleDefaultTool}
              onToggleTools={toggleDefaultTools}
              onEnableAll={() => void updateDefaultEnabledTools(availableTools.map((tool) => tool.name))}
              onDisableAll={() => void updateDefaultEnabledTools([])}
            />
          </div>
        </div>
      ) : null}

      {workspaceAccessOpen && activeThread ? (
        <div className="absolute inset-x-0 bottom-0 top-11 z-20 overflow-y-auto bg-[var(--panel-alt)]">
          <AssistantWorkspaceAccessView
            key={activeThread.id}
            requestJson={requestJson}
            threadId={activeThread.id}
            threadTitle={activeThread.title}
            onClose={() => setWorkspaceAccessOpen(false)}
          />
        </div>
      ) : null}

      {showExistingDroneAccess ? <div
        ref={setScopeDropNodeRef}
        className={`flex-shrink-0 border-b border-[var(--border)] px-2 py-1.5 transition-colors ${
          scopeDropActive ? 'bg-[var(--accent-subtle)]' : 'bg-[rgba(0,0,0,.08)]'
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="mr-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Existing drones
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <ScopeModeControl label="R" mode={scopeReadMode} onChange={updateScopeReadMode} />
            <ScopeModeControl label="W" mode={scopeWriteMode} onChange={updateScopeWriteMode} />
            <ScopeModeControl label="X" mode={scopeExecuteMode} onChange={updateScopeExecuteMode} />
          </div>
          <div className="min-w-[120px] flex-1 overflow-hidden">
            {scopeDrones.length === 0 ? (
              <div className="truncate text-[10px] text-[var(--muted-dim)]">
                {scopeReadMode === 'selected' || scopeWriteMode === 'selected' || scopeExecuteMode === 'selected'
                  ? 'No selected drones. Drop drones here to allow existing-drone access.'
                  : 'Drop drones here to limit existing-drone access.'}
              </div>
            ) : (
              <div className="flex min-w-0 gap-1 overflow-x-auto no-scrollbar">
                {scopeDrones.map((drone) => (
                  <span
                    key={drone.id}
                    className="inline-flex max-w-[150px] flex-shrink-0 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-1.5 py-0.5 text-[10px] text-[var(--fg-secondary)]"
                  >
                    <span className="min-w-0 truncate">{drone.name || drone.id}</span>
                    <button
                      type="button"
                      onClick={() => removeScopeDrone(drone.id)}
                      className="text-[11px] leading-none text-[var(--muted-dim)] hover:text-[var(--red)]"
                      title={`Remove ${drone.name || drone.id} from assistant scope`}
                      aria-label={`Remove ${drone.name || drone.id} from assistant scope`}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div> : null}

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
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} className="h-full overflow-y-auto">
              <div
                ref={scrollContentRef}
                className={showEmptyAssistantThread ? 'flex min-h-full items-center justify-center px-3 py-3' : 'space-y-2 py-3'}
              >
                {blipSession.hasOlder ? (
                  <div className="px-3 text-center">
                    <button
                      type="button"
                      className="rounded border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
                      disabled={blipSession.olderLoading}
                      onClick={() => void loadOlderMessages()}
                    >
                      {blipSession.olderLoading ? 'Loading older messages...' : 'Load older messages'}
                    </button>
                  </div>
                ) : null}
                {loading && !snapshot ? (
                  <div className="px-3 text-[12px] text-[var(--muted)]">Loading built-in agent...</div>
                ) : blipSession.historyLoading && visibleItems.length === 0 ? (
                  <div className="px-3 text-[12px] text-[var(--muted)]">Loading conversation...</div>
                ) : showEmptyAssistantThread ? (
                  <div className="w-full rounded border border-dashed border-[var(--border)] px-3 py-5 text-center">
                    <div className="text-[12px] text-[var(--fg-secondary)]">Start the chat to inspect drones or coordinate work.</div>
                    <div className="mt-1 text-[11px] text-[var(--muted-dim)]">Drone messaging will ask for approval first.</div>
                  </div>
                ) : (
                  visibleItems.map((item) =>
                    item.type === 'message' ? (
                      <AssistantMessageRow
                        key={item.key}
                        message={item.message}
                        droneMentionLinks={droneMentionLinks}
                        onOpenDroneMention={openDroneMention}
                        showToolCalls={item.showToolCalls}
                        isStreamingAssistant={
                          item.message.role === 'assistant' && item.sourceMessageIndex === streamingAssistantSourceIndex
                        }
                        showReasoning={running && item.key === latestActivityItemKey}
                      />
                    ) : item.type === 'tool' ? (
                      <ToolActivityRow key={item.key} call={item.call} result={item.result} droneNameById={droneNameById} />
                    ) : (
                      <RepeatedToolActivityRow key={item.key} items={item.items} />
                    ),
                  )
                )}
                {showThinking ? <AssistantThinkingRow /> : null}
                {activePendingApprovals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    busy={approvalBusyId === approval.id}
                    onApprove={() => void resolveApproval(approval, true)}
                    onDeny={() => void resolveApproval(approval, false)}
                  />
                ))}
                {visibleQueuedPrompts.map((prompt) => (
                  <AssistantQueuedPromptRow
                    key={prompt.id}
                    prompt={prompt}
                    cancelling={queuedPromptBusyId === prompt.id}
                    onCancel={() => void cancelQueuedPrompt(prompt.id)}
                  />
                ))}
                {error || blipSession.runError || blipSession.historyError ? <div className="mx-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">{error ?? blipSession.runError ?? blipSession.historyError}</div> : null}
              </div>
            </div>
          </div>

      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)] p-2">
        <NativeAgentModelControls
          thread={activeThread}
          models={snapshot?.models ?? EMPTY_ASSISTANT_MODEL_OPTIONS}
          defaultModel={snapshot?.defaultModel}
          busy={defaultModelBusy}
          onUpdate={(patch) => void updateThread(patch)}
          onSetDefault={() => void setActiveModelAsDefault()}
        />
        {attachmentError ? (
          <div className="mb-2 rounded border border-[rgba(255,90,90,.28)] bg-[rgba(255,90,90,.07)] px-2.5 py-1.5 text-[11px] text-[var(--red)]">
            {attachmentError}
          </div>
        ) : null}
        <div
          className={`relative rounded border bg-[rgba(255,255,255,.03)] focus-within:border-[var(--accent-muted)] ${
            attachmentDragActive || droneReferenceDropActive ? 'border-[var(--accent-muted)]' : 'border-[var(--border-subtle)]'
          }`}
          onDragEnter={(event) => {
            event.stopPropagation();
            if (attachmentControlsLocked) return;
            if (event.dataTransfer?.types?.includes?.('Files')) setAttachmentDragActive(true);
          }}
          onDragOver={(event) => {
            event.stopPropagation();
            if (event.dataTransfer?.types?.includes?.('Files')) event.preventDefault();
            if (attachmentControlsLocked) return;
          }}
          onDragLeave={(event) => {
            event.stopPropagation();
            setAttachmentDragActive(false);
          }}
          onDrop={(event) => {
            event.stopPropagation();
            event.preventDefault();
            setAttachmentDragActive(false);
            if (attachmentControlsLocked) return;
            addAttachmentFiles(event.dataTransfer?.files ?? null, { source: 'file' });
          }}
        >
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="hidden"
            disabled={attachmentControlsLocked}
            onChange={(event) => {
              addAttachmentFiles(event.currentTarget.files, { source: 'file' });
              event.currentTarget.value = '';
            }}
          />
          {referencedDrones.length > 0 || droneReferenceDropActive ? (
            <div className="border-b border-[var(--border-subtle)] px-2.5 py-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  {referencedDrones.length > 0
                    ? `${referencedDrones.length} drone${referencedDrones.length === 1 ? '' : 's'} referenced`
                    : 'Drop drones to reference them'}
                </div>
              </div>
              {referencedDrones.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
                  {referencedDrones.map((drone) => {
                    const label = drone.name || drone.id;
                    return (
                      <div
                        key={drone.id}
                        className="relative w-[190px] flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-2 py-1.5"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <IconDrone className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
                          <span className="min-w-0 truncate text-[10px] font-medium text-[var(--fg-secondary)]" title={label}>
                            {label}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[9px] text-[var(--muted-dim)]" title={drone.id}>
                          {drone.id}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeReferencedDrone(drone.id)}
                          disabled={droneReferenceControlsLocked}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-raised)] text-[10px] font-bold text-[var(--muted)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-45"
                          title={`Remove ${label}`}
                          aria-label={`Remove ${label}`}
                        >
                          x
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1.5 text-[10px] text-[var(--accent)]">
                  Release to add drone names and IDs to this message.
                </div>
              )}
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="border-b border-[var(--border-subtle)] px-2.5 py-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  {attachments.length} item{attachments.length === 1 ? '' : 's'} attached
                  {imageAttachmentCount > 0 ? ` · ${imageAttachmentCount} image${imageAttachmentCount === 1 ? '' : 's'}` : ''}
                  {promptImageAttachmentCount > 0 ? ` · ${promptImageAttachmentCount} chat-only` : ''}
                </div>
                <button
                  type="button"
                  onClick={openAttachmentPicker}
                  disabled={attachmentControlsLocked}
                  className="h-6 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-45"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Add
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="relative flex-shrink-0">
                    {attachment.kind === 'image' ? (
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.name}
                        className="h-14 w-14 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] object-cover"
                      />
                    ) : (
                      <div className="w-[172px] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-2 py-1.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <IconFile className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
                          <span className="min-w-0 truncate text-[10px] font-medium text-[var(--fg-secondary)]">{attachment.name}</span>
                        </div>
                        <div className="mt-1 truncate text-[9px] text-[var(--muted-dim)]">
                          {formatBytes(attachment.size)} · {attachment.mime || 'application/octet-stream'}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      disabled={attachmentControlsLocked}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-raised)] text-[10px] font-bold text-[var(--muted)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-45"
                      title={`Remove ${attachment.name}`}
                      aria-label={`Remove ${attachment.name}`}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            data-chat-input-focus-id="assistant-chat"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendPrompt();
              }
            }}
            onPaste={(event) => {
              event.stopPropagation();
              handleAssistantPaste(event);
            }}
            disabled={!activeThread}
            placeholder={
              running
                ? promptDeliveryMode === 'asap'
                  ? 'Send at next turn'
                  : 'Queue a message'
                : 'Ask the assistant'
            }
            className="h-24 w-full resize-none border-0 bg-transparent px-3 pb-10 pt-2 text-[12px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={openAttachmentPicker}
            disabled={attachmentControlsLocked}
            className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)] disabled:opacity-40"
            title="Attach files, paste images, or drag and drop"
            aria-label="Attach files"
          >
            <IconPlus className="h-3.5 w-3.5" />
          </button>
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {running ? (
              <button
                type="button"
                onClick={() => void stop()}
                disabled={assistantStopBusy}
                title="Stop the assistant run"
                aria-busy={assistantStopBusy}
                className="h-7 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--red)] disabled:opacity-40"
                style={{ fontFamily: 'var(--display)' }}
              >
                {assistantStopBusy ? 'Stopping…' : 'Stop'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void sendPrompt()}
              disabled={(!draft.trim() && attachments.length === 0 && referencedDrones.length === 0) || !activeThread || scopeSyncBusy}
              className="h-7 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] disabled:opacity-40"
              style={{ fontFamily: 'var(--display)' }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
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
          onUseGlobalForThread={() => setThreadSystemPromptDraft(threadSystemPromptSettings?.threadSystemPrompt.globalPrompt ?? '')}
          onUseDefaultForGlobal={() => setSystemPromptDraft(systemPromptSettings?.assistantSystemPrompt.defaultPrompt ?? '')}
          onClose={() => setSystemPromptOpen(false)}
          onSaveGlobal={() => void saveSystemPromptSettings()}
          onSaveThread={() => void saveThreadSystemPromptSettings()}
          onPromoteThread={() => void promoteThreadSystemPrompt()}
        />
      ) : null}
    </div>
  );
}
