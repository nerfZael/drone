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
import { IconChatThread, IconEye, IconList, IconPencil, IconPlus, IconSettings, IconSidebarCollapse, IconSidebarExpand, IconSpinner, IconTrash } from '../app/icons';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { IconChevron, IconDrone, IconFile, IconFolder, iconForFilePath } from '../icons';
import { dispatchAssistantOpenDroneChat } from './open-drone-chat-event';
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
const ASSISTANT_OVERVIEW_AUTO_STORAGE_KEY = 'droneHub.assistant.overviewAuto';
const ASSISTANT_OVERVIEW_INTERVAL_STORAGE_KEY = 'droneHub.assistant.overviewIntervalMs';
const TOOL_ROW_MESSAGE_PREVIEW_MAX = 72;
const TOOL_ROW_TARGET_PREVIEW_MAX = 3;
/** Distance from bottom (px) below which we treat the assistant transcript as "pinned" for auto-scroll. */
const ASSISTANT_SCROLL_BOTTOM_THRESHOLD_PX = 48;
const ASSISTANT_IDLE_REFRESH_INTERVAL_MS = 2_500;
const ASSISTANT_ACTIVE_REFRESH_INTERVAL_MS = 1_000;
const ASSISTANT_EVENT_REFRESH_DEBOUNCE_MS = 150;
const ASSISTANT_OVERVIEW_INTERVAL_OPTIONS = [
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
  { value: '60000', label: '1m' },
  { value: '120000', label: '2m' },
  { value: '300000', label: '5m' },
];

type AssistantThreadStatus = 'idle' | 'running' | 'waiting_for_approval' | 'waiting_for_chats_idle' | 'error';

type AssistantMessage = {
  role: 'user' | 'assistant' | 'toolResult';
  content?: string | Array<{ type: string; text?: string; thinking?: string; name?: string; arguments?: any; id?: string; data?: string; mimeType?: string }>;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  errorMessage?: string;
};

type AssistantQueuedPrompt = {
  id: string;
  prompt: string;
  createdAt: string;
  provider: AssistantProviderId;
  model: string;
  thinkingLevel: string;
  deliveryMode?: AssistantPromptDeliveryMode;
};

type AssistantPromptDeliveryMode = 'queue' | 'asap';
type AssistantPanelMode = 'normal' | 'voice';
type AssistantSystemPromptKind = 'normal' | 'voice';

type AssistantRunModel = {
  provider: AssistantProviderId;
  model: string;
  thinkingLevel: string;
  promptId: string;
  startedAt: string;
};

type AssistantChatIdleSubscription = {
  id: string;
  threadId: string;
  mode?: 'all' | 'any';
  targets: Array<{ droneId: string; chatName: string }>;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'fired' | 'cancelled' | 'expired';
};

type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  voiceEnabled?: boolean;
  voiceEnabledAt?: string | null;
  model: string;
  provider: AssistantProviderId;
  thinkingLevel: string;
  systemPrompt?: string;
  systemPromptUpdatedAt?: string | null;
  enabledTools?: string[];
  accessScope: AssistantAccessScope;
  autoApprove: boolean;
  promptDeliveryMode: AssistantPromptDeliveryMode;
  messageCount?: number;
  messages: AssistantMessage[];
  queuedPrompts?: AssistantQueuedPrompt[];
  status: AssistantThreadStatus;
  error: string | null;
};

type AssistantApproval = {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  label: string;
  args: any;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
};

type AssistantModelOption = {
  provider: AssistantProviderId;
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevel: string;
};

type AssistantToolSummary = {
  name: string;
  label: string;
  description: string;
  category: 'context' | 'prompts' | 'files' | 'chats' | 'drones' | 'actions';
};

type AssistantProviderId = 'openai' | 'gemini' | 'codex';

type AssistantAccessScope = { readMode: 'all' | 'selected'; writeMode: 'all' | 'selected'; droneIds: string[]; updatedAt: string };
type AssistantScopeUpdateResult = { ok: true; accessScope?: AssistantAccessScope };
type AssistantScopeDraft = { readMode: AssistantScopeMode; writeMode: AssistantScopeMode; drones: AssistantScopeDrone[] };
type PendingAssistantScopeSave = {
  requestId: number;
  threadId: string;
  key: string;
  promise: Promise<boolean>;
};

type AssistantSnapshot = {
  ok: true;
  activeThreadId: string;
  threads: AssistantThread[];
  pendingApprovals: AssistantApproval[];
  chatIdleSubscriptions?: AssistantChatIdleSubscription[];
  models: AssistantModelOption[];
  availableTools?: AssistantToolSummary[];
  accessScope?: AssistantAccessScope;
  runningModels?: Record<string, AssistantRunModel>;
  streamingMessage?: AssistantMessage;
  streamingMessages?: AssistantMessage[];
};

function snapshotWithPreferredActiveThread(snapshot: AssistantSnapshot, preferredThreadId: string | null | undefined): AssistantSnapshot {
  const threadId = String(preferredThreadId ?? '').trim();
  if (!threadId || snapshot.activeThreadId === threadId) return snapshot;
  if (!snapshot.threads.some((thread) => thread.id === threadId)) return snapshot;
  return { ...snapshot, activeThreadId: threadId };
}

const EMPTY_ASSISTANT_MODEL_OPTIONS: AssistantModelOption[] = [];
const EMPTY_ASSISTANT_TOOL_SUMMARIES: AssistantToolSummary[] = [];

type AssistantSystemPromptSettings = {
  ok: true;
  assistantSystemPrompt: {
    prompt: string;
    promptSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPrompt: string;
    maxPromptChars: number;
    runtimeAppendix: string;
  };
  assistantVoiceSystemPrompt: {
    prompt: string;
    promptSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPrompt: string;
    maxPromptChars: number;
    runtimeAppendix: string;
  };
};

type AssistantThreadSystemPromptSettings = {
  ok: true;
  threadId: string;
  threadSystemPrompt: {
    prompt: string;
    promptSource: 'thread' | 'global' | 'default';
    updatedAt: string | null;
    globalPrompt: string;
    globalPromptSource: 'settings' | 'default';
    defaultPrompt: string;
    maxPromptChars: number;
    runtimeAppendix: string;
  };
};

type AssistantOverviewPromptSettings = {
  ok: true;
  assistantOverviewPrompt: {
    prompt: string;
    promptSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPrompt: string;
    maxPromptChars: number;
  };
};

type AssistantThreadOverviewResult = {
  ok: true;
  threadId: string;
  markdown: string;
  generatedAt: string;
  inputFingerprint: string;
  promptFingerprint: string;
  provider: AssistantProviderId;
  model: string;
  cached: boolean;
  inputReused: boolean;
};

type AssistantArtifactSummary = {
  path: string;
  size: number;
  updatedAt: string;
  revision: string;
  mimeType?: string;
  binary?: boolean;
};

type AssistantArtifactFile = AssistantArtifactSummary & {
  content: string;
  contentBase64?: string;
};

type AssistantAttachmentPayload = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
  disposition?: 'artifact' | 'prompt';
};

type AssistantAttachmentSource = 'file' | 'paste';
type AssistantDraftImageAttachment = Extract<DraftChatAttachment, { kind: 'image' }> & { source: AssistantAttachmentSource };
type AssistantDraftTextAttachment = Extract<DraftChatAttachment, { kind: 'text' }> & { source: AssistantAttachmentSource };

type AssistantDraftFileAttachment = {
  kind: 'file';
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  source: 'file';
};

type AssistantDraftAttachment = AssistantDraftImageAttachment | AssistantDraftTextAttachment | AssistantDraftFileAttachment;
type AssistantDroneReference = { id: string; name: string };

type AssistantScopeDrone = { id: string; name: string };
type AssistantScopeMode = 'all' | 'selected';

const ASSISTANT_PROVIDERS: Array<{ id: AssistantProviderId; label: string; authLabel: string; title: string }> = [
  { id: 'codex', label: 'Codex', authLabel: 'CLI subscription', title: 'Use Codex CLI ChatGPT authentication for Codex models.' },
  { id: 'openai', label: 'OpenAI', authLabel: 'API key', title: 'Use the configured OpenAI API key for OpenAI models.' },
  { id: 'gemini', label: 'Gemini', authLabel: 'API key', title: 'Use the configured Gemini API key for Gemini models.' },
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

function readInitialOverviewAutoEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ASSISTANT_OVERVIEW_AUTO_STORAGE_KEY) === '1';
}

function normalizeOverviewIntervalMs(raw: unknown): number {
  const value = String(raw ?? '').trim();
  return ASSISTANT_OVERVIEW_INTERVAL_OPTIONS.some((option) => option.value === value) ? Number(value) : 30_000;
}

function readInitialOverviewIntervalMs(): number {
  if (typeof window === 'undefined') return 30_000;
  return normalizeOverviewIntervalMs(window.localStorage.getItem(ASSISTANT_OVERVIEW_INTERVAL_STORAGE_KEY));
}

function assistantScopeSyncKey(readMode: AssistantScopeMode, writeMode: AssistantScopeMode, droneIds: string[]): string {
  return `${readMode}\u0000${writeMode}\u0000${droneIds.join('\u0000')}`;
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

function assistantScopeDroneIds(readMode: AssistantScopeMode, writeMode: AssistantScopeMode, drones: AssistantScopeDrone[]): string[] {
  if (readMode !== 'selected' && writeMode !== 'selected') return [];
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
  const ids = readMode === 'selected' || writeMode === 'selected' ? cleanAssistantScopeIds(scope.droneIds) : [];
  return assistantScopeSyncKey(readMode, writeMode, ids);
}

function assistantScopeUpdatedAtMs(scope: AssistantAccessScope | null | undefined): number {
  const ms = Date.parse(String(scope?.updatedAt ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

type AssistantToolCall = { id: string; name: string; args: any };
type AssistantDroneNameMap = Record<string, string>;
type AssistantWaitTargetLabel = { key: string; droneLabel: string; chatName: string };
type AssistantMessageDroneSummary = { droneLabel: string; chatName: string; message: string };
type AssistantToolRenderItem = { type: 'tool'; key: string; call?: AssistantToolCall; result?: AssistantMessage };

type AssistantRenderItem =
  | { type: 'message'; key: string; message: AssistantMessage; showToolCalls?: boolean; sourceMessageIndex: number }
  | AssistantToolRenderItem
  | { type: 'toolGroup'; key: string; items: AssistantToolRenderItem[] }
  | { type: 'queued'; key: string; prompt: AssistantQueuedPrompt };

function messageText(message: AssistantMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part.type === 'text') return String(part.text ?? '');
      if (part.type === 'thinking') return String(part.thinking ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function messageImageParts(message: AssistantMessage): Array<{ data: string; mimeType: string }> {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === 'image' && String(part.data ?? '').trim())
    .map((part) => ({
      data: String(part.data ?? '').trim(),
      mimeType: String(part.mimeType ?? '').trim() || 'image/png',
    }));
}

function lastAssistantContentBlock(message: AssistantMessage): { type: string } | null {
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i];
    if (!part || typeof part !== 'object') continue;
    const t = String((part as { type?: string }).type ?? '');
    if (t === 'text' || t === 'thinking' || t === 'toolCall') return { type: t };
  }
  return null;
}

function latestThinkingText(message: AssistantMessage): string {
  if (lastAssistantContentBlock(message)?.type !== 'thinking') return '';
  const content = message.content;
  if (!Array.isArray(content)) return '';
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const part = content[i];
    if (part?.type === 'thinking') return String(part.thinking ?? '');
  }
  return '';
}

function toolCalls(message: AssistantMessage): AssistantToolCall[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part.type === 'toolCall')
    .map((part) => ({
      id: String(part.id ?? ''),
      name: String(part.name ?? ''),
      args: part.arguments ?? {},
    }))
    .filter((part) => part.id && part.name);
}

const TOOL_LABELS: Record<string, string> = {
  create_chat: 'Create chat',
  create_drone: 'Create drone',
  assistant_files: 'Assistant files',
  get_current_context: 'Read current context',
  get_system_prompt: 'Read system prompt',
  update_system_prompt: 'Update system prompt',
  get_chat_overview: 'Read chat overview',
  inspect_drone: 'Inspect drone',
  list_drones: 'List drones',
  message_drone: 'Send user message to drone',
  read_chat_messages: 'Read chat messages',
  search_chat_messages: 'Search chat messages',
  set_drone_group: 'Set drone group',
  subscribe_to_any_chat_idle: 'Subscribe to any chat idle',
  subscribe_to_all_chats_idle: 'Subscribe to all chats idle',
  subscribe_to_chats_idle: 'Subscribe to all chats idle',
  wait_for_agent_chats_idle: 'Wait for chats idle',
};

