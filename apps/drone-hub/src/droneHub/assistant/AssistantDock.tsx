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
  IconChatThread,
  IconPencil,
  IconPlus,
  IconSettings,
  IconShieldCheck,
  IconSidebarCollapse,
  IconSidebarExpand,
  IconSpinner,
  IconTrash,
  IconWrench,
} from '../app/icons';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { IconChevron, IconDrone, IconFile, IconFolder, iconForFilePath } from '../icons';
import { dispatchAssistantOpenDroneChat } from './open-drone-chat-event';
import { useBlipThreadSession } from './useBlipThreadSession';
import { AssistantThreadFilesView, selectDefaultArtifactPath } from './AssistantThreadFilesView';
import { AssistantThreadSidebar } from './AssistantThreadSidebar';
import { AssistantWorkspaceAccessView } from './AssistantWorkspaceAccessView';
import { assistantThreadsByCreatedAtNewestFirst } from './assistant-thread-order';
import {
  AssistantSystemPromptModal,
  AssistantToolsPanel,
  ScopeModeControl,
} from './AssistantSettingsPanels';
import {
  AssistantChatIdleFooterBanner,
  AssistantQueuedPromptRow,
  AssistantMessageRow,
  AssistantThinkingRow,
  ChatsIdleActivityRow,
  MessageDroneActivityRow,
  RepeatedToolActivityRow,
  ToolActivityRow,
} from './AssistantTranscript';
import { ApprovalCard } from './AssistantWorkflowCards';
import {
  assistantThreadStatusLabel,
  assistantThreadStatusTone,
  formatArtifactSize,
  formatUpdatedAt,
} from './assistant-formatters';
import {
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
  AssistantChatIdleSubscription,
  AssistantDraftAttachment,
  AssistantDraftFileAttachment,
  AssistantDraftImageAttachment,
  AssistantDraftTextAttachment,
  AssistantDroneNameMap,
  AssistantDroneReference,
  AssistantMessage,
  AssistantModelOption,
  AssistantPanelMode,
  AssistantPromptDeliveryMode,
  AssistantProviderId,
  AssistantRunModel,
  AssistantScopeDraft,
  AssistantScopeDrone,
  AssistantScopeMode,
  AssistantScopeUpdateResult,
  AssistantSnapshot,
  AssistantSystemPromptKind,
  AssistantSystemPromptSettings,
  AssistantThread,
  AssistantThreadStatus,
  AssistantThreadSystemPromptSettings,
  AssistantToolSummary,
  PendingAssistantScopeSave,
} from './assistant-types';
import {
  canSendAssistantDesktopVoiceRealtimeText,
  desktopAssistantVoiceControlLabel,
  desktopAssistantVoiceControlTitle,
  desktopAssistantVoiceHeardText,
  dispatchAssistantDesktopVoiceOff,
  dispatchAssistantDesktopVoiceRealtimeToggle,
  dispatchAssistantDesktopVoiceStartRecording,
  dispatchAssistantDesktopVoiceToggle,
  isDesktopAssistantVoiceActive,
  isDesktopAssistantVoiceBusy,
  sendAssistantDesktopVoiceRealtimeText,
  subscribeAssistantDesktopVoiceStatus,
  type DesktopAssistantVoiceStatus,
} from './desktop-assistant-voice';

const ASSISTANT_THREAD_SIDEBAR_OPEN_STORAGE_KEY = 'droneHub.assistant.threadSidebarOpen';
const ASSISTANT_THREAD_MODE_STORAGE_KEY = 'droneHub.assistant.threadMode';
const ASSISTANT_FILES_OPEN_STORAGE_KEY = 'droneHub.assistant.filesOpen';
/** Distance from bottom (px) below which we treat the assistant transcript as "pinned" for auto-scroll. */
const ASSISTANT_SCROLL_BOTTOM_THRESHOLD_PX = 48;
const ASSISTANT_IDLE_REFRESH_INTERVAL_MS = 2_500;
const ASSISTANT_ACTIVE_REFRESH_INTERVAL_MS = 1_000;
const ASSISTANT_EVENT_REFRESH_DEBOUNCE_MS = 150;

function snapshotWithPreferredActiveThread(snapshot: AssistantSnapshot, preferredThreadId: string | null | undefined): AssistantSnapshot {
  const threadId = String(preferredThreadId ?? '').trim();
  if (!threadId || snapshot.activeThreadId === threadId) return snapshot;
  if (!snapshot.threads.some((thread) => thread.id === threadId)) return snapshot;
  return { ...snapshot, activeThreadId: threadId };
}
const EMPTY_ASSISTANT_MODEL_OPTIONS: AssistantModelOption[] = [];
const EMPTY_ASSISTANT_TOOL_SUMMARIES: AssistantToolSummary[] = [];

const ASSISTANT_PROVIDERS: Array<{ id: AssistantProviderId; label: string; title: string }> = [
  { id: 'codex', label: 'Codex', title: 'Use Codex models.' },
  { id: 'openai', label: 'OpenAI', title: 'Use OpenAI models.' },
  { id: 'gemini', label: 'Gemini', title: 'Use Gemini models.' },
];

function readInitialThreadSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(ASSISTANT_THREAD_SIDEBAR_OPEN_STORAGE_KEY) !== '0';
}

function readInitialAssistantPanelMode(): AssistantPanelMode {
  if (typeof window === 'undefined') return 'normal';
  return window.localStorage.getItem(ASSISTANT_THREAD_MODE_STORAGE_KEY) === 'voice' ? 'voice' : 'normal';
}

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

function modelSelectionKey(selection: Pick<AssistantRunModel, 'provider' | 'model' | 'thinkingLevel'>): string {
  return `${selection.provider}:${selection.model}`;
}

function modelSelectionLabel(
  selection: Pick<AssistantRunModel, 'provider' | 'model' | 'thinkingLevel'>,
  options: AssistantModelOption[],
): string {
  const match = options.find((option) => option.provider === selection.provider && option.id === selection.model);
  if (match) return match.name;
  return selection.model;
}

function compactModelSelectionLabel(label: string): string {
  return label.replace(/^GPT-/, '').replace(/\bMedium\b/, 'Med');
}

function uniqueAssistantModels(options: AssistantModelOption[]): AssistantModelOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.provider}:${option.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assistantReasoningLabel(level: string): string {
  if (level === 'off') return 'None';
  if (level === 'xhigh') return 'X-high';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function DefaultModelStar({ selected }: { selected: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill={selected ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="m12 3.2 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.73l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3.2Z" />
    </svg>
  );
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

export function AssistantDock() {
  const [snapshot, setSnapshot] = React.useState<AssistantSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [attachments, setAttachments] = React.useState<AssistantDraftAttachment[]>([]);
  const [referencedDrones, setReferencedDrones] = React.useState<AssistantDroneReference[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [attachmentDragActive, setAttachmentDragActive] = React.useState(false);
  const [threadSidebarOpen, setThreadSidebarOpen] = React.useState(readInitialThreadSidebarOpen);
  const [assistantPanelMode, setAssistantPanelMode] = React.useState<AssistantPanelMode>(readInitialAssistantPanelMode);
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
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [workspaceAccessOpen, setWorkspaceAccessOpen] = React.useState(false);
  const [enabledToolDraftNames, setEnabledToolDraftNames] = React.useState<string[]>([]);
  const [defaultEnabledToolDraftNames, setDefaultEnabledToolDraftNames] = React.useState<string[]>([]);
  const [defaultToolsBusy, setDefaultToolsBusy] = React.useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = React.useState(false);
  const [systemPromptMode, setSystemPromptMode] = React.useState<'thread' | 'global'>('thread');
  const [systemPromptGlobalKind, setSystemPromptGlobalKind] = React.useState<AssistantSystemPromptKind>('normal');
  const [systemPromptSettings, setSystemPromptSettings] = React.useState<AssistantSystemPromptSettings | null>(null);
  const [systemPromptDraft, setSystemPromptDraft] = React.useState('');
  const [voiceSystemPromptDraft, setVoiceSystemPromptDraft] = React.useState('');
  const [threadSystemPromptSettings, setThreadSystemPromptSettings] = React.useState<AssistantThreadSystemPromptSettings | null>(null);
  const [threadSystemPromptDraft, setThreadSystemPromptDraft] = React.useState('');
  const [systemPromptLoading, setSystemPromptLoading] = React.useState(false);
  const [systemPromptSaving, setSystemPromptSaving] = React.useState(false);
  const [threadSystemPromptSaving, setThreadSystemPromptSaving] = React.useState(false);
  const [promoteSystemPromptSaving, setPromoteSystemPromptSaving] = React.useState(false);
  const [systemPromptError, setSystemPromptError] = React.useState<string | null>(null);
  const [systemPromptNotice, setSystemPromptNotice] = React.useState<string | null>(null);
  const [assistantEventsConnected, setAssistantEventsConnected] = React.useState(false);
  const [assistantEventsUnavailable, setAssistantEventsUnavailable] = React.useState(
    () => typeof window === 'undefined' || typeof window.EventSource === 'undefined',
  );
  const [voiceTranscriptionActive, setVoiceTranscriptionActive] = React.useState(false);
  const [voiceAndroidMode, setVoiceAndroidMode] = React.useState('');
  const [voiceAndroidStatus, setVoiceAndroidStatus] = React.useState('');
  const [voiceDraftActive, setVoiceDraftActive] = React.useState(false);
  const [desktopVoiceStatus, setDesktopVoiceStatus] = React.useState<DesktopAssistantVoiceStatus>({
    mode: 'off',
    message: 'Desktop voice is off.',
  });
  const selectedDrone = useDroneHubUiStore((state) => state.selectedDrone);
  const selectedChat = useDroneHubUiStore((state) => state.selectedChat);
  const appView = useDroneHubUiStore((state) => state.appView);
  const draftChat = useDroneHubUiStore((state) => state.draftChat);
  const kanbanBoardOpen = useDroneHubUiStore((state) => state.kanbanBoardOpen);
  const playbookRunsOpen = useDroneHubUiStore((state) => state.playbookRunsOpen);
  const selectedGroupMultiChat = useDroneHubUiStore((state) => state.selectedGroupMultiChat);
  const threadSidebarDockSide = useDroneHubUiStore((state) => state.assistantThreadSidebarDockSide);
  const setThreadSidebarDockSide = useDroneHubUiStore((state) => state.setAssistantThreadSidebarDockSide);
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
  const defaultEnabledToolDraftNamesRef = React.useRef<string[]>([]);
  const assistantEventRefreshTimerRef = React.useRef<number | null>(null);
  const draftRef = React.useRef('');
  const voiceDraftActiveRef = React.useRef(false);
  const voiceDraftTextRef = React.useRef('');
  const voiceEnabledRef = React.useRef(false);
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

  const visibleThreads = React.useMemo(() => {
    const threads = snapshot?.threads ?? [];
    return assistantThreadsByCreatedAtNewestFirst(
      threads.filter((thread) =>
        assistantPanelMode === 'voice' ? Boolean(thread.voiceEnabled) : !thread.voiceEnabled,
      ),
    );
  }, [assistantPanelMode, snapshot?.threads]);

  const activeThread = React.useMemo(() => {
    if (!snapshot) return null;
    return visibleThreads.find((thread) => thread.id === snapshot.activeThreadId) ?? visibleThreads[0] ?? null;
  }, [snapshot, visibleThreads]);
  const activeThreadId = activeThread?.id ?? '';
  activeThreadIdRef.current = activeThreadId;
  const autoApprove = Boolean(activeThread?.autoApprove);
  const voiceEnabled = Boolean(activeThread?.voiceEnabled);
  voiceEnabledRef.current = voiceEnabled;
  const blipSession = useBlipThreadSession(activeThreadId, Boolean(activeThread));
  React.useEffect(() => {
    if (activeThreadId) void blipSession.refreshHistory({ quiet: true });
  }, [activeThread?.updatedAt, activeThreadId, blipSession.refreshHistory]);
  React.useEffect(() => {
    if (!voiceEnabled || desktopVoiceStatus.mode !== 'recording' || !activeThreadId || typeof window === 'undefined') return;
    const refreshHistory = () => void blipSession.refreshHistory({ quiet: true });
    refreshHistory();
    const timer = window.setInterval(refreshHistory, 750);
    return () => window.clearInterval(timer);
  }, [activeThreadId, blipSession.refreshHistory, desktopVoiceStatus.mode, voiceEnabled]);
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
  const realtimeTextReady = voiceEnabled && canSendAssistantDesktopVoiceRealtimeText();
  const realtimeTextBlocked = voiceEnabled && !realtimeTextReady;
  const promptDeliveryMode: AssistantPromptDeliveryMode = activeThread?.promptDeliveryMode === 'asap' ? 'asap' : 'queue';
  const activeAccessScope: AssistantAccessScope | null = activeThread?.accessScope ?? snapshot?.accessScope ?? null;
  const activeAccessScopeDroneIdsKey = activeAccessScope?.droneIds?.join('\u0000') ?? '';
  const activePendingApprovals = React.useMemo(
    () => (snapshot?.pendingApprovals ?? []).filter((approval) => approval.threadId === activeThread?.id && approval.status === 'pending'),
    [activeThread?.id, snapshot?.pendingApprovals],
  );
  const visibleQueuedPrompts = React.useMemo(
    () => (activeThread?.queuedPrompts ?? []).filter((prompt) => prompt.status !== 'running'),
    [activeThread?.queuedPrompts],
  );
  const activeRunningModel = activeThread ? snapshot?.runningModels?.[activeThread.id] ?? null : null;
  const running = blipSession.running || activeThread?.status === 'running' || activeThread?.status === 'waiting_for_approval' || Boolean(activeRunningModel);
  const activeChatIdleSubscriptionsForThread = React.useMemo(
    () =>
      (snapshot?.chatIdleSubscriptions ?? []).filter((sub) => sub.threadId === activeThreadId && sub.status === 'active'),
    [snapshot?.chatIdleSubscriptions, activeThreadId],
  );
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
  const assistantChatIdleHold =
    Boolean(activeThread) &&
    (activeThread?.status === 'waiting_for_chats_idle' || activeChatIdleSubscriptionsForThread.length > 0);
  const droneReferenceControlsLocked = !activeThread || assistantChatIdleHold;
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

  const applySnapshot = React.useCallback((next: AssistantSnapshot, preferredThreadId?: string | null) => {
    setSnapshot(snapshotWithPreferredActiveThread(next, preferredThreadId ?? activeThreadIdRef.current));
  }, []);

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
      const threadId = activeThreadIdRef.current;
      let next: AssistantSnapshot;
      if (threadId) {
        next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(threadId)}`);
        if (snapshotRequestSeqRef.current !== requestSeq) return;
        applySnapshot(next, threadId);
      } else {
        const listed = await requestJson<AssistantSnapshot>('/api/assistant/threads');
        const listedThreadId = String(listed.activeThreadId ?? '').trim();
        next = listedThreadId
          ? await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(listedThreadId)}`)
          : listed;
        if (snapshotRequestSeqRef.current !== requestSeq) return;
        applySnapshot(next, listedThreadId);
      }
    } catch (err: any) {
      if (!options.silent) setError(err?.message ?? String(err));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [applySnapshot]);

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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

  React.useEffect(() => {
    voiceDraftActiveRef.current = voiceDraftActive;
  }, [voiceDraftActive]);

  React.useEffect(() => subscribeAssistantDesktopVoiceStatus(setDesktopVoiceStatus), []);

  React.useEffect(() => {
    if (!voiceEnabled) {
      setVoiceTranscriptionActive(false);
      setVoiceAndroidMode('');
      setVoiceAndroidStatus('');
    }
  }, [voiceEnabled]);

  const appendVoiceTranscriptSegment = React.useCallback((textRaw: unknown, options?: { requireVoiceEnabled?: boolean }) => {
    const text = String(textRaw ?? '').trim();
    if (!text || (options?.requireVoiceEnabled !== false && !voiceEnabledRef.current)) return;
    const currentDraft = draftRef.current;
    if (currentDraft.trim() && !voiceDraftActiveRef.current) return;
    const next = currentDraft.trim() ? `${currentDraft.trimEnd()}\n${text}` : text;
    voiceDraftTextRef.current = next.trim();
    voiceDraftActiveRef.current = true;
    setVoiceDraftActive(true);
    setDraft(next);
  }, []);

  const scheduleAssistantEventRefresh = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (assistantEventRefreshTimerRef.current != null) {
      window.clearTimeout(assistantEventRefreshTimerRef.current);
    }
    assistantEventRefreshTimerRef.current = window.setTimeout(() => {
      assistantEventRefreshTimerRef.current = null;
      void refresh({ silent: true });
    }, ASSISTANT_EVENT_REFRESH_DEBOUNCE_MS);
  }, [refresh]);

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
      setVoiceSystemPromptDraft(data.assistantVoiceSystemPrompt.prompt);
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
    setSystemPromptGlobalKind(voiceEnabledRef.current ? 'voice' : 'normal');
    setSystemPromptOpen(true);
    void loadSystemPromptSettings();
  }, [loadSystemPromptSettings]);

  const saveSystemPromptSettings = React.useCallback(async () => {
    setSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const promptType = systemPromptGlobalKind;
      const prompt = promptType === 'voice' ? voiceSystemPromptDraft : systemPromptDraft;
      const data = await requestJson<AssistantSystemPromptSettings>('/api/assistant/system-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, promptType }),
      });
      setSystemPromptSettings(data);
      setSystemPromptDraft(data.assistantSystemPrompt.prompt);
      setVoiceSystemPromptDraft(data.assistantVoiceSystemPrompt.prompt);
      setThreadSystemPromptSettings((prev) => {
        if (!prev) return prev;
        const activeThreadUsesSavedPromptType = Boolean(activeThread?.voiceEnabled) === (promptType === 'voice');
        if (!activeThreadUsesSavedPromptType) return prev;
        const savedSettings = promptType === 'voice' ? data.assistantVoiceSystemPrompt : data.assistantSystemPrompt;
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
      setSystemPromptNotice(promptType === 'voice' ? 'Saved. New realtime assistant threads will use this prompt.' : 'Saved. New standard assistant threads will use this prompt.');
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setSystemPromptSaving(false);
    }
  }, [activeThread?.voiceEnabled, systemPromptDraft, systemPromptGlobalKind, voiceSystemPromptDraft]);

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
      setSystemPromptNotice('Saved. Only this assistant thread will use this prompt.');
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
    const confirmed = window.confirm('Promote this thread system prompt to the matching global prompt for new assistant threads? Existing threads keep their own prompts.');
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
      setVoiceSystemPromptDraft(data.assistantVoiceSystemPrompt.prompt);
      await loadSystemPromptSettings();
      setSystemPromptNotice(activeThread?.voiceEnabled ? 'Promoted. New realtime assistant threads will use this prompt.' : 'Promoted. New standard assistant threads will use this prompt.');
      void refresh();
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setPromoteSystemPromptSaving(false);
    }
  }, [activeThread?.voiceEnabled, loadSystemPromptSettings, refresh, threadSystemPromptDraft]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      setAssistantEventsUnavailable(true);
      return;
    }
    let closed = false;
    const source = new window.EventSource('/api/assistant/events');
    const markConnected = () => {
      if (closed) return;
      setAssistantEventsConnected(true);
      setAssistantEventsUnavailable(false);
      scheduleAssistantEventRefresh();
    };
    const markChanged = () => {
      if (closed) return;
      scheduleAssistantEventRefresh();
    };
    source.onopen = markConnected;
    source.onmessage = markChanged;
    source.addEventListener('connected', markConnected);
    source.addEventListener('assistant_change', markChanged);
    source.onerror = () => {
      if (closed) return;
      setAssistantEventsConnected(false);
      setAssistantEventsUnavailable(true);
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [scheduleAssistantEventRefresh]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return;
    let closed = false;
    const source = new window.EventSource('/api/assistant/voice/transcript/events');
    source.addEventListener('voice_transcript_segment', (event) => {
      if (closed) return;
      try {
        const data = JSON.parse((event as MessageEvent).data);
        appendVoiceTranscriptSegment(data?.text);
      } catch {
        // Ignore malformed transcript messages.
      }
    });
    source.addEventListener('voice_transcript_status', (event) => {
      if (closed) return;
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const status = String(data?.status ?? '').trim();
        setVoiceTranscriptionActive(status === 'collecting' || status === 'transcribing');
      } catch {
        // Ignore malformed status messages.
      }
    });
    source.addEventListener('voice_android_status', (event) => {
      if (closed) return;
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setVoiceAndroidMode(String(data?.mode ?? '').trim());
        setVoiceAndroidStatus(String(data?.status ?? '').trim());
      } catch {
        // Ignore malformed Android status messages.
      }
    });
    source.onerror = () => {
      if (closed) return;
      setVoiceTranscriptionActive(false);
      setVoiceAndroidMode('');
      setVoiceAndroidStatus('');
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [appendVoiceTranscriptSegment]);

  React.useEffect(() => {
    return () => {
      if (assistantEventRefreshTimerRef.current != null) {
        window.clearTimeout(assistantEventRefreshTimerRef.current);
        assistantEventRefreshTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (!voiceDraftActive) return;
    const voiceText = voiceDraftTextRef.current.trim();
    if (!voiceText) return;
    const normalizedVoiceText = voiceText.replace(/\s+/g, ' ').trim().toLowerCase();
    const delivered = (blipSession.messages as AssistantMessage[]).some((message) => {
      if (message.role !== 'user') return false;
      const normalizedMessageText = messageText(message).replace(/\s+/g, ' ').trim().toLowerCase();
      return normalizedMessageText === normalizedVoiceText || normalizedMessageText.includes(normalizedVoiceText);
    });
    if (!delivered) return;
    setDraft((current) => (current.trim() === voiceText ? '' : current));
    voiceDraftTextRef.current = '';
    voiceDraftActiveRef.current = false;
    setVoiceDraftActive(false);
  }, [blipSession.messages, voiceDraftActive]);

  const hasAssistantBackgroundActivity =
    Object.keys(snapshot?.runningModels ?? {}).length > 0 ||
    (snapshot?.threads ?? []).some((thread) => thread.status === 'running' || thread.status === 'waiting_for_approval' || thread.status === 'waiting_for_chats_idle') ||
    (snapshot?.chatIdleSubscriptions ?? []).some((subscription) => subscription.status === 'active');
  const shouldPollAssistantSnapshot = assistantEventsUnavailable || !assistantEventsConnected;

  React.useEffect(() => {
    if (!shouldPollAssistantSnapshot) return;
    const intervalMs = hasAssistantBackgroundActivity ? ASSISTANT_ACTIVE_REFRESH_INTERVAL_MS : ASSISTANT_IDLE_REFRESH_INTERVAL_MS;
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [hasAssistantBackgroundActivity, refresh, shouldPollAssistantSnapshot]);

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
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_THREAD_SIDEBAR_OPEN_STORAGE_KEY, threadSidebarOpen ? '1' : '0');
  }, [threadSidebarOpen]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_THREAD_MODE_STORAGE_KEY, assistantPanelMode);
  }, [assistantPanelMode]);

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
    snapshot?.activeThreadId,
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
      setError('Assistant access changes are not saved yet.');
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

  const selectedDroneChatOpen = Boolean(
    selectedDrone &&
      appView === 'workspace' &&
      !draftChat &&
      !kanbanBoardOpen &&
      !playbookRunsOpen &&
      !selectedGroupMultiChat,
  );

  const createThread = React.useCallback(async () => {
    updateThreadRequestRef.current += 1;
    const requestSeq = beginSnapshotMutation();
    try {
      const activeDroneId = selectedDroneChatOpen ? String(selectedDrone ?? '').trim() : '';
      const next = await requestJson<AssistantSnapshot>('/api/assistant/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          activeDroneId: activeDroneId || null,
          activeChatName: activeDroneId ? String(selectedChat ?? '').trim() || 'default' : null,
          voiceEnabled: assistantPanelMode === 'voice',
          title: assistantPanelMode === 'voice' ? 'Realtime thread' : undefined,
        }),
      });
      if (!snapshotMutationCurrent(requestSeq)) return;
      activeThreadIdRef.current = String(next.activeThreadId ?? '').trim();
      applySnapshot(next, activeThreadIdRef.current);
      setDraft('');
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    }
  }, [applySnapshot, assistantPanelMode, beginSnapshotMutation, selectedChat, selectedDrone, selectedDroneChatOpen, snapshotMutationCurrent]);

  const openVoicePairing = React.useCallback(async () => {
    const popup = typeof window === 'undefined' ? null : window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    try {
      const data = await requestJson<{ ok: true; url: string }>('/api/assistant/voice/pairing-url');
      if (popup) {
        popup.location.href = data.url;
      } else if (typeof window !== 'undefined') {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      try {
        popup?.close();
      } catch {
        // ignore
      }
      setError(err?.message ?? String(err));
    }
  }, []);

  const selectThread = React.useCallback(async (thread: AssistantThread) => {
    updateThreadRequestRef.current += 1;
    const requestSeq = beginSnapshotMutation();
    const previousThreadId = activeThreadIdRef.current;
    activeThreadIdRef.current = thread.id;
    try {
      const next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(thread.id)}/activate`, { method: 'POST' });
      if (!snapshotMutationCurrent(requestSeq)) return;
      applySnapshot(next, thread.id);
      setDraft('');
    } catch (err: any) {
      if (!snapshotMutationCurrent(requestSeq)) return;
      activeThreadIdRef.current = previousThreadId;
      setError(err?.message ?? String(err));
    }
  }, [applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const deleteThread = React.useCallback(async (thread: AssistantThread) => {
    updateThreadRequestRef.current += 1;
    const requestSeq = beginSnapshotMutation();
    try {
      const next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(thread.id)}`, { method: 'DELETE' });
      if (!snapshotMutationCurrent(requestSeq)) return;
      activeThreadIdRef.current = String(next.activeThreadId ?? '').trim();
      applySnapshot(next, activeThreadIdRef.current);
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    }
  }, [applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const renameThread = React.useCallback(async (thread: AssistantThread, title: string) => {
    updateThreadRequestRef.current += 1;
    const requestSeq = beginSnapshotMutation();
    const preferredThreadId = activeThreadIdRef.current;
    try {
      let next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(thread.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!snapshotMutationCurrent(requestSeq)) return;
      if (preferredThreadId && preferredThreadId !== thread.id) {
        next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(preferredThreadId)}/activate`, { method: 'POST' });
        if (!snapshotMutationCurrent(requestSeq)) return;
      }
      activeThreadIdRef.current = preferredThreadId || String(next.activeThreadId ?? '').trim();
      applySnapshot(next, activeThreadIdRef.current);
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
      throw err;
    }
  }, [applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const updateThread = React.useCallback(async (patch: Partial<Pick<AssistantThread, 'title' | 'model' | 'provider' | 'thinkingLevel' | 'autoApprove' | 'promptDeliveryMode' | 'enabledTools' | 'voiceEnabled'>>) => {
    if (!activeThread) return;
    const requestId = updateThreadRequestRef.current + 1;
    updateThreadRequestRef.current = requestId;
    const requestSeq = beginSnapshotMutation();
    try {
      const next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (updateThreadRequestRef.current === requestId && snapshotMutationCurrent(requestSeq)) applySnapshot(next, activeThread.id);
    } catch (err: any) {
      if (updateThreadRequestRef.current === requestId && snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    }
  }, [activeThread, applySnapshot, beginSnapshotMutation, snapshotMutationCurrent]);

  const attachmentControlsLocked = !activeThread || voiceEnabled || assistantChatIdleHold;
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
    if (activeThread.voiceEnabled) {
      if (attachmentSnapshot.length > 0) {
        if (snapshotMutationCurrent(requestSeq)) setAttachmentError('Realtime voice threads do not support file attachments yet.');
        return;
      }
      try {
        if (!sendAssistantDesktopVoiceRealtimeText(prompt)) {
          if (snapshotMutationCurrent(requestSeq)) setError('Realtime voice is not connected. Start realtime voice before sending text in this thread.');
          return;
        }
        if (!snapshotMutationCurrent(requestSeq)) return;
        setDraft('');
        setReferencedDrones([]);
        scrollAssistantToBottom({ force: true });
        refocusInputWhenIdleRef.current = true;
        void refresh({ silent: true });
      } catch (err: any) {
        if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
      }
      return;
    }
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
          setError(String(event.error ?? 'Assistant failed.'));
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
      applySnapshot(
        next,
        activeThread.id,
      );
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
      if (snapshotMutationCurrent(requestSeq)) applySnapshot(next, activeThread.id);
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
      applySnapshot(
        next,
        activeThread.id,
      );
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
      const next = await requestJson<AssistantSnapshot>('/api/assistant/default-model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: activeThread.provider, model: activeThread.model, thinkingLevel: activeThread.thinkingLevel }),
      });
      if (snapshotMutationCurrent(requestSeq)) applySnapshot(next, activeThread.id);
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    } finally {
      setDefaultModelBusy(false);
    }
  }, [activeThread, applySnapshot, beginSnapshotMutation, snapshot?.defaultModel, snapshotMutationCurrent]);

  const modelOptions = snapshot?.models ?? EMPTY_ASSISTANT_MODEL_OPTIONS;
  const activeProvider = activeThread?.provider ?? modelOptions[0]?.provider ?? 'openai';
  const providerOptions = React.useMemo(
    () => ASSISTANT_PROVIDERS.map((provider) => ({
      ...provider,
      models: uniqueAssistantModels(modelOptions.filter((model) => model.provider === provider.id)),
    })),
    [modelOptions],
  );
  const activeProviderOptions = React.useMemo(
    () => providerOptions.find((provider) => provider.id === activeProvider)?.models ?? [],
    [activeProvider, providerOptions],
  );
  const displayedModelOptions = React.useMemo(() => {
    if (!activeThread) return activeProviderOptions;
    const selectedKey = `${activeThread.provider}:${activeThread.model}`;
    const hasSelected = activeProviderOptions.some((model) => `${model.provider}:${model.id}` === selectedKey);
    if (hasSelected) return activeProviderOptions;
    return [
      {
        provider: activeThread.provider,
        id: activeThread.model,
        name: activeThread.model,
        reasoning: activeThread.thinkingLevel !== 'off',
        thinkingLevel: activeThread.thinkingLevel,
      },
      ...activeProviderOptions,
    ];
  }, [activeProviderOptions, activeThread]);
  const selectedModelKey = activeThread ? modelSelectionKey({ provider: activeThread.provider, model: activeThread.model, thinkingLevel: activeThread.thinkingLevel }) : '';
  const modelMenuEntries = React.useMemo<UiMenuSelectEntry[]>(
    () =>
      displayedModelOptions.map((model) => ({
        value: `${model.provider}:${model.id}`,
        label: model.name,
        title: model.id,
        searchText: `${model.name} ${model.id}`,
      })),
    [displayedModelOptions],
  );
  const reasoningMenuEntries = React.useMemo<UiMenuSelectEntry[]>(() => {
    if (!activeThread) return [];
    const levels = new Set(
      modelOptions
        .filter((option) => option.provider === activeThread.provider && option.id === activeThread.model)
        .map((option) => option.thinkingLevel),
    );
    if (levels.size === 0) levels.add(activeThread.thinkingLevel);
    return [...levels].map((level) => ({ value: level, label: assistantReasoningLabel(level) }));
  }, [activeThread, modelOptions]);
  const selectedModelLabel = React.useMemo(() => {
    if (!activeThread) return '';
    return modelSelectionLabel({ provider: activeThread.provider, model: activeThread.model, thinkingLevel: activeThread.thinkingLevel }, modelOptions);
  }, [activeThread, modelOptions]);
  const activeModelIsDefault = Boolean(
    activeThread &&
      snapshot?.defaultModel.provider === activeThread.provider &&
      snapshot.defaultModel.model === activeThread.model &&
      snapshot.defaultModel.thinkingLevel === activeThread.thinkingLevel,
  );
  const activeProviderMeta = providerOptions.find((provider) => provider.id === activeProvider) ?? ASSISTANT_PROVIDERS[0];
  const activeRunningModelLabel = activeRunningModel ? modelSelectionLabel(activeRunningModel, modelOptions) : '';
  const availableTools = snapshot?.availableTools ?? EMPTY_ASSISTANT_TOOL_SUMMARIES;
  const snapshotEnabledToolNames = React.useMemo(() => {
    const toolNames = availableTools.map((tool) => tool.name);
    if (!activeThread) return [];
    const configured = Array.isArray(activeThread.enabledTools)
      ? activeThread.enabledTools
      : toolNames.filter((name) => name !== 'get_system_prompt' && name !== 'update_system_prompt' && name !== 'set_thinking_level' && name !== 'speak');
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
        const next = await requestJson<AssistantSnapshot>('/api/assistant/default-tools', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabledTools: persistedTools }),
        });
        if (snapshotMutationCurrent(requestSeq)) applySnapshot(next, activeThreadIdRef.current);
      } catch (err: any) {
        if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
      } finally {
        setDefaultToolsBusy(false);
      }
    },
    [applySnapshot, availableTools, beginSnapshotMutation, snapshot?.defaultEnabledTools, snapshotMutationCurrent],
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
    const timer = window.setInterval(() => {
      void loadArtifactFiles({ silent: true });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, filesOpen, loadArtifactFiles]);

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
    const timer = window.setInterval(() => {
      void loadSelectedArtifactFile({ silent: true });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [filesOpen, loadSelectedArtifactFile, selectedArtifactPath]);

  const threadSidebar = threadSidebarOpen ? (
    <AssistantThreadSidebar
      threads={visibleThreads}
      activeThreadId={activeThread?.id ?? null}
      dockSide={threadSidebarDockSide}
      mode={assistantPanelMode}
      onCreateThread={() => void createThread()}
      onSelectThread={(thread) => void selectThread(thread)}
      onDockSideChange={setThreadSidebarDockSide}
      onRenameThread={renameThread}
      onDeleteThread={(thread) => void deleteThread(thread)}
      onModeChange={setAssistantPanelMode}
      onOpenPairing={() => void openVoicePairing()}
      desktopVoiceStatus={desktopVoiceStatus}
      onToggleDesktopVoice={dispatchAssistantDesktopVoiceToggle}
      onStartDesktopVoiceRecording={dispatchAssistantDesktopVoiceStartRecording}
      onStopDesktopVoice={dispatchAssistantDesktopVoiceOff}
      onCollapse={() => setThreadSidebarOpen(false)}
    />
  ) : null;

  return (
    <div data-assistant-dock-root="true" className="flex h-full min-h-0 bg-[var(--panel-alt)]">
      {threadSidebarDockSide === 'left' ? threadSidebar : null}
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
          <button
            type="button"
            onClick={() => setThreadSidebarOpen((open) => !open)}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg-secondary)] ${
              threadSidebarOpen
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-label={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-pressed={threadSidebarOpen}
          >
            {threadSidebarOpen ? (
              <IconSidebarCollapse className={`h-3.5 w-3.5 ${threadSidebarDockSide === 'right' ? 'rotate-180' : ''}`} />
            ) : (
              <IconSidebarExpand className={`h-3.5 w-3.5 ${threadSidebarDockSide === 'right' ? 'rotate-180' : ''}`} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-[var(--fg)]">{activeThread?.title ?? 'Assistant'}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {activeThread ? <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${assistantThreadStatusTone(activeThread.status)}`} /> : null}
              <span className="truncate">{assistantThreadStatusLabel(activeThread?.status, loading ? 'loading' : 'idle')}</span>
              {voiceEnabled && voiceAndroidMode === 'awake' ? (
                <span
                  className="inline-flex h-5 flex-shrink-0 items-center gap-1 rounded-full border border-[rgba(74,222,128,.32)] bg-[rgba(74,222,128,.08)] px-1.5 text-[9px] font-semibold text-[var(--green)]"
                  title={voiceAndroidStatus || 'Android app awake and waiting for wake phrase'}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
                  Awake
                </span>
              ) : null}
              {voiceEnabled && voiceAndroidMode === 'recording' ? (
                <span
                  className="inline-flex h-5 flex-shrink-0 items-center gap-1 rounded-full border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-1.5 text-[9px] font-semibold text-[var(--accent)] shadow-[0_0_14px_rgba(59,130,246,.28)]"
                  title={voiceAndroidStatus || 'Android app recording audio'}
                >
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                  </span>
                  Recording
                </span>
              ) : null}
              {voiceEnabled && voiceTranscriptionActive ? (
                <span
                  className="relative ml-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_18px_rgba(59,130,246,.42)]"
                  title="Voice transcription active"
                  role="img"
                  aria-label="Voice transcription active"
                >
                  <span className="absolute inset-0 rounded-full bg-[var(--accent)] opacity-20 animate-ping" />
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="relative h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3" />
                    <path d="M8 21h8" />
                  </svg>
                </span>
              ) : null}
              {desktopVoiceStatus.mode !== 'off' ? (
                <span
                  className={`inline-flex h-5 flex-shrink-0 items-center gap-1 rounded-full border px-1.5 text-[9px] font-semibold ${
                    desktopVoiceStatus.mode === 'error'
                      ? 'border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] text-[var(--red)]'
                      : desktopVoiceStatus.mode === 'sleeping'
                        ? 'border-[rgba(148,163,184,.36)] bg-[rgba(148,163,184,.08)] text-[var(--muted)]'
                      : desktopVoiceStatus.mode === 'recording' || desktopVoiceStatus.mode === 'transcribing'
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[rgba(74,222,128,.32)] bg-[rgba(74,222,128,.08)] text-[var(--green)]'
                  }`}
                  title={desktopVoiceStatus.message}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      desktopVoiceStatus.mode === 'recording' || desktopVoiceStatus.mode === 'transcribing'
                        ? 'animate-pulse bg-[var(--accent)]'
                        : desktopVoiceStatus.mode === 'error'
                          ? 'bg-[var(--red)]'
                          : desktopVoiceStatus.mode === 'sleeping'
                            ? 'bg-[var(--muted)]'
                          : 'bg-[var(--green)]'
                    }`}
                  />
                  Desktop
                </span>
              ) : null}
            </div>
          </div>
          {!threadSidebarOpen ? (
            <button
              type="button"
              onClick={() => void createThread()}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg)]"
              title="New assistant thread"
              aria-label="New assistant thread"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setWorkspaceAccessOpen(false);
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
            onClick={() => {
              setFilesOpen(false);
              setToolsPanelOpen(false);
              setSettingsOpen(false);
              setWorkspaceAccessOpen((value) => !value);
            }}
            disabled={!activeThread}
            aria-pressed={workspaceAccessOpen}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
              workspaceAccessOpen
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title="Configure workspace access"
            aria-label="Configure workspace access"
          >
            <IconFolder className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={openSystemPromptEditor}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg)]"
            title="Edit assistant system prompts"
            aria-label="Edit assistant system prompts"
          >
            <IconPencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-assistant-tools-trigger
            onClick={() => {
              setSettingsOpen(false);
              setWorkspaceAccessOpen(false);
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
              setSettingsOpen((value) => !value);
            }}
            aria-pressed={settingsOpen}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] ${
              settingsOpen
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title="Assistant settings"
            aria-label="Assistant settings"
          >
            <IconSettings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void updateThread({ voiceEnabled: !voiceEnabled })}
            disabled={!activeThread}
            aria-pressed={voiceEnabled}
            aria-label="Toggle realtime thread mode"
            title={voiceEnabled ? 'Realtime mode is on' : 'Realtime mode is off'}
            className={`h-8 w-8 flex-shrink-0 rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
              voiceEnabled
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="mx-auto h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
              <path d="M8 21h8" />
            </svg>
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
        </div>

      {settingsOpen ? (
        <div className="absolute inset-x-0 bottom-0 top-11 z-20 overflow-y-auto bg-[var(--panel-alt)]">
          <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
            <div className="mb-4">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                <IconSettings className="h-4 w-4 text-[var(--muted)]" />
                Settings
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">Defaults apply to newly created threads. Existing threads keep their current configuration.</div>
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

      <div
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
      </div>

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
                  <div className="px-3 text-[12px] text-[var(--muted)]">Loading assistant...</div>
                ) : blipSession.historyLoading && visibleItems.length === 0 ? (
                  <div className="px-3 text-[12px] text-[var(--muted)]">Loading conversation...</div>
                ) : showEmptyAssistantThread ? (
                  <div className="w-full rounded border border-dashed border-[var(--border)] px-3 py-5 text-center">
                    <div className="text-[12px] text-[var(--fg-secondary)]">Start a thread to inspect drones or coordinate work.</div>
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

          {assistantChatIdleHold ? (
            <AssistantChatIdleFooterBanner subscriptions={activeChatIdleSubscriptionsForThread} droneNameById={droneNameById} />
          ) : null}

      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)] p-2">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <UiMenuSelect
            value={activeProvider}
            disabled={!activeThread || defaultModelBusy}
            onValueChange={(value) => {
              const provider = providerOptions.find((option) => option.id === value);
              if (!provider) return;
              const nextModel = provider.models[0];
              void updateThread({
                provider: provider.id,
                ...(nextModel ? { model: nextModel.id } : {}),
              });
            }}
            entries={providerOptions.map((provider) => ({
              value: provider.id,
              label: provider.label,
              title: provider.title,
              searchText: provider.label,
              disabled: provider.models.length === 0,
            }))}
            variant="toolbar"
            role="listbox"
            itemRole="option"
            title="Assistant provider"
            triggerLabel={activeProviderMeta.label}
            triggerClassName="h-7 w-[88px] justify-between border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
            triggerLabelClassName="font-semibold"
            panelClassName="bottom-full mb-1.5 w-[140px]"
            header="Provider"
          />
          <UiMenuSelect
            value={selectedModelKey}
            disabled={!activeThread || defaultModelBusy}
            onValueChange={(value) => {
              const [provider, model] = value.split(':');
              void updateThread({ provider: provider as AssistantThread['provider'], model });
            }}
            entries={modelMenuEntries}
            variant="toolbar"
            role="listbox"
            itemRole="option"
            title="Next assistant model"
            triggerLabel={compactModelSelectionLabel(selectedModelLabel)}
            triggerClassName="h-7 w-[112px] justify-between border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
            triggerLabelClassName="font-semibold"
            panelClassName="bottom-full mb-1.5 w-[190px]"
            menuClassName="max-h-56 overflow-y-auto"
            header="Model"
            searchable
            searchPlaceholder="Search models"
          />
          <UiMenuSelect
            value={activeThread?.thinkingLevel ?? ''}
            disabled={!activeThread || defaultModelBusy || reasoningMenuEntries.length === 0}
            onValueChange={(thinkingLevel) => void updateThread({ thinkingLevel })}
            entries={reasoningMenuEntries}
            variant="toolbar"
            role="listbox"
            itemRole="option"
            title={`Reasoning: ${assistantReasoningLabel(activeThread?.thinkingLevel ?? 'off')}`}
            triggerLabel={assistantReasoningLabel(activeThread?.thinkingLevel ?? 'off')}
            triggerClassName="h-7 w-[82px] justify-between border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
            triggerLabelClassName="font-semibold"
            panelClassName="bottom-full mb-1.5 w-[140px]"
            menuClassName="max-h-56 overflow-y-auto"
            header="Reasoning"
          />
          <button
            type="button"
            disabled={!activeThread || defaultModelBusy}
            aria-pressed={activeModelIsDefault}
            aria-label={activeModelIsDefault ? 'Current default model and reasoning' : 'Set current model and reasoning as default'}
            title={activeModelIsDefault ? 'Default model and reasoning for new threads' : 'Make this model and reasoning the default for new threads'}
            onClick={() => void setActiveModelAsDefault()}
            className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              activeModelIsDefault
                ? 'bg-[rgba(250,204,21,.10)] text-[var(--yellow)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--yellow)]'
            }`}
          >
            <DefaultModelStar selected={activeModelIsDefault} />
          </button>
          <div
            className="grid h-7 flex-shrink-0 grid-cols-2 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]"
            role="group"
            aria-label="Assistant message delivery"
          >
            {(['queue', 'asap'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!activeThread}
                onClick={() => void updateThread({ promptDeliveryMode: mode })}
                aria-pressed={promptDeliveryMode === mode}
                title={mode === 'queue' ? 'Queue after the assistant finishes' : 'Inject after the current turn before the next assistant response'}
                className={`min-w-[42px] px-2 text-[10px] font-semibold uppercase tracking-wide disabled:opacity-40 ${
                  promptDeliveryMode === mode
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {mode === 'queue' ? 'Queue' : 'ASAP'}
              </button>
            ))}
          </div>
        </div>
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
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              if (voiceDraftActiveRef.current && next.trim() !== voiceDraftTextRef.current.trim()) {
                voiceDraftActiveRef.current = false;
                voiceDraftTextRef.current = '';
                setVoiceDraftActive(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!assistantChatIdleHold) void sendPrompt();
              }
            }}
            onPaste={(event) => {
              event.stopPropagation();
              handleAssistantPaste(event);
            }}
            disabled={!activeThread || realtimeTextBlocked}
            placeholder={
              realtimeTextBlocked
                ? desktopVoiceStatus.realtime?.enabled === true
                  ? 'Start realtime voice to type in this thread'
                  : 'Turn on realtime voice to type in this thread'
                : assistantChatIdleHold
                ? 'Stop subscription below to send a message'
                : running
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
          {activeRunningModel ? (
            <span
              className="absolute bottom-2 left-10 max-w-[calc(100%-190px)] truncate rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
              title={`Running model: ${activeRunningModelLabel}`}
              style={{ fontFamily: 'var(--display)' }}
            >
              Running {activeRunningModelLabel}
            </span>
          ) : voiceDraftActive ? (
            <span
              className="absolute bottom-2 left-10 max-w-[calc(100%-190px)] truncate rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]"
              title="Voice transcript draft"
              style={{ fontFamily: 'var(--display)' }}
            >
              Voice draft
            </span>
          ) : null}
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {running || assistantChatIdleHold ? (
              <button
                type="button"
                onClick={() => void stop()}
                disabled={assistantStopBusy}
                title={assistantChatIdleHold && !running ? 'Cancel chat idle subscription' : 'Stop the assistant run'}
                aria-busy={assistantStopBusy}
                className="h-7 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--red)] disabled:opacity-40"
                style={{ fontFamily: 'var(--display)' }}
              >
                {assistantStopBusy ? 'Stopping…' : 'Stop'}
              </button>
            ) : null}
            {!assistantChatIdleHold ? (
              <button
                type="button"
                onClick={() => void sendPrompt()}
                disabled={(!draft.trim() && attachments.length === 0 && referencedDrones.length === 0) || !activeThread || scopeSyncBusy || realtimeTextBlocked}
                className="h-7 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] disabled:opacity-40"
                style={{ fontFamily: 'var(--display)' }}
              >
                Send
              </button>
            ) : null}
          </div>
        </div>
      </div>
        </div>
      )}
      </div>
      {threadSidebarDockSide === 'right' ? threadSidebar : null}
      {systemPromptOpen ? (
        <AssistantSystemPromptModal
          mode={systemPromptMode}
          globalPromptKind={systemPromptGlobalKind}
          settings={systemPromptSettings}
          draft={systemPromptDraft}
          voiceDraft={voiceSystemPromptDraft}
          threadSettings={threadSystemPromptSettings}
          threadDraft={threadSystemPromptDraft}
          loading={systemPromptLoading}
          saving={systemPromptSaving}
          threadSaving={threadSystemPromptSaving}
          promoting={promoteSystemPromptSaving}
          error={systemPromptError}
          notice={systemPromptNotice}
          onModeChange={setSystemPromptMode}
          onGlobalPromptKindChange={setSystemPromptGlobalKind}
          onDraftChange={setSystemPromptDraft}
          onVoiceDraftChange={setVoiceSystemPromptDraft}
          onThreadDraftChange={setThreadSystemPromptDraft}
          onUseGlobalForThread={() => setThreadSystemPromptDraft(threadSystemPromptSettings?.threadSystemPrompt.globalPrompt ?? '')}
          onUseDefaultForGlobal={() => {
            const defaultPrompt =
              systemPromptGlobalKind === 'voice'
                ? systemPromptSettings?.assistantVoiceSystemPrompt.defaultPrompt
                : systemPromptSettings?.assistantSystemPrompt.defaultPrompt;
            if (systemPromptGlobalKind === 'voice') setVoiceSystemPromptDraft(defaultPrompt ?? '');
            else setSystemPromptDraft(defaultPrompt ?? '');
          }}
          onClose={() => setSystemPromptOpen(false)}
          onSaveGlobal={() => void saveSystemPromptSettings()}
          onSaveThread={() => void saveThreadSystemPromptSettings()}
          onPromoteThread={() => void promoteThreadSystemPrompt()}
        />
      ) : null}
    </div>
  );
}