function isChatIdleToolName(name: string | undefined): boolean {
  return (
    name === 'subscribe_to_any_chat_idle' ||
    name === 'subscribe_to_all_chats_idle' ||
    name === 'subscribe_to_chats_idle' ||
    name === 'wait_for_agent_chats_idle'
  );
}

function toolLabel(name: string | undefined): string {
  const key = String(name ?? '').trim();
  if (!key) return 'Tool';
  return TOOL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeAssistantWaitTargets(args: any, droneNameById: AssistantDroneNameMap): AssistantWaitTargetLabel[] {
  const rawTargets = Array.isArray(args?.targets) ? args.targets : [];
  const seen = new Set<string>();
  const targets: AssistantWaitTargetLabel[] = [];
  for (const rawTarget of rawTargets) {
    const droneId = String(rawTarget?.droneId ?? rawTarget?.id ?? rawTarget?.drone ?? '').trim();
    const explicitName = String(rawTarget?.droneName ?? rawTarget?.name ?? rawTarget?.displayName ?? '').trim();
    const chatName = String(rawTarget?.chatName ?? rawTarget?.chat ?? 'default').trim() || 'default';
    const key = `${droneId || explicitName}\u0000${chatName}`;
    if ((!droneId && !explicitName) || seen.has(key)) continue;
    seen.add(key);
    targets.push({
      key,
      droneLabel: explicitName || droneNameById[droneId] || droneId,
      chatName,
    });
  }
  return targets;
}

function compactPreview(raw: unknown, maxLength = TOOL_ROW_MESSAGE_PREVIEW_MAX): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function summarizeWaitTargets(targets: AssistantWaitTargetLabel[]): string {
  if (targets.length === 0) return '';
  const labels = targets.map((target) => target.droneLabel).filter(Boolean);
  const visible = labels.slice(0, TOOL_ROW_TARGET_PREVIEW_MAX);
  const remainder = labels.length - visible.length;
  return remainder > 0 ? `${visible.join(', ')} +${remainder}` : visible.join(', ');
}

function messageDroneSummary(args: any, droneNameById: AssistantDroneNameMap): string {
  const resolved = args?.resolved ?? args ?? {};
  const droneId = String(resolved?.droneId ?? resolved?.id ?? args?.droneId ?? '').trim();
  const droneLabel = String(resolved?.droneName ?? resolved?.name ?? '').trim() || droneNameById[droneId] || droneId;
  const message = compactPreview(resolved?.message ?? resolved?.prompt ?? args?.message ?? args?.prompt);
  if (droneLabel && message) return `${droneLabel}: ${message}`;
  return droneLabel || message;
}

function messageDroneDetails(args: any, droneNameById: AssistantDroneNameMap): AssistantMessageDroneSummary {
  const resolved = args?.resolved ?? args ?? {};
  const droneId = String(resolved?.droneId ?? resolved?.id ?? args?.droneId ?? '').trim();
  const droneLabel = String(resolved?.droneName ?? resolved?.name ?? '').trim() || droneNameById[droneId] || droneId;
  const chatName = String(resolved?.chatName ?? args?.chatName ?? '').trim();
  const message = String(resolved?.message ?? resolved?.prompt ?? args?.message ?? args?.prompt ?? '').trim();
  return { droneLabel, chatName, message };
}

function toolActivityTitle(call: AssistantToolCall | undefined, result: AssistantMessage | undefined, droneNameById: AssistantDroneNameMap): string {
  const baseTitle = toolLabel(call?.name || result?.toolName);
  if (!call) return baseTitle;
  if (isChatIdleToolName(call.name)) {
    const summary = summarizeWaitTargets(normalizeAssistantWaitTargets(call.args, droneNameById));
    return summary ? `${baseTitle}: ${summary}` : baseTitle;
  }
  if (call.name === 'message_drone') {
    const summary = messageDroneSummary(call.args, droneNameById);
    return summary ? `${baseTitle}: ${summary}` : baseTitle;
  }
  return baseTitle;
}

function toolItemName(item: AssistantToolRenderItem): string {
  return String(item.call?.name || item.result?.toolName || '').trim();
}

function canGroupToolItem(item: AssistantToolRenderItem): boolean {
  const name = toolItemName(item);
  return Boolean(name) && name !== 'message_drone' && !isChatIdleToolName(name);
}

function compactRepeatedToolItems(items: AssistantRenderItem[]): AssistantRenderItem[] {
  const compacted: AssistantRenderItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type !== 'tool' || !canGroupToolItem(item)) {
      compacted.push(item);
      continue;
    }

    const name = toolItemName(item);
    const run: AssistantToolRenderItem[] = [item];
    let nextIndex = index + 1;
    while (nextIndex < items.length) {
      const next = items[nextIndex];
      if (next.type !== 'tool' || !canGroupToolItem(next) || toolItemName(next) !== name) break;
      run.push(next);
      nextIndex += 1;
    }

    if (run.length > 1) {
      compacted.push({
        type: 'toolGroup',
        key: `tool-group:${name}:${run[0].key}:${run.length}`,
        items: run,
      });
      index = nextIndex - 1;
    } else {
      compacted.push(item);
    }
  }
  return compacted;
}

function toolDroneLookupKey(items: AssistantRenderItem[]): string {
  const keys: string[] = [];
  for (const item of items) {
    if (item.type !== 'tool' || !item.call) continue;
    if (isChatIdleToolName(item.call.name)) {
      const targets = Array.isArray(item.call.args?.targets) ? item.call.args.targets : [];
      for (const target of targets) {
        const droneId = String(target?.droneId ?? target?.id ?? target?.drone ?? '').trim();
        if (!droneId) continue;
        const chatName = String(target?.chatName ?? target?.chat ?? 'default').trim() || 'default';
        keys.push(`${droneId}:${chatName}`);
      }
      continue;
    }
    if (item.call.name === 'message_drone') {
      const droneId = String(item.call.args?.resolved?.droneId ?? item.call.args?.droneId ?? '').trim();
      if (!droneId) continue;
      keys.push(droneId);
    }
  }
  return keys.join('|');
}

function renderItemsFromMessages(messages: AssistantMessage[]): AssistantRenderItem[] {
  const consumedToolResults = new Set<number>();
  const items: AssistantRenderItem[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'toolResult') {
      if (consumedToolResults.has(index)) continue;
      const resultKey = String(message.toolCallId ?? '').trim();
      items.push({
        type: 'tool',
        key: resultKey ? `tool-result:${resultKey}` : `tool-result:idx-${index}`,
        result: message,
      });
      continue;
    }

    const calls = toolCalls(message);
    if (message.role !== 'assistant' || calls.length === 0) {
      items.push({ type: 'message', key: `message:${index}:${message.role}`, message, sourceMessageIndex: index });
      continue;
    }

    if (messageText(message).trim() || message.errorMessage) {
      items.push({ type: 'message', key: `message:${index}:${message.role}`, message, showToolCalls: false, sourceMessageIndex: index });
    }

    for (const call of calls) {
      let resultIndex = -1;
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
        if (consumedToolResults.has(nextIndex)) continue;
        const candidate = messages[nextIndex];
        if (candidate.role !== 'toolResult') continue;
        const candidateCallId = String(candidate.toolCallId ?? '').trim();
        if (candidateCallId && candidateCallId !== call.id) continue;
        resultIndex = nextIndex;
        break;
      }
      const result = resultIndex >= 0 ? messages[resultIndex] : undefined;
      if (resultIndex >= 0) consumedToolResults.add(resultIndex);
      items.push({ type: 'tool', key: `tool-call:${call.id}`, call, result });
    }
  }
  return compactRepeatedToolItems(items);
}

function formatUpdatedAt(raw: string): string {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return '';
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'now';
  if (delta < 60 * 60_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(delta / (60 * 60_000)))}h`;
  return new Date(ms).toLocaleDateString();
}

function formatArtifactSize(bytesRaw: number): string {
  const bytes = Number(bytesRaw);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type AssistantArtifactTreeNode =
  | {
      kind: 'directory';
      name: string;
      path: string;
      children: AssistantArtifactTreeNode[];
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      file: AssistantArtifactSummary;
    };

function sortAssistantArtifactTree(nodes: AssistantArtifactTreeNode[]): AssistantArtifactTreeNode[] {
  return nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

function buildAssistantArtifactTree(files: AssistantArtifactSummary[]): AssistantArtifactTreeNode[] {
  const root: AssistantArtifactTreeNode[] = [];
  const directoriesByPath = new Map<string, Extract<AssistantArtifactTreeNode, { kind: 'directory' }>>();

  for (const file of files) {
    const path = String(file.path ?? '').trim();
    if (!path) continue;
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop() ?? path;
    let parent = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let directory = directoriesByPath.get(currentPath);
      if (!directory) {
        directory = { kind: 'directory', name: part, path: currentPath, children: [] };
        directoriesByPath.set(currentPath, directory);
        parent.push(directory);
      }
      parent = directory.children;
    }

    parent.push({ kind: 'file', name: fileName, path, file });
  }

  const sortDeep = (nodes: AssistantArtifactTreeNode[]) => {
    sortAssistantArtifactTree(nodes);
    for (const node of nodes) {
      if (node.kind === 'directory') sortDeep(node.children);
    }
  };
  sortDeep(root);
  return root;
}

function collectAssistantArtifactDirectoryPaths(nodes: AssistantArtifactTreeNode[]): string[] {
  const out: string[] = [];
  const visit = (items: AssistantArtifactTreeNode[]) => {
    for (const node of items) {
      if (node.kind !== 'directory') continue;
      out.push(node.path);
      visit(node.children);
    }
  };
  visit(nodes);
  return out;
}

function AssistantTreeIndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0">
      {Array.from({ length: depth }).map((_, index) => (
        <span
          key={index}
          className="absolute inset-y-0 w-px bg-[rgba(136,145,168,.18)]"
          style={{ left: `${9 + index * 14}px` }}
        />
      ))}
    </span>
  );
}

function selectDefaultArtifactPath(files: AssistantArtifactSummary[]): string | null {
  if (files.length === 0) return null;
  const preferred = files.find((file) => file.path === 'status.md') ?? files.find((file) => file.path.endsWith('/status.md'));
  return preferred?.path ?? files[0]?.path ?? null;
}

function isImageMimeType(mimeRaw: unknown): boolean {
  return String(mimeRaw ?? '').trim().toLowerCase().startsWith('image/');
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
  return `${selection.provider}:${selection.model}:${selection.thinkingLevel}`;
}

function modelSelectionLabel(
  selection: Pick<AssistantRunModel, 'provider' | 'model' | 'thinkingLevel'>,
  options: AssistantModelOption[],
): string {
  const match = options.find(
    (option) =>
      modelSelectionKey({ provider: option.provider, model: option.id, thinkingLevel: option.thinkingLevel }) === modelSelectionKey(selection),
  );
  if (match) return match.name;
  return `${selection.provider}/${selection.model}${selection.thinkingLevel !== 'off' ? ` ${selection.thinkingLevel}` : ''}`;
}

function compactModelSelectionLabel(label: string): string {
  return label.replace(/^GPT-/, '').replace(/\bMedium\b/, 'Med');
}

function assistantThreadStatusTone(status: AssistantThreadStatus): string {
  if (status === 'running') return 'bg-[var(--green)]';
  if (status === 'waiting_for_approval') return 'bg-[var(--accent)]';
  if (status === 'waiting_for_chats_idle') return 'bg-[var(--yellow)]';
  if (status === 'error') return 'bg-[var(--red)]';
  return 'bg-[var(--muted-dim)]';
}

function assistantThreadStatusLabel(status: AssistantThreadStatus | undefined, fallback: string): string {
  if (!status) return fallback;
  if (status === 'waiting_for_chats_idle') return 'subscribed to chats idle';
  return status.replace(/_/g, ' ');
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

function ToolDisclosure({
  title,
  status,
  children,
}: {
  title: string;
  status?: 'ok' | 'error';
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {status ? (
          <span
            className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${
              status === 'error' ? 'bg-[var(--red)] text-[var(--bg)]' : 'bg-[var(--green)] text-[var(--bg)]'
            }`}
          >
            {status === 'error' ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <ToolCheckIcon className="h-2.5 w-2.5" />}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open ? <div className="border-t border-[var(--border-subtle)] px-2 py-1.5">{children}</div> : null}
    </div>
  );
}

function ToolCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5.2l2 2 4-4.4" />
    </svg>
  );
}

function ThinkingPulseDots() {
  return (
    <span className="inline-flex h-6 flex-shrink-0 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2" aria-hidden="true">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" style={{ animationDelay: '120ms' }} />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" style={{ animationDelay: '240ms' }} />
    </span>
  );
}

function AssistantThinkingRow() {
  return (
    <div className="px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
        Assistant
      </div>
      <ThinkingPulseDots />
    </div>
  );
}

function ReasoningBlock({ text, headerPulse }: { text: string; headerPulse: boolean }) {
  const [open, setOpen] = React.useState(false);
  const trimmed = text.trim();
  if (!trimmed && !headerPulse) return null;

  return (
    <div className="mb-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[rgba(255,255,255,.04)]"
      >
        <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          Reasoning
        </span>
        {headerPulse ? <ThinkingPulseDots /> : null}
        <span className="ml-auto flex-shrink-0 text-[10px] text-[var(--muted)]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {trimmed ? (
        open ? (
          <div className="border-t border-[var(--border-subtle)] px-2.5 py-2">
            <div className="max-h-[min(70vh,28rem)] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--muted)]">
              {trimmed}
            </div>
          </div>
        ) : (
          <div className="border-t border-[var(--border-subtle)] px-2.5 pb-2 pt-1">
            <div className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--muted-dim)]">
              {trimmed}
            </div>
          </div>
        )
      ) : headerPulse ? (
        <div className="border-t border-[var(--border-subtle)] px-2.5 py-2 text-[11px] text-[var(--muted-dim)]">…</div>
      ) : null}
    </div>
  );
}

function summarizeChatIdleBannerTargets(subscriptions: AssistantChatIdleSubscription[], droneNameById: AssistantDroneNameMap): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const sub of subscriptions) {
    for (const target of sub.targets) {
      const droneId = String(target.droneId ?? '').trim();
      const chatName = String(target.chatName ?? '').trim() || 'default';
      const droneLabel = (droneId && droneNameById[droneId]) || droneId || 'drone';
      const label = chatName !== 'default' ? `${droneLabel} / ${chatName}` : droneLabel;
      if (!label.trim() || seen.has(label)) continue;
      seen.add(label);
      parts.push(label);
    }
  }
  if (parts.length === 0) return '';
  const visible = parts.slice(0, 4);
  const extra = parts.length - visible.length;
  return extra > 0 ? `${visible.join(' · ')} +${extra}` : visible.join(' · ');
}

function chatIdleBannerTitle(subscriptions: AssistantChatIdleSubscription[]): string {
  const modes = new Set(subscriptions.map((sub) => sub.mode ?? 'all'));
  if (modes.size === 1 && modes.has('any')) return 'Subscribed — waiting for any chat to go idle';
  if (modes.size === 1 && modes.has('all')) return 'Subscribed — waiting for all chats to go idle';
  return 'Subscribed — waiting for chat idle events';
}

function formatChatIdleExpiryHint(expiresAtIso: string): string {
  const ms = Date.parse(expiresAtIso);
  if (!Number.isFinite(ms)) return '';
  const delta = ms - Date.now();
  if (delta <= 0) return 'Subscription expires soon';
  if (delta < 60_000) return 'Expires in under a minute';
  if (delta < 60 * 60_000) return `Expires in ${Math.ceil(delta / 60_000)}m`;
  return `Expires ${new Date(ms).toLocaleString()}`;
}

function earliestChatIdleExpiryIso(subscriptions: AssistantChatIdleSubscription[]): string | null {
  let best: number | null = null;
  for (const sub of subscriptions) {
    const ms = Date.parse(sub.expiresAt);
    if (!Number.isFinite(ms)) continue;
    if (best === null || ms < best) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

function AssistantChatIdleFooterBanner({
  subscriptions,
  droneNameById,
}: {
  subscriptions: AssistantChatIdleSubscription[];
  droneNameById: AssistantDroneNameMap;
}) {
  const targetLine = React.useMemo(() => summarizeChatIdleBannerTargets(subscriptions, droneNameById), [subscriptions, droneNameById]);
  const title = React.useMemo(() => chatIdleBannerTitle(subscriptions), [subscriptions]);
  const expiryHint = React.useMemo(() => {
    const iso = earliestChatIdleExpiryIso(subscriptions);
    return iso ? formatChatIdleExpiryHint(iso) : '';
  }, [subscriptions]);

  return (
    <div
      className="flex-shrink-0 border-t border-[rgba(255,200,80,.28)] bg-[rgba(255,200,80,.08)] px-3 py-2"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[var(--yellow)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">{title}</div>
          {targetLine ? (
            <div className="mt-0.5 truncate text-[10px] text-[var(--muted)]" title={targetLine}>
              Watching {targetLine}
            </div>
          ) : (
            <div className="mt-0.5 text-[10px] text-[var(--muted)]">
              The assistant resumes this thread automatically when monitored chats become idle. Use Stop below to cancel.
            </div>
          )}
          {expiryHint ? <div className="mt-1 text-[10px] text-[var(--muted-dim)]">{expiryHint}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ToolStatusIndicator({ result }: { result?: AssistantMessage }) {
  const dotClass = !result ? 'bg-[var(--accent)]' : result.isError ? 'bg-[var(--red)]' : 'bg-[var(--green)]';
  if (!result || result.isError) return <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass}`} />;
  return (
    <span className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${dotClass} text-[var(--bg)]`}>
      <ToolCheckIcon className="h-2.5 w-2.5" />
    </span>
  );
}

function ToolDetailsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto flex h-5 flex-shrink-0 items-center rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      {open ? 'Hide details' : 'Details'}
    </button>
  );
}

function ToolPayloadDetails({ call, result }: { call?: AssistantToolCall; result?: AssistantMessage }) {
  const resultText = result ? messageText(result) : '';
  return (
    <div className="grid gap-2 border-t border-[var(--border-subtle)] px-2.5 py-2">
      {call ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Arguments
          </div>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--muted-dim)]">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        </div>
      ) : null}
      {result ? (
        <div className={call ? 'border-t border-[var(--border-subtle)] pt-2' : ''}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Result
          </div>
          {resultText ? (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[var(--fg-secondary)]">{resultText}</pre>
          ) : (
            <div className="mt-1 text-[11px] text-[var(--muted-dim)]">No result payload.</div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--muted-dim)]">Waiting for result...</div>
      )}
    </div>
  );
}

function RepeatedToolActivityRow({ items }: { items: AssistantToolRenderItem[] }) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const first = items[0];
  const name = toolItemName(first);
  const label = toolLabel(name);
  const errorCount = items.filter((item) => item.result?.isError).length;
  const pendingCount = items.filter((item) => !item.result).length;
  const statusParts = [
    pendingCount > 0 ? `${pendingCount} pending` : '',
    errorCount > 0 ? `${errorCount} failed` : '',
  ].filter(Boolean);
  const statusText = statusParts.length > 0 ? statusParts.join(', ') : 'Complete';
  const statusResult: AssistantMessage | undefined =
    errorCount > 0 ? { role: 'toolResult', isError: true, content: '' } : pendingCount > 0 ? undefined : { role: 'toolResult', content: '' };

  return (
    <div className="mx-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
        <ToolStatusIndicator result={statusResult} />
        <div className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          {label}
        </div>
        <span className="flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--fg-secondary)]">
          x{items.length}
        </span>
        <span className="hidden flex-shrink-0 text-[10px] text-[var(--muted-dim)] sm:inline">{statusText}</span>
        <ToolDetailsButton open={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} />
      </div>
      {detailsOpen ? (
        <div className="grid gap-2 border-t border-[var(--border-subtle)] p-2">
          {items.map((item, index) => (
            <div key={item.key} className="overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)]">
              <div className="flex min-w-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
                <ToolStatusIndicator result={item.result} />
                <div className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  {label} #{index + 1}
                </div>
              </div>
              <ToolPayloadDetails call={item.call} result={item.result} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessageDroneActivityRow({
  call,
  result,
  droneNameById,
}: {
  call: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById: AssistantDroneNameMap;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const summary = messageDroneDetails(call.args, droneNameById);
  const preview = compactPreview(summary.message, 220);
  return (
    <div className="mx-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]">
      <div className="px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ToolStatusIndicator result={result} />
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Send user message
            </div>
            <ToolDetailsButton open={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-1.5 py-0.5 text-[11px] text-[var(--fg-secondary)]">
              <span className="truncate">{summary.droneLabel || 'Target drone'}</span>
            </span>
            {summary.chatName && summary.chatName !== 'default' ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
                <span className="truncate">{summary.chatName}</span>
              </span>
            ) : null}
          </div>
          {preview ? (
            <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-2 py-1.5 text-[12px] leading-5 text-[var(--fg-secondary)]">
              {preview}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-[var(--muted-dim)]">No message preview available.</div>
          )}
        </div>
      </div>
      {detailsOpen ? <ToolPayloadDetails call={call} result={result} /> : null}
    </div>
  );
}

function ChatsIdleActivityRow({
  call,
  result,
  droneNameById,
}: {
  call: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById: AssistantDroneNameMap;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const targets = normalizeAssistantWaitTargets(call.args, droneNameById);
  const targetSummary = summarizeWaitTargets(targets);
  const label = toolLabel(call.name);
  return (
    <div className="mx-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]">
      <div className="border-b border-[var(--border-subtle)] px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ToolStatusIndicator result={result} />
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {label}
            </div>
            <ToolDetailsButton open={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} />
          </div>
          <div className="mt-1 text-[12px] text-[var(--fg-secondary)]">
            {targetSummary || 'Resolving target drones'}
          </div>
        </div>
      </div>
      <div className="grid gap-1.5 p-2">
        {targets.length > 0 ? (
          targets.map((target) => (
            <div
              key={target.key}
              className="flex min-h-8 min-w-0 items-center gap-2 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-2"
            >
              <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--fg-secondary)]">{target.droneLabel}</div>
              {target.chatName && target.chatName !== 'default' ? (
                <div className="max-w-[42%] truncate rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                  {target.chatName}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-2 py-2 text-[11px] text-[var(--muted-dim)]">
            Waiting for result...
          </div>
        )}
      </div>
      {detailsOpen ? <ToolPayloadDetails call={call} result={result} /> : null}
    </div>
  );
}

function ToolActivityRow({
  call,
  result,
  droneNameById = {},
}: {
  call?: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById?: AssistantDroneNameMap;
}) {
  if (call?.name === 'message_drone') {
    return <MessageDroneActivityRow call={call} result={result} droneNameById={droneNameById} />;
  }

  if (call && isChatIdleToolName(call.name)) {
    return <ChatsIdleActivityRow call={call} result={result} droneNameById={droneNameById} />;
  }

  const title = toolActivityTitle(call, result, droneNameById);
  const resultText = result ? messageText(result) : '';
  return (
    <div className="mx-3">
      <ToolDisclosure title={title} status={result ? (result.isError ? 'error' : 'ok') : undefined}>
        {call ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Arguments
            </div>
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--muted-dim)]">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
        ) : null}
        {result ? (
          <div className={call ? 'mt-2 border-t border-[var(--border-subtle)] pt-2' : ''}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Result
            </div>
            {resultText ? (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[var(--fg-secondary)]">{resultText}</pre>
            ) : (
              <div className="mt-1 text-[11px] text-[var(--muted-dim)]">No result payload.</div>
            )}
          </div>
        ) : (
          <div className={call ? 'mt-2 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--muted-dim)]' : 'text-[11px] text-[var(--muted-dim)]'}>
            Waiting for result...
          </div>
        )}
      </ToolDisclosure>
    </div>
  );
}

function AssistantMessageRow({
  message,
  droneMentionLinks,
  onOpenDroneMention,
  showToolCalls = true,
  isStreamingAssistant = false,
  showReasoning = false,
}: {
  message: AssistantMessage;
  droneMentionLinks?: MarkdownTextMentionLink[];
  onOpenDroneMention?: (mention: MarkdownTextMentionLink) => void;
  showToolCalls?: boolean;
  isStreamingAssistant?: boolean;
  showReasoning?: boolean;
}) {
  const calls = showToolCalls ? toolCalls(message) : [];
  const content = message.content;
  const structuredAssistant =
    message.role === 'assistant' &&
    Array.isArray(content) &&
    content.some((part) => part?.type === 'thinking' || part?.type === 'text' || part?.type === 'toolCall');

  if (message.role === 'toolResult') {
    return <ToolActivityRow result={message} />;
  }

  let body: React.ReactNode = null;
  if (message.role === 'assistant' && structuredAssistant) {
    const blocks: React.ReactNode[] = [];
    let lastThinkingPartIndex = -1;
    for (let i = 0; i < content.length; i += 1) {
      if (content[i]?.type === 'thinking') lastThinkingPartIndex = i;
    }
    const lastBlock = lastAssistantContentBlock(message);
    for (let i = 0; i < content.length; i += 1) {
      const part = content[i];
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'thinking') {
        const thinkingText = String(part.thinking ?? '');
        const currentReasoning = Boolean(showReasoning && lastBlock?.type === 'thinking' && i === lastThinkingPartIndex);
        const headerPulse = Boolean(isStreamingAssistant && currentReasoning);
        if (currentReasoning) {
          blocks.push(<ReasoningBlock key={`th:${i}`} text={thinkingText} headerPulse={headerPulse} />);
        }
      } else if (part.type === 'text') {
        const t = String(part.text ?? '').trim();
        if (t) {
          blocks.push(
            <MarkdownMessage
              key={`tx:${i}`}
              text={t}
              className="dh-markdown text-[12px]"
              textMentionLinks={droneMentionLinks}
              onOpenTextMention={onOpenDroneMention}
            />,
          );
        }
      }
    }
    body = blocks.length > 0 ? <div className="space-y-1">{blocks}</div> : null;
  } else {
    const text = messageText(message);
    const images = messageImageParts(message);
    const textBody = text ? (
      message.role === 'assistant' ? (
        <MarkdownMessage
          text={text}
          className="dh-markdown text-[12px]"
          textMentionLinks={droneMentionLinks}
          onOpenTextMention={onOpenDroneMention}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words text-[12px] text-[var(--fg-secondary)]">{text}</div>
      )
    ) : null;
    const imageBody = images.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <img
            key={`${image.mimeType}:${index}`}
            src={`data:${image.mimeType};base64,${image.data}`}
            alt="Attached image"
            className="max-h-44 max-w-[min(260px,100%)] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] object-contain"
          />
        ))}
      </div>
    ) : null;
    body = textBody || imageBody ? <div className="space-y-2">{textBody}{imageBody}</div> : null;
  }

  if (message.role === 'assistant' && !body && !message.errorMessage && calls.length === 0) return null;

  return (
    <div className={`px-3 py-2 ${message.role === 'user' ? 'bg-[rgba(255,255,255,.025)] border-y border-[var(--border-subtle)]' : ''}`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
        {message.role === 'user' ? 'You' : 'Assistant'}
      </div>
      {body}
      {!body && message.errorMessage ? <div className="text-[12px] text-[var(--red)]">{message.errorMessage}</div> : null}
      {calls.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {calls.map((call) => (
            <ToolDisclosure key={call.id} title={toolLabel(call.name)}>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--muted-dim)]">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </ToolDisclosure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QueuedPromptRow({
  prompt,
  modelLabel,
  busy,
  onCancel,
}: {
  prompt: AssistantQueuedPrompt;
  modelLabel: string;
  busy: boolean;
  onCancel: () => void;
}) {
  const asap = prompt.deliveryMode === 'asap';
  return (
    <div className="px-3 py-2 bg-[rgba(255,255,255,.018)] border-y border-[var(--border-subtle)]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          {asap ? 'ASAP queue' : 'Queued'}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="max-w-[180px] truncate rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]"
            title={`Queued model: ${modelLabel}`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {modelLabel}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-6 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--red)] disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Cancel
          </button>
        </div>
      </div>
      <div className="whitespace-pre-wrap break-words text-[12px] text-[var(--fg-secondary)]">{prompt.prompt}</div>
    </div>
  );
}

function formatAgentForApproval(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  const kind = String(raw.kind ?? '').trim();
  if (kind === 'builtin') return String(raw.id ?? '').trim();
  if (kind === 'custom') return String(raw.label ?? raw.id ?? '').trim();
  return '';
}

function approvalSummary(approval: AssistantApproval): {
  title: string;
  rows: Array<{ label: string; value: string }>;
  markdownLabel?: string;
  markdown?: string;
} {
  const args = approval.args ?? {};
  if (approval.toolName === 'message_drone') {
    const resolved = args.resolved ?? args;
    const droneName = String(resolved.droneName ?? resolved.droneId ?? args.droneId ?? '').trim();
    const chatName = String(resolved.chatName ?? args.chatName ?? '').trim();
    const message = String(resolved.message ?? args.message ?? args.prompt ?? '').trim();
    return {
      title: 'Send message',
      rows: [
        ...(droneName ? [{ label: 'Drone', value: droneName }] : []),
        ...(chatName && chatName !== 'default' ? [{ label: 'Chat', value: chatName }] : []),
      ],
      markdownLabel: 'Message',
      markdown: message,
    };
  }

  if (approval.toolName === 'create_drone') {
    const request = args.resolvedRequest ?? args;
    const agent = formatAgentForApproval(request.seedAgent);
    const initialMessage = String(request.seedPrompt ?? request.initialMessage ?? '').trim();
    return {
      title: 'Create drone',
      rows: [
        { label: 'Name', value: String(request.name ?? '').trim() },
        { label: 'Runtime', value: String(request.runtime ?? 'container').trim() || 'container' },
        ...(String(request.group ?? '').trim() ? [{ label: 'Group', value: String(request.group).trim() }] : []),
        ...(String(request.repoPath ?? '').trim() ? [{ label: 'Repo', value: String(request.repoPath).trim() }] : []),
        ...(String(request.repoBranchSource ?? '').trim() ? [{ label: 'Branch source', value: String(request.repoBranchSource).trim() }] : []),
        ...(String(request.remoteBranch ?? '').trim() ? [{ label: 'Remote branch', value: String(request.remoteBranch).trim() }] : []),
        ...(agent ? [{ label: 'Agent', value: agent }] : []),
        ...(String(request.seedModel ?? '').trim() ? [{ label: 'Model', value: String(request.seedModel).trim() }] : []),
      ].filter((row) => row.value),
      markdownLabel: initialMessage ? 'Initial message' : undefined,
      markdown: initialMessage,
    };
  }

  if (approval.toolName === 'set_drone_group') {
    const resolved = args.resolved ?? args;
    const droneNames = Array.isArray(resolved.drones)
      ? resolved.drones.map((drone: any) => String(drone?.name ?? '').trim()).filter(Boolean)
      : Array.isArray(resolved.droneIds ?? args.droneIds)
        ? (resolved.droneIds ?? args.droneIds).map((id: any) => String(id ?? '').trim()).filter(Boolean)
        : [];
    const group = String(resolved.group ?? args.group ?? '').trim();
    return {
      title: 'Set drone group',
      rows: [
        ...(droneNames.length > 0 ? [{ label: droneNames.length === 1 ? 'Drone' : 'Drones', value: droneNames.join(', ') }] : []),
        { label: 'Group', value: group || 'Ungrouped' },
      ],
    };
  }

  return {
    title: approval.label || 'Approval required',
    rows: [],
  };
}

function ApprovalCard({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: AssistantApproval;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [showJson, setShowJson] = React.useState(false);
  const summary = approvalSummary(approval);
  return (
    <div className="mx-3 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]" style={{ fontFamily: 'var(--display)' }}>
            Approval required
          </div>
          <div className="mt-0.5 text-[12px] font-semibold text-[var(--fg)]">{summary.title}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowJson((value) => !value)}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {showJson ? 'Hide JSON' : 'JSON'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDeny}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Deny
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="h-7 rounded border border-[var(--accent-muted)] bg-[var(--accent)] px-2 text-[10px] font-semibold uppercase tracking-wide text-black disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Approve
          </button>
        </div>
      </div>
      {summary.rows.length > 0 ? (
        <div className="mt-2 grid gap-1.5 text-[12px]">
          {summary.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                {row.label}
              </div>
              <div className="min-w-0 break-words text-[var(--fg-secondary)]">{row.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {summary.markdown ? (
        <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-2.5 py-2">
          {summary.markdownLabel ? (
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {summary.markdownLabel}
            </div>
          ) : null}
          <MarkdownMessage text={summary.markdown} className="dh-markdown text-[12px]" />
        </div>
      ) : null}
      {showJson ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[rgba(0,0,0,.16)] p-2 text-[10px] text-[var(--muted)]">
          {JSON.stringify(approval.args, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function AssistantThreadFilesView({
  threadId,
  files,
  selectedPath,
  selectedFile,
  loading,
  error,
  onSelectPath,
  onRefresh,
  onClose,
}: {
  threadId: string;
  files: AssistantArtifactSummary[];
  selectedPath: string | null;
  selectedFile: AssistantArtifactFile | null;
  loading: boolean;
  error: string | null;
  onSelectPath: (path: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const artifactTree = React.useMemo(() => buildAssistantArtifactTree(files), [files]);
  const [expandedDirs, setExpandedDirs] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const availableDirs = new Set(collectAssistantArtifactDirectoryPaths(artifactTree));
    setExpandedDirs((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const dirPath of availableDirs) {
        next[dirPath] = prev[dirPath] ?? true;
        if (!(dirPath in prev)) changed = true;
      }
      if (Object.keys(prev).some((dirPath) => !availableDirs.has(dirPath))) changed = true;
      return changed ? next : prev;
    });
  }, [artifactTree]);

  const toggleDirectory = React.useCallback((path: string) => {
    setExpandedDirs((prev) => ({ ...prev, [path]: prev[path] !== true }));
  }, []);

  function renderArtifactTree(nodes: AssistantArtifactTreeNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = 4 + depth * 14;
      if (node.kind === 'directory') {
        const open = expandedDirs[node.path] === true;
        return (
          <React.Fragment key={`dir:${node.path}`}>
            <div className="relative w-full group/artifact-dir">
              <AssistantTreeIndentGuides depth={depth} />
              <button
                type="button"
                onClick={() => toggleDirectory(node.path)}
                title={node.path}
                className="flex h-[22px] w-full min-w-0 items-center gap-1 pr-2 text-left text-[13px] text-[var(--fg-secondary)] transition-colors hover:bg-[rgba(255,255,255,.055)]"
                style={{ paddingLeft: `${indentPx}px` }}
              >
                <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--muted)]">
                  <IconChevron down={open} size={12} />
                </span>
                <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[#d7b85a]">
                  <IconFolder size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate leading-none">{node.name}</span>
              </button>
            </div>
            {open ? renderArtifactTree(node.children, depth + 1) : null}
          </React.Fragment>
        );
      }

      const Icon = iconForFilePath(node.path) ?? IconFile;
      const selected = node.path === selectedPath;
      return (
        <button
          key={`file:${node.path}`}
          type="button"
          onClick={() => onSelectPath(node.path)}
          title={`${node.path} • ${formatUpdatedAt(node.file.updatedAt)} • ${formatArtifactSize(node.file.size)}`}
          className={`relative flex h-[22px] w-full min-w-0 items-center gap-1 pr-2 text-left text-[13px] transition-colors ${
            selected
              ? 'bg-[rgba(55,118,171,.20)] text-[var(--fg)] shadow-[inset_0_0_0_1px_rgba(64,156,255,.55)]'
              : 'text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,.055)]'
          }`}
          style={{ paddingLeft: `${indentPx}px` }}
        >
          <AssistantTreeIndentGuides depth={depth} />
          <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--muted)]" aria-hidden="true" />
          <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--muted)]">
            <Icon size={13} />
          </span>
          <span className="min-w-0 flex-1 truncate leading-none">{node.name}</span>
        </button>
      );
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[rgba(0,0,0,.08)]">
      <div className="flex h-10 flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconFile className="h-4 w-4 flex-shrink-0 text-[var(--muted)]" />
          <div className="min-w-0">
            <div className="min-w-0 truncate text-[12px] font-semibold text-[var(--fg-secondary)]">Thread files</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--muted-dim)]">
              <span>{files.length} file{files.length === 1 ? '' : 's'}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" aria-hidden="true" />
                Live refresh
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            disabled={!threadId || loading}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-45"
            style={{ fontFamily: 'var(--display)' }}
          >
            {loading ? 'Loading' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Chat
          </button>
        </div>
      </div>
      {error ? (
        <div className="mx-3 mt-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-2.5 py-2 text-[11px] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[210px] flex-shrink-0 overflow-y-auto border-r border-[var(--border-subtle)] py-1">
          {files.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-[var(--muted-dim)]">
              {loading ? 'Loading files...' : 'No thread files.'}
            </div>
          ) : (
            <div>{renderArtifactTree(artifactTree, 0)}</div>
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">
          {selectedFile ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex-shrink-0 border-b border-[var(--border-subtle)] px-4 py-2">
                <div className="truncate text-[13px] font-medium text-[var(--fg-secondary)]">{selectedFile.path}</div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--muted-dim)]">
                  {formatArtifactSize(selectedFile.size)} · {formatUpdatedAt(selectedFile.updatedAt)} · {selectedFile.revision}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                {selectedFile.contentBase64 && isImageMimeType(selectedFile.mimeType) ? (
                  <img
                    src={`data:${selectedFile.mimeType || 'image/png'};base64,${selectedFile.contentBase64}`}
                    alt={selectedFile.path}
                    className="max-h-full max-w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] object-contain"
                  />
                ) : selectedFile.content.trim() ? (
                  <MarkdownMessage text={selectedFile.content} className="dh-markdown text-[13px]" />
                ) : (
                  <div className="text-[12px] text-[var(--muted-dim)]">
                    {selectedFile.binary ? 'Binary file preview is unavailable.' : 'Empty file'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[var(--muted-dim)]">
              {loading ? 'Loading selected file...' : 'No file selected'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AssistantThreadSidebar({
  threads,
  activeThreadId,
  mode,
  onCreateThread,
  onSelectThread,
  onDeleteThread,
  onModeChange,
  onOpenPairing,
  desktopVoiceStatus,
  onToggleDesktopVoice,
  onStartDesktopVoiceRecording,
  onStopDesktopVoice,
  onCollapse,
}: {
  threads: AssistantThread[];
  activeThreadId: string | null;
  mode: AssistantPanelMode;
  onCreateThread: () => void;
  onSelectThread: (thread: AssistantThread) => void;
  onDeleteThread: (thread: AssistantThread) => void;
  onModeChange: (mode: AssistantPanelMode) => void;
  onOpenPairing: () => void;
  desktopVoiceStatus: DesktopAssistantVoiceStatus;
  onToggleDesktopVoice: () => void;
  onStartDesktopVoiceRecording: () => void;
  onStopDesktopVoice: () => void;
  onCollapse: () => void;
}) {
  const voiceMode = mode === 'voice';
  const desktopVoiceActive = isDesktopAssistantVoiceActive(desktopVoiceStatus);
  const desktopVoiceBusy = isDesktopAssistantVoiceBusy(desktopVoiceStatus);
  const desktopVoiceHeardText = desktopAssistantVoiceHeardText(desktopVoiceStatus);
  const desktopVoiceLabel = desktopAssistantVoiceControlLabel(desktopVoiceStatus);
  const desktopVoiceMainTitle = desktopAssistantVoiceControlTitle(desktopVoiceStatus);
  const desktopVoiceRealtimeAvailable = desktopVoiceStatus.realtime?.available === true;
  const desktopVoiceRealtimeEnabled = desktopVoiceStatus.realtime?.enabled === true;
  return (
    <aside className="flex w-52 max-w-[46%] min-w-0 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[rgba(0,0,0,.14)]">
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)]">
          {voiceMode ? (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <path d="M12 19v3" />
            </svg>
          ) : (
            <IconChatThread className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            {voiceMode ? 'Realtime' : 'Standard'}
          </div>
          <div className="text-[10px] text-[var(--muted-dim)]">{threads.length || 0} {voiceMode ? 'realtime' : 'standard'}</div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]"
          title="Hide thread sidebar"
          aria-label="Hide thread sidebar"
        >
          <IconSidebarCollapse className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-shrink-0 border-b border-[var(--border-subtle)] p-2">
        <button
          type="button"
          onClick={onCreateThread}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] hover:bg-[rgba(167,139,250,.16)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          <IconPlus className="h-3.5 w-3.5" />
          {voiceMode ? 'New Realtime Thread' : 'New Standard Thread'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {threads.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-[var(--muted-dim)]">{voiceMode ? 'No realtime threads yet.' : 'No standard threads yet.'}</div>
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => {
              const active = thread.id === activeThreadId;
              const messageCount = (thread.messageCount ?? thread.messages.length) + (thread.queuedPrompts?.length ?? 0);
              return (
                <div
                  key={thread.id}
                  className={`group relative rounded border transition-colors ${
                    active
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                      : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectThread(thread)}
                    className="min-h-[58px] w-full min-w-0 px-2 py-1.5 pr-8 text-left"
                    aria-current={active ? 'true' : undefined}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${assistantThreadStatusTone(thread.status)}`} />
                      <span className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}>
                        {thread.title || 'Untitled thread'}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--muted-dim)]">
                      <span className="truncate">{assistantThreadStatusLabel(thread.status, 'idle')}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatUpdatedAt(thread.updatedAt)}</span>
                      {messageCount > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{messageCount}</span>
                        </>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteThread(thread)}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded text-[var(--muted-dim)] opacity-0 hover:bg-[rgba(255,90,90,.1)] hover:text-[var(--red)] group-hover:opacity-100 focus:opacity-100"
                    title={`Delete ${thread.title || 'thread'}`}
                    aria-label={`Delete ${thread.title || 'thread'}`}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 space-y-2 border-t border-[var(--border)] p-2">
        <div className="flex flex-col items-center gap-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleDesktopVoice}
              aria-pressed={desktopVoiceActive && desktopVoiceStatus.mode !== 'sleeping'}
              aria-label="Toggle desktop assistant voice awake or sleep"
              title={desktopVoiceMainTitle}
              className={`relative flex h-16 w-16 items-center justify-center rounded-full border transition-all duration-200 ${
                desktopVoiceStatus.mode === 'error'
                  ? 'border-[rgba(255,90,90,.5)] bg-[rgba(255,90,90,.1)] text-[var(--red)]'
                  : desktopVoiceStatus.mode === 'sleeping'
                    ? 'border-[rgba(148,163,184,.45)] bg-[rgba(148,163,184,.08)] text-[var(--muted)]'
                  : desktopVoiceActive
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_24px_rgba(45,212,191,.22)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.035)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
              }`}
            >
              {desktopVoiceBusy ? (
                <span className="absolute inset-0 rounded-full bg-[var(--accent)] opacity-20 animate-ping" aria-hidden="true" />
              ) : null}
              <svg viewBox="0 0 24 24" aria-hidden="true" className="relative h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
                <path d="M8 21h8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onStartDesktopVoiceRecording}
              disabled={desktopVoiceBusy}
              aria-label="Start assistant recording now"
              title={desktopVoiceBusy ? 'Assistant voice is already recording' : 'Start assistant recording now'}
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                desktopVoiceStatus.mode === 'recording'
                  ? 'border-[var(--accent-muted)] bg-[rgba(45,212,191,.12)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
              }`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
                <path d="M8 21h8" />
                <path d="M19 5v4" />
                <path d="M17 7h4" />
              </svg>
            </button>
            {desktopVoiceRealtimeAvailable ? (
              <button
                type="button"
                onClick={dispatchAssistantDesktopVoiceRealtimeToggle}
                aria-pressed={desktopVoiceRealtimeEnabled}
                aria-label={desktopVoiceRealtimeEnabled ? 'Turn off realtime assistant voice' : 'Turn on realtime assistant voice'}
                title={desktopVoiceRealtimeEnabled ? 'Realtime assistant voice is on' : 'Realtime assistant voice is off'}
                className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                  desktopVoiceRealtimeEnabled
                    ? 'border-[var(--accent-muted)] bg-[rgba(45,212,191,.12)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]'
                }`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12a8 8 0 0 1 8-8" />
                  <path d="M4 12a8 8 0 0 0 8 8" />
                  <path d="M20 12a8 8 0 0 0-8-8" />
                  <path d="M20 12a8 8 0 0 1-8 8" />
                  <path d="M8 12h8" />
                </svg>
              </button>
            ) : null}
          </div>
          <div className="max-w-full truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            {desktopVoiceRealtimeEnabled ? `${desktopVoiceLabel} / RT` : desktopVoiceLabel}
          </div>
          {desktopVoiceActive ? (
            <button
              type="button"
              onClick={onStopDesktopVoice}
              aria-label="Turn off desktop assistant voice"
              title="Turn off desktop assistant voice"
              className="flex h-8 w-[88px] items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:border-[rgba(248,113,113,.35)] hover:bg-[rgba(248,113,113,.08)] hover:text-[var(--red)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Off
            </button>
          ) : null}
          {desktopVoiceHeardText ? (
            <div
              className="w-full truncate rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-2 py-1 text-center text-[10px] text-[var(--muted-dim)]"
              title={desktopVoiceHeardText}
            >
              {desktopVoiceStatus.recognizer?.textFinal ? 'Heard' : 'Hearing'}: {desktopVoiceHeardText}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onModeChange(voiceMode ? 'normal' : 'voice')}
          aria-pressed={voiceMode}
          title={voiceMode ? 'Show standard assistant threads' : 'Show realtime assistant threads'}
          className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded border px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
            voiceMode
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_18px_rgba(167,139,250,.16)]'
              : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v3" />
          </svg>
          {voiceMode ? 'Realtime Mode' : 'Realtime'}
        </button>
        {voiceMode ? (
          <button
            type="button"
            onClick={onOpenPairing}
            title="Open Android pairing QR code"
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 3h7v7H3z" />
              <path d="M14 3h7v7h-7z" />
              <path d="M3 14h7v7H3z" />
              <path d="M14 14h3v3h-3z" />
              <path d="M19 14h2v7h-5" />
              <path d="M14 19h2" />
            </svg>
            Pair Android
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function ScopeModeControl({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: AssistantScopeMode;
  onChange: (mode: AssistantScopeMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-0.5">
      <div className="px-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
        {label}
      </div>
      <button
        type="button"
        onClick={() => onChange('all')}
        className={`h-5 rounded px-1.5 text-[9px] font-semibold uppercase tracking-wide ${
          mode === 'all'
            ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
            : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
      >
        All
      </button>
      <button
        type="button"
        onClick={() => onChange('selected')}
        className={`h-5 rounded px-1.5 text-[9px] font-semibold uppercase tracking-wide ${
          mode === 'selected'
            ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
            : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
      >
        Selected
      </button>
    </div>
  );
}

const ASSISTANT_TOOL_CATEGORY_LABELS: Record<AssistantToolSummary['category'], string> = {
  context: 'Context',
  prompts: 'Prompts',
  files: 'Files',
  chats: 'Chats',
  drones: 'Drones',
  actions: 'Actions',
};

function AssistantToolsPanel({
  tools,
  enabledTools,
  disabled,
  onToggleTool,
  onEnableAll,
  onDisableAll,
  onClose,
}: {
  tools: AssistantToolSummary[];
  enabledTools: string[];
  disabled: boolean;
  onToggleTool: (toolName: string, enabled: boolean) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onClose: () => void;
}) {
  const enabled = new Set(enabledTools);
  const categories = React.useMemo(() => {
    const groups = new Map<AssistantToolSummary['category'], AssistantToolSummary[]>();
    for (const tool of tools) {
      const current = groups.get(tool.category) ?? [];
      current.push(tool);
      groups.set(tool.category, current);
    }
    return Array.from(groups.entries());
  }, [tools]);

  return (
    <div className="absolute right-2 top-10 z-30 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_rgba(0,0,0,.48)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
            Assistant tools
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[var(--muted-dim)]">
            Tool changes apply when the assistant starts its next turn.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          Close
        </button>
      </div>
      <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2">
        <button
          type="button"
          onClick={onEnableAll}
          disabled={disabled}
          className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-45"
          style={{ fontFamily: 'var(--display)' }}
        >
          Enable all
        </button>
        <button
          type="button"
          onClick={onDisableAll}
          disabled={disabled}
          className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-45"
          style={{ fontFamily: 'var(--display)' }}
        >
          Disable all
        </button>
        <div className="ml-auto text-[10px] text-[var(--muted-dim)]">
          {enabledTools.length} / {tools.length}
        </div>
      </div>
      <div className="max-h-[min(520px,calc(100vh-190px))] overflow-y-auto p-2">
        {categories.map(([category, categoryTools]) => (
          <section key={category} className="mb-2 last:mb-0">
            <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {ASSISTANT_TOOL_CATEGORY_LABELS[category]}
            </div>
            <div className="space-y-1">
              {categoryTools.map((tool) => {
                const checked = enabled.has(tool.name);
                return (
                  <label
                    key={tool.name}
                    className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 transition-colors ${
                      checked
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) => onToggleTool(tool.name, event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium text-[var(--fg-secondary)]">{tool.label}</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-dim)]">{tool.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

type PromptDiffLine = { kind: 'same' | 'add' | 'remove'; text: string; oldLine?: number; newLine?: number };

function promptDiffLines(oldText: string, newText: string): PromptDiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const dp: number[][] = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: PromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push({ kind: 'same', text: oldLines[i], oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
    } else if (j < newLines.length && (i >= oldLines.length || dp[i][j + 1] >= dp[i + 1][j])) {
      lines.push({ kind: 'add', text: newLines[j], newLine });
      j += 1;
      newLine += 1;
    } else if (i < oldLines.length) {
      lines.push({ kind: 'remove', text: oldLines[i], oldLine });
      i += 1;
      oldLine += 1;
    }
  }
  return lines;
}

function AssistantPromptDiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = React.useMemo(() => promptDiffLines(oldText, newText), [oldText, newText]);
  const changed = lines.some((line) => line.kind !== 'same');
  return (
    <div className="mt-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
          Promotion diff
        </div>
        <div className="text-[10px] text-[var(--muted-dim)]">Global to thread draft</div>
      </div>
      <div className="max-h-[260px] overflow-auto font-mono text-[11px] leading-relaxed">
        {!changed ? (
          <div className="px-3 py-3 text-[var(--muted-dim)]">No differences.</div>
        ) : (
          lines.map((line, index) => {
            const tone =
              line.kind === 'add'
                ? 'bg-[rgba(52,211,153,.08)] text-[#a7f3d0]'
                : line.kind === 'remove'
                  ? 'bg-[rgba(255,90,90,.08)] text-[#fecaca]'
                  : 'text-[var(--muted)]';
            const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';
            return (
              <div key={`${index}:${line.kind}`} className={`grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-2 px-2 py-0.5 ${tone}`}>
                <span className="select-none text-right text-[var(--muted-dim)]">
                  {line.kind === 'add' ? '' : line.oldLine}
                  <span className="px-1 text-[var(--muted-dim)]">/</span>
                  {line.kind === 'remove' ? '' : line.newLine}
                </span>
                <span className="select-none text-[var(--muted-dim)]">{marker}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{line.text || ' '}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AssistantSystemPromptModal({
  mode,
  globalPromptKind,
  settings,
  draft,
  voiceDraft,
  threadSettings,
  threadDraft,
  loading,
  saving,
  threadSaving,
  promoting,
  error,
  notice,
  onModeChange,
  onGlobalPromptKindChange,
  onDraftChange,
  onVoiceDraftChange,
  onThreadDraftChange,
  onUseGlobalForThread,
  onUseDefaultForGlobal,
  onClose,
  onSaveGlobal,
  onSaveThread,
  onPromoteThread,
}: {
  mode: 'thread' | 'global';
  globalPromptKind: AssistantSystemPromptKind;
  settings: AssistantSystemPromptSettings | null;
  draft: string;
  voiceDraft: string;
  threadSettings: AssistantThreadSystemPromptSettings | null;
  threadDraft: string;
  loading: boolean;
  saving: boolean;
  threadSaving: boolean;
  promoting: boolean;
  error: string | null;
  notice: string | null;
  onModeChange: (mode: 'thread' | 'global') => void;
  onGlobalPromptKindChange: (kind: AssistantSystemPromptKind) => void;
  onDraftChange: (value: string) => void;
  onVoiceDraftChange: (value: string) => void;
  onThreadDraftChange: (value: string) => void;
  onUseGlobalForThread: () => void;
  onUseDefaultForGlobal: () => void;
  onClose: () => void;
  onSaveGlobal: () => void;
  onSaveThread: () => void;
  onPromoteThread: () => void;
}) {
  const [diffOpen, setDiffOpen] = React.useState(false);
  const activeGlobalSettings = globalPromptKind === 'voice' ? settings?.assistantVoiceSystemPrompt : settings?.assistantSystemPrompt;
  const currentPrompt = activeGlobalSettings?.prompt ?? '';
  const currentThreadPrompt = threadSettings?.threadSystemPrompt.prompt ?? '';
  const currentGlobalPrompt = threadSettings?.threadSystemPrompt.globalPrompt ?? currentPrompt;
  const maxChars = (mode === 'thread' ? threadSettings?.threadSystemPrompt.maxPromptChars : activeGlobalSettings?.maxPromptChars) ?? 20_000;
  const activeGlobalDraft = globalPromptKind === 'voice' ? voiceDraft : draft;
  const globalDirty = activeGlobalDraft !== currentPrompt;
  const threadDirty = threadDraft !== currentThreadPrompt;
  const globalSaveDisabled = loading || saving || !globalDirty || !activeGlobalDraft.trim();
  const threadSaveDisabled = loading || threadSaving || !threadDirty || !threadDraft.trim();
  const activeDraft = mode === 'thread' ? threadDraft : activeGlobalDraft;
  const activeSource =
    mode === 'thread'
      ? threadSettings?.threadSystemPrompt.promptSource ?? 'thread'
      : activeGlobalSettings?.promptSource ?? 'default';

  React.useEffect(() => {
    if (mode !== 'thread') setDiffOpen(false);
  }, [mode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-4">
      <div className="flex max-h-[min(760px,calc(100vh-2rem))] w-[min(860px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.55)]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
              Assistant system prompts
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
              Thread changes affect only the current thread. Global changes apply to new standard or realtime threads.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 grid h-8 w-full max-w-[280px] grid-cols-2 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
            {(['thread', 'global'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onModeChange(item)}
                aria-pressed={mode === item}
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  mode === item
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {item === 'thread' ? 'This thread' : 'Global'}
              </button>
            ))}
          </div>
          {error ? (
            <div className="mb-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mb-3 rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[11px] text-[#34d399]">
              {notice}
            </div>
          ) : null}
          <label className="flex min-h-0 flex-col gap-2">
            {mode === 'global' ? (
              <div className="mb-1 grid h-8 w-full max-w-[280px] grid-cols-2 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
                {(['normal', 'voice'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => onGlobalPromptKindChange(item)}
                    aria-pressed={globalPromptKind === item}
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      globalPromptKind === item
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {item === 'normal' ? 'Standard' : 'Realtime'}
                  </button>
                ))}
              </div>
            ) : null}
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">
              {mode === 'global' && globalPromptKind === 'voice' ? 'Realtime prompt' : 'Prompt'}
            </span>
            <textarea
              value={activeDraft}
              onChange={(event) =>
                mode === 'thread'
                  ? onThreadDraftChange(event.target.value)
                  : globalPromptKind === 'voice'
                    ? onVoiceDraftChange(event.target.value)
                    : onDraftChange(event.target.value)
              }
              disabled={loading || saving || threadSaving || promoting}
              maxLength={maxChars}
              rows={20}
              className="min-h-[360px] resize-y rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted-dim)] transition-colors focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-50"
              placeholder={loading ? 'Loading system prompt...' : 'Enter the assistant system prompt'}
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted-dim)]">
            <span>Source: {activeSource}</span>
            <span>
              {activeDraft.length.toLocaleString()} / {maxChars.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted-dim)]">
            {(mode === 'thread' ? threadSettings?.threadSystemPrompt.runtimeAppendix : activeGlobalSettings?.runtimeAppendix) ??
              'Access-scope instructions are appended at run time.'}
          </div>
          {mode === 'thread' && diffOpen ? <AssistantPromptDiffView oldText={currentGlobalPrompt} newText={threadDraft} /> : null}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          {mode === 'thread' ? (
            <>
              <button
                type="button"
                onClick={() => setDiffOpen((value) => !value)}
                disabled={loading}
                className="mr-auto h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                {diffOpen ? 'Hide diff' : 'Show diff'}
              </button>
              <button
                type="button"
                onClick={onUseGlobalForThread}
                disabled={loading || threadSaving || promoting}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                Use global
              </button>
              <button
                type="button"
                onClick={onPromoteThread}
                disabled={loading || threadSaving || promoting || !threadDraft.trim()}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                {promoting ? 'Promoting...' : 'Promote to global'}
              </button>
              <button
                type="button"
                onClick={onSaveThread}
                disabled={threadSaveDisabled}
                className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide ${
                  threadSaveDisabled
                    ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-45'
                    : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {threadSaving ? 'Saving...' : 'Save for this thread'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onUseDefaultForGlobal}
                disabled={loading || saving || promoting}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                Use default
              </button>
              <button
                type="button"
                onClick={onSaveGlobal}
                disabled={globalSaveDisabled}
                className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide ${
                  globalSaveDisabled
                    ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-45'
                    : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {saving ? 'Saving...' : globalPromptKind === 'voice' ? 'Save for new realtime threads' : 'Save for new standard threads'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantOverviewPromptModal({
  settings,
  draft,
  loading,
  saving,
  error,
  notice,
  onDraftChange,
  onUseDefault,
  onClose,
  onSave,
}: {
  settings: AssistantOverviewPromptSettings | null;
  draft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  onDraftChange: (value: string) => void;
  onUseDefault: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const currentPrompt = settings?.assistantOverviewPrompt.prompt ?? '';
  const maxChars = settings?.assistantOverviewPrompt.maxPromptChars ?? 20_000;
  const dirty = draft !== currentPrompt;
  const saveDisabled = loading || saving || !dirty || !draft.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-4">
      <div className="flex max-h-[min(720px,calc(100vh-2rem))] w-[min(820px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.55)]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
              Assistant overview prompt
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
              Saved changes apply globally to assistant overview generation.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <div className="mb-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mb-3 rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[11px] text-[#34d399]">
              {notice}
            </div>
          ) : null}
          <label className="flex min-h-0 flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Prompt</span>
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              disabled={loading || saving}
              maxLength={maxChars}
              rows={18}
              className="min-h-[320px] resize-y rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted-dim)] transition-colors focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-50"
              placeholder={loading ? 'Loading overview prompt...' : 'Enter the assistant overview prompt'}
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted-dim)]">
            <span>
              Source: {settings?.assistantOverviewPrompt.promptSource === 'settings' ? 'settings' : 'default'}
            </span>
            <span>
              {draft.length.toLocaleString()} / {maxChars.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onUseDefault}
            disabled={loading || saving}
            className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ fontFamily: 'var(--display)' }}
          >
            Use default
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saveDisabled}
            className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide ${
              saveDisabled
                ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-45'
                : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {saving ? 'Saving...' : 'Save overview prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantOverviewOverlay({
  overview,
  loading,
  error,
  autoEnabled,
  canRerun,
  onClose,
  onRerun,
  onEditPrompt,
}: {
  overview: AssistantThreadOverviewResult | null;
  loading: boolean;
  error: string | null;
  autoEnabled: boolean;
  canRerun: boolean;
  onClose: () => void;
  onRerun: () => void;
  onEditPrompt: () => void;
}) {
  const generatedAt = overview?.generatedAt ? formatUpdatedAt(overview.generatedAt) : '';
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-20">
      <section className="pointer-events-auto max-h-[min(440px,calc(100vh-260px))] overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_50px_rgba(0,0,0,.45)]">
        <div className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <IconList className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" />
              <div className="truncate text-[12px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                Thread overview
              </div>
              {loading ? <IconSpinner className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" /> : null}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-[var(--muted-dim)]">
              {generatedAt ? `${overview?.cached ? 'Cached' : overview?.inputReused ? 'Rerun' : 'Generated'} ${generatedAt}` : autoEnabled ? 'Auto overview is on' : 'No overview generated yet'}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onRerun}
              disabled={!canRerun || loading}
              className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ fontFamily: 'var(--display)' }}
              title="Rerun the overview using the same captured chat input"
            >
              Rerun
            </button>
            <button
              type="button"
              onClick={onEditPrompt}
              className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
              title="Edit overview prompt"
              aria-label="Edit overview prompt"
            >
              <IconPencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Minimize
            </button>
          </div>
        </div>
        <div className="max-h-[calc(min(440px,calc(100vh-260px))-42px)] overflow-y-auto px-3 py-2">
          {error ? (
            <div className="rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">
              {error}
            </div>
          ) : overview?.markdown ? (
            <MarkdownMessage text={overview.markdown} className="text-[12px] leading-relaxed text-[var(--fg-secondary)]" />
          ) : loading ? (
            <div className="py-8 text-center text-[12px] text-[var(--muted)]">Generating overview...</div>
          ) : (
            <div className="py-8 text-center text-[12px] text-[var(--muted)]">No overview has been generated for this thread yet.</div>
          )}
        </div>
      </section>
    </div>
  );
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
  const [scopeDrones, setScopeDrones] = React.useState<AssistantScopeDrone[]>([]);
  const [scopeSyncBusy, setScopeSyncBusy] = React.useState(false);
  const [droneNameById, setDroneNameById] = React.useState<AssistantDroneNameMap>({});
  const [approvalBusyId, setApprovalBusyId] = React.useState<string | null>(null);
  const [queuedCancelBusyId, setQueuedCancelBusyId] = React.useState<string | null>(null);
  const [assistantStopBusy, setAssistantStopBusy] = React.useState(false);
  const [toolsPanelOpen, setToolsPanelOpen] = React.useState(false);
  const [enabledToolDraftNames, setEnabledToolDraftNames] = React.useState<string[]>([]);
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
  const [overviewOpen, setOverviewOpen] = React.useState(false);
  const [overviewAutoEnabled, setOverviewAutoEnabled] = React.useState(readInitialOverviewAutoEnabled);
  const [overviewIntervalMs, setOverviewIntervalMs] = React.useState(readInitialOverviewIntervalMs);
  const [overview, setOverview] = React.useState<AssistantThreadOverviewResult | null>(null);
  const [overviewLoading, setOverviewLoading] = React.useState(false);
  const [overviewError, setOverviewError] = React.useState<string | null>(null);
  const [overviewPromptOpen, setOverviewPromptOpen] = React.useState(false);
  const [overviewPromptSettings, setOverviewPromptSettings] = React.useState<AssistantOverviewPromptSettings | null>(null);
  const [overviewPromptDraft, setOverviewPromptDraft] = React.useState('');
  const [overviewPromptLoading, setOverviewPromptLoading] = React.useState(false);
  const [overviewPromptSaving, setOverviewPromptSaving] = React.useState(false);
  const [overviewPromptError, setOverviewPromptError] = React.useState<string | null>(null);
  const [overviewPromptNotice, setOverviewPromptNotice] = React.useState<string | null>(null);
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
    return threads.filter((thread) => (assistantPanelMode === 'voice' ? Boolean(thread.voiceEnabled) : !thread.voiceEnabled));
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
  const realtimeTextReady = voiceEnabled && canSendAssistantDesktopVoiceRealtimeText();
  const realtimeTextBlocked = voiceEnabled && !realtimeTextReady;
  const promptDeliveryMode: AssistantPromptDeliveryMode = activeThread?.promptDeliveryMode === 'asap' ? 'asap' : 'queue';
  const activeAccessScope: AssistantAccessScope | null = activeThread?.accessScope ?? snapshot?.accessScope ?? null;
  const activeAccessScopeDroneIdsKey = activeAccessScope?.droneIds?.join('\u0000') ?? '';
  const activePendingApprovals = React.useMemo(
    () => (snapshot?.pendingApprovals ?? []).filter((approval) => approval.threadId === activeThread?.id && approval.status === 'pending'),
    [activeThread?.id, snapshot?.pendingApprovals],
  );
  const activeRunningModel = activeThread ? snapshot?.runningModels?.[activeThread.id] ?? null : null;
  const running = activeThread?.status === 'running' || activeThread?.status === 'waiting_for_approval' || Boolean(activeRunningModel);
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
    const messages = activeThread?.messages ?? [];
    const streamingMessages = Array.isArray(snapshot?.streamingMessages) && snapshot.streamingMessages.length > 0
      ? snapshot.streamingMessages
      : snapshot?.streamingMessage
        ? [snapshot.streamingMessage]
        : [];
    const visibleStreaming = streamingMessages.filter((streaming) => streaming.role === 'assistant' || streaming.role === 'user');
    if (visibleStreaming.length === 0) return messages;
    return [...messages, ...visibleStreaming];
  }, [activeThread?.messages, snapshot?.streamingMessage, snapshot?.streamingMessages]);
  const visibleItems = React.useMemo(() => {
    const items = renderItemsFromMessages(visibleMessages);
    for (const prompt of activeThread?.queuedPrompts ?? []) {
      items.push({ type: 'queued', key: `queued:${prompt.id}`, prompt });
    }
    return items;
  }, [activeThread?.queuedPrompts, visibleMessages]);
  const latestActivityItemKey = React.useMemo(() => {
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      if (item.type !== 'queued') return item.key;
    }
    return '';
  }, [visibleItems]);
  const streamingAssistantSourceIndex = React.useMemo(() => {
    const streamingMessages = Array.isArray(snapshot?.streamingMessages) && snapshot.streamingMessages.length > 0
      ? snapshot.streamingMessages
      : snapshot?.streamingMessage
        ? [snapshot.streamingMessage]
        : [];
    const assistantStreamingOffset = streamingMessages.findIndex((streaming) => streaming.role === 'assistant');
    if (assistantStreamingOffset < 0) return -1;
    return (activeThread?.messages?.length ?? 0) + assistantStreamingOffset;
  }, [activeThread?.messages?.length, snapshot?.streamingMessage, snapshot?.streamingMessages]);
  const streamingAssistantMessage = React.useMemo(() => {
    const streamingMessages = Array.isArray(snapshot?.streamingMessages) && snapshot.streamingMessages.length > 0
      ? snapshot.streamingMessages
      : snapshot?.streamingMessage
        ? [snapshot.streamingMessage]
        : [];
    return streamingMessages.find((streaming) => streaming.role === 'assistant') ?? null;
  }, [snapshot?.streamingMessage, snapshot?.streamingMessages]);
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

  const loadOverviewPromptSettings = React.useCallback(async () => {
    setOverviewPromptLoading(true);
    setOverviewPromptError(null);
    setOverviewPromptNotice(null);
    try {
      const data = await requestJson<AssistantOverviewPromptSettings>('/api/assistant/overview-prompt');
      setOverviewPromptSettings(data);
      setOverviewPromptDraft(data.assistantOverviewPrompt.prompt);
    } catch (err: any) {
      setOverviewPromptError(err?.message ?? String(err));
    } finally {
      setOverviewPromptLoading(false);
    }
  }, []);

  const openOverviewPromptEditor = React.useCallback(() => {
    setOverviewPromptOpen(true);
    void loadOverviewPromptSettings();
  }, [loadOverviewPromptSettings]);

  const saveOverviewPromptSettings = React.useCallback(async () => {
    setOverviewPromptSaving(true);
    setOverviewPromptError(null);
    setOverviewPromptNotice(null);
    try {
      const data = await requestJson<AssistantOverviewPromptSettings>('/api/assistant/overview-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: overviewPromptDraft }),
      });
      setOverviewPromptSettings(data);
      setOverviewPromptDraft(data.assistantOverviewPrompt.prompt);
      setOverviewPromptNotice('Saved. Overview generation will use this prompt.');
    } catch (err: any) {
      setOverviewPromptError(err?.message ?? String(err));
    } finally {
      setOverviewPromptSaving(false);
    }
  }, [overviewPromptDraft]);

  const requestOverview = React.useCallback(
    async (options: { force?: boolean; reuseLastInput?: boolean; silent?: boolean } = {}) => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;
      if (!options.silent) setOverviewLoading(true);
      setOverviewError(null);
      try {
        const data = await requestJson<AssistantThreadOverviewResult>(`/api/assistant/threads/${encodeURIComponent(threadId)}/overview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ force: Boolean(options.force), reuseLastInput: Boolean(options.reuseLastInput) }),
        });
        if (activeThreadIdRef.current !== threadId) return;
        setOverview(data);
      } catch (err: any) {
        if (activeThreadIdRef.current !== threadId) return;
        setOverviewError(err?.message ?? String(err));
      } finally {
        if (!options.silent && activeThreadIdRef.current === threadId) setOverviewLoading(false);
      }
    },
    [],
  );

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
    const delivered = (activeThread?.messages ?? []).some((message) => {
      if (message.role !== 'user') return false;
      const normalizedMessageText = messageText(message).replace(/\s+/g, ' ').trim().toLowerCase();
      return normalizedMessageText === normalizedVoiceText || normalizedMessageText.includes(normalizedVoiceText);
    });
    if (!delivered) return;
    setDraft((current) => (current.trim() === voiceText ? '' : current));
    voiceDraftTextRef.current = '';
    voiceDraftActiveRef.current = false;
    setVoiceDraftActive(false);
  }, [activeThread?.messages, voiceDraftActive]);

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
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_OVERVIEW_AUTO_STORAGE_KEY, overviewAutoEnabled ? '1' : '0');
  }, [overviewAutoEnabled]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_OVERVIEW_INTERVAL_STORAGE_KEY, String(overviewIntervalMs));
  }, [overviewIntervalMs]);

  React.useEffect(() => {
    setOverview(null);
    setOverviewError(null);
    setOverviewLoading(false);
  }, [activeThreadId]);

  React.useEffect(() => {
    if (!systemPromptOpen) return;
    void loadSystemPromptSettings();
  }, [activeThreadId, loadSystemPromptSettings, systemPromptOpen]);

  React.useEffect(() => {
    if (!overviewAutoEnabled || !activeThreadId) return;
    void requestOverview();
    const timer = window.setInterval(() => {
      void requestOverview({ silent: true });
    }, overviewIntervalMs);
    return () => window.clearInterval(timer);
  }, [activeThreadId, overviewAutoEnabled, overviewIntervalMs, requestOverview]);

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
    activeAccessScope?.updatedAt,
    activeAccessScopeDroneIdsKey,
    resolveScopeDroneNames,
    snapshot?.activeThreadId,
  ]);

  const saveScopeDraft = React.useCallback(async (draft: AssistantScopeDraft): Promise<boolean> => {
    const readMode = draft.readMode === 'selected' ? 'selected' : 'all';
    const writeMode = draft.writeMode === 'selected' ? 'selected' : 'all';
    const cleanDrones = cleanAssistantScopeDrones(draft.drones);
    const visibleDrones = readMode === 'selected' || writeMode === 'selected' ? cleanDrones : [];
    const scopedDroneIds = assistantScopeDroneIds(readMode, writeMode, visibleDrones);
    const syncKey = assistantScopeSyncKey(readMode, writeMode, scopedDroneIds);
    currentScopeKeyRef.current = syncKey;
    setScopeReadMode(readMode);
    setScopeWriteMode(writeMode);
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
        droneIds: scopedDroneIds,
      }),
    })
      .then((data) => {
        if (scopeSaveRequestIdRef.current !== requestId) return true;
        const savedScope = data.accessScope ?? { readMode, writeMode, droneIds: scopedDroneIds, updatedAt: new Date().toISOString() };
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
    void saveScopeDraft({ readMode: 'selected', writeMode: 'selected', drones: Array.from(byId.values()) });
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
      drones: scopeDrones.filter((drone) => drone.id !== droneId),
    });
  }, [saveScopeDraft, scopeDrones, scopeReadMode, scopeWriteMode]);

  const updateScopeReadMode = React.useCallback((mode: AssistantScopeMode) => {
    void saveScopeDraft({ readMode: mode, writeMode: scopeWriteMode, drones: scopeDrones });
  }, [saveScopeDraft, scopeDrones, scopeWriteMode]);

  const updateScopeWriteMode = React.useCallback((mode: AssistantScopeMode) => {
    void saveScopeDraft({ readMode: scopeReadMode, writeMode: mode, drones: scopeDrones });
  }, [saveScopeDraft, scopeDrones, scopeReadMode]);

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
  }, [activePendingApprovals.length, scrollAssistantToBottom, showThinking, snapshot?.streamingMessage, visibleItems]);

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

  const updateThread = React.useCallback(async (patch: Partial<Pick<AssistantThread, 'model' | 'provider' | 'thinkingLevel' | 'autoApprove' | 'promptDeliveryMode' | 'enabledTools' | 'voiceEnabled'>>) => {
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
        if (event?.type === 'snapshot' && event.snapshot) applySnapshot(event.snapshot, activeThread.id);
        if (event?.type === 'approval_pending' && event.snapshot) applySnapshot(event.snapshot, activeThread.id);
        if (event?.type === 'error') {
          sentOk = false;
          setError(String(event.error ?? 'Assistant failed.'));
        }
      });
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
      if (snapshotMutationCurrent(requestSeq)) void refresh();
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
  }, [activeThread, applySnapshot, beginSnapshotMutation, draft, refresh, scrollAssistantToBottom, snapshotMutationCurrent, waitForScopeSave]);

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

  const cancelQueuedPrompt = React.useCallback(async (prompt: AssistantQueuedPrompt) => {
    if (!activeThread) return;
    const requestSeq = beginSnapshotMutation();
    setQueuedCancelBusyId(prompt.id);
    try {
      const next = await requestJson<AssistantSnapshot>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/queued/${encodeURIComponent(prompt.id)}`,
        { method: 'DELETE' },
      );
      if (!snapshotMutationCurrent(requestSeq)) return;
      applySnapshot(
        next,
        activeThread.id,
      );
    } catch (err: any) {
      if (snapshotMutationCurrent(requestSeq)) setError(err?.message ?? String(err));
    } finally {
      setQueuedCancelBusyId(null);
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

  const modelOptions = snapshot?.models ?? EMPTY_ASSISTANT_MODEL_OPTIONS;
  const activeProvider = activeThread?.provider ?? modelOptions[0]?.provider ?? 'openai';
  const providerOptions = React.useMemo(
    () => ASSISTANT_PROVIDERS.map((provider) => ({
      ...provider,
      models: modelOptions.filter((model) => model.provider === provider.id),
    })),
    [modelOptions],
  );
  const activeProviderOptions = React.useMemo(
    () => providerOptions.find((provider) => provider.id === activeProvider)?.models ?? [],
    [activeProvider, providerOptions],
  );
  const displayedModelOptions = React.useMemo(() => {
    if (!activeThread) return activeProviderOptions;
    const selectedKey = `${activeThread.provider}:${activeThread.model}:${activeThread.thinkingLevel}`;
    const hasSelected = activeProviderOptions.some((model) => `${model.provider}:${model.id}:${model.thinkingLevel}` === selectedKey);
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
        value: `${model.provider}:${model.id}:${model.thinkingLevel}`,
        label: model.name,
        title: `${model.provider}/${model.id}${model.thinkingLevel !== 'off' ? ` ${model.thinkingLevel}` : ''}`,
        searchText: `${model.name} ${model.id} ${model.thinkingLevel}`,
      })),
    [displayedModelOptions],
  );
  const selectedModelLabel = React.useMemo(() => {
    if (!activeThread) return '';
    return modelSelectionLabel({ provider: activeThread.provider, model: activeThread.model, thinkingLevel: activeThread.thinkingLevel }, modelOptions);
  }, [activeThread, modelOptions]);
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

  const enabledToolNames = React.useMemo(() => {
    const available = new Set(availableTools.map((tool) => tool.name));
    return enabledToolDraftNames.filter((name) => available.has(name));
  }, [availableTools, enabledToolDraftNames]);

  const updateEnabledTools = React.useCallback(
    (nextTools: string[]) => {
      enabledToolDraftNamesRef.current = nextTools;
      setEnabledToolDraftNames(nextTools);
      void updateThread({ enabledTools: nextTools });
    },
    [updateThread],
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

  return (
    <div className="flex h-full min-h-0 bg-[var(--panel-alt)]">
      {threadSidebarOpen ? (
        <AssistantThreadSidebar
          threads={visibleThreads}
          activeThreadId={activeThread?.id ?? null}
          mode={assistantPanelMode}
          onCreateThread={() => void createThread()}
          onSelectThread={(thread) => void selectThread(thread)}
          onDeleteThread={(thread) => void deleteThread(thread)}
          onModeChange={setAssistantPanelMode}
          onOpenPairing={() => void openVoicePairing()}
          desktopVoiceStatus={desktopVoiceStatus}
          onToggleDesktopVoice={dispatchAssistantDesktopVoiceToggle}
          onStartDesktopVoiceRecording={dispatchAssistantDesktopVoiceStartRecording}
          onStopDesktopVoice={dispatchAssistantDesktopVoiceOff}
          onCollapse={() => setThreadSidebarOpen(false)}
        />
      ) : null}
      <div
        ref={assistantThreadRef}
        tabIndex={-1}
        className={`flex min-w-0 flex-1 flex-col outline-none ${attachmentDragActive ? 'ring-1 ring-inset ring-[var(--accent-muted)]' : ''}`}
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
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-label={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-pressed={threadSidebarOpen}
          >
            {threadSidebarOpen ? <IconSidebarCollapse className="h-3.5 w-3.5" /> : <IconSidebarExpand className="h-3.5 w-3.5" />}
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
            onClick={() => setFilesOpen((value) => !value)}
            aria-pressed={filesOpen}
            className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] ${
              filesOpen
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
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
            title="Edit assistant system prompts"
            aria-label="Edit assistant system prompts"
          >
            <IconPencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setToolsPanelOpen((value) => !value)}
            disabled={!activeThread}
            aria-pressed={toolsPanelOpen}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
              toolsPanelOpen
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
            title="Toggle assistant tools"
            aria-label="Toggle assistant tools"
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
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
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
            aria-label="Toggle auto-approve proposals"
            title={autoApprove ? 'Auto-approve proposals is on' : 'Auto-approve proposals is off'}
            className={`h-8 w-8 flex-shrink-0 rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
              autoApprove
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
            }`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="mx-auto h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v4" />
              <path d="M12 17v4" />
              <path d="M5.64 5.64l2.83 2.83" />
              <path d="M15.53 15.53l2.83 2.83" />
              <path d="M3 12h4" />
              <path d="M17 12h4" />
              <path d="M5.64 18.36l2.83-2.83" />
              <path d="M15.53 8.47l2.83-2.83" />
              <path d="M10 12.4l1.4 1.4 3-3.6" />
            </svg>
          </button>
          {toolsPanelOpen ? (
            <AssistantToolsPanel
              tools={availableTools}
              enabledTools={enabledToolNames}
              disabled={!activeThread}
              onToggleTool={toggleAssistantTool}
              onEnableAll={() => updateEnabledTools(availableTools.map((tool) => tool.name))}
              onDisableAll={() => updateEnabledTools([])}
              onClose={() => setToolsPanelOpen(false)}
            />
          ) : null}
        </div>

      <div
        ref={setScopeDropNodeRef}
        className={`flex-shrink-0 border-b border-[var(--border)] px-2 py-1.5 transition-colors ${
          scopeDropActive ? 'bg-[var(--accent-subtle)]' : 'bg-[rgba(0,0,0,.08)]'
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="mr-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Access
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <ScopeModeControl label="R" mode={scopeReadMode} onChange={updateScopeReadMode} />
            <ScopeModeControl label="W" mode={scopeWriteMode} onChange={updateScopeWriteMode} />
          </div>
          <div className="min-w-[120px] flex-1 overflow-hidden">
            {scopeDrones.length === 0 ? (
              <div className="truncate text-[10px] text-[var(--muted-dim)]">
                {scopeReadMode === 'selected' || scopeWriteMode === 'selected'
                  ? 'No selected drones. Drop drones here to allow access.'
                  : 'Drop drones here to limit access.'}
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
        <>
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} className="h-full overflow-y-auto">
              <div ref={scrollContentRef} className="space-y-2 py-3">
                {loading && !snapshot ? (
                  <div className="px-3 text-[12px] text-[var(--muted)]">Loading assistant...</div>
                ) : visibleItems.length === 0 && !showThinking ? (
                  <div className="mx-3 rounded border border-dashed border-[var(--border)] px-3 py-5 text-center">
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
                    ) : item.type === 'toolGroup' ? (
                      <RepeatedToolActivityRow key={item.key} items={item.items} />
                    ) : (
                      <QueuedPromptRow
                        key={item.key}
                        prompt={item.prompt}
                        modelLabel={modelSelectionLabel({ provider: item.prompt.provider, model: item.prompt.model, thinkingLevel: item.prompt.thinkingLevel }, modelOptions)}
                        busy={queuedCancelBusyId === item.prompt.id}
                        onCancel={() => void cancelQueuedPrompt(item.prompt)}
                      />
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
                {error ? <div className="mx-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">{error}</div> : null}
              </div>
            </div>
            {overviewOpen ? (
              <AssistantOverviewOverlay
                overview={overview}
                loading={overviewLoading}
                error={overviewError}
                autoEnabled={overviewAutoEnabled}
                canRerun={Boolean(overview)}
                onClose={() => setOverviewOpen(false)}
                onRerun={() => void requestOverview({ force: true, reuseLastInput: true })}
                onEditPrompt={openOverviewPromptEditor}
              />
            ) : null}
          </div>

          {assistantChatIdleHold ? (
            <AssistantChatIdleFooterBanner subscriptions={activeChatIdleSubscriptionsForThread} droneNameById={droneNameById} />
          ) : null}

      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)] p-2">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <div
            className="mr-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Provider
          </div>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">
            {providerOptions.map((provider) => {
              const selected = provider.id === activeProvider;
              const disabled = !activeThread || provider.models.length === 0;
              return (
                <button
                  key={provider.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  title={provider.title}
                  onClick={() => {
                    const nextModel = provider.models[0];
                    void updateThread({
                      provider: provider.id,
                      ...(nextModel ? { model: nextModel.id, thinkingLevel: nextModel.thinkingLevel } : {}),
                    });
                  }}
                  className={`inline-flex h-7 min-w-[72px] flex-shrink-0 items-center justify-center rounded border px-2 text-[10px] font-semibold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-45 ${
                    selected
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {provider.label}
                </button>
              );
            })}
          </div>
          <UiMenuSelect
            value={selectedModelKey}
            disabled={!activeThread}
            onValueChange={(value) => {
              const [provider, model, thinkingLevel] = value.split(':');
              void updateThread({ provider: provider as AssistantThread['provider'], model, thinkingLevel });
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
          <div
            className="inline-flex h-7 max-w-[130px] flex-shrink-0 items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] text-[var(--muted)]"
            title={activeProviderMeta.title}
          >
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${activeProvider === 'codex' ? 'bg-[var(--green)]' : 'bg-[var(--muted-dim)]'}`} />
            <span className="truncate">{activeProviderMeta.authLabel}</span>
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
            <UiMenuSelect
              value={String(overviewIntervalMs)}
              disabled={!activeThread}
              onValueChange={(value) => setOverviewIntervalMs(normalizeOverviewIntervalMs(value))}
              entries={ASSISTANT_OVERVIEW_INTERVAL_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                title: `Refresh overview every ${option.label}`,
                searchText: option.label,
              }))}
              variant="toolbar"
              role="listbox"
              itemRole="option"
              title="Overview refresh interval"
              triggerLabel={ASSISTANT_OVERVIEW_INTERVAL_OPTIONS.find((option) => option.value === String(overviewIntervalMs))?.label ?? '30s'}
              triggerClassName="h-7 w-[56px] justify-between border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
              triggerLabelClassName="font-semibold"
              panelClassName="bottom-full right-0 mb-1.5 w-[120px]"
              menuClassName="max-h-48 overflow-y-auto"
              header="Overview"
            />
            <button
              type="button"
              onClick={() => {
                const next = !overviewOpen;
                setOverviewOpen(next);
                if (next && !overview && !overviewLoading) void requestOverview();
              }}
              disabled={!activeThread}
              aria-pressed={overviewOpen}
              className={`flex h-7 w-7 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
                overviewOpen
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
              }`}
              title={overviewOpen ? 'Hide thread overview' : 'Show thread overview'}
              aria-label={overviewOpen ? 'Hide thread overview' : 'Show thread overview'}
            >
              {overviewLoading ? <IconSpinner className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !overviewAutoEnabled;
                setOverviewAutoEnabled(next);
                if (next) setOverviewOpen(true);
              }}
              disabled={!activeThread}
              aria-pressed={overviewAutoEnabled}
              aria-label="Toggle automatic thread overview"
              title={overviewAutoEnabled ? 'Automatic overview is on' : 'Automatic overview is off'}
              className={`flex h-7 w-7 items-center justify-center rounded border text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 ${
                overviewAutoEnabled
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]'
              }`}
            >
              <IconList className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {attachmentError ? (
          <div className="mb-2 rounded border border-[rgba(255,90,90,.28)] bg-[rgba(255,90,90,.07)] px-2.5 py-1.5 text-[11px] text-[var(--red)]">
            {attachmentError}
          </div>
        ) : null}
        <div
          ref={setDroneReferenceDropNodeRef}
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
        </>
      )}
      </div>
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
      {overviewPromptOpen ? (
        <AssistantOverviewPromptModal
          settings={overviewPromptSettings}
          draft={overviewPromptDraft}
          loading={overviewPromptLoading}
          saving={overviewPromptSaving}
          error={overviewPromptError}
          notice={overviewPromptNotice}
          onDraftChange={setOverviewPromptDraft}
          onUseDefault={() => setOverviewPromptDraft(overviewPromptSettings?.assistantOverviewPrompt.defaultPrompt ?? '')}
          onClose={() => setOverviewPromptOpen(false)}
          onSave={() => void saveOverviewPromptSettings()}
        />
      ) : null}
    </div>
  );
}
