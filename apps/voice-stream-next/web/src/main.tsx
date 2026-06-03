import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react';
import QRCode from 'qrcode';
import { ApprovalCodeRecognizer, type ApprovalCodeUpdate } from '../../server/src/approval-code.js';
import {
  approvalRecognizerOptions,
  VOICE_APPROVAL_SETTINGS_DEFAULT,
} from '../../server/src/voice-approval-settings.js';
import { createClerkClient, createCookieClient, createDevClient, readDevUser } from './apiClient.js';
import type {
  ApiClient,
  AndroidApkInfo,
  AndroidSetupInfo,
  AssistantApprovalRecord,
  AssistantArtifactRecord,
  AssistantExtensionsResponse,
  AssistantExtensionManifestRecord,
  AssistantExtensionTargetKind,
  AssistantExtensionToolManifest,
  AssistantExtensionToolRoute,
  AssistantMessage,
  AssistantModelOption,
  AssistantProfile,
  AssistantQueuedPromptRecord,
  AssistantSkillRecord,
  AssistantSnapshot,
  AssistantToolSummary,
  AssistantThread,
  AssistantThreadView,
  DashboardData,
  DashboardView,
  DesktopAppInfo,
  DesktopVoskStatus,
  DesktopVoskText,
  DeviceRecord,
  SpeechPlaybackTarget,
  VoiceRecordingRecord,
  VoiceApprovalFormState,
  VoiceSettings,
} from './dashboardTypes.js';
import { exactTimeLabel, relativeTimeAgo, timeLabel } from './time.js';
import { AssistantFilesPanel, type ArtifactPanelMode } from './assistant/AssistantFilesPanel.js';
import { AssistantSystemPromptModal, type AssistantSystemPromptMode } from './assistant/AssistantSystemPromptModal.js';
import { cn } from './ui/cn.js';
import { CircuitRobotLoader } from './ui/CircuitRobotLoader.js';
import { MarkdownMessage } from './ui/MarkdownMessage.js';
import { UiMenuSelect, type UiMenuSelectEntry } from './ui/MenuSelect.js';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const desktopDeviceStorageKey = 'voiceStreamNext.desktopDevice';
const ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT = 'You are VoiceStream, a concise voice assistant. Keep spoken replies short and practical.';
const ASSISTANT_SYSTEM_PROMPT_MAX_CHARS = 20_000;
const SLEEP_PHRASE_STABLE_MS = 650;
const SLEEP_PHRASE_MIN_HITS = 2;
const SLEEP_PHRASE_MAX_GAP_MS = 1_500;
const MICROCREDITS_PER_CREDIT = 1_000_000;

const ASSISTANT_PROVIDERS: Array<{ id: 'codex' | 'openai'; label: string; title: string }> = [
  { id: 'codex', label: 'Codex', title: 'Use connected Codex ChatGPT authentication for Codex models.' },
  { id: 'openai', label: 'OpenAI', title: 'Use the configured OpenAI API key for OpenAI models.' },
];

type AssistantApiKeyProvider = 'openai' | 'exa';
type AssistantSettingsPromptField = 'voiceSystemPrompt';
type SettingsPane = 'devices' | 'assistant' | 'assistant-config' | 'skills' | 'voice' | 'recordings' | 'activity';
type AssistantSkillDraft = {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  markdownBody: string;
  toolNamesText: string;
  disableModelInvocation: boolean;
};
type AssistantProfileDraft = {
  name: string;
  wakePhrase: string;
  wakePhraseAliases: string[];
  ttsVoice: string;
  enabled: boolean;
  systemPrompt: string;
  enabledTools: string[] | null;
};
const ASSISTANT_TTS_VOICE_OPTIONS = [
  { id: 'autumn', label: 'Autumn - female' },
  { id: 'diana', label: 'Diana - female' },
  { id: 'hannah', label: 'Hannah - female' },
  { id: 'austin', label: 'Austin - male' },
  { id: 'daniel', label: 'Daniel - male' },
  { id: 'troy', label: 'Troy - male' },
] as const;
type AppEvent = {
  type: string;
  sequence: number;
  at: string;
  threadId?: string;
  platform?: 'android' | 'desktop';
};
type SseMessage = { event: string; data: unknown };

const SETTINGS_PANES: Array<{ id: SettingsPane; label: string }> = [
  { id: 'devices', label: 'Devices' },
  { id: 'assistant', label: 'Assistants' },
  { id: 'assistant-config', label: 'Assistant Config' },
  { id: 'skills', label: 'Skills' },
  { id: 'voice', label: 'Voice' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'activity', label: 'Activity' },
];

const assistantIconButtonClass =
  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-white/[.02] p-0 text-[var(--muted)] transition hover:bg-white/[.05] hover:text-[var(--fg-secondary)] disabled:pointer-events-none disabled:opacity-50';
const assistantIconButtonActiveClass = '!border-[rgba(74,222,128,.28)] !bg-[rgba(74,222,128,.08)] !text-[var(--green)]';
const assistantIconSvgClass = 'h-3.5 w-3.5 fill-none stroke-current stroke-2';
const assistantPrimaryButtonClass =
  'flex h-8 w-full items-center justify-center rounded border border-[var(--border-subtle)] bg-white/[.025] px-2 font-display text-[10px] font-semibold uppercase text-[var(--fg-secondary)] transition hover:bg-white/[.055] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-50';
const assistantKickerClass = 'font-display text-[11px] font-semibold uppercase leading-none text-[var(--muted)]';
const assistantPanelClass = 'min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] p-3 text-[var(--fg-secondary)] shadow-none';
const assistantPanelHeaderClass = 'mb-3 flex items-start justify-between gap-3';
const assistantPanelTitleClass = 'm-0 mt-0.5 text-[15px] font-bold leading-tight text-[var(--fg)]';
const assistantEmptyClass = 'p-2.5 text-xs text-[var(--muted)]';
const assistantActionButtonClass =
  'inline-flex h-[30px] items-center justify-center rounded border border-[var(--border)] bg-white/[.035] px-2.5 font-display text-[10px] font-semibold uppercase text-[var(--fg-secondary)] transition hover:border-[rgba(136,145,168,.36)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-50';
const assistantFieldLabelClass = 'grid gap-1.5 text-[10px] font-extrabold uppercase leading-tight text-[var(--muted)]';
const assistantRowClass = 'rounded-[7px] border border-[var(--border-subtle)] bg-white/[.025] text-[var(--fg-secondary)]';
const assistantSkillBadgeClass =
  'inline-flex max-w-[130px] items-center rounded border border-[rgba(74,222,128,.22)] bg-[rgba(74,222,128,.07)] px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase leading-none text-[var(--green)]';
const settingsTabClass =
  'relative -mb-px inline-flex h-8 items-center justify-center rounded-t-md border border-[var(--border-subtle)] border-b-transparent bg-black/[.12] px-3 font-display text-[10px] font-semibold uppercase text-[var(--muted)] shadow-none transition hover:bg-white/[.04] hover:text-[var(--fg-secondary)]';
const settingsTabActiveClass =
  'border-[rgba(74,222,128,.30)] border-b-[var(--panel-alt)] bg-[rgba(74,222,128,.08)] text-[var(--green)]';
const ASSISTANT_MESSAGES_BOTTOM_THRESHOLD_PX = 1;
const COMPACT_VIEWPORT_QUERY = '(max-width: 880px)';

function isCompactViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(COMPACT_VIEWPORT_QUERY).matches;
}

function modelSelectionKey(selection: { provider: string; model: string; thinkingLevel: string }): string {
  return `${selection.provider}:${selection.model}:${selection.thinkingLevel}`;
}

function modelSelectionLabel(selection: { provider: string; model: string; thinkingLevel: string }, options: AssistantModelOption[]): string {
  const match = options.find((option) => modelSelectionKey({ provider: option.provider, model: option.id, thinkingLevel: option.thinkingLevel }) === modelSelectionKey(selection));
  if (match) return match.name;
  return `${selection.provider}/${selection.model}${selection.thinkingLevel !== 'off' ? ` ${selection.thinkingLevel}` : ''}`;
}

function compactModelSelectionLabel(label: string): string {
  return label.replace(/^Codex\s+/, '').replace(/^GPT-/, '').replace(/\bMedium\b/, 'Med');
}

function modelMenuEntry(model: AssistantModelOption): UiMenuSelectEntry {
  const key = modelSelectionKey({ provider: model.provider, model: model.id, thinkingLevel: model.thinkingLevel });
  return {
    value: key,
    title: `${model.provider}/${model.id}${model.thinkingLevel !== 'off' ? ` ${model.thinkingLevel}` : ''}`,
    searchText: `${model.provider} ${model.name} ${model.id} ${model.thinkingLevel}`,
    label: (
      <span className="flex w-full min-w-0 items-center justify-between gap-2.5">
        <span className="min-w-0 truncate font-display text-[10px] font-bold uppercase">{compactModelSelectionLabel(model.name)}</span>
        <small className="shrink-0 text-[10px] normal-case text-[var(--muted)]">{model.provider}{model.thinkingLevel !== 'off' ? ` · ${model.thinkingLevel}` : ''}</small>
      </span>
    ),
  };
}

declare global {
  interface Window {
    voiceStreamDesktop?: {
      isDesktop?: boolean;
      writeClipboard?: (text: string) => void;
      voskStatus?: () => Promise<DesktopVoskStatus>;
      startVosk?: () => Promise<DesktopVoskStatus>;
      stopVosk?: () => Promise<DesktopVoskStatus>;
      resetVosk?: () => Promise<DesktopVoskStatus>;
      setVoskGrammar?: (mode: 'awake' | 'sleep', settings: VoiceSettings) => Promise<DesktopVoskStatus>;
      sendVoskFrame?: (frame: ArrayBuffer) => void;
      onVoskStatus?: (callback: (status: DesktopVoskStatus) => void) => () => void;
      onVoskText?: (callback: (result: DesktopVoskText) => void) => () => void;
    };
  }
}

function codeValue(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}

function safeJsonText(raw: string | null | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function messageRoleLabel(message: AssistantMessage): string {
  if (message.role === 'assistant') return 'Assistant';
  if (message.role === 'toolResult') return message.toolName ? `Tool: ${message.toolName}` : 'Tool';
  if (message.role === 'system') return 'System';
  return 'You';
}

type AssistantToolCall = {
  id: string;
  name: string;
  args: unknown;
};

type AssistantContentPart = {
  type: string;
  text?: string;
  thinking?: string;
  reasoning?: string;
  name?: string;
  arguments?: unknown;
  args?: unknown;
  id?: string;
  callId?: string;
  call_id?: string;
};

type AssistantRenderItem =
  | { type: 'message'; key: string; message: AssistantMessage }
  | { type: 'tool'; key: string; call?: AssistantToolCall; result?: AssistantMessage };

type AppToast = {
  id: string;
  kind: 'notice' | 'error';
  message: string;
};

type AssistantStreamingDraft = {
  reply: string;
  thinking: string;
};

const TOOL_LABELS: Record<string, string> = {
  assistant_artifacts: 'Assistant artifacts',
  load_skill: 'Load skill',
  speak: 'Speak',
  get_system_prompt: 'Read system prompt',
  update_system_prompt: 'Update system prompt',
  set_thinking_level: 'Set thinking level',
};

function toolLabel(name: string | undefined): string {
  const key = String(name ?? '').trim();
  if (!key) return 'Tool';
  return TOOL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function emptySkillDraft(): AssistantSkillDraft {
  return {
    id: null,
    slug: '',
    name: '',
    description: '',
    markdownBody: '',
    toolNamesText: '',
    disableModelInvocation: false,
  };
}

function draftFromAssistantSkill(skill: AssistantSkillRecord): AssistantSkillDraft {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    markdownBody: skill.markdownBody,
    toolNamesText: skill.toolNames.join(', '),
    disableModelInvocation: skill.disableModelInvocation,
  };
}

function skillPayloadFromDraft(draft: AssistantSkillDraft): Record<string, unknown> {
  return {
    name: draft.name,
    slug: draft.slug,
    description: draft.description,
    markdownBody: draft.markdownBody,
    toolNames: draft.toolNamesText
      .split(/[\s,]+/g)
      .map((item) => item.trim())
      .filter(Boolean),
    disableModelInvocation: draft.disableModelInvocation,
  };
}

function profileDraftFromAssistantProfile(profile: AssistantProfile): AssistantProfileDraft {
  return {
    name: profile.name,
    wakePhrase: profile.wakePhrase,
    wakePhraseAliases: profile.wakePhraseAliases ?? [],
    ttsVoice: profile.ttsVoice,
    enabled: profile.enabled,
    systemPrompt: profile.systemPrompt ?? '',
    enabledTools: profile.enabledTools ? [...profile.enabledTools] : null,
  };
}

function assistantProfilePayloadFromDraft(draft: AssistantProfileDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    wakePhrase: draft.wakePhrase.trim(),
    wakePhraseAliases: draft.wakePhraseAliases.map((alias) => alias.trim()).filter(Boolean),
    ttsVoice: draft.ttsVoice.trim(),
    enabled: draft.enabled,
    systemPrompt: draft.systemPrompt.trim(),
    enabledTools: draft.enabledTools,
  };
}

function messageParts(message: AssistantMessage | undefined): AssistantContentPart[] {
  if (!message) return [];
  const parsed = safeJsonText(message.contentJson);
  if (Array.isArray(parsed)) return parsed.filter((part): part is AssistantContentPart => Boolean(part && typeof part === 'object'));
  return [];
}

function isReasoningPart(part: AssistantContentPart): boolean {
  return part.type === 'thinking' || part.type === 'reasoning';
}

function reasoningPartText(part: AssistantContentPart): string {
  return String(part.thinking ?? part.reasoning ?? part.text ?? '');
}

function messageText(message: AssistantMessage | undefined): string {
  if (!message) return '';
  const textFromParts = messageParts(message)
    .filter((part) => part.type === 'text' || isReasoningPart(part))
    .map((part) => part.type === 'text' ? String(part.text ?? '') : reasoningPartText(part))
    .join('');
  return (textFromParts || String(message.content ?? '')).trim();
}

function toolCallsForMessage(message: AssistantMessage): AssistantToolCall[] {
  const calls = messageParts(message).filter((item) => ['modelToolCall', 'toolCall'].includes(String(item.type)));
  return calls
    .map((item) => ({
      id: String(item.id ?? item.callId ?? item.call_id ?? ''),
      name: String(item.name ?? ''),
      args: item.arguments ?? item.args ?? {},
    }))
    .filter((call) => call.id && call.name);
}

function renderItemsFromMessages(sourceMessages: AssistantMessage[]): AssistantRenderItem[] {
  const consumedToolResultIndexes = new Set<number>();
  const items: AssistantRenderItem[] = [];
  for (let index = 0; index < sourceMessages.length; index += 1) {
    const message = sourceMessages[index]!;
    if (message.role === 'toolResult') {
      if (consumedToolResultIndexes.has(index)) continue;
      const key = message.toolCallId ? `tool-result:${message.toolCallId}` : `tool-result:${message.id}`;
      items.push({ type: 'tool', key, result: message });
      continue;
    }

    const calls = message.role === 'assistant' ? toolCallsForMessage(message) : [];
    if (calls.length === 0) {
      items.push({ type: 'message', key: `message:${message.id}`, message });
      continue;
    }

    const visibleText = messageText(message);
    if (visibleText && !/^requested\s+/i.test(visibleText)) {
      items.push({ type: 'message', key: `message:${message.id}`, message });
    }

    for (const call of calls) {
      let resultIndex = -1;
      for (let candidateIndex = index + 1; candidateIndex < sourceMessages.length; candidateIndex += 1) {
        if (consumedToolResultIndexes.has(candidateIndex)) continue;
        const candidate = sourceMessages[candidateIndex]!;
        if (candidate.role !== 'toolResult') continue;
        const candidateCallId = String(candidate.toolCallId ?? '').trim();
        if (candidateCallId && candidateCallId !== call.id) continue;
        resultIndex = candidateIndex;
        break;
      }
      const result = resultIndex >= 0 ? sourceMessages[resultIndex] : undefined;
      if (resultIndex >= 0) consumedToolResultIndexes.add(resultIndex);
      items.push({ type: 'tool', key: `tool-call:${call.id}`, call, result });
    }
  }
  return items;
}

type SpeechAudioQueueItem = {
  src: string;
  revoke?: () => void;
  repeatSrc?: string;
  requireAwakeMode?: boolean;
  requeued?: boolean;
};

const speechAudioQueue: SpeechAudioQueueItem[] = [];
let speechAudioPlaying = false;
let speechAudioMode = 'off';
let activeSpeechAudio: { audio: HTMLAudioElement; finish: () => void; item: SpeechAudioQueueItem; requireAwakeMode?: boolean } | null = null;
let lastCompletedSpeechAudioSrc: string | null = null;

function speechPlaybackAllowed(): boolean {
  return ['awake', 'recording', 'paused', 'transcribing'].includes(speechAudioMode);
}

function speechPlaybackBlocked(): boolean {
  return speechAudioMode === 'recording' || speechAudioMode === 'transcribing';
}

function setSpeechPlaybackMode(mode: string): void {
  speechAudioMode = mode;
  if (mode === 'sleeping' || mode === 'off') {
    stopSpeechAudioPlayback({ clearQueue: true, onlyAwakeMode: true });
  } else if (speechPlaybackBlocked()) {
    stopSpeechAudioPlayback({ clearQueue: false, requeueActive: true });
  } else {
    void drainSpeechAudioQueue();
  }
}

function queueSpeechAudio(audioBase64: string, contentType = 'audio/wav', options: { requireAwakeMode?: boolean } = {}): void {
  const clean = audioBase64.trim();
  if (!clean || typeof Audio === 'undefined') return;
  if (options.requireAwakeMode && !speechPlaybackAllowed()) return;
  const src = `data:${contentType.trim() || 'audio/wav'};base64,${clean}`;
  speechAudioQueue.push({ src, repeatSrc: src, requireAwakeMode: options.requireAwakeMode });
  void drainSpeechAudioQueue();
}

function queueSpeechAudioBytes(data: BlobPart, contentType = 'audio/wav', options: { requireAwakeMode?: boolean } = {}): void {
  if (typeof Audio === 'undefined') return;
  if (options.requireAwakeMode && !speechPlaybackAllowed()) return;
  const url = URL.createObjectURL(new Blob([data], { type: contentType }));
  speechAudioQueue.push({ src: url, revoke: () => URL.revokeObjectURL(url), requireAwakeMode: options.requireAwakeMode });
  void drainSpeechAudioQueue();
}

async function drainSpeechAudioQueue(): Promise<void> {
  if (speechAudioPlaying) return;
  speechAudioPlaying = true;
  try {
    while (speechAudioQueue.length > 0) {
      if (speechPlaybackBlocked()) break;
      const item = speechAudioQueue.shift()!;
      item.requeued = false;
      if (item.requireAwakeMode && !speechPlaybackAllowed()) {
        item.revoke?.();
        continue;
      }
      try {
        const completed = await playSpeechAudio(item);
        if (completed && item.repeatSrc) lastCompletedSpeechAudioSrc = item.repeatSrc;
      } finally {
        if (!item.requeued) item.revoke?.();
      }
    }
  } finally {
    speechAudioPlaying = false;
  }
}

function playSpeechAudio(item: SpeechAudioQueueItem): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio(item.src);
    let settled = false;
    let completed = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (activeSpeechAudio?.audio === audio) activeSpeechAudio = null;
      resolve(completed);
    };
    activeSpeechAudio = { audio, finish, item, requireAwakeMode: item.requireAwakeMode };
    audio.addEventListener('ended', () => {
      completed = true;
      finish();
    }, { once: true });
    audio.addEventListener('error', finish, { once: true });
    audio.play().catch(finish);
  });
}

function stopSpeechAudioPlayback(options: { clearQueue?: boolean; onlyAwakeMode?: boolean; requeueActive?: boolean } = {}): boolean {
  if (options.clearQueue) {
    for (let index = speechAudioQueue.length - 1; index >= 0; index -= 1) {
      const item = speechAudioQueue[index]!;
      if (options.onlyAwakeMode && !item.requireAwakeMode) continue;
      speechAudioQueue.splice(index, 1);
      item.revoke?.();
    }
  }
  const active = activeSpeechAudio;
  if (!active) return false;
  if (options.onlyAwakeMode && !active.requireAwakeMode) return false;
  activeSpeechAudio = null;
  if (options.requeueActive) {
    active.item.requeued = true;
    speechAudioQueue.unshift(active.item);
  }
  try {
    active.audio.pause();
    active.audio.currentTime = 0;
  } catch {
    // Ignore stop races with already-finished audio.
  }
  active.finish();
  return true;
}

function repeatLastSpeechAudioPlayback(): boolean {
  if (!lastCompletedSpeechAudioSrc) return false;
  stopSpeechAudioPlayback({ clearQueue: false });
  speechAudioQueue.unshift({ src: lastCompletedSpeechAudioSrc, repeatSrc: lastCompletedSpeechAudioSrc, requireAwakeMode: true });
  void drainSpeechAudioQueue();
  return true;
}

function ReasoningBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const trimmed = text.trim();
  if (!trimmed && !streaming) return null;
  return (
    <div className="mb-2 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] last:mb-0">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 border-0 bg-transparent px-2.5 py-1.5 text-left text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.035)]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="shrink-0 font-display text-[10px] font-bold uppercase">Reasoning</span>
        {streaming ? <ThinkingPulseDots /> : null}
        <small className="ml-auto text-[10px] text-[var(--muted)]">{open ? 'Hide' : 'Show'}</small>
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
            <div className="max-h-[4.5em] overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--muted-dim)]">
              {trimmed}
            </div>
          </div>
        )
      ) : streaming ? (
        <div className="border-t border-[var(--border-subtle)] px-2.5 py-2 text-[11px] text-[var(--muted-dim)]">...</div>
      ) : null}
    </div>
  );
}

function AssistantMessageRow({ message, streaming = false }: { message: AssistantMessage; streaming?: boolean }) {
  const parts = messageParts(message);
  const hasStructuredContent = parts.some((part) => part.type === 'text' || isReasoningPart(part));
  return (
    <article
      className={cn(
        'w-full px-3 py-2 text-[13px] leading-relaxed',
        message.role === 'user' && 'border-y border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--fg-secondary)]',
        message.role === 'assistant' && 'text-[var(--fg)]',
        message.role === 'system' && 'bg-[rgba(255,255,255,.018)] text-[var(--fg-secondary)]',
        message.role === 'toolResult' && 'border-y border-[var(--border-subtle)] bg-[rgba(74,222,128,.045)] text-[var(--fg-secondary)]',
        streaming && 'assistant-streaming-message',
      )}
    >
      <div className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]">{messageRoleLabel(message)}</div>
      {hasStructuredContent ? (
        parts.map((part, index) => {
          if (isReasoningPart(part)) return <ReasoningBlock key={index} text={reasoningPartText(part)} streaming={streaming && index === parts.length - 1} />;
          if (part.type === 'text') return <MarkdownMessage key={index} text={String(part.text ?? '')} />;
          return null;
        })
      ) : (
        <MarkdownMessage text={message.content} />
      )}
    </article>
  );
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
    <div className={cn('rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]', status === 'error' && 'border-[rgba(248,113,113,.22)]')}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]"
        style={{ fontFamily: 'var(--display)' }}
        aria-expanded={open}
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

function ToolPayloadDetails({ call, result }: { call?: AssistantToolCall; result?: AssistantMessage }) {
  const resultText = result ? messageText(result) : '';
  return (
    <>
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
    </>
  );
}

function ToolActivityMessage({ call, result }: { call?: AssistantToolCall; result?: AssistantMessage }) {
  const title = toolLabel(call?.name || result?.toolName || undefined);
  return (
    <div className="mx-3">
      <ToolDisclosure title={title} status={result ? (result.isError ? 'error' : 'ok') : undefined}>
        <ToolPayloadDetails call={call} result={result} />
      </ToolDisclosure>
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
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2" aria-hidden="true">
      <span className="h-1.5 w-1.5 animate-[assistant-thinking-pulse_1.2s_ease-in-out_infinite] rounded-full bg-[var(--muted)]" />
      <span className="h-1.5 w-1.5 animate-[assistant-thinking-pulse_1.2s_ease-in-out_infinite] rounded-full bg-[var(--muted)] [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-[assistant-thinking-pulse_1.2s_ease-in-out_infinite] rounded-full bg-[var(--muted)] [animation-delay:240ms]" />
    </span>
  );
}

function AssistantThinkingRow() {
  return (
    <div className="w-full px-3 py-2" role="status" aria-label="Assistant is thinking">
      <div className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]">Assistant</div>
      <ThinkingPulseDots />
    </div>
  );
}

const ASSISTANT_TOOL_CATEGORY_LABELS: Record<string, string> = {
  artifacts: 'Artifacts',
  speech: 'Speech',
  prompts: 'Prompts',
  settings: 'Settings',
  web: 'Web',
  extensions: 'Extensions',
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
    const groups = new Map<string, AssistantToolSummary[]>();
    for (const tool of tools) {
      const current = groups.get(tool.category) ?? [];
      current.push(tool);
      groups.set(tool.category, current);
    }
    return Array.from(groups.entries());
  }, [tools]);

  return (
    <div className="absolute right-2 top-[50px] z-[35] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_rgba(0,0,0,.48)] max-[620px]:fixed max-[620px]:inset-x-2 max-[620px]:bottom-2 max-[620px]:top-2 max-[620px]:w-auto">
      <div className="flex items-center justify-between gap-2.5 border-b border-[var(--border)] px-3 py-2">
        <div className="min-w-0">
          <strong className="block font-display text-xs font-bold text-[var(--fg)]">Assistant tools</strong>
          <small className="block min-w-0 truncate text-[10px] text-[var(--muted-dim)]">Tool changes apply when the assistant starts its next turn.</small>
        </div>
        <button type="button" className="h-7 border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2.5 font-display text-[10px] font-bold uppercase text-[var(--muted)]" onClick={onClose}>Close</button>
      </div>
      <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2">
        <button type="button" className="h-7 border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2.5 font-display text-[10px] font-bold uppercase text-[var(--muted)]" onClick={onEnableAll} disabled={disabled}>Enable all</button>
        <button type="button" className="h-7 border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2.5 font-display text-[10px] font-bold uppercase text-[var(--muted)]" onClick={onDisableAll} disabled={disabled}>Disable all</button>
        <span className="ml-auto text-[10px] text-[var(--muted-dim)]">{enabledTools.length} / {tools.length}</span>
      </div>
      <div className="max-h-[min(520px,calc(100vh-190px))] overflow-y-auto p-2 max-[620px]:max-h-none">
        {categories.map(([category, categoryTools]) => (
          <section key={category} className="mt-2 first:mt-0">
            <div className="mb-1 px-1 font-display text-[9px] font-bold uppercase text-[var(--muted-dim)]">{ASSISTANT_TOOL_CATEGORY_LABELS[category] ?? category}</div>
            <div className="grid gap-1">
              {categoryTools.map((tool) => {
                const checked = enabled.has(tool.name);
                return (
                  <label
                    key={tool.name}
                    className={cn(
                      'flex min-w-0 cursor-pointer items-start gap-2 rounded-[5px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 py-1.5',
                      checked && 'border-[rgba(139,92,246,.55)] bg-[rgba(139,92,246,.12)]',
                    )}
                    title={tool.description}
                  >
                    <input
                      className="mt-px h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) => onToggleTool(tool.name, event.target.checked)}
                    />
                    <span className="min-w-0">
                      <strong className="block truncate text-[11px] font-semibold text-[var(--fg-secondary)]">{tool.label}</strong>
                      <small className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-dim)]">{tool.description}</small>
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

function extensionToolName(extensionId: string, toolName: string): string {
  return `${safeExtensionToolSegment(extensionId).replace(/_/g, '-')}__${safeExtensionToolSegment(toolName)}`;
}

function safeExtensionToolSegment(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function routeForTool(routes: AssistantExtensionToolRoute[], toolName: string, tool: AssistantExtensionToolManifest): AssistantExtensionToolRoute {
  return routes.find((route) => route.toolName === toolName) ?? {
    userId: '',
    toolName,
    enabled: false,
    targetKind: tool.defaultTarget,
    targetDeviceId: null,
    updatedAt: '',
  };
}

function AssistantExtensionsPanel({
  data,
  devices,
  busy,
  onUpdateRoute,
}: {
  data: AssistantExtensionsResponse | null;
  devices: DeviceRecord[];
  busy: boolean;
  onUpdateRoute: (toolName: string, route: Pick<AssistantExtensionToolRoute, 'enabled' | 'targetKind' | 'targetDeviceId'>) => void;
}) {
  const connectedToolNames = React.useMemo(() => new Set((data?.connectedDevices ?? []).flatMap((device) => device.toolNames)), [data?.connectedDevices]);
  const routes = data?.routes ?? [];
  const connectedDevices = data?.connectedDevices ?? [];
  const manifests = data?.manifests ?? [];
  const activeDevices = devices.filter((device) => !device.revokedAt);

  function connectedFor(toolName: string, route: AssistantExtensionToolRoute): boolean {
    if (route.targetKind === 'server') return false;
    if (route.targetKind === 'device') {
      return connectedDevices.some((device) => device.deviceId === route.targetDeviceId && device.toolNames.includes(toolName));
    }
    return connectedToolNames.has(toolName);
  }

  function updateRoute(
    toolName: string,
    tool: AssistantExtensionToolManifest,
    current: AssistantExtensionToolRoute,
    patch: Partial<Pick<AssistantExtensionToolRoute, 'enabled' | 'targetKind' | 'targetDeviceId'>>,
  ) {
    const targetKind = patch.targetKind ?? current.targetKind ?? tool.defaultTarget;
    const targetDeviceId = targetKind === 'device'
      ? patch.targetDeviceId ?? current.targetDeviceId ?? activeDevices[0]?.id ?? null
      : null;
    onUpdateRoute(toolName, {
      enabled: patch.enabled ?? current.enabled,
      targetKind,
      targetDeviceId,
    });
  }

  return (
    <section className={assistantPanelClass}>
      <div className={assistantPanelHeaderClass}>
        <div>
          <h2 className={assistantPanelTitleClass}>Extensions</h2>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(260px,.44fr)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <div className={cn(assistantRowClass, 'grid gap-2 p-3')}>
            <div className="flex items-center justify-between gap-2">
              <strong className="text-xs text-[var(--fg)]">Connected runners</strong>
              <span className="text-[10px] text-[var(--muted-dim)]">{connectedDevices.length}</span>
            </div>
            {connectedDevices.map((device) => (
              <div key={`${device.deviceId}-${device.connectedAt}`} className="grid gap-1 rounded border border-[var(--border-subtle)] bg-white/[.025] p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--green)] shadow-[0_0_0_3px_rgba(74,222,128,.12)]" />
                  <strong className="min-w-0 truncate text-xs text-[var(--fg)]">{device.displayName}</strong>
                  <span className="ml-auto text-[10px] uppercase text-[var(--muted-dim)]">{device.deviceType}</span>
                </div>
                <small className="text-[11px] text-[var(--muted)]">{device.toolNames.length} tool{device.toolNames.length === 1 ? '' : 's'} advertised</small>
              </div>
            ))}
            {connectedDevices.length === 0 ? <div className={assistantEmptyClass}>No extension runner is connected.</div> : null}
          </div>
        </div>

        <div className="grid content-start gap-2">
          {manifests.map((record: AssistantExtensionManifestRecord) => (
            <article key={record.extensionId} className={cn(assistantRowClass, 'grid gap-2 p-3')}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-[var(--fg)]">{record.name}</strong>
                  <small className="block text-[11px] text-[var(--muted)]">{record.extensionId} / v{record.version}</small>
                </div>
                <span className="rounded border border-[var(--border-subtle)] px-2 py-1 text-[10px] uppercase text-[var(--muted)]">
                  {record.manifest.tools.length} tool{record.manifest.tools.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid gap-2">
                {record.manifest.tools.map((tool) => {
                  const toolName = extensionToolName(record.manifest.id, tool.name);
                  const route = routeForTool(routes, toolName, tool);
                  const routeConnected = connectedFor(toolName, route);
                  const canUseDeviceTarget = activeDevices.length > 0;
                  const canEnableRoute = route.targetKind !== 'server' && (route.targetKind !== 'device' || canUseDeviceTarget);
                  return (
                    <div key={toolName} className="grid gap-2 rounded border border-[var(--border-subtle)] bg-white/[.02] p-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0">
                          <strong className="block truncate text-xs text-[var(--fg-secondary)]">{tool.label}</strong>
                          <small className="block text-[11px] leading-snug text-[var(--muted)]">{tool.description}</small>
                        </div>
                        <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                          <input
                            className="h-3.5 w-3.5 accent-[var(--accent)]"
                            type="checkbox"
                            checked={route.enabled}
                            disabled={busy || !canEnableRoute}
                            onChange={(event) => updateRoute(toolName, tool, route, { enabled: event.currentTarget.checked })}
                          />
                          Enabled
                        </label>
                      </div>
                      <div className="grid grid-cols-[110px_minmax(150px,1fr)_auto] items-center gap-2 max-[720px]:grid-cols-1">
                        <select
                          value={route.targetKind}
                          disabled={busy}
                          onChange={(event) => updateRoute(toolName, tool, route, { targetKind: event.currentTarget.value as AssistantExtensionTargetKind })}
                          className="h-[30px] text-xs"
                        >
                          {tool.supportedTargets.includes('server') ? <option value="server" disabled>Server (not available)</option> : null}
                          {tool.supportedTargets.includes('any_device') ? <option value="any_device">Any device</option> : null}
                          {tool.supportedTargets.includes('device') ? <option value="device">Device</option> : null}
                        </select>
                        <select
                          value={route.targetDeviceId ?? ''}
                          disabled={busy || route.targetKind !== 'device'}
                          onChange={(event) => updateRoute(toolName, tool, route, { targetDeviceId: event.currentTarget.value || null })}
                          className="h-[30px] min-w-0 text-xs"
                        >
                          <option value="">Select device</option>
                          {activeDevices.map((device) => (
                            <option key={device.id} value={device.id}>{device.displayName} / {device.deviceType}</option>
                          ))}
                        </select>
                        <span className={cn('flex items-center gap-1.5 text-[10px] uppercase text-[var(--muted)]', route.enabled && routeConnected && 'text-[var(--green)]')}>
                          <span className={cn('h-2 w-2 rounded-full bg-[var(--muted)]', route.enabled && routeConnected && 'bg-[var(--green)]')} />
                          {route.enabled ? (route.targetKind === 'server' ? 'Server not available' : routeConnected ? 'Ready' : 'No runner') : 'Disabled'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
          {manifests.length === 0 ? <div className={assistantEmptyClass}>No extension manifests have been added yet.</div> : null}
        </div>
      </div>
    </section>
  );
}

function approvalSummary(approval: AssistantApprovalRecord): {
  title: string;
  rows: Array<{ label: string; value: string }>;
  blockLabel?: string;
  block?: string;
} {
  const args = (approval.args && typeof approval.args === 'object' ? approval.args : safeJsonText(approval.argsJson)) as Record<string, unknown>;
  if (approval.toolName === 'assistant_artifacts') {
    const action = String(args.action ?? '').trim();
    const artifactPath = String(args.path ?? '').trim();
    const content = String(args.content ?? '').trim();
    return {
      title: action === 'delete' ? 'Delete artifact' : action === 'read' ? 'Read artifact' : action === 'append' ? 'Append artifact' : 'Write artifact',
      rows: [
        ...(action ? [{ label: 'Action', value: action }] : []),
        ...(artifactPath ? [{ label: 'Path', value: artifactPath }] : []),
      ],
      blockLabel: content ? 'Content' : undefined,
      block: content,
    };
  }
  if (approval.toolName === 'speak') {
    return {
      title: 'Speak reply',
      rows: [],
      blockLabel: 'Text',
      block: String(args.text ?? '').trim(),
    };
  }
  if (approval.toolName === 'update_system_prompt') {
    return {
      title: 'Update system prompt',
      rows: [],
      blockLabel: 'Prompt',
      block: String(args.prompt ?? '').trim(),
    };
  }
  if (approval.toolName === 'set_thinking_level') {
    return {
      title: 'Set thinking level',
      rows: [{ label: 'Level', value: String(args.thinkingLevel ?? 'off') }],
    };
  }
  return {
    title: approval.label || 'Approval required',
    rows: [],
    blockLabel: 'Arguments',
    block: JSON.stringify(args, null, 2),
  };
}

type AssistantPromptEvent =
  | { type: 'snapshot'; snapshot: AssistantSnapshot }
  | { type: 'delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'message'; message: AssistantMessage }
  | { type: 'tool_call'; [key: string]: unknown }
  | { type: 'tool_result'; [key: string]: unknown }
  | { type: 'approval_pending'; snapshot: AssistantSnapshot }
  | { type: 'done'; snapshot: AssistantSnapshot }
  | { type: 'error'; error: string; snapshot?: AssistantSnapshot }
  | { type: string; [key: string]: unknown };

function upsertMessage(messages: AssistantMessage[], message: AssistantMessage): AssistantMessage[] {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) return [...messages, message];
  return messages.map((entry) => entry.id === message.id ? message : entry);
}

async function readAssistantEventStream(response: Response, handleEvent: (event: AssistantPromptEvent) => void): Promise<void> {
  if (!response.body) throw new Error('Assistant stream did not include a response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) handleEvent(JSON.parse(line));
      newlineIndex = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  const line = buffer.trim();
  if (line) handleEvent(JSON.parse(line));
}

async function readSseStream(response: Response, handleMessage: (message: SseMessage) => void): Promise<void> {
  if (!response.ok) throw new Error(`SSE stream failed: ${response.status} ${response.statusText}`);
  if (!response.body) throw new Error('SSE stream did not include a response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = 'message';
      return;
    }
    const dataText = dataLines.join('\n');
    let data: unknown = dataText;
    try {
      data = JSON.parse(dataText);
    } catch {
      // Keep non-JSON SSE payloads as plain text.
    }
    handleMessage({ event: eventName, data });
    eventName = 'message';
    dataLines = [];
  };

  const consumeLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message';
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  };

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      consumeLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer) consumeLine(buffer);
  dispatch();
}

function chooseDefaultArtifact(artifacts: AssistantArtifactRecord[], preferredPath?: string | null): AssistantArtifactRecord | null {
  return (
    artifacts.find((artifact) => artifact.path === preferredPath) ??
    artifacts.find((artifact) => artifact.path === 'status.md' || artifact.path.endsWith('/status.md')) ??
    artifacts[0] ??
    null
  );
}

function AppShell({ client, identitySlot }: { client: ApiClient; identitySlot: React.ReactNode }) {
  const [dashboard, setDashboard] = React.useState<DashboardData | null>(null);
  const [assistantSnapshotData, setAssistantSnapshotData] = React.useState<AssistantSnapshot | null>(null);
  const [activeView, setActiveView] = React.useState<DashboardView>('threads');
  const [settingsPane, setSettingsPane] = React.useState<SettingsPane>('devices');
  const [threadSidebarOpen, setThreadSidebarOpen] = React.useState(() => !isCompactViewport());
  const [mobileToolbarOpen, setMobileToolbarOpen] = React.useState(false);
  const [mobileModelControlsOpen, setMobileModelControlsOpen] = React.useState(false);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [streamingByThreadId, setStreamingByThreadId] = React.useState<Record<string, AssistantStreamingDraft>>({});
  const [promptSubmittingByThreadId, setPromptSubmittingByThreadId] = React.useState<Record<string, boolean>>({});
  const [artifacts, setArtifacts] = React.useState<AssistantArtifactRecord[]>([]);
  const [selectedArtifact, setSelectedArtifact] = React.useState<AssistantArtifactRecord | null>(null);
  const [artifactPathDraft, setArtifactPathDraft] = React.useState('');
  const [artifactContentDraft, setArtifactContentDraft] = React.useState('');
  const [artifactDirty, setArtifactDirty] = React.useState(false);
  const [artifactsLoading, setArtifactsLoading] = React.useState(false);
  const [artifactsError, setArtifactsError] = React.useState<string | null>(null);
  const [artifactPanelMode, setArtifactPanelMode] = React.useState<ArtifactPanelMode>('view');
  const [assistantFilesOpen, setAssistantFilesOpen] = React.useState(false);
  const [assistantToolsOpen, setAssistantToolsOpen] = React.useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = React.useState(false);
  const [systemPromptMode, setSystemPromptMode] = React.useState<AssistantSystemPromptMode>('thread');
  const [voiceSystemPromptDraft, setVoiceSystemPromptDraft] = React.useState(ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT);
  const [threadSystemPromptDraft, setThreadSystemPromptDraft] = React.useState('');
  const [assistantSettingsPromptDrafts, setAssistantSettingsPromptDrafts] = React.useState<Record<AssistantSettingsPromptField, string>>({
    voiceSystemPrompt: ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT,
  });
  const [systemPromptSaving, setSystemPromptSaving] = React.useState(false);
  const [promoteSystemPromptSaving, setPromoteSystemPromptSaving] = React.useState(false);
  const [systemPromptError, setSystemPromptError] = React.useState<string | null>(null);
  const [systemPromptNotice, setSystemPromptNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [toasts, setToasts] = React.useState<AppToast[]>([]);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [threadTitleDraft, setThreadTitleDraft] = React.useState('');
  const [threadDeleteCandidate, setThreadDeleteCandidate] = React.useState<AssistantThread | null>(null);
  const [artifactDeleteCandidate, setArtifactDeleteCandidate] = React.useState<AssistantArtifactRecord | null>(null);
  const [codexConnectFlow, setCodexConnectFlow] = React.useState<{ state: string; authorizationUrl: string; redirectUri: string; expiresAt: string } | null>(null);
  const [codexCodeDraft, setCodexCodeDraft] = React.useState('');
  const [apiKeyDrafts, setApiKeyDrafts] = React.useState<Record<AssistantApiKeyProvider, string>>({ openai: '', exa: '' });
  const [apiKeyCopying, setApiKeyCopying] = React.useState<Record<AssistantApiKeyProvider, boolean>>({ openai: false, exa: false });
  const [assistantProfileDrafts, setAssistantProfileDrafts] = React.useState<Record<string, AssistantProfileDraft>>({});
  const [selectedAssistantProfileId, setSelectedAssistantProfileId] = React.useState<string | null>(null);
  const [skillDraft, setSkillDraft] = React.useState<AssistantSkillDraft>(() => emptySkillDraft());
  const [deviceNameEditor, setDeviceNameEditor] = React.useState<{ deviceId: string; draft: string } | null>(null);
  const [deviceName, setDeviceName] = React.useState('Android voice client');
  const [deviceType, setDeviceType] = React.useState('android');
  const [androidApkInfo, setAndroidApkInfo] = React.useState<AndroidApkInfo | null>(null);
  const [desktopAppInfo, setDesktopAppInfo] = React.useState<DesktopAppInfo | null>(null);
  const [adminAndroidFile, setAdminAndroidFile] = React.useState<File | null>(null);
  const [adminDesktopFile, setAdminDesktopFile] = React.useState<File | null>(null);
  const [creditGrantDrafts, setCreditGrantDrafts] = React.useState<Record<string, { amountCredits: string; reason: string }>>({});
  const [assistantExtensions, setAssistantExtensions] = React.useState<AssistantExtensionsResponse | null>(null);
  const [voiceRecordings, setVoiceRecordings] = React.useState<VoiceRecordingRecord[]>([]);
  const [voiceRecordingsLoading, setVoiceRecordingsLoading] = React.useState(false);
  const [voiceRecordingsError, setVoiceRecordingsError] = React.useState<string | null>(null);
  const [androidSetupInfo, setAndroidSetupInfo] = React.useState<AndroidSetupInfo | null>(null);
  const [androidSetupQr, setAndroidSetupQr] = React.useState('');
  const [pairingText, setPairingText] = React.useState('');
  const [pairingQr, setPairingQr] = React.useState('');
  const [pairingExpiresAt, setPairingExpiresAt] = React.useState<string | null>(null);
  const [pairingDeviceId, setPairingDeviceId] = React.useState<string | null>(null);
  const [approvalSettings, setApprovalSettings] = React.useState<VoiceApprovalFormState>(VOICE_APPROVAL_SETTINGS_DEFAULT);
  const settingsHydratedRef = React.useRef(false);
  const approvalSettingsDirtyRef = React.useRef(false);
  const assistantSettingsPromptDirtyRef = React.useRef<Record<AssistantSettingsPromptField, boolean>>({
    voiceSystemPrompt: false,
  });
  const assistantEventRefreshTimerRef = React.useRef<number | null>(null);
  const artifactsEventRefreshTimerRef = React.useRef<number | null>(null);
  const dashboardEventRefreshTimerRef = React.useRef<number | null>(null);
  const releaseEventRefreshTimerRef = React.useRef<number | null>(null);
  const appEventsConnectedRef = React.useRef(false);
  const promptSubmittingThreadIdsRef = React.useRef<Record<string, boolean>>({});
  const streamingRequestThreadIdsRef = React.useRef<Record<string, boolean>>({});
  const scheduleAssistantEventRefreshRef = React.useRef<() => void>(() => {});
  const scheduleArtifactsEventRefreshRef = React.useRef<(threadId?: string | null) => void>(() => {});
  const scheduleDashboardEventRefreshRef = React.useRef<() => void>(() => {});
  const scheduleReleaseEventRefreshRef = React.useRef<(platform?: 'android' | 'desktop') => void>(() => {});
  const messagesScrollRef = React.useRef<HTMLDivElement | null>(null);
  const messagesStickToBottomRef = React.useRef(true);
  const messageScrollSignatureRef = React.useRef('');
  const activeThreadIdRef = React.useRef<string | null>(null);
  const messageDraftRef = React.useRef('');

  const selectActiveThread = React.useCallback((threadId: string | null) => {
    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
  }, []);

  React.useEffect(() => {
    messageDraftRef.current = messageDraft;
  }, [messageDraft]);

  React.useEffect(() => {
    const media = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const syncLayoutMode = (matches: boolean) => {
      setThreadSidebarOpen(!matches);
      if (!matches) {
        setMobileToolbarOpen(false);
        setMobileModelControlsOpen(false);
      }
    };
    syncLayoutMode(media.matches);
    const onChange = (event: MediaQueryListEvent) => syncLayoutMode(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const hydrateApprovalSettings = React.useCallback((settings: VoiceSettings) => {
    setApprovalSettings({
      triggerPhrase: settings.triggerPhrase,
      unlockPhrase: settings.unlockPhrase,
      shutdownPhrase: settings.shutdownPhrase,
      lockCode: settings.lockCode,
      minDigits: settings.minDigits,
      maxDigits: settings.maxDigits,
      stableMs: settings.stableMs,
      collectTimeoutMs: settings.collectTimeoutMs,
      duplicateCooldownMs: settings.duplicateCooldownMs,
      finalizeCheckIntervalMs: settings.finalizeCheckIntervalMs,
      postPromptCommandSuppressionMs: settings.postPromptCommandSuppressionMs,
    });
    settingsHydratedRef.current = true;
    approvalSettingsDirtyRef.current = false;
  }, []);

  const updateApprovalSettingsDraft = React.useCallback((patch: Partial<VoiceApprovalFormState>) => {
    approvalSettingsDirtyRef.current = true;
    setApprovalSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const assistantThreads = assistantSnapshotData?.threads ?? dashboard?.threads ?? [];
  const activeThread =
    assistantThreads.find((thread) => thread.id === activeThreadId) ??
    assistantThreads[0] ??
    null;
  const activeThreadStreaming = activeThread ? streamingByThreadId[activeThread.id] : null;
  const streamingReply = activeThreadStreaming?.reply ?? '';
  const streamingThinking = activeThreadStreaming?.thinking ?? '';
  const activePromptSubmitting = activeThread ? Boolean(promptSubmittingByThreadId[activeThread.id]) : false;
  const updateMessagesStickToBottom = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
    messagesStickToBottomRef.current = gap <= ASSISTANT_MESSAGES_BOTTOM_THRESHOLD_PX;
  }, []);
  const scrollMessagesToBottom = React.useCallback((options: { force?: boolean; retries?: number } = {}) => {
    const { force = false, retries = 4 } = options;
    if (force) messagesStickToBottomRef.current = true;
    let triesRemaining = retries;
    const attempt = () => {
      window.requestAnimationFrame(() => {
        const node = messagesScrollRef.current;
        if (!node) {
          if (triesRemaining > 0) {
            triesRemaining -= 1;
            attempt();
          }
          return;
        }
        if (!force && !messagesStickToBottomRef.current) return;
        node.scrollTop = node.scrollHeight;
        updateMessagesStickToBottom(node);
        if (force) messagesStickToBottomRef.current = true;
        const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
        if (gap > 1 && triesRemaining > 0) {
          triesRemaining -= 1;
          attempt();
        }
      });
    };
    attempt();
  }, [updateMessagesStickToBottom]);
  const dismissToast = React.useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const pushToast = React.useCallback((kind: AppToast['kind'], message: string | null) => {
    const clean = String(message ?? '').trim();
    if (!clean) return;
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current.slice(-3), { id, kind, message: clean }]);
  }, []);
  const setError = React.useCallback((message: string | null) => pushToast('error', message), [pushToast]);
  const setNotice = React.useCallback((message: string | null) => pushToast('notice', message), [pushToast]);
  const setPromptSubmitting = React.useCallback((threadId: string, submitting: boolean) => {
    const next = { ...promptSubmittingThreadIdsRef.current, [threadId]: submitting };
    if (!submitting) delete next[threadId];
    promptSubmittingThreadIdsRef.current = next;
    setPromptSubmittingByThreadId(next);
  }, []);
  const clearThreadStreaming = React.useCallback((threadId: string) => {
    setStreamingByThreadId((current) => {
      if (!current[threadId]) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }, []);
  const appendThreadStreaming = React.useCallback((threadId: string, patch: Partial<AssistantStreamingDraft>) => {
    setStreamingByThreadId((current) => {
      const existing = current[threadId] ?? { reply: '', thinking: '' };
      return {
        ...current,
        [threadId]: {
          reply: patch.reply === undefined ? existing.reply : `${existing.reply}${patch.reply}`,
          thinking: patch.thinking === undefined ? existing.thinking : `${existing.thinking}${patch.thinking}`,
        },
      };
    });
  }, []);
  React.useEffect(() => {
    if (toasts.length === 0) return undefined;
    const timers = toasts.map((toast) => window.setTimeout(() => dismissToast(toast.id), toast.kind === 'error' ? 7200 : 4200));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismissToast, toasts]);
  React.useEffect(() => {
    setThreadTitleDraft(activeThread?.title ?? '');
  }, [activeThread?.id, activeThread?.title]);
  const hydrateArtifactDraft = React.useCallback((artifact: AssistantArtifactRecord | null, mode?: ArtifactPanelMode) => {
    setSelectedArtifact(artifact);
    setArtifactPathDraft(artifact?.path ?? '');
    setArtifactContentDraft(artifact?.content ?? '');
    setArtifactDirty(false);
    setArtifactPanelMode(mode ?? (artifact ? 'view' : 'edit'));
  }, []);
  const activeInheritedSystemPrompt = React.useMemo(() => {
    const settings = assistantSnapshotData?.assistantSettings;
    return settings?.voiceSystemPrompt ?? ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT;
  }, [assistantSnapshotData?.assistantSettings]);
  const seedSystemPromptDrafts = React.useCallback(() => {
    const voicePrompt = assistantSnapshotData?.assistantSettings.voiceSystemPrompt ?? ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT;
    setVoiceSystemPromptDraft(voicePrompt);
    setThreadSystemPromptDraft(activeThread?.systemPrompt ?? '');
  }, [activeThread?.systemPrompt, assistantSnapshotData?.assistantSettings]);

  React.useEffect(() => {
    const voiceSystemPrompt = assistantSnapshotData?.assistantSettings.voiceSystemPrompt ?? ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT;
    setAssistantSettingsPromptDrafts((current) => ({
      voiceSystemPrompt: assistantSettingsPromptDirtyRef.current.voiceSystemPrompt ? current.voiceSystemPrompt : voiceSystemPrompt,
    }));
  }, [
    assistantSnapshotData?.assistantSettings.voiceSystemPrompt,
  ]);

  React.useEffect(() => {
    const profiles = assistantSnapshotData?.assistantProfiles ?? [];
    setAssistantProfileDrafts((current) => {
      const next: Record<string, AssistantProfileDraft> = {};
      for (const profile of profiles) {
        next[profile.id] = current[profile.id] ?? profileDraftFromAssistantProfile(profile);
      }
      return next;
    });
    setSelectedAssistantProfileId((current) => current && profiles.some((profile) => profile.id === current) ? current : profiles[0]?.id ?? null);
  }, [assistantSnapshotData?.assistantProfiles]);

  React.useEffect(() => {
    if (systemPromptOpen) seedSystemPromptDrafts();
  }, [activeThread?.id, systemPromptOpen]);

  function openSystemPromptEditor() {
    seedSystemPromptDrafts();
    setSystemPromptMode('thread');
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    setSystemPromptOpen(true);
  }

  const loadAssistantSnapshot = React.useCallback(
    async (preferredThreadId?: string | null) => {
      const requestedThreadId = preferredThreadId ?? null;
      const query = requestedThreadId ? `?activeThreadId=${encodeURIComponent(requestedThreadId)}` : '';
      const snapshot = await client.request<AssistantSnapshot>(`/api/assistant/threads${query}`);
      if (requestedThreadId && activeThreadIdRef.current && activeThreadIdRef.current !== requestedThreadId) {
        return snapshot;
      }
      setAssistantSnapshotData(snapshot);
      const nextThreadId = snapshot.activeThreadId ?? snapshot.threads[0]?.id ?? null;
      if (!activeThreadIdRef.current && nextThreadId) selectActiveThread(nextThreadId);
      const visibleThreadId = requestedThreadId ?? activeThreadIdRef.current ?? nextThreadId;
      const visibleThread = snapshot.threads.find((thread) => thread.id === visibleThreadId) ?? snapshot.threads[0] ?? null;
      if (visibleThread) setMessages(visibleThread.messages);
      return snapshot;
    },
    [client, selectActiveThread],
  );

  const loadAssistantExtensions = React.useCallback(async () => {
    try {
      const data = await client.request<AssistantExtensionsResponse>('/api/assistant/extensions');
      setAssistantExtensions(data);
      return data;
    } catch {
      setAssistantExtensions(null);
      return null;
    }
  }, [client]);

  const loadDashboard = React.useCallback(async (options: { includeAssistant?: boolean } = {}) => {
    setError(null);
    try {
      const data = await client.request<DashboardData>('/api/dashboard');
      setDashboard(data);
      if (options.includeAssistant !== false) {
        await Promise.all([loadAssistantSnapshot(activeThreadId), loadAssistantExtensions()]);
      }
      if (!settingsHydratedRef.current || !approvalSettingsDirtyRef.current) hydrateApprovalSettings(data.settings);
      if (!activeThreadIdRef.current && data.threads[0]) selectActiveThread(data.threads[0].id);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [activeThreadId, client, hydrateApprovalSettings, loadAssistantExtensions, loadAssistantSnapshot, selectActiveThread]);

  const loadAndroidApkInfo = React.useCallback(async () => {
    try {
      const data = await client.request<{ ok: true; android: AndroidApkInfo }>('/api/mobile/android');
      setAndroidApkInfo(data.android);
    } catch {
      setAndroidApkInfo(null);
    }
  }, [client]);

  const loadDesktopAppInfo = React.useCallback(async () => {
    try {
      const data = await client.request<{ ok: true; desktop: DesktopAppInfo }>('/api/desktop');
      setDesktopAppInfo(data.desktop);
    } catch {
      setDesktopAppInfo(null);
    }
  }, [client]);

  const loadVoiceRecordings = React.useCallback(async () => {
    setVoiceRecordingsLoading(true);
    setVoiceRecordingsError(null);
    try {
      const data = await client.request<{ ok: true; retentionPerMode: number; recordings: VoiceRecordingRecord[] }>('/api/voice/recordings');
      setVoiceRecordings(data.recordings);
    } catch (err: any) {
      setVoiceRecordingsError(err?.message ?? String(err));
    } finally {
      setVoiceRecordingsLoading(false);
    }
  }, [client]);

  const refreshAndroidSetup = React.useCallback(async () => {
    try {
      const data = await client.request<{ ok: true; android: AndroidApkInfo; setup: AndroidSetupInfo }>('/api/mobile/android/setup', {
        method: 'POST',
        body: '{}',
      });
      setAndroidApkInfo(data.android);
      setAndroidSetupInfo(data.setup);
      setAndroidSetupQr(await QRCode.toDataURL(data.setup.setupUrl, { margin: 1, width: 180 }));
    } catch {
      setAndroidSetupInfo(null);
      setAndroidSetupQr('');
    }
  }, [client]);

  const scheduleAssistantEventRefresh = React.useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    if (assistantEventRefreshTimerRef.current !== null) window.clearTimeout(assistantEventRefreshTimerRef.current);
    assistantEventRefreshTimerRef.current = window.setTimeout(() => {
      assistantEventRefreshTimerRef.current = null;
      void Promise.all([loadAssistantSnapshot(activeThreadId), loadAssistantExtensions()]);
    }, 160);
  }, [activeThreadId, loadAssistantExtensions, loadAssistantSnapshot]);

  const scheduleArtifactsEventRefresh = React.useCallback((threadId?: string | null) => {
    const targetThreadId = threadId ?? activeThreadIdRef.current;
    if (document.visibilityState === 'hidden' || !targetThreadId) return;
    if (artifactsEventRefreshTimerRef.current !== null) window.clearTimeout(artifactsEventRefreshTimerRef.current);
    artifactsEventRefreshTimerRef.current = window.setTimeout(() => {
      artifactsEventRefreshTimerRef.current = null;
      if (activeThreadIdRef.current !== targetThreadId) return;
      void loadArtifacts(targetThreadId);
    }, 160);
  }, [loadArtifacts]);

  const scheduleDashboardEventRefresh = React.useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    if (dashboardEventRefreshTimerRef.current !== null) window.clearTimeout(dashboardEventRefreshTimerRef.current);
    dashboardEventRefreshTimerRef.current = window.setTimeout(() => {
      dashboardEventRefreshTimerRef.current = null;
      void loadDashboard({ includeAssistant: false });
    }, 160);
  }, [loadDashboard]);

  const scheduleReleaseEventRefresh = React.useCallback(
    (platform?: 'android' | 'desktop') => {
      if (document.visibilityState === 'hidden') return;
      if (releaseEventRefreshTimerRef.current !== null) window.clearTimeout(releaseEventRefreshTimerRef.current);
      releaseEventRefreshTimerRef.current = window.setTimeout(() => {
        releaseEventRefreshTimerRef.current = null;
        if (!platform || platform === 'android') void loadAndroidApkInfo();
        if (!platform || platform === 'desktop') void loadDesktopAppInfo();
      }, 160);
    },
    [loadAndroidApkInfo, loadDesktopAppInfo],
  );

  React.useEffect(() => {
    scheduleAssistantEventRefreshRef.current = scheduleAssistantEventRefresh;
    scheduleArtifactsEventRefreshRef.current = scheduleArtifactsEventRefresh;
    scheduleDashboardEventRefreshRef.current = scheduleDashboardEventRefresh;
    scheduleReleaseEventRefreshRef.current = scheduleReleaseEventRefresh;
  }, [scheduleArtifactsEventRefresh, scheduleAssistantEventRefresh, scheduleDashboardEventRefresh, scheduleReleaseEventRefresh]);

  const loadMessages = React.useCallback(
    async (threadId: string | null) => {
      if (!threadId) {
        setMessages([]);
        return;
      }
      try {
        const data = await client.request<{ ok: true; messages: AssistantMessage[] }>(
          `/api/assistant/threads/${encodeURIComponent(threadId)}/messages`,
        );
        if (activeThreadIdRef.current && activeThreadIdRef.current !== threadId) return;
        setMessages(data.messages);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    },
    [client],
  );

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  React.useEffect(() => {
    void loadAndroidApkInfo();
  }, [loadAndroidApkInfo]);

  React.useEffect(() => {
    void loadDesktopAppInfo();
  }, [loadDesktopAppInfo]);

  React.useEffect(() => {
    if (activeView === 'settings' && settingsPane === 'recordings') void loadVoiceRecordings();
  }, [activeView, settingsPane, loadVoiceRecordings]);

  React.useEffect(() => {
    void refreshAndroidSetup();
  }, [refreshAndroidSetup]);

  React.useEffect(() => {
    void loadMessages(activeThread?.id ?? null);
  }, [activeThread?.id, loadMessages]);

  React.useEffect(() => {
    void loadArtifacts(activeThread?.id ?? null);
  }, [activeThread?.id]);

  React.useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let retryTimer: number | null = null;

    const handleAppEvent = (event: AppEvent) => {
      if (event.type === 'assistant_changed') {
        scheduleAssistantEventRefreshRef.current();
        if (!event.threadId || event.threadId === activeThreadIdRef.current) {
          scheduleArtifactsEventRefreshRef.current(event.threadId);
        }
        return;
      }
      if (event.type === 'release_changed') {
        scheduleReleaseEventRefreshRef.current(event.platform);
        scheduleDashboardEventRefreshRef.current();
        return;
      }
      scheduleDashboardEventRefreshRef.current();
      if (event.type === 'device_changed' || event.type === 'device_connected' || event.type === 'device_disconnected') {
        scheduleAssistantEventRefreshRef.current();
      }
    };

    const waitForRetry = () =>
      new Promise<void>((resolve) => {
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          resolve();
        }, 2000);
      });

    const connect = async () => {
      while (!stopped) {
        try {
          const response = await client.stream('/api/events', { signal: controller.signal });
          if (!response.ok) throw new Error(`SSE stream failed: ${response.status} ${response.statusText}`);
          appEventsConnectedRef.current = true;
          scheduleDashboardEventRefreshRef.current();
          await readSseStream(response, (message) => {
            if (message.event === 'connected') {
              appEventsConnectedRef.current = true;
              scheduleDashboardEventRefreshRef.current();
              return;
            }
            if (message.event !== 'app_event') return;
            handleAppEvent(message.data as AppEvent);
          });
        } catch {
          if (stopped || controller.signal.aborted) return;
        }
        appEventsConnectedRef.current = false;
        await waitForRetry();
      }
    };

    void connect();
    return () => {
      stopped = true;
      appEventsConnectedRef.current = false;
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (assistantEventRefreshTimerRef.current !== null) {
        window.clearTimeout(assistantEventRefreshTimerRef.current);
        assistantEventRefreshTimerRef.current = null;
      }
      if (artifactsEventRefreshTimerRef.current !== null) {
        window.clearTimeout(artifactsEventRefreshTimerRef.current);
        artifactsEventRefreshTimerRef.current = null;
      }
      if (dashboardEventRefreshTimerRef.current !== null) {
        window.clearTimeout(dashboardEventRefreshTimerRef.current);
        dashboardEventRefreshTimerRef.current = null;
      }
      if (releaseEventRefreshTimerRef.current !== null) {
        window.clearTimeout(releaseEventRefreshTimerRef.current);
        releaseEventRefreshTimerRef.current = null;
      }
    };
  }, [client]);

  React.useEffect(() => {
    const refresh = (force = false) => {
      if (document.visibilityState === 'hidden') return;
      if (appEventsConnectedRef.current && !force) return;
      void loadDashboard();
    };
    const timer = window.setInterval(() => refresh(false), 8000);
    const focusRefresh = () => refresh(true);
    window.addEventListener('focus', focusRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focusRefresh);
    };
  }, [loadDashboard]);

  React.useEffect(() => {
    if (typeof window.EventSource === 'undefined') return undefined;
    let closed = false;
    const source = new window.EventSource('/api/speech/events');
    source.addEventListener('connected', () => {
      if (!closed) scheduleAssistantEventRefresh();
    });
    source.addEventListener('speech_audio', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const audioBase64 = String(data?.audioBase64 ?? '').trim();
        const contentType = String(data?.contentType ?? 'audio/wav').trim() || 'audio/wav';
        if (audioBase64) queueSpeechAudio(audioBase64, contentType);
        scheduleAssistantEventRefresh();
      } catch {
        // Ignore malformed speech events.
      }
    });
    source.onerror = () => {
      if (closed) return;
      scheduleAssistantEventRefresh();
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [scheduleAssistantEventRefresh]);

  React.useEffect(() => {
    const threadId = activeThread?.id ?? null;
    if (!threadId) return undefined;
    const refresh = (force = false) => {
      if (document.visibilityState === 'hidden') return;
      if (appEventsConnectedRef.current && !force) return;
      void loadMessages(threadId);
    };
    const timer = window.setInterval(() => refresh(false), 8000);
    const focusRefresh = () => refresh(true);
    window.addEventListener('focus', focusRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focusRefresh);
    };
  }, [activeThread?.id, loadMessages]);

  React.useEffect(() => {
    messageScrollSignatureRef.current = '';
    scrollMessagesToBottom({ force: true });
  }, [activeThread?.id, scrollMessagesToBottom]);

  React.useEffect(() => {
    if (assistantFilesOpen) return;
    scrollMessagesToBottom();
  }, [assistantFilesOpen, scrollMessagesToBottom]);

  React.useEffect(() => {
    const thread = activeThread as AssistantThreadView | null;
    const pendingApprovalsForThread = (assistantSnapshotData?.pendingApprovals ?? []).filter(
      (approval) => approval.threadId === activeThread?.id && approval.status === 'pending',
    );
    const signature = [
      activeThread?.id ?? '',
      activeThread?.status ?? '',
      messages
        .map((message) =>
          [
            message.id,
            message.role,
            message.content?.length ?? 0,
            message.content ? message.content.slice(-80) : '',
            message.contentJson?.length ?? 0,
            message.contentJson ? message.contentJson.slice(-80) : '',
            message.toolName ?? '',
            message.toolCallId ?? '',
            message.isError ? '1' : '0',
          ].join(':'),
        )
        .join('|'),
      streamingReply.length,
      streamingReply.slice(-80),
      streamingThinking.length,
      streamingThinking.slice(-80),
      (thread?.runs ?? []).map((run) => [run.id, run.status, run.startedAt, run.completedAt ?? '', run.cancelledAt ?? ''].join(':')).join('|'),
      (thread?.queuedPrompts ?? []).map((prompt) => [prompt.id, prompt.createdAt, prompt.prompt?.length ?? 0].join(':')).join('|'),
      pendingApprovalsForThread.map((approval) => [approval.id, approval.toolName, approval.createdAt].join(':')).join('|'),
    ].join('\u0001');
    if (signature === messageScrollSignatureRef.current) return;
    messageScrollSignatureRef.current = signature;
    scrollMessagesToBottom();
  }, [activeThread, assistantSnapshotData?.pendingApprovals, messages, scrollMessagesToBottom, streamingReply, streamingThinking]);

  async function createThread() {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; thread: AssistantThread; snapshot: AssistantSnapshot }>('/api/assistant/threads', {
        method: 'POST',
        body: JSON.stringify({
          title: 'New thread',
          source: 'voice',
          voiceEnabled: true,
        }),
      });
      selectActiveThread(data.thread.id);
      setAssistantSnapshotData(data.snapshot);
      const createdThread = data.snapshot.threads.find((thread) => thread.id === data.thread.id) as AssistantThreadView | undefined;
      setMessages(createdThread?.messages ?? []);
      await loadDashboard({ includeAssistant: false });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const content = messageDraft.trim();
    const submittedDraft = messageDraft;
    const targetThread = activeThread as AssistantThreadView | null;
    if (!targetThread || !content) return;
    const targetThreadId = targetThread.id;
    if (promptSubmittingThreadIdsRef.current[targetThreadId]) return;
    const ownsStreamingState = !streamingRequestThreadIdsRef.current[targetThreadId];
    if (ownsStreamingState) {
      streamingRequestThreadIdsRef.current = { ...streamingRequestThreadIdsRef.current, [targetThreadId]: true };
    }
    let promptSubmitReleased = false;
    const releasePromptSubmit = () => {
      if (promptSubmitReleased) return;
      promptSubmitReleased = true;
      setPromptSubmitting(targetThreadId, false);
    };
    setPromptSubmitting(targetThreadId, true);
    setError(null);
    if (ownsStreamingState) clearThreadStreaming(targetThreadId);
    scrollMessagesToBottom({ force: true });
    try {
      const response = await client.stream(
        `/api/assistant/threads/${encodeURIComponent(targetThreadId)}/stream`,
        {
          method: 'POST',
          body: JSON.stringify({ prompt: content }),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        let data: any = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { error: text };
        }
        throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
      }
      if (activeThreadIdRef.current === targetThreadId && messageDraftRef.current === submittedDraft) {
        messageDraftRef.current = '';
        setMessageDraft('');
      }
      scrollMessagesToBottom({ force: true });
      await readAssistantEventStream(response, (promptEvent) => {
        if (promptEvent.type === 'delta') {
          if (ownsStreamingState) appendThreadStreaming(targetThreadId, { reply: String(promptEvent.delta ?? '') });
          return;
        }
        if (promptEvent.type === 'thinking_delta') {
          if (ownsStreamingState) appendThreadStreaming(targetThreadId, { thinking: String(promptEvent.delta ?? '') });
          return;
        }
        if (promptEvent.type === 'message' && promptEvent.message) {
          if (activeThreadIdRef.current === targetThreadId) {
            setMessages((current) => upsertMessage(current, promptEvent.message as AssistantMessage));
          }
          return;
        }
        if (promptEvent.type === 'tool_call' || promptEvent.type === 'tool_result') {
          if (activeThreadIdRef.current === targetThreadId) void loadMessages(targetThreadId);
          return;
        }
        if ((promptEvent.type === 'snapshot' || promptEvent.type === 'approval_pending' || promptEvent.type === 'queued' || promptEvent.type === 'done') && promptEvent.snapshot) {
          releasePromptSubmit();
          const snapshot = promptEvent.snapshot as AssistantSnapshot;
          setAssistantSnapshotData(snapshot);
          const visibleThread = snapshot.threads.find((thread) => thread.id === targetThreadId);
          if (visibleThread && activeThreadIdRef.current === targetThreadId) setMessages(visibleThread.messages);
          if (promptEvent.type === 'done' && ownsStreamingState) clearThreadStreaming(targetThreadId);
          return;
        }
        if (promptEvent.type === 'error') {
          releasePromptSubmit();
          throw new Error(String(promptEvent.error ?? 'Assistant stream failed'));
        }
      });
      await Promise.all([loadAssistantSnapshot(targetThreadId), loadDashboard()]);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      releasePromptSubmit();
      if (ownsStreamingState) clearThreadStreaming(targetThreadId);
      if (ownsStreamingState) {
        const next = { ...streamingRequestThreadIdsRef.current };
        delete next[targetThreadId];
        streamingRequestThreadIdsRef.current = next;
      }
    }
  }

  async function updateThreadSettings(patch: Partial<AssistantThread>) {
    if (!activeThread) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await client.request<{ ok: true; thread: AssistantThread; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function startCodexConnect() {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; state: string; authorizationUrl: string; redirectUri: string; expiresAt: string }>(
        '/api/assistant/codex/connect',
        { method: 'POST', body: '{}' },
      );
      setCodexConnectFlow(data);
      setCodexCodeDraft('');
      window.open(data.authorizationUrl, '_blank', 'noopener,noreferrer');
      setNotice('Opened Codex sign-in. Paste the final redirect URL or code here when it completes.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function completeCodexConnect() {
    if (!codexConnectFlow || !codexCodeDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        '/api/assistant/codex/complete',
        {
          method: 'POST',
          body: JSON.stringify({ state: codexConnectFlow.state, codeOrUrl: codexCodeDraft }),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      setCodexConnectFlow(null);
      setCodexCodeDraft('');
      setNotice('Connected Codex.');
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectCodex() {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        '/api/assistant/codex/connection',
        { method: 'DELETE' },
      );
      setAssistantSnapshotData(data.snapshot);
      setCodexConnectFlow(null);
      setCodexCodeDraft('');
      setNotice('Disconnected Codex.');
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function renameActiveThread() {
    const nextTitle = threadTitleDraft.trim();
    if (!activeThread || !nextTitle || nextTitle === activeThread.title) return;
    await updateThreadSettings({ title: nextTitle });
  }

  async function deleteThread(threadId: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(threadId)}`,
        { method: 'DELETE' },
      );
      setAssistantSnapshotData(data.snapshot);
      const nextThreadId = data.snapshot.activeThreadId ?? data.snapshot.threads[0]?.id ?? null;
      selectActiveThread(nextThreadId);
      const visibleThread = data.snapshot.threads.find((thread) => thread.id === nextThreadId) ?? null;
      setMessages(visibleThread?.messages ?? []);
      setThreadDeleteCandidate(null);
      setNotice('Deleted assistant thread.');
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelQueuedPrompt(queuedPrompt: AssistantQueuedPromptRecord) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(queuedPrompt.threadId)}/queued/${encodeURIComponent(queuedPrompt.id)}`,
        { method: 'DELETE' },
      );
      setAssistantSnapshotData(data.snapshot);
      setNotice('Cancelled queued prompt.');
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolveApproval(approvalId: string, approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/approvals/${encodeURIComponent(approvalId)}/${approved ? 'approve' : 'deny'}`,
        { method: 'POST', body: '{}' },
      );
      setAssistantSnapshotData(data.snapshot);
      const visibleThread = data.snapshot.threads.find((thread) => thread.id === activeThread?.id);
      if (visibleThread) setMessages(visibleThread.messages);
      await loadDashboard();
      setNotice(approved ? 'Approved assistant tool call.' : 'Denied assistant tool call.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopActiveRun() {
    if (!activeThread) return;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/stop`,
        { method: 'POST', body: '{}' },
      );
      setAssistantSnapshotData(data.snapshot);
      setNotice('Stopped active assistant run.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadArtifacts(threadId: string | null) {
    if (!threadId) {
      setArtifacts([]);
      hydrateArtifactDraft(null);
      return;
    }
    setArtifactsLoading(true);
    setArtifactsError(null);
    try {
      const data = await client.request<{ ok: true; artifacts: AssistantArtifactRecord[] }>(
        `/api/assistant/threads/${encodeURIComponent(threadId)}/artifacts`,
      );
      setArtifacts(data.artifacts);
      const nextSelected = selectedArtifact
        ? chooseDefaultArtifact(data.artifacts, selectedArtifact.path)
        : isCompactViewport()
          ? null
          : chooseDefaultArtifact(data.artifacts);
      if (!artifactDirty) hydrateArtifactDraft(nextSelected);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      setArtifactsError(message);
      setError(message);
    } finally {
      setArtifactsLoading(false);
    }
  }

  function newArtifactDraft() {
    if (busy) return;
    if (artifactDirty && !window.confirm('Discard unsaved changes and create a new file?')) return;
    hydrateArtifactDraft(null, 'edit');
    setArtifactPathDraft('notes/new-artifact.md');
    setArtifactContentDraft('');
    setArtifactDirty(true);
  }

  function cancelArtifactEdit() {
    if (selectedArtifact) {
      hydrateArtifactDraft(selectedArtifact, 'view');
      return;
    }
    const fallback = chooseDefaultArtifact(artifacts);
    if (fallback) {
      hydrateArtifactDraft(fallback, 'view');
      return;
    }
    hydrateArtifactDraft(null, 'view');
    setArtifactPathDraft('');
    setArtifactContentDraft('');
  }

  function closeArtifactFile() {
    if (busy) return;
    if (artifactDirty && !window.confirm('Discard unsaved changes and return to files?')) return;
    hydrateArtifactDraft(null, 'view');
    setArtifactPathDraft('');
    setArtifactContentDraft('');
  }

  async function saveArtifact() {
    if (!activeThread) return;
    const artifactPath = artifactPathDraft.trim();
    if (!artifactPath) {
      setError('Artifact path is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{
        ok: true;
        artifact: AssistantArtifactRecord;
        artifacts: AssistantArtifactRecord[];
        snapshot: AssistantSnapshot;
      }>(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}/artifacts/file`, {
        method: 'PUT',
        body: JSON.stringify({ path: artifactPath, content: artifactContentDraft }),
      });
      setArtifacts(data.artifacts);
      setAssistantSnapshotData(data.snapshot);
      hydrateArtifactDraft(data.artifact);
      setNotice('Saved assistant artifact.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteArtifact(artifact: AssistantArtifactRecord | null = artifactDeleteCandidate) {
    if (!activeThread || !artifact) return;
    const artifactPath = artifact.path;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; artifacts: AssistantArtifactRecord[]; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/artifacts/file`,
        {
          method: 'DELETE',
          body: JSON.stringify({ path: artifactPath }),
        },
      );
      setArtifacts(data.artifacts);
      setAssistantSnapshotData(data.snapshot);
      hydrateArtifactDraft(chooseDefaultArtifact(data.artifacts));
      setArtifactDeleteCandidate(null);
      setNotice('Deleted assistant artifact.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyArtifact() {
    await navigator.clipboard?.writeText(artifactContentDraft);
    setNotice('Copied artifact content.');
  }

  function downloadArtifact() {
    const artifactPath = artifactPathDraft.trim() || 'assistant-artifact.txt';
    const blob = new Blob([artifactContentDraft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = artifactPath.split('/').filter(Boolean).pop() || 'assistant-artifact.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveApprovalSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; settings: VoiceSettings }>('/api/settings/voice-approval', {
        method: 'POST',
        body: JSON.stringify({ settings: approvalSettings }),
      });
      hydrateApprovalSettings(data.settings);
      await loadDashboard();
      setNotice('Saved voice approval settings.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateSpeechPlaybackTarget(target: SpeechPlaybackTarget) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; settings: VoiceSettings; speechPlayback: DashboardData['speechPlayback'] }>(
        '/api/settings/speech-playback',
        {
          method: 'PATCH',
          body: JSON.stringify({ target }),
        },
      );
      setDashboard((current) => current
        ? { ...current, settings: data.settings, speechPlayback: data.speechPlayback }
        : current);
      setNotice('Saved speech playback target.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateAssistantSettings(
    patch: Partial<NonNullable<AssistantSnapshot['assistantSettings']>>,
    options: { clearPromptDirty?: AssistantSettingsPromptField[] } = {},
  ) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; settings: AssistantSnapshot['assistantSettings']; snapshot: AssistantSnapshot }>(
        '/api/assistant/settings',
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      for (const field of options.clearPromptDirty ?? []) {
        assistantSettingsPromptDirtyRef.current[field] = false;
      }
      setAssistantSnapshotData(data.snapshot);
      setNotice('Saved assistant settings.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  function updateAssistantProfileDraft(profileId: string, patch: Partial<AssistantProfileDraft>) {
    setAssistantProfileDrafts((current) => ({
      ...current,
      [profileId]: {
        ...(current[profileId] ?? { name: '', wakePhrase: '', wakePhraseAliases: [], ttsVoice: '', enabled: true, systemPrompt: '', enabledTools: null }),
        ...patch,
      },
    }));
  }

  async function saveAssistantProfile(profile: AssistantProfile) {
    const draft = assistantProfileDrafts[profile.id] ?? profileDraftFromAssistantProfile(profile);
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; profile: AssistantProfile; profiles: AssistantProfile[]; snapshot: AssistantSnapshot }>(
        `/api/assistant/profiles/${encodeURIComponent(profile.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(assistantProfilePayloadFromDraft(draft)),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      setAssistantProfileDrafts((current) => ({ ...current, [data.profile.id]: profileDraftFromAssistantProfile(data.profile) }));
      setNotice('Saved assistant profile.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createAssistantProfile() {
    const existingCount = assistantSnapshotData?.assistantProfiles.length ?? 0;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; profile: AssistantProfile; profiles: AssistantProfile[]; snapshot: AssistantSnapshot }>('/api/assistant/profiles', {
        method: 'POST',
        body: JSON.stringify({
          name: `Assistant ${existingCount + 1}`,
          wakePhrase: `hey assistant ${existingCount + 1}`,
          wakePhraseAliases: [],
          ttsVoice: 'austin',
          enabled: true,
        }),
      });
      setAssistantSnapshotData(data.snapshot);
      setAssistantProfileDrafts((current) => ({ ...current, [data.profile.id]: profileDraftFromAssistantProfile(data.profile) }));
      setSelectedAssistantProfileId(data.profile.id);
      setNotice('Created assistant profile.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveAssistantApiKey(provider: AssistantApiKeyProvider) {
    const apiKey = apiKeyDrafts[provider].trim();
    if (!apiKey) {
      setError('API key is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(`/api/assistant/keys/${provider}`, {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });
      setAssistantSnapshotData(data.snapshot);
      setApiKeyDrafts((current) => ({ ...current, [provider]: '' }));
      setNotice(`Saved ${provider === 'openai' ? 'OpenAI' : 'Exa'} key.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAssistantApiKey(provider: AssistantApiKeyProvider) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; snapshot: AssistantSnapshot }>(`/api/assistant/keys/${provider}`, { method: 'DELETE' });
      setAssistantSnapshotData(data.snapshot);
      setNotice(`Deleted ${provider === 'openai' ? 'OpenAI' : 'Exa'} key.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyAssistantApiKey(provider: AssistantApiKeyProvider) {
    const label = provider === 'openai' ? 'OpenAI' : 'Exa';
    const draftKey = apiKeyDrafts[provider].trim();
    setApiKeyCopying((current) => ({ ...current, [provider]: true }));
    setError(null);
    try {
      let apiKey = draftKey;
      if (!apiKey) {
        const data = await client.request<{ ok: true; apiKey: string }>(`/api/assistant/keys/${encodeURIComponent(provider)}/reveal`);
        apiKey = data.apiKey;
      }
      if (!await copyText(apiKey)) {
        throw new Error('Clipboard access is not available.');
      }
      setNotice(`Copied ${label} key.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setApiKeyCopying((current) => ({ ...current, [provider]: false }));
    }
  }

  async function saveAssistantSkill() {
    if (!skillDraft.name.trim()) {
      setError('Skill name is required.');
      return;
    }
    if (!skillDraft.description.trim()) {
      setError('Skill description is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = skillDraft.id
        ? `/api/assistant/skills/${encodeURIComponent(skillDraft.id)}`
        : '/api/assistant/skills';
      const data = await client.request<{ ok: true; skill: AssistantSkillRecord; snapshot: AssistantSnapshot }>(path, {
        method: skillDraft.id ? 'PATCH' : 'POST',
        body: JSON.stringify(skillPayloadFromDraft(skillDraft)),
      });
      setAssistantSnapshotData(data.snapshot);
      setSkillDraft(draftFromAssistantSkill(data.skill));
      setNotice(skillDraft.id ? 'Saved skill.' : 'Created skill.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAssistantSkill() {
    if (!skillDraft.id) return;
    if (!window.confirm(`Delete "${skillDraft.name || 'this skill'}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; deleted: boolean; snapshot: AssistantSnapshot }>(
        `/api/assistant/skills/${encodeURIComponent(skillDraft.id)}`,
        { method: 'DELETE' },
      );
      setAssistantSnapshotData(data.snapshot);
      setSkillDraft(emptySkillDraft());
      setNotice('Deleted skill.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateExtensionToolRoute(
    toolName: string,
    route: Pick<AssistantExtensionToolRoute, 'enabled' | 'targetKind' | 'targetDeviceId'>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; route: AssistantExtensionToolRoute; snapshot: AssistantSnapshot }>(
        `/api/assistant/extensions/tools/${encodeURIComponent(toolName)}/route`,
        {
          method: 'PATCH',
          body: JSON.stringify(route),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      setAssistantExtensions((current) => current
        ? { ...current, routes: [...current.routes.filter((item) => item.toolName !== data.route.toolName), data.route] }
        : current);
      await loadAssistantExtensions();
      setNotice('Updated extension route.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveGlobalSystemPrompt() {
    const prompt = voiceSystemPromptDraft;
    if (!prompt.trim()) {
      setSystemPromptError('System prompt is required.');
      return;
    }
    setSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await client.request<{ ok: true; settings: AssistantSnapshot['assistantSettings']; snapshot: AssistantSnapshot }>(
        '/api/assistant/settings',
        { method: 'PATCH', body: JSON.stringify({ voiceSystemPrompt: prompt }) },
      );
      setAssistantSnapshotData(data.snapshot);
      setVoiceSystemPromptDraft(data.snapshot.assistantSettings.voiceSystemPrompt);
      setSystemPromptNotice('Saved default prompt.');
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setSystemPromptSaving(false);
    }
  }

  async function saveThreadSystemPrompt() {
    if (!activeThread) return;
    setSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await client.request<{ ok: true; thread: AssistantThread; snapshot: AssistantSnapshot }>(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}`,
        { method: 'PATCH', body: JSON.stringify({ systemPrompt: threadSystemPromptDraft.trim() }) },
      );
      setAssistantSnapshotData(data.snapshot);
      setThreadSystemPromptDraft(data.thread.systemPrompt ?? '');
      setSystemPromptNotice(data.thread.systemPrompt ? 'Saved thread prompt override.' : 'Thread now uses the default prompt.');
      await loadDashboard();
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setSystemPromptSaving(false);
    }
  }

  async function promoteThreadSystemPrompt() {
    const prompt = threadSystemPromptDraft.trim();
    if (!prompt) return;
    setPromoteSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await client.request<{ ok: true; settings: AssistantSnapshot['assistantSettings']; snapshot: AssistantSnapshot }>(
        '/api/assistant/settings',
        {
          method: 'PATCH',
          body: JSON.stringify({ voiceSystemPrompt: prompt }),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      setVoiceSystemPromptDraft(data.snapshot.assistantSettings.voiceSystemPrompt);
      setSystemPromptNotice('Saved thread prompt as the default.');
    } catch (err: any) {
      setSystemPromptError(err?.message ?? String(err));
    } finally {
      setPromoteSystemPromptSaving(false);
    }
  }

  async function pairDevice(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{
        ok: true;
        device: DeviceRecord;
        token: string;
        payloadUri: string;
        expiresAt: string;
      }>('/api/pairing/payload', {
        method: 'POST',
        body: JSON.stringify({ deviceType, displayName: deviceName }),
      });
      setPairingText(data.payloadUri);
      setPairingExpiresAt(data.expiresAt);
      setPairingDeviceId(data.device.id);
      setPairingQr(await QRCode.toDataURL(data.payloadUri, { margin: 1, width: 220 }));
      await navigator.clipboard?.writeText(data.payloadUri).catch(() => undefined);
      await loadDashboard();
      setNotice(`Created ${data.device.displayName}. Pairing payload copied when clipboard access was available.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyPairingPayload() {
    if (!pairingText) return;
    await navigator.clipboard?.writeText(pairingText);
    setNotice('Copied pairing payload.');
  }

  async function sharePairingPayload() {
    if (!pairingText) return;
    if (navigator.share) {
      await navigator.share({
        title: 'VoiceStream pairing',
        text: 'Scan or open this VoiceStream pairing payload.',
        url: pairingText,
      });
      setNotice('Shared pairing payload.');
      return;
    }
    await copyPairingPayload();
  }

  async function revokeDevice(deviceId: string) {
    setBusy(true);
    setError(null);
    try {
      await client.request(`/api/devices/${encodeURIComponent(deviceId)}/revoke`, { method: 'POST', body: '{}' });
      if (pairingDeviceId === deviceId) {
        setPairingText('');
        setPairingQr('');
        setPairingExpiresAt(null);
        setPairingDeviceId(null);
      }
      await loadDashboard();
      setNotice('Device revoked.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rotateDeviceToken(deviceId: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{
        ok: true;
        device: DeviceRecord;
        payloadUri?: string;
        expiresAt?: string;
      }>(`/api/devices/${encodeURIComponent(deviceId)}/rotate-token`, {
        method: 'POST',
        body: JSON.stringify({ includePayload: true }),
      });
      if (data.payloadUri) {
        setPairingText(data.payloadUri);
        setPairingExpiresAt(data.expiresAt ?? null);
        setPairingDeviceId(data.device.id);
        setPairingQr(await QRCode.toDataURL(data.payloadUri, { margin: 1, width: 220 }));
        await navigator.clipboard?.writeText(data.payloadUri).catch(() => undefined);
      }
      await loadDashboard();
      setNotice(`Rotated token for ${data.device.displayName}.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function renameDevice(deviceId: string, draftName: string) {
    const displayName = draftName.trim();
    if (!displayName) {
      setError('Device name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; device: DeviceRecord }>(
        `/api/devices/${encodeURIComponent(deviceId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ displayName }),
        },
      );
      setDeviceNameEditor(null);
      await loadDashboard();
      setNotice(`Renamed device to ${data.device.displayName}.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendDeviceCommand(deviceId: string, command: 'sleep' | 'off' | 'awake' | 'query_status') {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; delivered: boolean; ack?: { status?: string; mode?: string } }>(
        `/api/devices/${encodeURIComponent(deviceId)}/command`,
        {
          method: 'POST',
          body: JSON.stringify({ command }),
        },
      );
      const detail = data.ack?.status ? ` ${data.ack.status}` : '';
      setNotice(data.delivered ? `Sent ${command}.${detail}` : `Device is offline; ${command} was not delivered.`);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyLogs() {
    const text = (dashboard?.logs ?? [])
      .map((log) => `[${log.createdAt}] ${log.level.toUpperCase()} ${log.source}: ${log.message}${log.detailsJson ? ` ${log.detailsJson}` : ''}`)
      .join('\n');
    await navigator.clipboard?.writeText(text);
    setNotice('Copied visible logs.');
  }

  async function parseUploadResponse<T>(response: Response, path: string): Promise<T> {
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Expected JSON from ${path}`);
    }
    if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
    return data as T;
  }

  async function parseReleaseMetadataFile(file: File): Promise<Record<string, unknown>> {
    let metadata: any = null;
    try {
      metadata = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} must be valid JSON.`);
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error(`${file.name} must be a JSON object.`);
    }
    return metadata;
  }

  function normalizeReleaseMetadata(raw: Record<string, unknown>, platform: 'android' | 'desktop'): Record<string, unknown> | null {
    if (String(raw.platform ?? '').trim().toLowerCase() === platform) return raw;
    if (platform !== 'android') return null;

    const elements = Array.isArray(raw.elements) ? raw.elements : [];
    const firstElement = elements.find((entry) => entry && typeof entry === 'object') as Record<string, unknown> | undefined;
    const versionCode = Number(firstElement?.versionCode);
    const versionName = String(firstElement?.versionName ?? '').trim();
    const variant = String(raw.variantName ?? '').trim();
    const outputFile = String(firstElement?.outputFile ?? '').trim();
    if (!Number.isInteger(versionCode) || versionCode <= 0 || !versionName || !variant) return null;

    return {
      app: 'voice-stream-next',
      platform: 'android',
      variant,
      versionCode,
      versionName,
      fileName: outputFile || 'voice-stream-next-android-latest.apk',
      variantFileName: outputFile || undefined,
      builtAt: new Date().toISOString(),
    };
  }

  async function releaseFiles(files: File[], platform: 'android' | 'desktop'): Promise<{ artifact: File | null; metadata: Record<string, unknown> | null }> {
    const metadataCandidates = [
      ...files.filter((file) => /^latest\.json$/i.test(file.name)),
      ...files.filter((file) => /\.json$/i.test(file.name) && !/^latest\.json$/i.test(file.name)),
    ];
    let metadata: Record<string, unknown> | null = null;
    for (const candidate of metadataCandidates) {
      const parsed = await parseReleaseMetadataFile(candidate);
      const normalized = normalizeReleaseMetadata(parsed, platform);
      if (normalized) {
        metadata = normalized;
        break;
      }
    }
    const artifact = platform === 'android'
      ? files.find((file) => /\.apk$/i.test(file.name)) ?? null
      : files.find((file) => /\.(zip|dmg|exe|appimage|tar\.gz|tgz)$/i.test(file.name)) ?? null;
    return { artifact, metadata };
  }

  function fileList(files: FileList | File[] | null | undefined): File[] {
    return Array.from(files ?? []);
  }

  type DroppedEntry = {
    isFile: boolean;
    isDirectory: boolean;
    file?: (success: (file: File) => void, failure?: (error: unknown) => void) => void;
    createReader?: () => {
      readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (error: unknown) => void) => void;
    };
  };

  async function filesFromEntry(entry: DroppedEntry): Promise<File[]> {
    if (entry.isFile && entry.file) {
      return new Promise((resolve, reject) => entry.file?.((file) => resolve([file]), reject));
    }
    if (!entry.isDirectory || !entry.createReader) return [];
    const reader = entry.createReader();
    const entries: DroppedEntry[] = [];
    for (;;) {
      const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      entries.push(...batch);
    }
    const nested = await Promise.all(entries.map((child) => filesFromEntry(child)));
    return nested.flat();
  }

  async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
    const itemEntries = Array.from(dataTransfer.items ?? [])
      .map((item) => {
        const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry;
        return getter ? getter.call(item) : null;
      })
      .filter((entry): entry is DroppedEntry => Boolean(entry));
    if (itemEntries.length === 0) return fileList(dataTransfer.files);
    const nested = await Promise.all(itemEntries.map((entry) => filesFromEntry(entry)));
    return nested.flat();
  }

  function updateCreditGrantDraft(userId: string, patch: Partial<{ amountCredits: string; reason: string }>) {
    setCreditGrantDrafts((current) => ({
      ...current,
      [userId]: {
        amountCredits: current[userId]?.amountCredits ?? '',
        reason: current[userId]?.reason ?? '',
        ...patch,
      },
    }));
  }

  async function grantAdminCredits(userId: string) {
    const draft = creditGrantDrafts[userId] ?? { amountCredits: '', reason: '' };
    const amountCredits = Number(draft.amountCredits);
    if (!Number.isFinite(amountCredits) || amountCredits <= 0) {
      setError('Enter a positive credit amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; users: DashboardData['adminUsers'] }>(
        `/api/admin/users/${encodeURIComponent(userId)}/credits/grants`,
        {
          method: 'POST',
          body: JSON.stringify({
            amountCredits,
            reason: draft.reason,
          }),
        },
      );
      setDashboard((current) => current ? { ...current, adminUsers: data.users } : current);
      setCreditGrantDrafts((current) => ({
        ...current,
        [userId]: { amountCredits: '', reason: '' },
      }));
      setNotice(`Granted ${formatCredits(amountCredits * MICROCREDITS_PER_CREDIT)} credits.`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAndroidReleaseFiles(files: File[]) {
    const { artifact, metadata } = await releaseFiles(files, 'android');
    if (!artifact || !metadata) {
      setError('Drop or choose both the Android APK and latest.json or Gradle output-metadata.json.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setAdminAndroidFile(artifact);
      const path = '/api/admin/releases/android';
      const response = await client.stream(path, {
        method: 'PUT',
        headers: {
          'content-type': artifact.type || 'application/vnd.android.package-archive',
          'x-voice-release-file-name': artifact.name,
          'x-voice-release-metadata': JSON.stringify(metadata),
        },
        body: artifact,
      });
      const data = await parseUploadResponse<{ ok: true; android: AndroidApkInfo }>(response, path);
      setAndroidApkInfo(data.android);
      await refreshAndroidSetup();
      await loadDashboard();
      setNotice('Uploaded Android app release.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadDesktopReleaseFiles(files: File[]) {
    const { artifact, metadata } = await releaseFiles(files, 'desktop');
    if (!artifact || !metadata) {
      setError('Drop or choose both the desktop archive and a latest.json with platform "desktop".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setAdminDesktopFile(artifact);
      const path = '/api/admin/releases/desktop';
      const response = await client.stream(path, {
        method: 'PUT',
        headers: {
          'content-type': artifact.type || 'application/octet-stream',
          'x-voice-release-file-name': artifact.name,
          'x-voice-release-metadata': JSON.stringify(metadata),
        },
        body: artifact,
      });
      const data = await parseUploadResponse<{ ok: true; desktop: DesktopAppInfo }>(response, path);
      setDesktopAppInfo(data.desktop);
      await loadDashboard();
      setNotice('Uploaded desktop app release.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function droppedFiles(event: React.DragEvent<HTMLElement>): Promise<File[]> {
    event.preventDefault();
    return filesFromDrop(event.dataTransfer);
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <CircuitRobotLoader />
      </div>
    );
  }

  if (window.voiceStreamDesktop?.isDesktop) {
    return (
      <main className="desktop-shell">
        <header className="desktop-topbar">
          <div>
            <div className="kicker">Voice Stream</div>
            <h1>Desktop voice</h1>
          </div>
          <div className="identity">{identitySlot}</div>
        </header>

        <ToastStack toasts={toasts} onDismiss={dismissToast} />

        <DesktopVoicePanel client={client} onRefresh={loadDashboard} />
      </main>
    );
  }

  const devices = dashboard?.devices ?? [];
  const threads = assistantThreads;
  const logs = dashboard?.logs ?? [];
  const adminUsers = dashboard?.adminUsers ?? [];
  const assistantRecordings = voiceRecordings.filter((recording) => recording.mode === 'assistant');
  const clipboardRecordings = voiceRecordings.filter((recording) => recording.mode === 'clipboard');
  const speechPlayback = dashboard?.speechPlayback;
  const speechPlaybackTarget = dashboard?.settings.speechPlaybackTarget ?? speechPlayback?.preferredTarget ?? 'auto';
  const pendingApprovals = assistantSnapshotData?.pendingApprovals ?? [];
  const activePendingApprovals = pendingApprovals.filter((approval) => approval.threadId === activeThread?.id && approval.status === 'pending');
  const activeRuns = (activeThread as AssistantThreadView | null)?.runs?.filter((run) => run.status === 'running' || run.status === 'waiting_for_approval') ?? [];
  const queuedPrompts = (activeThread as AssistantThreadView | null)?.queuedPrompts ?? [];
  const activeLoadedSkills = (activeThread as AssistantThreadView | null)?.loadedSkills ?? [];
  const enabledTools = new Set(activeThread?.enabledTools ?? []);
  const enabledToolNames = activeThread?.enabledTools ?? [];
  const availableTools = assistantSnapshotData?.availableTools ?? [];
  const assistantSkills = assistantSnapshotData?.skills ?? [];
  const defaultEnabledTools = new Set(assistantSnapshotData?.assistantSettings.defaultEnabledTools ?? []);
  const defaultEnabledToolNames = assistantSnapshotData?.assistantSettings.defaultEnabledTools ?? [];
  const assistantProfiles = assistantSnapshotData?.assistantProfiles ?? dashboard?.assistantProfiles ?? [];
  const selectedAssistantProfile =
    assistantProfiles.find((profile) => profile.id === selectedAssistantProfileId) ??
    assistantProfiles[0] ??
    null;
  const selectedAssistantProfileDraft = selectedAssistantProfile
    ? assistantProfileDrafts[selectedAssistantProfile.id] ?? profileDraftFromAssistantProfile(selectedAssistantProfile)
    : null;
  const selectedProfileEnabledTools = selectedAssistantProfileDraft?.enabledTools ?? defaultEnabledToolNames;
  const selectedProfileEnabledToolSet = new Set(selectedProfileEnabledTools);
  const enabledAssistantProfileCount = assistantProfiles.filter((profile) => profile.enabled).length;
  const enabledAssistantProfiles = assistantProfiles.filter((profile) => profile.enabled);
  const activeAssistantProfile =
    assistantProfiles.find((profile) => profile.id === activeThread?.assistantProfileId) ??
    enabledAssistantProfiles[0] ??
    null;
  const assistantProfileMenuEntries: UiMenuSelectEntry[] = enabledAssistantProfiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
    detail: profile.wakePhrase,
  }));
  const activeAssistantProfileLabel = activeAssistantProfile?.name ?? 'Assistant profile';
  const activeThreadMessageCount = (activeThread as AssistantThreadView | null)?.messages?.length ?? messages.length;
  const assistantProfileLocked = activeThreadMessageCount > 0;
  const autoApprove = Boolean(activeThread?.autoApprove);
  const codexConnection = assistantSnapshotData?.codexConnection ?? { connected: false, accountId: null, expiresAt: null, updatedAt: null };
  const assistantSettings = assistantSnapshotData?.assistantSettings ?? null;
  const activeProvider = activeThread?.provider ?? 'openai';
  const activeModel = activeThread?.model ?? 'gpt-5.5';
  const activeThinkingLevel = activeThread?.thinkingLevel ?? 'off';
  const defaultProvider = assistantSettings?.defaultProvider ?? 'openai';
  const defaultModel = assistantSettings?.defaultModel ?? 'gpt-5.5';
  const defaultThinkingLevel = assistantSettings?.defaultThinkingLevel ?? 'off';
  const modelOptions = assistantSnapshotData?.models ?? [];
  const providerOptions = ASSISTANT_PROVIDERS.map((provider) => ({
    ...provider,
    models: modelOptions.filter((model) => model.provider === provider.id),
  }));
  const activeProviderModels = providerOptions.find((provider) => provider.id === activeProvider)?.models ?? [];
  const selectedModelKey = activeThread ? modelSelectionKey({ provider: activeProvider, model: activeModel, thinkingLevel: activeThinkingLevel }) : '';
  const displayedModelOptions = activeThread && activeProviderModels.some((model) => modelSelectionKey({ provider: model.provider, model: model.id, thinkingLevel: model.thinkingLevel }) === selectedModelKey)
    ? activeProviderModels
    : activeThread
      ? [
          ...activeProviderModels,
          {
            provider: activeProvider,
            id: activeModel,
            name: activeModel,
            thinkingLevel: activeThinkingLevel,
          },
        ]
      : activeProviderModels;
  const modelMenuEntries: UiMenuSelectEntry[] = displayedModelOptions.map(modelMenuEntry);
  const selectedModelLabel = activeThread
    ? modelSelectionLabel({ provider: activeProvider, model: activeModel, thinkingLevel: activeThinkingLevel }, modelOptions)
    : 'Model';
  const defaultProviderModels = providerOptions.find((provider) => provider.id === defaultProvider)?.models ?? [];
  const selectedDefaultModelKey = assistantSettings ? modelSelectionKey({ provider: defaultProvider, model: defaultModel, thinkingLevel: defaultThinkingLevel }) : '';
  const displayedDefaultModelOptions = assistantSettings && defaultProviderModels.some((model) => modelSelectionKey({ provider: model.provider, model: model.id, thinkingLevel: model.thinkingLevel }) === selectedDefaultModelKey)
    ? defaultProviderModels
    : assistantSettings
      ? [
          ...defaultProviderModels,
          {
            provider: defaultProvider,
            id: defaultModel,
            name: defaultModel,
            thinkingLevel: defaultThinkingLevel,
          },
        ]
      : defaultProviderModels;
  const defaultModelMenuEntries: UiMenuSelectEntry[] = displayedDefaultModelOptions.map(modelMenuEntry);
  const selectedDefaultModelLabel = assistantSettings
    ? modelSelectionLabel({ provider: defaultProvider, model: defaultModel, thinkingLevel: defaultThinkingLevel }, modelOptions)
    : 'Model';
  const providerAuthLabel = activeProvider === 'codex'
    ? codexConnection.connected
      ? `Codex connected${codexConnection.accountId ? ` · ${codexConnection.accountId}` : ''}`
      : 'Codex not connected'
    : 'OpenAI API key';
  const activeProviderMeta = providerOptions.find((provider) => provider.id === activeProvider) ?? providerOptions[0];
  const activeRunningModel = activeRuns[0];
  const streamingMessage: AssistantMessage | null = streamingReply || streamingThinking
    ? {
        id: 'streaming-assistant-message',
        role: 'assistant',
        content: streamingReply,
        contentJson: JSON.stringify([
          ...(streamingThinking ? [{ type: 'thinking', thinking: streamingThinking }] : []),
          ...(streamingReply ? [{ type: 'text', text: streamingReply }] : []),
        ]),
        toolName: null,
        toolCallId: null,
        isError: false,
        spokenText: null,
        createdAt: new Date().toISOString(),
      }
    : null;
  const visibleAssistantMessages = streamingMessage ? [...messages, streamingMessage] : messages;
  const assistantRenderItems = renderItemsFromMessages(visibleAssistantMessages);
  const showThinking = Boolean(activeThread) && activeRuns.length > 0 && activePendingApprovals.length === 0 && !messageText(streamingMessage ?? undefined).trim();
  const activeRunningModelLabel = activeRunningModel
    ? modelSelectionLabel({ provider: activeRunningModel.provider, model: activeRunningModel.model, thinkingLevel: activeRunningModel.thinkingLevel }, modelOptions)
    : '';
  const connectedDeviceIds = new Set((dashboard?.clientStatuses ?? []).map((status) => status.deviceId));
  const navItems: Array<{ id: DashboardView; label: string; count?: number }> = [
    { id: 'threads', label: 'Chat', count: threads.length },
    { id: 'settings', label: 'Settings', count: devices.length },
    ...(dashboard?.user.admin ? [{ id: 'admin' as const, label: 'Admin' }] : []),
  ];
  const settingsPaneEntries: UiMenuSelectEntry[] = SETTINGS_PANES.map((pane) => ({
    value: pane.id,
    title: pane.label,
    label: <span className="font-display text-[10px] font-bold uppercase">{pane.label}</span>,
  }));
  const activeSettingsPaneLabel = SETTINGS_PANES.find((pane) => pane.id === settingsPane)?.label ?? 'Settings';
  const messageDraftRows = Math.min(5, Math.max(1, messageDraft.split('\n').length));
  const closeThreadSidebarOnCompact = () => {
    if (isCompactViewport()) setThreadSidebarOpen(false);
  };

  return (
    <main className="assistant-dock-shell relative flex h-screen min-h-0 overflow-hidden bg-[var(--panel-alt)] text-[var(--fg)] max-[880px]:h-dvh max-[880px]:flex-col">
      <button
        type="button"
        className={cn(
          'hidden border-0 bg-black/20 p-0 shadow-none transition-opacity duration-150 max-[880px]:absolute max-[880px]:inset-0 max-[880px]:z-20 max-[880px]:block',
          threadSidebarOpen ? 'max-[880px]:opacity-100' : 'max-[880px]:pointer-events-none max-[880px]:opacity-0',
        )}
        onClick={() => setThreadSidebarOpen(false)}
        aria-label="Close thread sidebar"
      />
      <aside
        className={cn(
          'relative z-[1] flex min-h-0 w-52 max-w-[46%] shrink-0 flex-col border-r border-[var(--border)] bg-black/[.14] transition-transform duration-150 ease-out max-[880px]:absolute max-[880px]:inset-y-0 max-[880px]:left-0 max-[880px]:z-30 max-[880px]:w-[min(86vw,330px)] max-[880px]:max-w-none max-[880px]:bg-[var(--panel-alt)] max-[880px]:shadow-[18px_0_40px_rgba(0,0,0,.32)]',
          threadSidebarOpen ? 'max-[880px]:translate-x-0' : 'hidden max-[880px]:flex max-[880px]:-translate-x-[calc(100%+1px)] max-[880px]:pointer-events-none',
        )}
        aria-hidden={!threadSidebarOpen}
      >
        <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-2">
          <button
            type="button"
            className={assistantIconButtonClass}
            onClick={() => setThreadSidebarOpen(false)}
            title="Back to assistant chat"
            aria-label="Back to assistant chat"
          >
            <svg viewBox="0 0 24 24" focusable="false" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
              <path d="M4 5h16v10H8l-4 4V5Z" />
            </svg>
          </button>
          <div className="grid min-w-0 gap-px">
            <span className={assistantKickerClass}>Threads</span>
            <small className="text-[10px] leading-tight text-[var(--muted)]">{threads.length} assistant</small>
          </div>
          <button
            type="button"
            className={cn(assistantIconButtonClass, 'ml-auto max-[880px]:hidden')}
            onClick={() => setThreadSidebarOpen(false)}
            title="Hide thread sidebar"
            aria-label="Hide thread sidebar"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
              <path d="M15 18l-6-6 6-6" />
              <path d="M20 4v16" />
            </svg>
          </button>
        </div>

        <div className="grid gap-1.5 border-b border-[var(--border)] p-2">
          <button
            type="button"
            className={assistantPrimaryButtonClass}
            onClick={() => {
              void createThread();
              closeThreadSidebarOnCompact();
            }}
            disabled={busy}
          >
            + New Thread
          </button>
        </div>

        <div className="grid min-h-0 content-start gap-1.5 overflow-auto p-1.5">
          {threads.map((thread) => {
            const active = thread.id === activeThread?.id;
            const messageCount = active ? messages.length : 0;
            const queuedCount = (thread as AssistantThreadView).queuedPrompts?.length ?? 0;
            const loadedSkills = (thread as AssistantThreadView).loadedSkills ?? [];
            return (
              <div
                key={thread.id}
                className="group/thread relative min-h-[58px] w-full"
              >
                <button
                  type="button"
                  className={cn(
                    'grid min-h-[58px] w-full content-center gap-1 rounded border border-transparent bg-transparent py-1.5 pl-2 pr-10 text-left text-[var(--fg-secondary)] transition hover:border-[rgba(136,145,168,.24)] hover:bg-white/[.04] hover:text-[var(--fg)]',
                    active && '!border-[rgba(136,145,168,.24)] !bg-white/[.04] !text-[var(--fg)]',
                  )}
                  onClick={() => {
                    setActiveView('threads');
                    selectActiveThread(thread.id);
                    closeThreadSidebarOnCompact();
                  }}
                >
                  <div className="flex min-w-0 items-center gap-[7px]">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted-dim)]', active && '!bg-[var(--green)] shadow-[0_0_10px_rgba(74,222,128,.22)]')} />
                    <strong className="min-w-0 truncate text-xs font-semibold">{thread.title || 'Untitled thread'}</strong>
                  </div>
                  <small className="min-w-0 truncate text-[10px] leading-tight text-[var(--muted)]">
                    {timeLabel(thread.updatedAt)}
                    {messageCount ? ` · ${messageCount}` : ''}
                    {queuedCount ? ` · ${queuedCount} queued` : ''}
                  </small>
                  {loadedSkills.length > 0 ? (
                    <span className="flex min-w-0 flex-wrap gap-1 pr-1">
                      {loadedSkills.slice(0, 2).map((skill) => (
                        <span key={skill.id} className={assistantSkillBadgeClass} title={`Loaded skill: ${skill.name}`}>
                          <span className="truncate">{skill.name}</span>
                        </span>
                      ))}
                      {loadedSkills.length > 2 ? (
                        <span className={assistantSkillBadgeClass} title={`${loadedSkills.length - 2} more loaded skill(s)`}>
                          +{loadedSkills.length - 2}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded border border-[rgba(248,113,113,.26)] bg-black/[.18] p-0 text-[#fca5a5] opacity-0 shadow-none transition hover:border-[rgba(248,113,113,.46)] hover:bg-[rgba(248,113,113,.10)] hover:text-[#fecaca] focus:opacity-100 focus:outline-none group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 disabled:pointer-events-none disabled:opacity-40 max-[880px]:opacity-100"
                  onClick={() => setThreadDeleteCandidate(thread)}
                  disabled={busy}
                  title={`Delete ${thread.title || 'thread'}`}
                  aria-label={`Delete ${thread.title || 'thread'}`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M6 6l1 15h10l1-15" />
                    <path d="M10 10v7" />
                    <path d="M14 10v7" />
                  </svg>
                </button>
              </div>
            );
          })}
          {threads.length === 0 ? <div className={assistantEmptyClass}>No threads yet.</div> : null}
        </div>

        <div className="grid gap-2 border-t border-[var(--border)] bg-white/[.018] p-2 max-[880px]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] leading-tight text-[var(--muted)]">Connected devices</span>
            <strong className="text-xs text-[var(--fg)]">{connectedDeviceIds.size}/{devices.length}</strong>
          </div>
        </div>
      </aside>

      <section className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="relative z-[2] flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-white/[.025] px-2">
          <button
            type="button"
            className={cn(assistantIconButtonClass, 'h-8 w-8', threadSidebarOpen && assistantIconButtonActiveClass)}
            onClick={() => setThreadSidebarOpen((open) => !open)}
            title={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-label={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-pressed={threadSidebarOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
              <path d="M4 5h16v10H8l-4 4V5Z" />
            </svg>
          </button>
          <div className="grid min-w-[120px] flex-1 gap-px">
            <div className="flex min-w-0 items-center gap-1.5">
              <strong className="min-w-0 truncate text-xs font-semibold leading-tight text-[var(--fg)]">
                {activeView === 'threads'
                  ? activeThread?.title ?? 'Assistant'
                  : activeView === 'settings'
                    ? `Settings / ${SETTINGS_PANES.find((pane) => pane.id === settingsPane)?.label ?? 'General'}`
                    : navItems.find((item) => item.id === activeView)?.label}
              </strong>
              {activeView === 'threads' ? (
                <button
                  type="button"
                  className={cn(
                    'hidden h-5 shrink-0 items-center gap-1 rounded border border-[var(--border-subtle)] bg-white/[.02] px-1.5 font-display text-[10px] font-bold leading-none text-[var(--muted)] shadow-none transition hover:bg-white/[.05] hover:text-[var(--fg-secondary)] disabled:pointer-events-none disabled:opacity-50 max-[620px]:inline-flex',
                    assistantFilesOpen && assistantIconButtonActiveClass,
                  )}
                  onClick={() => setAssistantFilesOpen((open) => !open)}
                  disabled={!activeThread}
                  title={assistantFilesOpen ? 'Hide assistant files' : 'Show assistant files'}
                  aria-label={assistantFilesOpen ? 'Hide assistant files' : 'Show assistant files'}
                  aria-pressed={assistantFilesOpen}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 fill-none stroke-current stroke-2">
                    <path d="M4 6.5h5l1.5 2H20v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                    <path d="M4 6.5v11" />
                  </svg>
                  <span>{artifacts.length > 9 ? '9+' : artifacts.length}</span>
                </button>
              ) : null}
            </div>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-display text-[10px] font-medium uppercase leading-tight text-[var(--muted-dim)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)] shadow-[0_0_12px_rgba(74,222,128,.32)]" />
              {activeView === 'threads' ? (activeThread ? activeThread.status ?? 'idle' : 'no thread') : 'live'}
              {activeView === 'threads' && activeLoadedSkills.length > 0 ? (
                <>
                  {activeLoadedSkills.slice(0, 4).map((skill) => (
                    <span key={skill.id} className={assistantSkillBadgeClass} title={`Loaded skill: ${skill.name}`}>
                      <span className="truncate">{skill.name}</span>
                    </span>
                  ))}
                  {activeLoadedSkills.length > 4 ? (
                    <span className={assistantSkillBadgeClass} title={`${activeLoadedSkills.length - 4} more loaded skill(s)`}>
                      +{activeLoadedSkills.length - 4}
                    </span>
                  ) : null}
                </>
              ) : null}
            </span>
          </div>

          {activeView === 'threads' ? (
            <>
              <button
                type="button"
                className={cn(assistantIconButtonClass, 'hidden max-[620px]:flex')}
                onClick={() => void createThread()}
                disabled={busy}
                title="New assistant thread"
                aria-label="New assistant thread"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18h6" />
                  <path d="M15 15v6" />
                </svg>
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={cn(assistantIconButtonClass, 'hidden max-[620px]:flex', mobileToolbarOpen && assistantIconButtonActiveClass)}
            onClick={() => setMobileToolbarOpen((open) => !open)}
            title={mobileToolbarOpen ? 'Hide assistant toolbar' : 'Show assistant toolbar'}
            aria-label={mobileToolbarOpen ? 'Hide assistant toolbar' : 'Show assistant toolbar'}
            aria-pressed={mobileToolbarOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </svg>
          </button>

          <div className="flex min-w-0 shrink items-center justify-end gap-1.5 max-[620px]:hidden max-[880px]:overflow-x-auto">
            {activeView !== 'threads' ? (
              <button
                type="button"
                className={assistantIconButtonClass}
                onClick={() => setActiveView('threads')}
                title="Back to assistant chat"
                aria-label="Back to assistant chat"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                  <path d="M4 5h16v10H8l-4 4V5Z" />
                </svg>
              </button>
            ) : null}
            {!threadSidebarOpen ? (
              <button
                type="button"
                className={assistantIconButtonClass}
                onClick={() => void createThread()}
                disabled={busy}
                title="New assistant thread"
                aria-label="New assistant thread"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            ) : null}
            {activeView === 'threads' ? (
              <>
                <button
                  type="button"
                  className={assistantIconButtonClass}
                  onClick={openSystemPromptEditor}
                  disabled={!activeThread}
                  title="Edit assistant system prompts"
                  aria-label="Edit assistant system prompts"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={cn(assistantIconButtonClass, assistantToolsOpen && assistantIconButtonActiveClass)}
                  onClick={() => setAssistantToolsOpen((open) => !open)}
                  disabled={!activeThread}
                  title={assistantToolsOpen ? 'Hide assistant tools' : 'Show assistant tools'}
                  aria-label={assistantToolsOpen ? 'Hide assistant tools' : 'Show assistant tools'}
                  aria-pressed={assistantToolsOpen}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.34.6.6 1 .6h.6a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.4Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={cn(assistantIconButtonClass, autoApprove && assistantIconButtonActiveClass)}
                  onClick={() => void updateThreadSettings({ autoApprove: !autoApprove })}
                  disabled={!activeThread || busy}
                  title={autoApprove ? 'Auto-approve tool calls is on' : 'Auto-approve tool calls is off'}
                  aria-label={autoApprove ? 'Turn off auto-approve' : 'Turn on auto-approve'}
                  aria-pressed={autoApprove}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                    <path d="M20 6 9 17l-5-5" />
                    <path d="M15 6h5v5" />
                  </svg>
                </button>
              </>
            ) : null}
            <div className="flex min-w-0 items-center gap-1.5">
              {navItems.filter((item) => item.id !== 'threads').map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(assistantIconButtonClass, activeView === item.id && assistantIconButtonActiveClass)}
                  onClick={() => setActiveView(item.id)}
                  title={item.label}
                  aria-label={item.label}
                  aria-pressed={activeView === item.id}
                >
                  {item.id === 'settings' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.34.6.6 1 .6h.6a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.4Z" />
                    </svg>
                  ) : item.id === 'admin' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
                      <path d="M9 12l2 2 4-4" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                      <path d="M3 3v18h18" />
                      <path d="M7 15l4-4 3 3 5-7" />
                    </svg>
                  )}
                  {typeof item.count === 'number' ? <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full border border-[var(--panel-alt)] bg-[var(--green)] px-1 text-center text-[9px] font-bold leading-[14px] text-[#071015]">{item.count}</span> : null}
                </button>
              ))}
            </div>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[rgba(74,222,128,.18)] bg-[rgba(74,222,128,.06)] px-2.5 font-display text-[10px] font-semibold uppercase text-[var(--green)] before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:shadow-[0_0_12px_rgba(74,222,128,.34)]">Live</span>
            {identitySlot ? <div className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center [&_button]:h-7 [&_button]:w-7">{identitySlot}</div> : null}
          </div>
        </header>

        {mobileToolbarOpen ? (
          <div className="hidden shrink-0 border-b border-[var(--border)] bg-[rgba(0,0,0,.16)] px-2 py-2 max-[620px]:block">
            <div className="grid gap-1.5">
              {activeView !== 'threads' ? (
                <button
                  type="button"
                  className="flex min-h-9 w-full items-center justify-between rounded border border-[var(--border-subtle)] bg-white/[.025] px-3 text-left text-xs text-[var(--fg-secondary)] shadow-none"
                  onClick={() => {
                    setActiveView('threads');
                    setMobileToolbarOpen(false);
                  }}
                >
                  <span>Back to chat</span>
                  <span className="text-[10px] uppercase text-[var(--muted)]">Chat</span>
                </button>
              ) : null}
              {activeView === 'threads' ? (
                <>
                  <button
                    type="button"
                    className={cn('flex min-h-9 w-full items-center justify-between rounded border border-[var(--border-subtle)] bg-white/[.025] px-3 text-left text-xs text-[var(--fg-secondary)] shadow-none', mobileModelControlsOpen && assistantIconButtonActiveClass)}
                    onClick={() => {
                      setMobileModelControlsOpen((open) => !open);
                      setMobileToolbarOpen(false);
                    }}
                    disabled={!activeThread}
                  >
                    <span>Model and delivery</span>
                    <span className="text-[10px] uppercase text-[var(--muted)]">{compactModelSelectionLabel(selectedModelLabel)}</span>
                  </button>
                  <button
                    type="button"
                    className="flex min-h-9 w-full items-center justify-between rounded border border-[var(--border-subtle)] bg-white/[.025] px-3 text-left text-xs text-[var(--fg-secondary)] shadow-none"
                    onClick={() => {
                      openSystemPromptEditor();
                      setMobileToolbarOpen(false);
                    }}
                    disabled={!activeThread}
                  >
                    <span>System prompt</span>
                    <span className="text-[10px] uppercase text-[var(--muted)]">Edit</span>
                  </button>
                  <button
                    type="button"
                    className={cn('flex min-h-9 w-full items-center justify-between rounded border border-[var(--border-subtle)] bg-white/[.025] px-3 text-left text-xs text-[var(--fg-secondary)] shadow-none', assistantToolsOpen && assistantIconButtonActiveClass)}
                    onClick={() => {
                      setAssistantToolsOpen((open) => !open);
                      setMobileToolbarOpen(false);
                    }}
                    disabled={!activeThread}
                  >
                    <span>Tools</span>
                    <span className="text-[10px] uppercase text-[var(--muted)]">{enabledToolNames.length}</span>
                  </button>
                  <button
                    type="button"
                    className={cn('flex min-h-9 w-full items-center justify-between rounded border border-[var(--border-subtle)] bg-white/[.025] px-3 text-left text-xs text-[var(--fg-secondary)] shadow-none', autoApprove && assistantIconButtonActiveClass)}
                    onClick={() => {
                      void updateThreadSettings({ autoApprove: !autoApprove });
                      setMobileToolbarOpen(false);
                    }}
                    disabled={!activeThread || busy}
                  >
                    <span>Auto-approve tool calls</span>
                    <span className="text-[10px] uppercase text-[var(--muted)]">{autoApprove ? 'On' : 'Off'}</span>
                  </button>
                </>
              ) : null}
              {navItems.filter((item) => item.id !== 'threads').map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn('flex min-h-9 w-full items-center justify-between rounded border border-[var(--border-subtle)] bg-white/[.025] px-3 text-left text-xs text-[var(--fg-secondary)] shadow-none', activeView === item.id && assistantIconButtonActiveClass)}
                  onClick={() => {
                    setActiveView(item.id);
                    setMobileToolbarOpen(false);
                  }}
                >
                  <span>{item.label}</span>
                  {typeof item.count === 'number' ? <span className="text-[10px] uppercase text-[var(--muted)]">{item.count}</span> : null}
                </button>
              ))}
              <div className="flex min-h-9 items-center justify-between rounded border border-[var(--border-subtle)] bg-white/[.018] px-3 text-xs text-[var(--fg-secondary)]">
                <span>Live</span>
                {identitySlot ? <div className="flex h-7 w-7 shrink-0 items-center justify-center [&_button]:h-7 [&_button]:w-7">{identitySlot}</div> : <span className="text-[10px] uppercase text-[var(--muted)]">Connected</span>}
              </div>
            </div>
          </div>
        ) : null}

        <ToastStack toasts={toasts} onDismiss={dismissToast} />

        {activeView === 'threads' && assistantToolsOpen && activeThread ? (
          <AssistantToolsPanel
            tools={availableTools}
            enabledTools={enabledToolNames}
            disabled={busy}
            onToggleTool={(toolName, checked) => {
              const next = new Set(enabledTools);
              if (checked) next.add(toolName);
              else next.delete(toolName);
              void updateThreadSettings({ enabledTools: [...next] });
            }}
            onEnableAll={() => void updateThreadSettings({ enabledTools: availableTools.map((tool) => tool.name) })}
            onDisableAll={() => void updateThreadSettings({ enabledTools: [] })}
            onClose={() => setAssistantToolsOpen(false)}
          />
        ) : null}

        <section className="min-h-0 flex-1 overflow-hidden">
          {activeView === 'threads' ? (
            <section className="flex h-full min-h-0 flex-col">
              {activeThread?.error ? (
                <div className="grid shrink-0 gap-1 border-b border-[rgba(248,113,113,.24)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[var(--fg-secondary)]">
                  <strong className="text-[11px] text-[#fecaca]">Assistant error</strong>
                  <span className="break-words text-xs leading-relaxed">{activeThread.error}</span>
                </div>
              ) : null}

              {assistantFilesOpen && activeThread ? (
                <AssistantFilesPanel
                  artifacts={artifacts}
                  artifactsLoading={artifactsLoading}
                  artifactsError={artifactsError}
                  selectedArtifact={selectedArtifact}
                  artifactPathDraft={artifactPathDraft}
                  artifactContentDraft={artifactContentDraft}
                  artifactDirty={artifactDirty}
                  panelMode={artifactPanelMode}
                  busy={busy}
                  onNew={newArtifactDraft}
                  onSelect={(artifact) => {
                    if (busy) return;
                    if (artifactDirty && !window.confirm('Discard unsaved changes and open this file?')) return;
                    hydrateArtifactDraft(artifact, 'view');
                  }}
                  onPanelModeChange={setArtifactPanelMode}
                  onPathChange={(path) => {
                    setArtifactPathDraft(path);
                    setArtifactDirty(true);
                  }}
                  onContentChange={(content) => {
                    setArtifactContentDraft(content);
                    setArtifactDirty(true);
                  }}
                  onCancelEdit={cancelArtifactEdit}
                  onCloseFile={closeArtifactFile}
                  onSave={() => void saveArtifact()}
                  onDelete={() => {
                    if (selectedArtifact) setArtifactDeleteCandidate(selectedArtifact);
                  }}
                  onCopy={() => void copyArtifact()}
                  onDownload={downloadArtifact}
                />
              ) : (
                <>
                <div
                  ref={messagesScrollRef}
                  onScroll={(event) => updateMessagesStickToBottom(event.currentTarget)}
                  className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto bg-[#151a20] py-3"
                >
                  {assistantRenderItems.map((item) =>
                    item.type === 'message' ? (
                      <AssistantMessageRow key={item.key} message={item.message} streaming={item.message.id === streamingMessage?.id} />
                    ) : (
                      <ToolActivityMessage key={item.key} call={item.call} result={item.result} />
                    ),
                  )}
                  {showThinking ? <AssistantThinkingRow /> : null}
                  {queuedPrompts.length > 0 ? (
                    <div className="mx-3 grid max-h-[220px] gap-1.5 overflow-auto">
                      {queuedPrompts.map((queuedPrompt) => (
                        <article key={queuedPrompt.id} className="flex min-w-0 items-center justify-between gap-2.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.018)] px-2.5 py-2">
                          <div className="min-w-0">
                            <strong className="block min-w-0 truncate text-xs font-semibold text-[var(--fg-secondary)]">{queuedPrompt.prompt}</strong>
                            <small className="block text-[10px] text-[var(--muted)]">
                              {queuedPrompt.provider}/{queuedPrompt.model}
                              {queuedPrompt.thinkingLevel !== 'off' ? ` · ${queuedPrompt.thinkingLevel}` : ''}
                              {' · '}
                              {timeLabel(queuedPrompt.createdAt)}
                            </small>
                          </div>
                  <button type="button" className={cn(assistantActionButtonClass, 'shrink-0')} disabled={busy} onClick={() => void cancelQueuedPrompt(queuedPrompt)}>
                    Cancel
                  </button>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  {activePendingApprovals.length > 0 ? (
                    <div className="mx-3 grid gap-1.5">
                      {activePendingApprovals.map((approval) => {
                        const summary = approvalSummary(approval);
                        return (
                          <article key={approval.id} className="grid grid-cols-[minmax(150px,.46fr)_minmax(0,1fr)_auto] items-start gap-2.5 rounded border border-[rgba(250,204,21,.2)] bg-[rgba(250,204,21,.045)] px-3 py-2.5 max-[880px]:grid-cols-1">
                            <div>
                              <strong className="block text-xs font-bold text-[var(--fg)]">{summary.title}</strong>
                              <small className="block text-[10px] text-[var(--muted)]">{approval.toolName} · {timeLabel(approval.createdAt)}</small>
                            </div>
                            <div className="grid min-w-0 gap-1.5">
                              {summary.rows.map((row) => (
                                <div key={row.label} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-xs text-[var(--fg-secondary)]">
                                  <span className="font-display text-[10px] font-bold uppercase text-[var(--muted)]">{row.label}</span>
                                  <strong className="min-w-0 break-words text-xs text-[var(--fg-secondary)]">{row.value}</strong>
                                </div>
                              ))}
                              {summary.block ? (
                                <pre className="m-0 min-w-0 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] p-2 font-mono text-[11px] leading-normal text-[var(--fg-secondary)]">
                                  {summary.blockLabel ? `${summary.blockLabel}\n` : ''}
                                  {summary.block}
                                </pre>
                              ) : null}
                            </div>
                            <div className="flex justify-end gap-1.5">
                              <button type="button" className="h-7 px-2.5 font-display text-[10px] font-bold uppercase" disabled={busy} onClick={() => void resolveApproval(approval.id, true)}>
                                Approve
                              </button>
                              <button type="button" className="h-7 px-2.5 font-display text-[10px] font-bold uppercase" disabled={busy} onClick={() => void resolveApproval(approval.id, false)}>
                                Deny
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                  {activeThread && messages.length === 0 && queuedPrompts.length === 0 && activePendingApprovals.length === 0 && !showThinking ? <div className={assistantEmptyClass}>This thread is empty.</div> : null}
                  {!activeThread ? <div className={assistantEmptyClass}>Create a thread to start.</div> : null}
                </div>

                <form className="block shrink-0 bg-[#151a20] p-2 pt-1" onSubmit={(event) => void sendMessage(event)}>
                <div className={cn('mb-1 flex min-w-0 flex-wrap items-center gap-1.5', !mobileModelControlsOpen && 'max-[620px]:hidden')}>
                  <div className="inline-flex shrink-0 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]" role="group" aria-label="Assistant provider">
                    {providerOptions.map((provider) => {
                      const selected = provider.id === activeProvider;
                      const disabled = !activeThread || busy || provider.models.length === 0;
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          disabled={disabled}
                          aria-pressed={selected}
                          title={provider.title}
                          onClick={() => {
                            const nextModel = provider.models[0];
                            void updateThreadSettings({
                              provider: provider.id,
                              ...(nextModel ? { model: nextModel.id, thinkingLevel: nextModel.thinkingLevel } : {}),
                            });
                          }}
                          className={cn(
                            'h-7 rounded-none border-0 border-r border-[var(--border-subtle)] bg-transparent px-2.5 font-display text-[10px] font-bold uppercase text-[var(--muted)] last:border-r-0 disabled:cursor-not-allowed disabled:text-[var(--muted-dim)]',
                            selected && '!bg-[rgba(74,222,128,.10)] !text-[var(--green)]',
                          )}
                        >
                          {provider.label}
                        </button>
                      );
                    })}
                  </div>
                  <UiMenuSelect
                    value={activeAssistantProfile?.id ?? ''}
                    entries={assistantProfileMenuEntries}
                    variant="toolbar"
                    role="listbox"
                    itemRole="option"
                    title={assistantProfileLocked ? 'Assistant profile cannot be changed after messages exist' : `Assistant profile: ${activeAssistantProfileLabel}`}
                    header="Assistant profile"
                    triggerLabel={activeAssistantProfileLabel}
                    panelClassName="w-[220px]"
                    disabled={!activeThread || busy || assistantProfileLocked || assistantProfileMenuEntries.length === 0}
                    onValueChange={(value) => {
                      if (!value || value === activeThread?.assistantProfileId) return;
                      void updateThreadSettings({ assistantProfileId: value });
                    }}
                  />
                  <UiMenuSelect
                    value={selectedModelKey}
                    entries={modelMenuEntries}
                    variant="toolbar"
                    role="listbox"
                    itemRole="option"
                    title={selectedModelLabel}
                    header="Model"
                    searchable
                    searchPlaceholder="Search models"
                    triggerLabel={compactModelSelectionLabel(selectedModelLabel)}
                    panelClassName="w-[220px]"
                    disabled={!activeThread || busy}
                    onValueChange={(value) => {
                      const [provider, nextModel, thinkingLevel] = value.split(':');
                      void updateThreadSettings({ provider, model: nextModel, thinkingLevel });
                    }}
                  />
                  <div className="inline-flex shrink-0 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]" role="group" aria-label="Assistant message delivery">
                    {(['queue', 'asap'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={!activeThread || busy}
                        aria-pressed={(activeThread?.promptDeliveryMode ?? 'queue') === mode}
                        className={cn(
                          'h-7 rounded-none border-0 border-r border-[var(--border-subtle)] bg-transparent px-2.5 font-display text-[10px] font-bold uppercase text-[var(--muted)] last:border-r-0 disabled:cursor-not-allowed disabled:text-[var(--muted-dim)]',
                          (activeThread?.promptDeliveryMode ?? 'queue') === mode && '!bg-[rgba(74,222,128,.10)] !text-[var(--green)]',
                        )}
                        onClick={() => void updateThreadSettings({ promptDeliveryMode: mode })}
                        title={mode === 'queue' ? 'Queue after the assistant finishes' : 'Send at the next assistant turn'}
                      >
                        {mode === 'queue' ? 'Queue' : 'ASAP'}
                      </button>
                    ))}
                  </div>
                  <div
                    className={cn(
                      'inline-flex h-[30px] max-w-[220px] min-w-0 items-center gap-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[var(--muted)] max-[620px]:hidden',
                      activeProvider === 'codex' && !codexConnection.connected && '!border-[rgba(245,158,11,.45)] !bg-[rgba(245,158,11,.07)]',
                    )}
                    title={activeProviderMeta?.title ?? providerAuthLabel}
                  >
                    <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--muted)]', activeProvider === 'codex' && codexConnection.connected && '!bg-[var(--green)] shadow-[0_0_0_3px_rgba(74,222,128,.12)]')} />
                    <small className="min-w-0 truncate text-[10px]">{providerAuthLabel}</small>
                    {activeProvider === 'codex' && !codexConnection.connected ? (
                      <button type="button" className="h-7 border-[rgba(74,222,128,.28)] bg-[rgba(74,222,128,.08)] px-2.5 font-display text-[10px] font-bold uppercase text-[var(--green)]" onClick={() => void startCodexConnect()} disabled={busy}>Connect</button>
                    ) : null}
                  </div>
                  <div className="ml-auto inline-flex items-center gap-1.5 max-[620px]:ml-0">
                    {activeRuns.length > 0 ? (
                      <button type="button" className="h-7 border-[rgba(248,113,113,.45)] bg-[rgba(248,113,113,.10)] px-2.5 font-display text-[10px] font-bold uppercase text-[#fca5a5]" onClick={() => void stopActiveRun()} disabled={busy}>
                        Stop
                      </button>
                    ) : null}
                  </div>
                </div>
                {codexConnectFlow ? (
                  <div className="mb-2 grid grid-cols-[minmax(180px,1fr)_auto] gap-2 max-[620px]:grid-cols-1">
                    <input
                      value={codexCodeDraft}
                      disabled={busy}
                      placeholder="Paste redirect URL or authorization code"
                      onChange={(event) => setCodexCodeDraft(event.currentTarget.value)}
                    />
                    <button type="button" onClick={() => void completeCodexConnect()} disabled={busy || !codexCodeDraft.trim()}>
                      Complete
                    </button>
                  </div>
                ) : null}
                <div className="relative min-h-[92px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] max-[620px]:min-h-[42px]">
                  <textarea
                    value={messageDraft}
                    rows={messageDraftRows}
                    onChange={(event) => {
                      const nextDraft = event.target.value;
                      messageDraftRef.current = nextDraft;
                      setMessageDraft(nextDraft);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (activeThread && messageDraft.trim() && !activePromptSubmitting) {
                          void sendMessage();
                        }
                      }
                    }}
                    placeholder={activeRuns.length > 0 ? ((activeThread?.promptDeliveryMode ?? 'queue') === 'asap' ? 'Send at next turn' : 'Queue a message') : 'Ask the assistant'}
                    disabled={!activeThread}
                    className="assistant-chat-composer-input block min-h-[92px] max-h-[180px] w-full resize-y border-0 bg-transparent px-2.5 pb-9 pt-2 text-xs leading-relaxed text-[var(--fg)] outline-none max-[620px]:min-h-[42px] max-[620px]:max-h-[132px] max-[620px]:resize-none max-[620px]:py-2 max-[620px]:pr-[68px]"
                  />
                  {activeRunningModel ? (
                    <span className="absolute bottom-2 left-2.5 max-w-[calc(100%-106px)] truncate text-[10px] text-[var(--muted-dim)] max-[620px]:hidden" title={`Running model: ${activeRunningModelLabel}`}>
                      Running {compactModelSelectionLabel(activeRunningModelLabel)}
                    </span>
                  ) : null}
                  <button type="submit" className="absolute bottom-2 right-2 h-7 border-[rgba(74,222,128,.28)] bg-[rgba(74,222,128,.08)] px-2.5 font-display text-[10px] font-bold uppercase text-[var(--green)]" disabled={!activeThread || !messageDraft.trim() || activePromptSubmitting}>
                    Send
                  </button>
                </div>
              </form>
                </>
              )}
            </section>
          ) : null}

          {activeView === 'settings' ? (
            <section className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 bg-[var(--panel-alt)] px-3 pt-3">
                <div className="hidden pb-1 max-[620px]:block">
                <UiMenuSelect
                  value={settingsPane}
                  entries={settingsPaneEntries}
                  placement="below"
                  title={`Settings pane: ${activeSettingsPaneLabel}`}
                  triggerLabel={activeSettingsPaneLabel}
                  triggerClassName="h-9 border-[var(--border)] bg-white/[.025] text-[var(--fg-secondary)]"
                  panelClassName="w-full"
                  menuClassName="max-h-[320px]"
                  onValueChange={(value) => setSettingsPane(value as SettingsPane)}
                />
                </div>
                <div className="flex w-full flex-nowrap items-end gap-1 overflow-x-auto bg-[var(--panel-alt)] pt-0 pb-1 max-[620px]:hidden">
                  {SETTINGS_PANES.map((pane) => (
                    <button
                      key={pane.id}
                      type="button"
                      className={cn(settingsTabClass, settingsPane === pane.id && settingsTabActiveClass)}
                      aria-pressed={settingsPane === pane.id}
                      onClick={() => setSettingsPane(pane.id)}
                    >
                      {pane.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3">
                {settingsPane === 'devices' ? (
                <>
                  <section className={assistantPanelClass}>
                    <div className={assistantPanelHeaderClass}>
                      <div>
                        <span className={assistantKickerClass}>Pairing</span>
                        <h2 className={assistantPanelTitleClass}>Android Setup</h2>
                      </div>
                      <button type="button" className={assistantActionButtonClass} onClick={() => void refreshAndroidSetup()}>
                        Refresh QR
                      </button>
                    </div>
                    <div className="grid gap-2 rounded border border-[var(--border-subtle)] bg-white/[.02] p-3">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <small className={assistantKickerClass}>Android Setup</small>
                        {androidApkInfo?.available ? (
                          <span className="text-xs text-[var(--muted)]">
                            v{androidApkInfo.versionName ?? androidApkInfo.versionCode ?? '?'}
                            {androidApkInfo.variant ? ` / ${androidApkInfo.variant}` : ''}
                          </span>
                        ) : null}
                      </div>
                      {androidSetupQr && androidSetupInfo?.setupUrl ? (
                        <div className="flex flex-wrap items-start gap-3">
                          <a href={androidSetupInfo.setupUrl} className="block rounded-[7px] border border-[var(--border)] bg-white p-1 transition hover:border-[rgba(136,145,168,.5)]" title="Android setup QR">
                            <img src={androidSetupQr} alt="Android setup QR" className="h-[132px] w-[132px]" />
                          </a>
                        </div>
                      ) : (
                        <div className={assistantEmptyClass}>No Android setup QR is available.</div>
                      )}
                      <AppDownloadLinks androidInfo={androidApkInfo} desktopInfo={desktopAppInfo} />
                    </div>
                  </section>

                  <section className={assistantPanelClass}>
                    <div className={assistantPanelHeaderClass}>
                      <div>
                        <h2 className={assistantPanelTitleClass}>Devices</h2>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      {devices.map((device) => {
                        const status = dashboard?.clientStatuses.find((entry) => entry.deviceId === device.id);
                        const pairing = dashboard?.pairingSessions.find((entry) => entry.deviceId === device.id);
                        const activeAt = status?.updatedAt ?? device.lastSeenAt;
                        const lastActiveRelative = relativeTimeAgo(activeAt);
                        const lastActiveExact = exactTimeLabel(activeAt);
                        const editing = deviceNameEditor?.deviceId === device.id;
                        return (
                          <article key={device.id} className={cn(assistantRowClass, 'grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-3 max-[760px]:grid-cols-1')}>
                            <div className="grid min-w-0 gap-1.5">
                              {editing ? (
                                <form
                                  className="flex min-w-0 flex-wrap items-center gap-1.5"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void renameDevice(device.id, deviceNameEditor.draft);
                                  }}
                                >
                                  <input
                                    value={deviceNameEditor.draft}
                                    disabled={busy}
                                    autoFocus
                                    onChange={(event) => setDeviceNameEditor({ deviceId: device.id, draft: event.currentTarget.value })}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Escape') setDeviceNameEditor(null);
                                    }}
                                    className="h-[30px] min-w-[10ch] max-w-full"
                                    style={{ width: `${Math.min(Math.max(deviceNameEditor.draft.length + 2, 12), 42)}ch` }}
                                  />
                                  <button type="submit" className={assistantActionButtonClass} disabled={busy || !deviceNameEditor.draft.trim()}>
                                    Save
                                  </button>
                                  <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => setDeviceNameEditor(null)}>
                                    Cancel
                                  </button>
                                </form>
                              ) : (
                                <button
                                  type="button"
                                  className="group flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded border-0 bg-transparent p-0 text-left text-xs font-semibold text-[var(--fg)] shadow-none transition hover:text-[var(--green)] focus:outline-none focus:ring-1 focus:ring-[rgba(74,222,128,.28)] disabled:pointer-events-none disabled:opacity-50"
                                  disabled={busy}
                                  onClick={() => setDeviceNameEditor({ deviceId: device.id, draft: device.displayName })}
                                  title={`Rename ${device.displayName}`}
                                  aria-label={`Rename ${device.displayName}`}
                                >
                                  <span className="min-w-0 truncate">{device.displayName}</span>
                                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current stroke-2 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                  </svg>
                                </button>
                              )}
                              <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                                <span>{device.deviceType}</span>
                                <span>{status ? `${status.mode} / ${status.status}` : 'No live status'}</span>
                                <span title={lastActiveExact}>Last active {lastActiveRelative}</span>
                                <span>token {device.tokenHint}...</span>
                              </div>
                              {pairing && !pairing.claimedAt ? <span className="text-xs text-[var(--muted)]">Pairing expires {timeLabel(pairing.expiresAt)}</span> : null}
                            </div>
                            <div className="flex flex-wrap justify-end gap-[7px]">
                              <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void sendDeviceCommand(device.id, 'query_status')}>
                                Query
                              </button>
                              <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void sendDeviceCommand(device.id, 'sleep')}>
                                Sleep
                              </button>
                              <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void sendDeviceCommand(device.id, 'off')}>
                                Off
                              </button>
                              <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void rotateDeviceToken(device.id)}>
                                Rotate
                              </button>
                              <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void revokeDevice(device.id)}>
                                Revoke
                              </button>
                            </div>
                          </article>
                        );
                      })}
                      {devices.length === 0 ? <div className={assistantEmptyClass}>No paired devices yet.</div> : null}
                    </div>
                  </section>
                </>
              ) : null}

                {settingsPane === 'assistant' ? (
                <>
              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <h2 className={assistantPanelTitleClass}>Profiles</h2>
                  </div>
                  <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void createAssistantProfile()}>
                    Add profile
                  </button>
                </div>
                <div className="grid gap-3 xl:grid-cols-[minmax(220px,.34fr)_minmax(0,1fr)]">
                  <div className="grid content-start gap-1.5">
                    {assistantProfiles.map((profile) => {
                      const selected = profile.id === selectedAssistantProfile?.id;
                      const draft = assistantProfileDrafts[profile.id] ?? profileDraftFromAssistantProfile(profile);
                      return (
                        <button
                          key={profile.id}
                          type="button"
                          className={cn(
                            'grid min-h-[58px] w-full content-center gap-1 rounded border border-[var(--border-subtle)] bg-white/[.02] px-2 py-1.5 text-left transition hover:border-[rgba(136,145,168,.36)] hover:bg-white/[.04]',
                            selected && 'border-[rgba(74,222,128,.30)] bg-[rgba(74,222,128,.08)]',
                          )}
                          onClick={() => setSelectedAssistantProfileId(profile.id)}
                        >
                          <span className="flex min-w-0 items-center justify-between gap-2">
                            <strong className="truncate text-xs text-[var(--fg)]">{draft.name || 'Assistant'}</strong>
                            <span className={cn('shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]', draft.enabled && 'border-[rgba(74,222,128,.28)] text-[var(--green)]')}>
                              {draft.enabled ? 'Enabled' : 'Off'}
                            </span>
                          </span>
                          <span className="truncate text-[11px] text-[var(--muted)]">{draft.wakePhrase || 'No wake phrase'}</span>
                        </button>
                      );
                    })}
                    {assistantProfiles.length === 0 ? <div className={assistantEmptyClass}>No assistant profiles loaded.</div> : null}
                  </div>

                  {selectedAssistantProfile && selectedAssistantProfileDraft ? (
                    <article className="grid gap-2.5 rounded border border-[var(--border-subtle)] bg-white/[.02] p-2.5">
                      <div className="grid grid-cols-[minmax(120px,1fr)_minmax(130px,170px)_auto] items-end gap-2 max-[880px]:grid-cols-1">
                        <label className={assistantFieldLabelClass}>
                          Name
                          <input
                            value={selectedAssistantProfileDraft.name}
                            disabled={busy}
                            className="h-[30px] min-w-0"
                            onChange={(event) => updateAssistantProfileDraft(selectedAssistantProfile.id, { name: event.currentTarget.value })}
                          />
                        </label>
                        <label className={assistantFieldLabelClass}>
                          Voice
                          <select
                            value={selectedAssistantProfileDraft.ttsVoice}
                            disabled={busy}
                            className="h-[30px] min-w-0"
                            onChange={(event) => updateAssistantProfileDraft(selectedAssistantProfile.id, { ttsVoice: event.currentTarget.value })}
                          >
                            {ASSISTANT_TTS_VOICE_OPTIONS.map((voice) => (
                              <option key={voice.id} value={voice.id}>{voice.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex h-[30px] items-center gap-2 rounded border border-[var(--border-subtle)] bg-white/[.02] px-2 text-[11px] font-semibold text-[var(--fg-secondary)]">
                          <input
                            type="checkbox"
                            checked={selectedAssistantProfileDraft.enabled}
                            disabled={busy || (selectedAssistantProfileDraft.enabled && enabledAssistantProfileCount <= 1)}
                            className="h-3.5 w-3.5 accent-[var(--green)]"
                            onChange={(event) => updateAssistantProfileDraft(selectedAssistantProfile.id, { enabled: event.currentTarget.checked })}
                          />
                          Enabled
                        </label>
                      </div>

                      <label className={assistantFieldLabelClass}>
                        Primary wake phrase
                        <input
                          value={selectedAssistantProfileDraft.wakePhrase}
                          disabled={busy}
                          className="h-[30px] min-w-0"
                          onChange={(event) => updateAssistantProfileDraft(selectedAssistantProfile.id, { wakePhrase: event.currentTarget.value })}
                        />
                      </label>

                      <div className="grid gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className={assistantFieldLabelClass}>Aliases</span>
                          <button
                            type="button"
                            className={assistantActionButtonClass}
                            disabled={busy}
                            onClick={() => updateAssistantProfileDraft(selectedAssistantProfile.id, { wakePhraseAliases: [...selectedAssistantProfileDraft.wakePhraseAliases, ''] })}
                          >
                            Add alias
                          </button>
                        </div>
                        <div className="grid gap-1.5">
                          {selectedAssistantProfileDraft.wakePhraseAliases.map((alias, aliasIndex) => (
                            <div key={`${selectedAssistantProfile.id}:alias:${aliasIndex}`} className="grid grid-cols-[minmax(160px,1fr)_auto] gap-1.5">
                              <input
                                value={alias}
                                disabled={busy}
                                className="h-[30px] min-w-0"
                                onChange={(event) => {
                                  const next = [...selectedAssistantProfileDraft.wakePhraseAliases];
                                  next[aliasIndex] = event.currentTarget.value;
                                  updateAssistantProfileDraft(selectedAssistantProfile.id, { wakePhraseAliases: next });
                                }}
                              />
                              <button
                                type="button"
                                className={assistantActionButtonClass}
                                disabled={busy}
                                onClick={() => updateAssistantProfileDraft(selectedAssistantProfile.id, { wakePhraseAliases: selectedAssistantProfileDraft.wakePhraseAliases.filter((_, index) => index !== aliasIndex) })}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          {selectedAssistantProfileDraft.wakePhraseAliases.length === 0 ? <div className="text-[11px] text-[var(--muted)]">No aliases configured.</div> : null}
                        </div>
                      </div>

                      <label className={assistantFieldLabelClass}>
                        System prompt
                        <textarea
                          value={selectedAssistantProfileDraft.systemPrompt}
                          disabled={busy}
                          rows={5}
                          onChange={(event) => updateAssistantProfileDraft(selectedAssistantProfile.id, { systemPrompt: event.currentTarget.value })}
                        />
                      </label>

                      <div className="grid gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className={assistantFieldLabelClass}>Default tools</span>
                            <div className="text-[11px] text-[var(--muted)]">
                              {selectedAssistantProfileDraft.enabledTools === null
                                ? `${defaultEnabledToolNames.length} / ${availableTools.length} enabled from global defaults.`
                                : `${selectedProfileEnabledTools.length} / ${availableTools.length} enabled for this profile.`}
                            </div>
                          </div>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button type="button" className={assistantActionButtonClass} disabled={busy || selectedAssistantProfileDraft.enabledTools === null} onClick={() => updateAssistantProfileDraft(selectedAssistantProfile.id, { enabledTools: null })}>
                              Use global
                            </button>
                            <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => updateAssistantProfileDraft(selectedAssistantProfile.id, { enabledTools: availableTools.map((tool) => tool.name) })}>
                              Enable all
                            </button>
                            <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => updateAssistantProfileDraft(selectedAssistantProfile.id, { enabledTools: [] })}>
                              Disable all
                            </button>
                          </div>
                        </div>
                        <div className="grid max-h-[300px] gap-1 overflow-y-auto pr-1">
                          {availableTools.map((tool) => {
                            const checked = selectedProfileEnabledToolSet.has(tool.name);
                            return (
                              <label
                                key={tool.name}
                                className={cn(
                                  'flex min-w-0 cursor-pointer items-start gap-2 rounded-[5px] border border-[var(--border-subtle)] bg-white/[.02] px-2 py-1.5',
                                  checked && 'border-[rgba(139,92,246,.55)] bg-[rgba(139,92,246,.12)]',
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={busy}
                                  onChange={(event) => {
                                    const next = new Set(selectedAssistantProfileDraft.enabledTools ?? defaultEnabledToolNames);
                                    if (event.currentTarget.checked) next.add(tool.name);
                                    else next.delete(tool.name);
                                    updateAssistantProfileDraft(selectedAssistantProfile.id, { enabledTools: [...next] });
                                  }}
                                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                                />
                                <span className="grid min-w-0 gap-px">
                                  <strong className="truncate text-xs text-[var(--fg)]">{tool.label}</strong>
                                  <small className="line-clamp-2 text-[11px] text-[var(--muted)]">{tool.description}</small>
                                </span>
                              </label>
                            );
                          })}
                          {availableTools.length === 0 ? <div className={assistantEmptyClass}>No tools loaded.</div> : null}
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button type="button" className={assistantActionButtonClass} disabled={busy || !selectedAssistantProfileDraft.name.trim() || !selectedAssistantProfileDraft.wakePhrase.trim() || !selectedAssistantProfileDraft.ttsVoice.trim()} onClick={() => void saveAssistantProfile(selectedAssistantProfile)}>
                          Save profile
                        </button>
                      </div>
                    </article>
                  ) : null}
                </div>
              </section>
                </>
              ) : null}

                {settingsPane === 'assistant-config' ? (
                <>
              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <h2 className={assistantPanelTitleClass}>API Keys</h2>
                  </div>
                </div>
                <div className="grid gap-2">
                  {(['openai', 'exa'] as const).map((provider) => {
                    const key = assistantSnapshotData?.apiKeys?.[provider];
                    const label = provider === 'openai' ? 'OpenAI' : 'Exa';
                    const hasDraftKey = Boolean(apiKeyDrafts[provider].trim());
                    const canCopyKey = hasDraftKey || Boolean(key?.hasKey);
                    return (
                      <div key={provider} className="grid grid-cols-[120px_minmax(180px,1fr)_auto_auto_auto] items-center gap-2 rounded border border-[var(--border)] bg-white/[.02] p-2 max-[880px]:grid-cols-1">
                        <div className="min-w-0">
                          <strong className="block text-xs text-[var(--fg)]">{label}</strong>
                          <small className="block truncate text-[11px] text-[var(--muted)]">{key?.hasKey ? key.keyHint : 'Not configured'}</small>
                        </div>
                        <input
                          type="password"
                          value={apiKeyDrafts[provider]}
                          disabled={busy}
                          placeholder={key?.hasKey ? 'Paste replacement key' : `Paste ${label} key`}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setApiKeyDrafts((current) => ({ ...current, [provider]: value }));
                          }}
                          className="h-[30px] min-w-0"
                        />
                        <button type="button" className={assistantActionButtonClass} onClick={() => void saveAssistantApiKey(provider)} disabled={busy || !hasDraftKey}>
                          Save
                        </button>
                        <button
                          type="button"
                          className={assistantActionButtonClass}
                          onClick={() => void copyAssistantApiKey(provider)}
                          disabled={busy || apiKeyCopying[provider] || !canCopyKey}
                          title={hasDraftKey ? `Copy pasted ${label} key` : `Copy saved ${label} key`}
                        >
                          {apiKeyCopying[provider] ? 'Copying' : 'Copy'}
                        </button>
                        <button type="button" className={assistantActionButtonClass} onClick={() => void deleteAssistantApiKey(provider)} disabled={busy || !key?.hasKey}>
                          Delete
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <h2 className={assistantPanelTitleClass}>Codex Connection</h2>
                  </div>
                  {codexConnection.connected ? (
                    <button type="button" className={assistantActionButtonClass} onClick={() => void disconnectCodex()} disabled={busy}>
                      Disconnect
                    </button>
                  ) : (
                    <button type="button" className={assistantActionButtonClass} onClick={() => void startCodexConnect()} disabled={busy}>
                      Connect Codex
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-[minmax(180px,1fr)_auto] items-center gap-2 rounded border border-[var(--border)] bg-white/[.02] p-2 max-[880px]:grid-cols-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full bg-[var(--muted)]', codexConnection.connected && '!bg-[var(--green)] shadow-[0_0_0_3px_rgba(74,222,128,.12)]')} />
                    <strong className="text-xs text-[var(--fg)]">{codexConnection.connected ? 'Connected' : 'Not connected'}</strong>
                    <small className="min-w-0 truncate text-[11px] text-[var(--muted)]">{codexConnection.accountId ?? 'Use Codex models without OpenAI API keys'}</small>
                  </div>
                  {codexConnectFlow ? (
                    <div className="col-span-full grid grid-cols-[minmax(180px,1fr)_auto] gap-2 max-[880px]:grid-cols-1">
                      <input
                        value={codexCodeDraft}
                        disabled={busy}
                        placeholder="Paste redirect URL or authorization code"
                        onChange={(event) => setCodexCodeDraft(event.currentTarget.value)}
                        className="h-[30px] min-w-0"
                      />
                      <button type="button" className={assistantActionButtonClass} onClick={() => void completeCodexConnect()} disabled={busy || !codexCodeDraft.trim()}>
                        Complete
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <h2 className={assistantPanelTitleClass}>New Thread Model</h2>
                  </div>
                  <span className="max-w-[220px] truncate text-right text-[11px] text-[var(--muted)]">
                    {assistantSettings ? `${defaultProvider}/${defaultModel}${defaultThinkingLevel !== 'off' ? ` · ${defaultThinkingLevel}` : ''}` : 'Loading'}
                  </span>
                </div>
                <div className="grid gap-2.5">
                  <div className="grid grid-cols-[minmax(160px,220px)_minmax(220px,1fr)] items-end gap-2.5 max-[760px]:grid-cols-1">
                    <div className={assistantFieldLabelClass}>
                      <span>Provider</span>
                      <div className="inline-flex h-[30px] min-w-0 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]" role="group" aria-label="Default assistant provider">
                        {providerOptions.map((provider) => {
                          const selected = provider.id === defaultProvider;
                          const disabled = busy || !assistantSettings || provider.models.length === 0;
                          return (
                            <button
                              key={provider.id}
                              type="button"
                              disabled={disabled}
                              aria-pressed={selected}
                              title={provider.title}
                              onClick={() => {
                                const nextModel = provider.models[0];
                                void updateAssistantSettings({
                                  defaultProvider: provider.id,
                                  ...(nextModel ? { defaultModel: nextModel.id, defaultThinkingLevel: nextModel.thinkingLevel } : {}),
                                });
                              }}
                              className={cn(
                                'h-full flex-1 rounded-none border-0 border-r border-[var(--border-subtle)] bg-transparent px-2.5 font-display text-[10px] font-bold uppercase text-[var(--muted)] last:border-r-0 disabled:cursor-not-allowed disabled:text-[var(--muted-dim)]',
                                selected && '!bg-[rgba(74,222,128,.10)] !text-[var(--green)]',
                              )}
                            >
                              {provider.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className={assistantFieldLabelClass}>
                      <span>Model</span>
                      <UiMenuSelect
                        value={selectedDefaultModelKey}
                        entries={defaultModelMenuEntries}
                        role="listbox"
                        itemRole="option"
                        title={selectedDefaultModelLabel}
                        header="Default model"
                        searchable
                        searchPlaceholder="Search models"
                        triggerLabel={compactModelSelectionLabel(selectedDefaultModelLabel)}
                        triggerClassName="h-[30px]"
                        placement="below"
                        panelClassName="w-[260px]"
                        disabled={busy || !assistantSettings || defaultModelMenuEntries.length === 0}
                        onValueChange={(value) => {
                          const [provider, nextModel, thinkingLevel] = value.split(':');
                          void updateAssistantSettings({ defaultProvider: provider, defaultModel: nextModel, defaultThinkingLevel: thinkingLevel });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <h2 className={assistantPanelTitleClass}>Global Tool Defaults</h2>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void updateAssistantSettings({ defaultEnabledTools: availableTools.map((tool) => tool.name) })}>
                      Enable all
                    </button>
                    <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void updateAssistantSettings({ defaultEnabledTools: [] })}>
                      Disable all
                    </button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="text-[11px] text-[var(--muted)]">{defaultEnabledToolNames.length} / {availableTools.length} enabled for profiles using global defaults.</div>
                  <div className="grid max-h-[360px] gap-1 overflow-y-auto pr-1">
                    {availableTools.map((tool) => {
                      const checked = defaultEnabledTools.has(tool.name);
                      return (
                        <label
                          key={tool.name}
                          className={cn(
                            'flex min-w-0 cursor-pointer items-start gap-2 rounded-[5px] border border-[var(--border-subtle)] bg-white/[.02] px-2 py-1.5',
                            checked && 'border-[rgba(139,92,246,.55)] bg-[rgba(139,92,246,.12)]',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={(event) => {
                              const next = new Set(defaultEnabledTools);
                              if (event.currentTarget.checked) next.add(tool.name);
                              else next.delete(tool.name);
                              void updateAssistantSettings({ defaultEnabledTools: [...next] });
                            }}
                            className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                          />
                          <span className="grid min-w-0 gap-px">
                            <strong className="truncate text-xs text-[var(--fg)]">{tool.label}</strong>
                            <small className="line-clamp-2 text-[11px] text-[var(--muted)]">{tool.description}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              <AssistantExtensionsPanel
                data={assistantExtensions}
                devices={devices}
                busy={busy}
                onUpdateRoute={(toolName, route) => void updateExtensionToolRoute(toolName, route)}
              />
                </>
              ) : null}

                {settingsPane === 'skills' ? (
                <section className={assistantPanelClass}>
                  <div className={assistantPanelHeaderClass}>
                    <div>
                      <h2 className={assistantPanelTitleClass}>Skills</h2>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => setSkillDraft(emptySkillDraft())}>
                        New
                      </button>
                      <button type="button" className={assistantActionButtonClass} disabled={busy || !skillDraft.name.trim() || !skillDraft.description.trim()} onClick={() => void saveAssistantSkill()}>
                        {skillDraft.id ? 'Save' : 'Create'}
                      </button>
                      <button type="button" className={assistantActionButtonClass} disabled={busy || !skillDraft.id} onClick={() => void deleteAssistantSkill()}>
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[minmax(220px,.34fr)_minmax(0,1fr)]">
                    <div className="grid content-start gap-1.5">
                      {assistantSkills.map((skill) => {
                        const selected = skill.id === skillDraft.id;
                        return (
                          <button
                            key={skill.id}
                            type="button"
                            className={cn(
                              'grid min-h-[58px] w-full content-center gap-1 rounded border border-[var(--border-subtle)] bg-white/[.02] px-2 py-1.5 text-left transition hover:border-[rgba(136,145,168,.36)] hover:bg-white/[.04]',
                              selected && 'border-[rgba(74,222,128,.30)] bg-[rgba(74,222,128,.08)]',
                            )}
                            disabled={busy}
                            onClick={() => setSkillDraft(draftFromAssistantSkill(skill))}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <strong className="min-w-0 truncate text-xs text-[var(--fg)]">{skill.name}</strong>
                              {skill.disableModelInvocation ? <small className="shrink-0 rounded border border-[var(--border-subtle)] px-1 text-[9px] uppercase text-[var(--muted)]">hidden</small> : null}
                            </span>
                            <small className="line-clamp-2 text-[11px] leading-snug text-[var(--muted)]">{skill.description}</small>
                          </button>
                        );
                      })}
                      {assistantSkills.length === 0 ? <div className={assistantEmptyClass}>No skills yet.</div> : null}
                    </div>

                    <div className="grid gap-2.5">
                      <div className="grid grid-cols-[minmax(160px,1fr)_minmax(120px,220px)] gap-2.5 max-[760px]:grid-cols-1">
                        <label className={assistantFieldLabelClass}>
                          Name
                          <input
                            value={skillDraft.name}
                            disabled={busy}
                            onChange={(event) => setSkillDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                            placeholder="Frontend design"
                          />
                        </label>
                        <label className={assistantFieldLabelClass}>
                          Slug
                          <input
                            value={skillDraft.slug}
                            disabled={busy}
                            onChange={(event) => setSkillDraft((current) => ({ ...current, slug: event.currentTarget.value }))}
                            placeholder="frontend-design"
                          />
                        </label>
                      </div>

                      <label className={assistantFieldLabelClass}>
                        Description
                        <textarea
                          value={skillDraft.description}
                          disabled={busy}
                          rows={3}
                          onChange={(event) => setSkillDraft((current) => ({ ...current, description: event.currentTarget.value }))}
                          placeholder="When this skill should be loaded."
                        />
                      </label>

                      <label className={assistantFieldLabelClass}>
                        Tool names
                        <input
                          value={skillDraft.toolNamesText}
                          disabled={busy}
                          onChange={(event) => setSkillDraft((current) => ({ ...current, toolNamesText: event.currentTarget.value }))}
                          placeholder="web_search, fetch_content, extension_id__tool"
                          list="assistant-skill-tool-options"
                        />
                      </label>
                      <datalist id="assistant-skill-tool-options">
                        {availableTools.map((tool) => <option key={tool.name} value={tool.name} />)}
                      </datalist>

                      <label className="flex min-w-0 cursor-pointer items-start gap-2 rounded-[5px] border border-[var(--border-subtle)] bg-white/[.02] px-2 py-1.5 text-[11px] text-[var(--muted)]">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                          checked={skillDraft.disableModelInvocation}
                          disabled={busy}
                          onChange={(event) => setSkillDraft((current) => ({ ...current, disableModelInvocation: event.currentTarget.checked }))}
                        />
                        <span className="grid gap-px">
                          <strong className="text-xs text-[var(--fg-secondary)]">Hide from assistant discovery</strong>
                          <small className="text-[11px] text-[var(--muted)]">Hidden skills stay saved and can still be loaded explicitly by name or slug.</small>
                        </span>
                      </label>

                      <label className={assistantFieldLabelClass}>
                        Instructions
                        <textarea
                          value={skillDraft.markdownBody}
                          disabled={busy}
                          rows={14}
                          onChange={(event) => setSkillDraft((current) => ({ ...current, markdownBody: event.currentTarget.value }))}
                          placeholder="# Skill instructions"
                        />
                      </label>
                    </div>
                  </div>
                </section>
              ) : null}

                {settingsPane === 'voice' ? (
                <>
              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <span className={assistantKickerClass}>Speech</span>
                    <h2 className={assistantPanelTitleClass}>Playback Target</h2>
                  </div>
                  <span className="text-[11px] text-[var(--muted)]">
                    Active: {speechPlayback?.resolvedTarget ?? 'none'}
                  </span>
                </div>
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {(['auto', 'web', 'desktop', 'android'] as SpeechPlaybackTarget[]).map((target) => (
                      <button
                        key={target}
                        type="button"
                        className={cn(
                          assistantActionButtonClass,
                          speechPlaybackTarget === target && 'border-[rgba(74,222,128,.28)] bg-[rgba(74,222,128,.08)] text-[var(--green)]',
                        )}
                        disabled={busy}
                        onClick={() => void updateSpeechPlaybackTarget(target)}
                      >
                        {target}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['web', 'desktop', 'android'] as const).map((target) => (
                      <span
                        key={target}
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase',
                          speechPlayback?.connectedTargets.includes(target)
                            ? 'border-[rgba(74,222,128,.22)] bg-[rgba(74,222,128,.08)] text-[var(--green)]'
                            : 'border-[var(--border-subtle)] bg-white/[.02] text-[var(--muted)]',
                        )}
                      >
                        {target}
                      </span>
                    ))}
                  </div>
                </div>
              </section>

              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <span className={assistantKickerClass}>Settings</span>
                    <h2 className={assistantPanelTitleClass}>Voice Approval</h2>
                  </div>
                </div>
                <form className="grid grid-cols-2 gap-2.5 max-[880px]:grid-cols-1" onSubmit={(event) => void saveApprovalSettings(event)}>
                  <label className={assistantFieldLabelClass}>
                    Trigger phrase
                    <input
                      value={approvalSettings.triggerPhrase}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateApprovalSettingsDraft({ triggerPhrase: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Sleep unlock phrase
                    <input
                      value={approvalSettings.unlockPhrase}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateApprovalSettingsDraft({ unlockPhrase: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Shutdown phrase
                    <input
                      value={approvalSettings.shutdownPhrase}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateApprovalSettingsDraft({ shutdownPhrase: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Sleep lock code
                    <input
                      value={approvalSettings.lockCode}
                      onChange={(event) => {
                        const value = codeValue(event.currentTarget.value);
                        updateApprovalSettingsDraft({ lockCode: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Min digits
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={approvalSettings.minDigits}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        updateApprovalSettingsDraft({ minDigits: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Max digits
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={approvalSettings.maxDigits}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        updateApprovalSettingsDraft({ maxDigits: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Stable ms
                    <input
                      type="number"
                      min={250}
                      max={3000}
                      value={approvalSettings.stableMs}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        updateApprovalSettingsDraft({ stableMs: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Collection timeout ms
                    <input
                      type="number"
                      min={1000}
                      max={15000}
                      value={approvalSettings.collectTimeoutMs}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        updateApprovalSettingsDraft({ collectTimeoutMs: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Duplicate cooldown ms
                    <input
                      type="number"
                      min={0}
                      max={15000}
                      value={approvalSettings.duplicateCooldownMs}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        updateApprovalSettingsDraft({ duplicateCooldownMs: value });
                      }}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Finalize interval ms
                    <input
                      type="number"
                      min={100}
                      max={1000}
                      value={approvalSettings.finalizeCheckIntervalMs}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        updateApprovalSettingsDraft({ finalizeCheckIntervalMs: value });
                      }}
                    />
                  </label>
                  <button type="submit" className={cn(assistantActionButtonClass, 'w-fit')} disabled={busy}>
                    Save Settings
                  </button>
                </form>
              </section>
                </>
              ) : null}

                {settingsPane === 'recordings' ? (
                <section className={assistantPanelClass}>
                  <div className={assistantPanelHeaderClass}>
                    <div>
                      <span className={assistantKickerClass}>Voice</span>
                      <h2 className={assistantPanelTitleClass}>Recent Recordings</h2>
                    </div>
                    <button type="button" className={assistantActionButtonClass} disabled={voiceRecordingsLoading} onClick={() => void loadVoiceRecordings()}>
                      Refresh
                    </button>
                  </div>
                  {voiceRecordingsError ? <div className="mb-2 rounded border border-[rgba(255,90,90,.24)] bg-[var(--red-subtle)] p-2 text-xs text-[var(--red)]">{voiceRecordingsError}</div> : null}
                  <div className="grid gap-3 xl:grid-cols-2">
                    {([
                      ['assistant', assistantRecordings],
                      ['clipboard', clipboardRecordings],
                    ] as Array<['assistant' | 'clipboard', VoiceRecordingRecord[]]>).map(([mode, recordings]) => (
                      <div key={mode} className="grid content-start gap-2">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <h3 className="m-0 font-display text-[12px] font-bold uppercase text-[var(--fg)]">{mode === 'assistant' ? 'Assistant' : 'Clipboard'}</h3>
                          <span className="text-[11px] text-[var(--muted)]">{recordings.length} / 10</span>
                        </div>
                        {recordings.map((recording) => (
                          <article key={recording.id} className={cn(assistantRowClass, 'grid gap-2 p-2.5')}>
                            <div className="grid gap-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <strong className="min-w-0 truncate text-xs text-[var(--fg)]">{recording.deviceName || recording.deviceId || 'Voice device'}</strong>
                                <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-display text-[9px] font-bold uppercase text-[var(--muted)]">
                                  {formatDurationMs(recording.durationMs)}
                                </span>
                                <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-display text-[9px] font-bold uppercase text-[var(--muted)]">
                                  {formatBytes(recording.sizeBytes)}
                                </span>
                              </div>
                              <time className="text-[11px] text-[var(--muted)]" title={exactTimeLabel(recording.createdAt)}>
                                {timeLabel(recording.createdAt)}
                              </time>
                            </div>
                            <audio controls preload="metadata" src={recordingAudioUrl(recording.id)} className="h-8 w-full" />
                            <div className="flex flex-wrap gap-1.5">
                              <a className={assistantActionButtonClass} href={recordingAudioUrl(recording.id, true)} download>
                                Download
                              </a>
                            </div>
                            <div className="max-h-[120px] overflow-y-auto rounded border border-[var(--border-subtle)] bg-black/[.10] p-2 text-xs leading-relaxed text-[var(--fg-secondary)]">
                              {recording.transcriptText ? recording.transcriptText : <span className="text-[var(--muted)]">No paired transcript.</span>}
                            </div>
                          </article>
                        ))}
                        {recordings.length === 0 ? (
                          <div className={assistantEmptyClass}>
                            {voiceRecordingsLoading ? 'Loading recordings.' : `No ${mode} recordings yet.`}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

                {settingsPane === 'activity' ? (
                <section className={assistantPanelClass}>
                  <div className={assistantPanelHeaderClass}>
                    <div>
                      <span className={assistantKickerClass}>Runtime</span>
                      <h2 className={assistantPanelTitleClass}>Logs</h2>
                    </div>
                    <button type="button" className={assistantActionButtonClass} onClick={() => void copyLogs()}>
                      Copy Logs
                    </button>
                  </div>
                  <div className="grid gap-2">
                    {logs.map((log) => (
                      <article key={log.id} className={cn(assistantRowClass, 'grid grid-cols-[92px_120px_minmax(0,1fr)_auto] items-center gap-2 p-2 max-[620px]:grid-cols-1')}>
                        <span className={cn('w-fit rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', log.level === 'error' ? 'border-[rgba(255,90,90,.24)] bg-[var(--red-subtle)] text-[var(--red)]' : 'border-[rgba(74,222,128,.22)] bg-[var(--green-subtle)] text-[var(--green)]')}>{log.level}</span>
                        <span className="text-xs text-[var(--muted)]">{log.source}</span>
                        <strong className="min-w-0 text-xs text-[var(--fg)]">{log.message}</strong>
                        <time className="text-xs text-[var(--muted)]">{timeLabel(log.createdAt)}</time>
                      </article>
                    ))}
                    {logs.length === 0 ? <div className={assistantEmptyClass}>No logs yet.</div> : null}
                  </div>
                </section>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeView === 'admin' ? (
            dashboard?.user.admin ? (
              <section className="grid min-h-0 gap-3 overflow-auto p-3">
                <section className={assistantPanelClass}>
                  <div className={assistantPanelHeaderClass}>
                    <div>
                      <span className={assistantKickerClass}>Admin</span>
                      <h2 className={assistantPanelTitleClass}>Users & Credits</h2>
                    </div>
                    <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={() => void loadDashboard({ includeAssistant: false })}>
                      Refresh
                    </button>
                  </div>
                  <div className="grid gap-2">
                    {adminUsers.map((item) => {
                      const draft = creditGrantDrafts[item.user.id] ?? { amountCredits: '', reason: '' };
                      const lastSeenExact = item.user.lastSeenAt ? exactTimeLabel(item.user.lastSeenAt) : '';
                      const lastSeenRelative = item.user.lastSeenAt ? relativeTimeAgo(item.user.lastSeenAt) : 'never';
                      const canGrant = Number(draft.amountCredits) > 0;
                      return (
                        <article key={item.user.id} className={cn(assistantRowClass, 'grid grid-cols-[minmax(180px,1.4fr)_120px_120px_120px_minmax(240px,1.3fr)] items-center gap-3 p-3 max-[1040px]:grid-cols-2 max-[680px]:grid-cols-1')}>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <strong className="min-w-0 truncate text-xs text-[var(--fg)]">{item.user.email || item.user.displayName || item.user.id}</strong>
                              {item.user.admin ? <span className="rounded border border-[rgba(74,222,128,.24)] bg-[rgba(74,222,128,.08)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--green)]">Admin</span> : null}
                            </div>
                            <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
                              <span className="min-w-0 truncate">{item.user.displayName || 'No name'}</span>
                              <span title={lastSeenExact}>Last seen {lastSeenRelative}</span>
                            </div>
                          </div>
                          <div className="grid gap-0.5">
                            <span className={assistantKickerClass}>Threads</span>
                            <strong className="text-sm text-[var(--fg)]">{item.threadCount}</strong>
                          </div>
                          <div className="grid gap-0.5">
                            <span className={assistantKickerClass}>Profiles</span>
                            <strong className="text-sm text-[var(--fg)]">{item.assistantProfileCount}</strong>
                          </div>
                          <div className="grid gap-0.5">
                            <span className={assistantKickerClass}>Credits</span>
                            <strong className="text-sm text-[var(--fg)]">{formatCredits(item.creditBalanceMicrocredits)}</strong>
                            <small className="text-[10px] text-[var(--muted)]">
                              Granted {formatCredits(item.creditsGrantedMicrocredits)} · Spent {formatCredits(item.creditsSpentMicrocredits)}
                            </small>
                          </div>
                          <form
                            className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 max-[520px]:grid-cols-1"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void grantAdminCredits(item.user.id);
                            }}
                          >
                            <input
                              value={draft.amountCredits}
                              onChange={(event) => updateCreditGrantDraft(item.user.id, { amountCredits: event.currentTarget.value })}
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Credits"
                              disabled={busy}
                              className="h-8 min-w-0"
                            />
                            <input
                              value={draft.reason}
                              onChange={(event) => updateCreditGrantDraft(item.user.id, { reason: event.currentTarget.value })}
                              placeholder="Reason"
                              disabled={busy}
                              className="h-8 min-w-0"
                            />
                            <button type="submit" className={assistantActionButtonClass} disabled={busy || !canGrant}>
                              Grant
                            </button>
                          </form>
                        </article>
                      );
                    })}
                    {adminUsers.length === 0 ? <div className={assistantEmptyClass}>No users yet.</div> : null}
                  </div>
                </section>

                <section className={assistantPanelClass}>
                  <div className={assistantPanelHeaderClass}>
                    <div>
                      <span className={assistantKickerClass}>Admin</span>
                      <h2 className={assistantPanelTitleClass}>App Releases</h2>
                    </div>
                  </div>
                  <div className="mb-3 grid gap-2 rounded border border-[var(--border-subtle)] bg-white/[.02] p-3">
                    <span className={assistantKickerClass}>Current downloads</span>
                    <AppDownloadLinks androidInfo={androidApkInfo} desktopInfo={desktopAppInfo} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-[880px]:grid-cols-1">
                    <section className="grid gap-2.5 rounded border border-[var(--border-subtle)] bg-white/[.02] p-3">
                      <div>
                        <span className={assistantKickerClass}>Desktop</span>
                        <h3 className="m-0 mt-1 text-sm leading-tight text-[var(--fg)]">Upload desktop app</h3>
                      </div>
                      <label
                        className={cn(
                          'grid min-h-[132px] cursor-pointer place-items-center gap-2 rounded border border-dashed border-[var(--border)] bg-black/[.12] p-4 text-center transition hover:border-[rgba(167,139,250,.52)] hover:bg-white/[.035]',
                          busy && 'pointer-events-none opacity-50',
                        )}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => void droppedFiles(event).then((files) => uploadDesktopReleaseFiles(files))}
                      >
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          accept=".tar.gz,.tgz,.zip,.dmg,.exe,.AppImage,.json,application/gzip,application/zip,application/json"
                          onChange={(event) => void uploadDesktopReleaseFiles(fileList(event.currentTarget.files))}
                        />
                        <span className="font-display text-[10px] font-bold uppercase text-[var(--fg-secondary)]">{busy ? 'Uploading...' : 'Drop desktop build folder or archive + latest.json'}</span>
                        <small className="max-w-full truncate text-[11px] text-[var(--muted)]">{adminDesktopFile ? `${adminDesktopFile.name} / ${formatBytes(adminDesktopFile.size)}` : 'Click to choose the archive and companion latest.json'}</small>
                        <small className="text-[10px] text-[var(--muted-dim)]">Current: {appDownloadMeta(desktopAppInfo)}</small>
                      </label>
                    </section>

                    <section className="grid gap-2.5 rounded border border-[var(--border-subtle)] bg-white/[.02] p-3">
                      <div>
                        <span className={assistantKickerClass}>Android</span>
                        <h3 className="m-0 mt-1 text-sm leading-tight text-[var(--fg)]">Upload Android APK</h3>
                      </div>
                      <label
                        className={cn(
                          'grid min-h-[132px] cursor-pointer place-items-center gap-2 rounded border border-dashed border-[var(--border)] bg-black/[.12] p-4 text-center transition hover:border-[rgba(167,139,250,.52)] hover:bg-white/[.035]',
                          busy && 'pointer-events-none opacity-50',
                        )}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => void droppedFiles(event).then((files) => uploadAndroidReleaseFiles(files))}
                      >
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          accept=".apk,.json,application/vnd.android.package-archive,application/json"
                          onChange={(event) => void uploadAndroidReleaseFiles(fileList(event.currentTarget.files))}
                        />
                        <span className="font-display text-[10px] font-bold uppercase text-[var(--fg-secondary)]">{busy ? 'Uploading...' : 'Drop Android build folder or APK + metadata'}</span>
                        <small className="max-w-full truncate text-[11px] text-[var(--muted)]">{adminAndroidFile ? `${adminAndroidFile.name} / ${formatBytes(adminAndroidFile.size)}` : 'Click to choose the APK and latest.json or output-metadata.json'}</small>
                        <small className="text-[10px] text-[var(--muted-dim)]">Current: {appDownloadMeta(androidApkInfo)}</small>
                      </label>
                    </section>
                  </div>
                </section>

                <section className={assistantPanelClass}>
                  <div className={assistantPanelHeaderClass}>
                    <div>
                      <span className={assistantKickerClass}>Admin</span>
                      <h2 className={assistantPanelTitleClass}>Device Monitor</h2>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {dashboard.adminDevices.map((device) => (
                      <article key={device.id} className={cn(assistantRowClass, 'grid grid-cols-[minmax(0,1fr)_120px_140px_auto] items-center gap-2 p-2 max-[620px]:grid-cols-1')}>
                        <strong className="min-w-0 text-xs text-[var(--fg)]">{device.displayName}</strong>
                        <span className="text-xs text-[var(--muted)]">{device.deviceType}</span>
                        <span className="text-xs text-[var(--muted)]">token {device.tokenHint}...</span>
                        <time className="text-xs text-[var(--muted)]">{timeLabel(device.lastSeenAt)}</time>
                      </article>
                    ))}
                    {dashboard.adminClientStatuses.map((status) => (
                      <article key={`admin-status-${status.deviceId}`} className="grid grid-cols-[minmax(0,1fr)_120px_140px_auto] items-center gap-2 rounded-[7px] border border-[rgba(74,222,128,.18)] bg-[rgba(74,222,128,.06)] p-2 text-[var(--fg-secondary)] max-[620px]:grid-cols-1">
                        <strong className="min-w-0 text-xs text-[var(--fg)]">{status.displayName}</strong>
                        <span className="text-xs text-[var(--muted)]">{status.mode}</span>
                        <span className="text-xs text-[var(--muted)]">{status.microphone || status.status}</span>
                        <time className="text-xs text-[var(--muted)]">{timeLabel(status.updatedAt)}</time>
                      </article>
                    ))}
                    {dashboard.adminDevices.length === 0 ? <div className={assistantEmptyClass}>No connected devices yet.</div> : null}
                  </div>
                </section>
              </section>
            ) : (
              <div className={assistantEmptyClass}>Admin access required.</div>
            )
          ) : null}
        </section>
      </section>
      {threadDeleteCandidate ? (
        <ThreadDeleteConfirmModal
          thread={threadDeleteCandidate}
          busy={busy}
          onCancel={() => setThreadDeleteCandidate(null)}
          onConfirm={() => void deleteThread(threadDeleteCandidate.id)}
        />
      ) : null}
      {artifactDeleteCandidate ? (
        <ArtifactDeleteConfirmModal
          artifact={artifactDeleteCandidate}
          busy={busy}
          onCancel={() => setArtifactDeleteCandidate(null)}
          onConfirm={() => void deleteArtifact(artifactDeleteCandidate)}
        />
      ) : null}
      <AssistantSystemPromptModal
        open={systemPromptOpen}
        threadTitle={activeThread?.title ?? ''}
        mode={systemPromptMode}
        onModeChange={setSystemPromptMode}
        threadDraft={threadSystemPromptDraft}
        onThreadDraftChange={setThreadSystemPromptDraft}
        voiceDraft={voiceSystemPromptDraft}
        onVoiceDraftChange={setVoiceSystemPromptDraft}
        inheritedPrompt={activeInheritedSystemPrompt}
        maxChars={ASSISTANT_SYSTEM_PROMPT_MAX_CHARS}
        saving={systemPromptSaving}
        promoteSaving={promoteSystemPromptSaving}
        error={systemPromptError}
        notice={systemPromptNotice}
        onClose={() => setSystemPromptOpen(false)}
        onSaveThread={() => void saveThreadSystemPrompt()}
        onSaveGlobal={() => void saveGlobalSystemPrompt()}
        onPromoteThread={() => void promoteThreadSystemPrompt()}
        onUseInherited={() => setThreadSystemPromptDraft('')}
        onResetGlobal={() => setVoiceSystemPromptDraft(ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT)}
      />
    </main>
  );
}

function DesktopVoicePanel({ client, onRefresh }: { client: ApiClient; onRefresh: () => Promise<void> }) {
  const [deviceName, setDeviceName] = React.useState('Electron desktop');
  const [status, setStatus] = React.useState('Ready');
  const [mode, setMode] = React.useState<VoiceMode>('off');
  const [streaming, setStreaming] = React.useState(false);
  const [voiceSettings, setVoiceSettings] = React.useState<VoiceSettings | null>(null);
  const [device, setDevice] = React.useState<{ id: string; token: string } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(desktopDeviceStorageKey) || 'null');
    } catch {
      return null;
    }
  });
  const refs = React.useRef<{
    socket?: WebSocket;
    stream?: MediaStream;
    context?: AudioContext;
    processor?: ScriptProcessorNode;
    recognition?: any;
    wakeStream?: MediaStream;
    wakeContext?: AudioContext;
    wakeProcessor?: ScriptProcessorNode;
    wakeUnsubscribe?: () => void;
    wakeStarting?: boolean;
  }>({});
  const modeRef = React.useRef(mode);
  const streamingRef = React.useRef(streaming);
  const lastRecognizedRef = React.useRef({ text: '', at: 0 });
  const sleepPhraseCandidateRef = React.useRef<{ match: 'unlock' | 'shutdown'; firstSeenAt: number; lastSeenAt: number; hits: number } | null>(null);
  const controlSocketRef = React.useRef<WebSocket | null>(null);
  const approvalRecognizerRef = React.useRef(new ApprovalCodeRecognizer());
  const approvalFinalizeTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    void loadVoiceSettings();
    return () => {
      if (approvalFinalizeTimerRef.current !== null) {
        window.clearTimeout(approvalFinalizeTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    modeRef.current = mode;
    setSpeechPlaybackMode(mode);
    if (mode !== 'sleeping') sleepPhraseCandidateRef.current = null;
  }, [mode]);

  React.useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  React.useEffect(() => {
    ensureControlSocket(device);
    return () => {
      controlSocketRef.current?.close();
      controlSocketRef.current = null;
    };
  }, [device?.id]);

  function resetApprovalCollection() {
    if (approvalFinalizeTimerRef.current !== null) {
      window.clearTimeout(approvalFinalizeTimerRef.current);
      approvalFinalizeTimerRef.current = null;
    }
    approvalRecognizerRef.current.reset();
  }

  function scheduleApprovalFinalize() {
    if (approvalFinalizeTimerRef.current !== null) {
      window.clearTimeout(approvalFinalizeTimerRef.current);
    }
    approvalFinalizeTimerRef.current = window.setTimeout(() => {
      approvalFinalizeTimerRef.current = null;
      handleApprovalUpdate(approvalRecognizerRef.current.flush(Date.now()));
      if (approvalRecognizerRef.current.isCollecting && modeRef.current !== 'off') {
        scheduleApprovalFinalize();
      }
    }, approvalRecognizerRef.current.finalizeCheckIntervalMs());
  }

  function showCollectingStatus(partialCode: string) {
    const nextStatus = partialCode
      ? `Approval: ${partialCode}`
      : 'Approval code...';
    setStatus(nextStatus);
    void reportDesktopStatus(modeRef.current, nextStatus);
  }

  function handleApprovalUpdate(update: ApprovalCodeUpdate): boolean {
    if (update.type === 'none') return false;
    if (update.type === 'collecting') {
      showCollectingStatus(update.partialCode);
      return true;
    }
    if (update.type === 'cancelled') {
      setStatus('Approval cancelled.');
      void reportDesktopStatus(modeRef.current, 'Approval cancelled.');
      return true;
    }
    void processApprovalCode(update.code);
    return true;
  }

  function acceptApprovalText(text: string, finalizeNow = false): boolean {
    const now = Date.now();
    let update = approvalRecognizerRef.current.accept(text, now);
    if (approvalRecognizerRef.current.isCollecting) {
      if (finalizeNow) {
        update = approvalRecognizerRef.current.flush(now + (voiceSettings?.stableMs ?? 900));
      } else {
        scheduleApprovalFinalize();
      }
    }
    if (update.type === 'none') {
      return approvalRecognizerRef.current.isCollecting;
    }
    return handleApprovalUpdate(update);
  }

  async function loadVoiceSettings(): Promise<VoiceSettings> {
    const data = await client.request<{ ok: true; settings: VoiceSettings }>('/api/settings/voice-approval');
    const next = data.settings;
    setVoiceSettings(next);
    approvalRecognizerRef.current.configure(approvalRecognizerOptions(next));
    return next;
  }

  async function pairDesktop() {
    const data = await client.request<{ ok: true; device: DeviceRecord; token: string }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify({ deviceType: 'desktop', displayName: deviceName }),
    });
    const next = { id: data.device.id, token: data.token };
    localStorage.setItem(desktopDeviceStorageKey, JSON.stringify(next));
    setDevice(next);
    ensureControlSocket(next);
    setStatus(`Paired ${data.device.displayName}.`);
    await onRefresh();
  }

  async function reportDesktopStatus(nextMode = modeRef.current, nextStatus = status) {
    const activeDevice = device;
    if (!activeDevice) return;
    if (controlSocketRef.current?.readyState === WebSocket.OPEN) {
      controlSocketRef.current.send(JSON.stringify({
        type: 'client_status',
        mode: nextMode,
        status: nextStatus,
        microphone: 'Desktop microphone',
        protocolVersion: 1,
        appVersion: 'electron',
        reportedAt: new Date().toISOString(),
      }));
      return;
    }
    ensureControlSocket(activeDevice);
    await client.request(`/api/devices/${encodeURIComponent(activeDevice.id)}/status`, {
      method: 'POST',
      body: JSON.stringify({
        token: activeDevice.token,
        mode: nextMode,
        status: nextStatus,
        microphone: window.voiceStreamDesktop?.isDesktop ? 'Desktop microphone' : '',
        protocolVersion: 1,
        appVersion: 'electron',
      }),
    }).catch(() => undefined);
  }

  function ensureControlSocket(activeDevice = device) {
    if (!activeDevice || controlSocketRef.current?.readyState === WebSocket.OPEN || controlSocketRef.current?.readyState === WebSocket.CONNECTING) return;
    const url = new URL(`/api/devices/${encodeURIComponent(activeDevice.id)}/control`, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', activeDevice.token);
    const socket = new WebSocket(url);
    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'client_status',
        mode: modeRef.current,
        status,
        microphone: 'Desktop microphone',
        protocolVersion: 1,
        appVersion: 'electron',
        reportedAt: new Date().toISOString(),
      }));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = JSON.parse(event.data);
      if (message.type === 'server_ping') {
        socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
        return;
      }
      if (message.type === 'speech_audio') {
        const audioBase64 = String(message.audioBase64 ?? '').trim();
        const contentType = String(message.contentType ?? 'audio/wav').trim() || 'audio/wav';
        if (audioBase64) queueSpeechAudio(audioBase64, contentType, { requireAwakeMode: true });
        return;
      }
      if (message.type === 'server_command') {
        void handleRemoteControlCommand(message, socket);
      }
    };
    socket.onclose = () => {
      if (controlSocketRef.current === socket) controlSocketRef.current = null;
    };
    socket.onerror = () => {
      if (controlSocketRef.current === socket) controlSocketRef.current = null;
    };
    controlSocketRef.current = socket;
  }

  async function handleRemoteControlCommand(message: any, socket: WebSocket) {
    const command = String(message?.command ?? '');
    const commandId = String(message?.commandId ?? '');
    const ack = (payload: Record<string, unknown>) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'command_ack', commandId, command, ...payload }));
    };
    try {
      if (command === 'query_status') {
        ack({ ok: true, mode: modeRef.current, status });
        void reportDesktopStatus(modeRef.current, status);
        return;
      }
      if (command === 'sleep') {
        enterSleep();
        ack({ ok: true, mode: 'sleeping', status: 'Sleeping.' });
        return;
      }
      if (command === 'off') {
        turnOff();
        ack({ ok: true, mode: 'off', status: 'Off.' });
        return;
      }
      if (command === 'awake') {
        enterAwake();
        ack({ ok: true, mode: 'awake', status: 'Awake.' });
        return;
      }
      ack({ ok: false, error: 'unknown command' });
    } catch (err: any) {
      ack({ ok: false, error: err?.message ?? String(err) });
    }
  }

  async function startVoice(target: VoiceStreamTarget = 'assistant', assistantProfileId?: string | null) {
    stopWakeListener();
    let activeDevice = device;
    if (!activeDevice) {
      await pairDesktop();
      activeDevice = JSON.parse(localStorage.getItem(desktopDeviceStorageKey) || 'null');
    }
    if (!activeDevice) return;
    const session = await client.request<{ ok: true; session: { id: string } }>('/api/voice/sessions', {
      method: 'POST',
      body: JSON.stringify({ deviceId: activeDevice.id, mode: target, ...(assistantProfileId ? { assistantProfileId } : {}) }),
    });
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext({ sampleRate: 16_000 });
    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const socket = openDesktopVoiceSocket(activeDevice, session.session.id, target, assistantProfileId);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'electron-web', mode: target }));
    };
    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(floatToPcm16(event.inputBuffer.getChannelData(0)));
    };
    socket.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'assistant_result') {
            const nextStatus = `Transcript: ${message.transcript || 'empty'} / Reply: ${message.assistantText || 'empty'}`;
            await finishVoiceFromServer(nextStatus);
            void onRefresh();
          } else if (message.type === 'transcript_result') {
            await finishVoiceFromServer(message.status || 'Transcript patched into chat.');
            void onRefresh();
          } else if (message.type === 'finish') {
            let nextStatus = 'Awake. Waiting for voice command.';
            if (target === 'clipboard') {
              const copied = await copyText(message.transcriptText || '');
              nextStatus = copied ? 'Copied voice transcription.' : 'No voice transcription detected.';
            }
            await finishVoiceFromServer(nextStatus);
            void onRefresh();
          } else if (message.type === 'sleep') {
            if (target === 'clipboard' && message.transcriptText) {
              await copyText(message.transcriptText || '');
            }
            await finishVoiceFromServer('Sleeping. Say your unlock or shutdown phrase.', 'sleeping');
            void onRefresh();
          } else if (message.type === 'assistant_error') {
            await finishVoiceFromServer(message.error || 'Voice runtime failed.');
          } else if (message.type === 'server_ping') {
            socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
          }
        } catch {
          setStatus(event.data);
        }
        return;
      }
      queueSpeechAudioBytes(event.data, 'audio/wav', { requireAwakeMode: true });
    };
    source.connect(processor);
    processor.connect(context.destination);
    refs.current = { socket, stream: media, context, processor };
    setStreaming(true);
    setMode('recording');
    setStatus(recordingStatus(target));
    void reportDesktopStatus('recording', recordingStatus(target));
  }

  async function stopVoice(nextMode: VoiceMode = 'awake') {
    const socket = refs.current.socket;
    socket?.send(JSON.stringify({ type: 'end' }));
    setTimeout(() => socket?.close(), 1200);
    refs.current.processor?.disconnect();
    refs.current.stream?.getTracks().forEach((track) => track.stop());
    await refs.current.context?.close().catch(() => undefined);
    refs.current = {};
    setStreaming(false);
    setMode(nextMode);
    setStatus('Voice stream stopped.');
    void reportDesktopStatus(nextMode, 'Voice stream stopped.');
    if (nextMode === 'sleeping') {
      await enterStoppedSleep('Voice stream stopped.');
    } else if (nextMode !== 'off') {
      startWakeListener();
    }
  }

  async function finishVoiceFromServer(nextStatus: string, nextMode: VoiceMode = 'awake') {
    refs.current.socket?.close();
    refs.current.processor?.disconnect();
    refs.current.stream?.getTracks().forEach((track) => track.stop());
    await refs.current.context?.close().catch(() => undefined);
    refs.current = {};
    setStreaming(false);
    setMode(nextMode);
    setStatus(nextStatus);
    void reportDesktopStatus(nextMode, nextStatus);
    if (nextMode === 'sleeping') {
      await enterStoppedSleep(nextStatus);
    } else {
      startWakeListener();
    }
  }

  async function enterStoppedSleep(nextStatus = 'Sleeping. Say your unlock or shutdown phrase.') {
    stopSpeechAudioPlayback({ clearQueue: true });
    resetApprovalCollection();
    setMode('sleeping');
    setStatus(nextStatus);
    void reportDesktopStatus('sleeping', nextStatus);
    const settings = await loadVoiceSettings().catch(() => null);
    if (settings) void window.voiceStreamDesktop?.setVoskGrammar?.('sleep', settings);
    startWakeListener();
  }

  async function enterAwake() {
    resetApprovalCollection();
    setMode('awake');
    void reportDesktopStatus('awake', 'Awake. Listening for voice commands.');
    const settings = await loadVoiceSettings().catch(() => null);
    if (settings) void window.voiceStreamDesktop?.setVoskGrammar?.('awake', settings);
    startWakeListener();
  }

  async function enterSleep() {
    if (streaming) void stopVoice('sleeping');
    stopSpeechAudioPlayback({ clearQueue: true });
    resetApprovalCollection();
    setMode('sleeping');
    const settings = await loadVoiceSettings().catch(() => null);
    setStatus('Sleeping. Say your unlock or shutdown phrase.');
    void reportDesktopStatus('sleeping', 'Sleeping. Say your unlock or shutdown phrase.');
    if (settings) void window.voiceStreamDesktop?.setVoskGrammar?.('sleep', settings);
    startWakeListener();
  }

  function turnOff() {
    if (streaming) void stopVoice('off');
    stopSpeechAudioPlayback({ clearQueue: true });
    stopWakeListener();
    resetApprovalCollection();
    setMode('off');
    setStatus('Off.');
    void reportDesktopStatus('off', 'Off.');
  }

  function stableSleepPhraseMatchForText(text: string, settings: VoiceSettings | null, finalResult = false): 'unlock' | 'shutdown' | null {
    if (!settings) {
      sleepPhraseCandidateRef.current = null;
      return null;
    }
    const match = sleepPhraseMatch(text, settings.unlockPhrase, settings.shutdownPhrase);
    if (!match) {
      sleepPhraseCandidateRef.current = null;
      return null;
    }
    if (finalResult) {
      sleepPhraseCandidateRef.current = null;
      return match;
    }
    const now = Date.now();
    const candidate = sleepPhraseCandidateRef.current;
    if (!candidate || candidate.match !== match || now - candidate.lastSeenAt > SLEEP_PHRASE_MAX_GAP_MS) {
      sleepPhraseCandidateRef.current = { match, firstSeenAt: now, lastSeenAt: now, hits: 1 };
      return null;
    }
    candidate.hits += 1;
    candidate.lastSeenAt = now;
    if (candidate.hits >= SLEEP_PHRASE_MIN_HITS && now - candidate.firstSeenAt >= SLEEP_PHRASE_STABLE_MS) {
      sleepPhraseCandidateRef.current = null;
      return match;
    }
    return null;
  }

  async function processPhraseText(text: string, finalizeNow = false, finalResult = false) {
    const currentMode = modeRef.current;
    const settings = await loadVoiceSettings().catch(() => null);
    if (currentMode !== 'sleeping' && acceptApprovalText(text, finalizeNow)) return;
    if (currentMode === 'recording') {
      setStatus('Recording. Voice commands are ignored until capture stops.');
      return;
    }
    if (currentMode === 'sleeping') {
      const sleepMatch = stableSleepPhraseMatchForText(text, settings, finalResult);
      if (sleepMatch === 'unlock') {
        setMode('awake');
        setStatus('Unlocked.');
        void reportDesktopStatus('awake', 'Unlocked.');
        const awakeSettings = await loadVoiceSettings().catch(() => settings);
        if (awakeSettings) void window.voiceStreamDesktop?.setVoskGrammar?.('awake', awakeSettings);
        startWakeListener();
        return;
      }
      if (sleepMatch === 'shutdown') {
        turnOff();
        return;
      }
      setStatus('Sleeping. Say your unlock or shutdown phrase.');
      return;
    }
    if (settings && matchesPhrase(text, settings.shutdownPhrase)) {
      turnOff();
      return;
    }
    const match = wakePhraseMatch(text, settings?.assistantProfiles);
    if (!match) {
      setStatus('No wake command matched.');
      return;
    }
    if (match.command === 'sleep') {
      enterSleep();
      return;
    }
    if (match.command === 'stop_audio') {
      const stopped = stopSpeechAudioPlayback({ clearQueue: false });
      setStatus(stopped ? 'Assistant audio stopped.' : 'No assistant audio is playing.');
      void reportDesktopStatus(currentMode, stopped ? 'Assistant audio stopped.' : 'No assistant audio is playing.');
      return;
    }
    if (match.command === 'repeat_audio') {
      const repeated = repeatLastSpeechAudioPlayback();
      setStatus(repeated ? 'Repeating assistant audio.' : 'No assistant audio to repeat.');
      void reportDesktopStatus(currentMode, repeated ? 'Repeating assistant audio.' : 'No assistant audio to repeat.');
      return;
    }
    if (match.command === 'status') {
      setStatus(`Mode: ${currentMode}. Device: ${device?.id ? device.id.slice(0, 12) : 'unpaired'}.`);
      return;
    }
    if (currentMode === 'off') enterAwake();
    await startVoice(match.command === 'patch' || match.command === 'clipboard' ? match.command : 'assistant', match.assistantProfileId);
  }

  function startWakeListener() {
    if (refs.current.wakeStarting || refs.current.wakeStream || refs.current.recognition) {
      setStatus(wakeListenerStatus());
      return;
    }
    if (window.voiceStreamDesktop?.startVosk && window.voiceStreamDesktop.sendVoskFrame && window.voiceStreamDesktop.onVoskText) {
      void startVoskWakeListener().then((started) => {
        if (!started) startSpeechWakeListener();
      });
      return;
    }
    startSpeechWakeListener();
  }

  async function startVoskWakeListener(): Promise<boolean> {
    const desktop = window.voiceStreamDesktop;
    if (!desktop?.startVosk || !desktop.sendVoskFrame || !desktop.onVoskText) return false;
    refs.current.wakeStarting = true;
    try {
      const status = await desktop.startVosk();
      if (!status.available) {
        setStatus(status.error ? `Vosk unavailable: ${status.error}` : 'Wake listener unavailable.');
        return false;
      }

      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext({ sampleRate: 16_000 });
      const source = context.createMediaStreamSource(media);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const unsubscribe = desktop.onVoskText((result) => {
        const text = result.text?.trim();
        if (!text) return;
        const now = Date.now();
        if (modeRef.current !== 'sleeping' && text === lastRecognizedRef.current.text && now - lastRecognizedRef.current.at < 1500) return;
        lastRecognizedRef.current = { text, at: now };
        void processPhraseText(text, false, Boolean(result.final)).catch((err) => setStatus(err?.message ?? String(err)));
      });

      processor.onaudioprocess = (event) => {
        desktop.sendVoskFrame?.(floatToPcm16(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      refs.current.wakeStream = media;
      refs.current.wakeContext = context;
      refs.current.wakeProcessor = processor;
      refs.current.wakeUnsubscribe = unsubscribe;
      setStatus(wakeListenerStatus('Awake. Listening with Vosk.'));
      return true;
    } catch (err: any) {
      stopVoskWakeListener();
      setStatus(err?.message ? `Vosk listener failed: ${err.message}` : 'Vosk listener failed.');
      return false;
    } finally {
      refs.current.wakeStarting = false;
    }
  }

  function startSpeechWakeListener() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus(modeRef.current === 'sleeping' ? sleepingStatusText() : 'Awake. Wake recognition is unavailable in this runtime.');
      return;
    }
    if (refs.current.recognition) {
      setStatus(wakeListenerStatus());
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      const text = result?.[0]?.transcript?.trim();
      if (!text) return;
      const now = Date.now();
      if (modeRef.current !== 'sleeping' && text === lastRecognizedRef.current.text && now - lastRecognizedRef.current.at < 1500) return;
      lastRecognizedRef.current = { text, at: now };
      void processPhraseText(text, false, Boolean(result?.isFinal));
    };
    recognition.onerror = () => setStatus('Wake listener paused.');
    recognition.onend = () => {
      refs.current.recognition = undefined;
      if (modeRef.current !== 'off' && !streamingRef.current) {
        window.setTimeout(() => startWakeListener(), 350);
      }
    };
    refs.current.recognition = recognition;
    try {
      recognition.start();
      setStatus(wakeListenerStatus());
    } catch {
      refs.current.recognition = undefined;
      setStatus(modeRef.current === 'sleeping' ? sleepingStatusText() : 'Awake. Wake recognition is unavailable in this runtime.');
    }
  }

  function sleepingStatusText() {
    return modeRef.current === 'sleeping' && status ? status : 'Sleeping.';
  }

  function wakeListenerStatus(awakeStatus = 'Awake. Listening for voice commands.') {
    return modeRef.current === 'sleeping' ? sleepingStatusText() : awakeStatus;
  }

  function stopWakeListener() {
    sleepPhraseCandidateRef.current = null;
    stopVoskWakeListener();
    const recognition = refs.current.recognition;
    if (!recognition) return;
    recognition.onend = null;
    refs.current.recognition = undefined;
    try {
      recognition.stop();
    } catch {
      // Ignore SpeechRecognition stop errors from already-ended sessions.
    }
  }

  function stopVoskWakeListener() {
    refs.current.wakeUnsubscribe?.();
    refs.current.wakeUnsubscribe = undefined;
    refs.current.wakeProcessor?.disconnect();
    refs.current.wakeProcessor = undefined;
    refs.current.wakeStream?.getTracks().forEach((track) => track.stop());
    refs.current.wakeStream = undefined;
    void refs.current.wakeContext?.close().catch(() => undefined);
    refs.current.wakeContext = undefined;
    void window.voiceStreamDesktop?.stopVosk?.();
  }

  async function processApprovalCode(code: string) {
    const settings = voiceSettings ?? await loadVoiceSettings();
    const currentMode = modeRef.current;
    if (currentMode === 'sleeping') {
      setStatus('Sleeping. Say your unlock or shutdown phrase.');
      return;
    }
    if (code === settings.lockCode) {
      enterSleep();
      return;
    }
    await client.request('/api/voice/approval-codes', {
      method: 'POST',
      body: JSON.stringify({ code, source: 'desktop' }),
    });
    setStatus(`Approval sent: ${code}.`);
    await onRefresh();
  }

  async function togglePrimaryVoice() {
    if (streamingRef.current || modeRef.current === 'recording') {
      await stopVoice();
      return;
    }
    if (modeRef.current === 'awake') {
      enterSleep();
      return;
    }
    enterAwake();
  }

  const primaryLabel = mode === 'off'
    ? 'Off'
    : mode === 'awake'
      ? 'Awake'
      : mode === 'sleeping'
        ? 'Sleeping'
        : 'Recording';
  const primaryAction = mode === 'off'
    ? 'Start voice'
    : mode === 'awake'
      ? 'Sleep'
      : mode === 'sleeping'
        ? 'Wake'
        : 'Stop';

  return (
    <section className="desktop-voice-focus">
      <div className="desktop-voice-copy">
        <div className="kicker">Assistant microphone</div>
        <h2>Voice control</h2>
        <p>{device ? `${deviceName} connected` : 'Connect this desktop, then start voice.'}</p>
      </div>

      <button
        type="button"
        className={`desktop-voice-orb is-${mode}`}
        onClick={() => void togglePrimaryVoice()}
        aria-pressed={mode === 'awake' || mode === 'recording'}
        aria-label={`${primaryAction} desktop voice`}
      >
        <span className="desktop-orb-ring" />
        <span className="desktop-mic-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
            <path d="M8 21h8" />
          </svg>
        </span>
        <strong>{primaryLabel}</strong>
        <span>{primaryAction}</span>
      </button>

      <p className="desktop-runtime-status">{status}</p>

      <div className="desktop-connection-strip">
        <label>
          Desktop name
          <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} disabled={streaming} />
        </label>
        <button type="button" onClick={() => void pairDesktop()} disabled={streaming}>
          Connect desktop
        </button>
      </div>
    </section>
  );
}

type VoiceMode = 'off' | 'awake' | 'sleeping' | 'recording';
type VoiceStreamTarget = 'assistant' | 'patch' | 'clipboard';
type WakeCommand = 'start' | 'patch' | 'clipboard' | 'sleep' | 'stop_audio' | 'repeat_audio' | 'status';

// Keep the status command path available, but do not match spoken status phrases locally.
const ENABLE_STATUS_WAKE_COMMAND = false;

function phraseWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matchesPhrase(text: string, phrase: string): boolean {
  const target = phraseWords(phrase);
  const words = phraseWords(text);
  if (target.length === 0 || words.length < target.length) return false;
  return words.some((_, index) => {
    if (index + target.length > words.length) return false;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (words[index + offset] !== target[offset]) return false;
    }
    return true;
  });
}

function sleepPhraseMatch(text: string, unlockPhrase: string, shutdownPhrase: string): 'unlock' | 'shutdown' | null {
  if (matchesPhrase(text, unlockPhrase)) return 'unlock';
  if (matchesPhrase(text, shutdownPhrase)) return 'shutdown';
  return null;
}

function wakePhraseMatch(text: string, assistantProfiles: VoiceSettings['assistantProfiles'] = []): { command: WakeCommand; assistantProfileId?: string | null } | null {
  const words = phraseWords(text);
  const compact = words.join('');
  if (words.some((word, index) => word === 'go' && words[index + 1] === 'to' && words[index + 2] === 'sleep')) return { command: 'sleep' };
  if (words.some((word, index) => (word === 'ok' || word === 'okay') && words[index + 1] === 'stop')) return { command: 'stop_audio' };
  if (words.some((word, index) => word === 'repeat' && words[index + 1] === 'what' && words[index + 2] === 'you' && words[index + 3] === 'said')) return { command: 'repeat_audio' };
  for (const profile of assistantProfiles.filter((profile) => profile.enabled)) {
    const phrases = [profile.wakePhrase, ...(profile.wakePhraseAliases ?? [])];
    if (phrases.some((phrase) => matchesPhrase(text, phrase))) return { command: 'start', assistantProfileId: profile.id };
  }
  if (words.some((word, index) => word === 'patch' && words[index + 1] === 'me' && words[index + 2] === 'in')) return { command: 'patch' };
  if (words.includes('transcribe')) return { command: 'clipboard' };
  if (ENABLE_STATUS_WAKE_COMMAND && (words.includes('status') || compact === 'stateus' || compact === 'checkstatus')) return { command: 'status' };
  return null;
}

function recordingStatus(target: VoiceStreamTarget): string {
  if (target === 'patch') return 'Patching voice transcript into chat.';
  if (target === 'clipboard') return 'Recording clipboard transcription.';
  return 'Streaming desktop microphone.';
}

async function copyText(text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (window.voiceStreamDesktop?.writeClipboard) {
    window.voiceStreamDesktop.writeClipboard(trimmed);
    return true;
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(trimmed);
      return true;
    } catch {
      // Fall through to the older browser copy path.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = trimmed;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

function openDesktopVoiceSocket(device: { id: string; token: string }, sessionId: string, target: VoiceStreamTarget, assistantProfileId?: string | null): WebSocket {
  const url = new URL('/api/voice/stream', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', device.id);
  url.searchParams.set('token', device.token);
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('mode', target);
  if (assistantProfileId) url.searchParams.set('assistantProfileId', assistantProfileId);
  return new WebSocket(url);
}

function floatToPcm16(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ThreadDeleteConfirmModal({
  thread,
  busy,
  onCancel,
  onConfirm,
}: {
  thread: AssistantThread;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title = thread.title?.trim() || 'Untitled thread';
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <section
        className="w-full max-w-sm rounded-lg border border-[rgba(248,113,113,.32)] bg-[var(--panel-alt)] p-4 text-[var(--fg)] shadow-[0_24px_80px_rgba(0,0,0,.42)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-thread-title"
        aria-describedby="delete-thread-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded border border-[rgba(248,113,113,.34)] bg-[rgba(248,113,113,.10)] text-[#fca5a5]" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" className="h-4 w-4 fill-none stroke-current stroke-2">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 15h10l1-15" />
              <path d="M10 10v7" />
              <path d="M14 10v7" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 id="delete-thread-title" className="m-0 text-[15px] font-bold leading-tight text-[var(--fg)]">Delete thread?</h2>
            <p id="delete-thread-description" className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              This will permanently delete "{title}" and its messages.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={assistantActionButtonClass}
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-[30px] items-center justify-center rounded border border-[rgba(248,113,113,.46)] bg-[rgba(248,113,113,.12)] px-2.5 font-display text-[10px] font-semibold uppercase text-[#fecaca] transition hover:bg-[rgba(248,113,113,.18)] disabled:pointer-events-none disabled:opacity-50"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ArtifactDeleteConfirmModal({
  artifact,
  busy,
  onCancel,
  onConfirm,
}: {
  artifact: AssistantArtifactRecord;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const path = artifact.path?.trim() || 'Untitled file';
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <section
        className="w-full max-w-sm rounded-lg border border-[rgba(248,113,113,.32)] bg-[var(--panel-alt)] p-4 text-[var(--fg)] shadow-[0_24px_80px_rgba(0,0,0,.42)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-artifact-title"
        aria-describedby="delete-artifact-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded border border-[rgba(248,113,113,.34)] bg-[rgba(248,113,113,.10)] text-[#fca5a5]" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" className="h-4 w-4 fill-none stroke-current stroke-2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
              <path d="M9 13h6" />
              <path d="M10 17h4" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 id="delete-artifact-title" className="m-0 text-[15px] font-bold leading-tight text-[var(--fg)]">Delete file?</h2>
            <p id="delete-artifact-description" className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              This will permanently delete "{path}" from this thread.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={assistantActionButtonClass}
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-[30px] items-center justify-center rounded border border-[rgba(248,113,113,.46)] bg-[rgba(248,113,113,.12)] px-2.5 font-display text-[10px] font-semibold uppercase text-[#fecaca] transition hover:bg-[rgba(248,113,113,.18)] disabled:pointer-events-none disabled:opacity-50"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: AppToast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <article key={toast.id} className={cn('app-toast', toast.kind === 'error' && 'is-error')}>
          <div className="app-toast-icon" aria-hidden="true">
            {toast.kind === 'error' ? (
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 8v5" />
                <path d="M12 17h.01" />
                <path d="M10.3 4.5 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </div>
          <p>{toast.message}</p>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </article>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function formatCredits(microcredits: number): string {
  const credits = Number(microcredits) / MICROCREDITS_PER_CREDIT;
  if (!Number.isFinite(credits)) return '0';
  const abs = Math.abs(credits);
  if (abs >= 100) return credits.toFixed(0);
  if (abs >= 1) return credits.toFixed(2);
  if (abs > 0) return credits.toFixed(4);
  return '0';
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

function recordingAudioUrl(recordingId: string, download = false): string {
  const query = download ? '?download=1' : '';
  return `/api/voice/recordings/${encodeURIComponent(recordingId)}/audio${query}`;
}

function appDownloadMeta(info: AndroidApkInfo | DesktopAppInfo | null): string {
  if (!info?.available) return 'Not built yet';
  const parts = [
    info.variant,
    'versionName' in info ? info.versionName ?? info.versionCode : null,
    info.size ? formatBytes(info.size) : null,
  ].filter(Boolean);
  return parts.join(' / ') || 'Ready';
}

function DownloadPlatformIcon({ platform }: { platform: 'desktop' | 'android' }) {
  if (platform === 'android') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="download-link-icon">
        <rect x="7" y="3" width="10" height="18" rx="2.2" />
        <path d="M10 18h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="download-link-icon">
      <rect x="4" y="5" width="16" height="11" rx="1.8" />
      <path d="M9 20h6" />
      <path d="M12 16v4" />
    </svg>
  );
}

function AppDownloadLinks({
  androidInfo,
  desktopInfo,
  loading = false,
}: {
  androidInfo: AndroidApkInfo | null;
  desktopInfo: DesktopAppInfo | null;
  loading?: boolean;
}) {
  const entries = [
    {
      platform: 'desktop' as const,
      label: 'Desktop app',
      action: 'Download for Linux',
      info: desktopInfo,
      href: desktopInfo?.available ? desktopInfo.downloadUrl : null,
    },
    {
      platform: 'android' as const,
      label: 'Android app',
      action: 'Download APK',
      info: androidInfo,
      href: androidInfo?.available ? androidInfo.downloadUrl : null,
    },
  ];
  return (
    <div className="download-links" aria-label="App downloads">
      {entries.map((entry) => {
        const meta = loading && !entry.info ? 'Checking...' : appDownloadMeta(entry.info);
        const content = (
          <>
            <DownloadPlatformIcon platform={entry.platform} />
            <span className="download-link-copy">
              <span className="download-link-label">{entry.label}</span>
              <strong>{entry.href ? entry.action : 'Unavailable'}</strong>
              <small>{meta}</small>
            </span>
          </>
        );
        return entry.href ? (
          <a key={entry.label} className="download-link" href={entry.href} aria-label={`${entry.action}: ${meta}`}>
            {content}
          </a>
        ) : (
          <span key={entry.label} className="download-link is-disabled" aria-disabled="true">
            {content}
          </span>
        );
      })}
    </div>
  );
}

function SignedOutDownloadLinks() {
  const [androidInfo, setAndroidInfo] = React.useState<AndroidApkInfo | null>(null);
  const [desktopInfo, setDesktopInfo] = React.useState<DesktopAppInfo | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch('/api/mobile/android').then((response) => response.ok ? response.json() : null).catch(() => null),
      fetch('/api/desktop').then((response) => response.ok ? response.json() : null).catch(() => null),
    ]).then(([androidData, desktopData]) => {
      if (cancelled) return;
      setAndroidInfo(androidData?.android ?? null);
      setDesktopInfo(desktopData?.desktop ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <AppDownloadLinks androidInfo={androidInfo} desktopInfo={desktopInfo} loading={loading} />;
}

function readDesktopAuthRequest(): { requestId: string; secret: string } | null {
  const params = new URLSearchParams(window.location.search);
  const requestId = String(params.get('desktopAuthRequest') ?? '').trim();
  const secret = String(params.get('desktopAuthSecret') ?? '').trim();
  return requestId && secret ? { requestId, secret } : null;
}

function closeDesktopAuthTab() {
  window.setTimeout(() => {
    window.close();
    window.open('', '_self');
    window.close();
  }, 350);
}

function DesktopAutoConnect({ client, children }: { client: ApiClient; children: React.ReactNode }) {
  const request = React.useMemo(readDesktopAuthRequest, []);
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [closeAttempted, setCloseAttempted] = React.useState(false);

  React.useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;
    void client
      .request<{ ok: true }>('/api/desktop-auth/claim', {
        method: 'POST',
        body: JSON.stringify({ requestId: request.requestId, secret: request.secret }),
      })
      .then(() => {
        if (cancelled) return;
        setConnected(true);
        window.history.replaceState({}, document.title, window.location.pathname || '/');
        closeDesktopAuthTab();
        window.setTimeout(() => {
          if (!cancelled) setCloseAttempted(true);
        }, 1200);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client, request]);

  if (!request) return <>{children}</>;

  return (
    <div className="signin-page">
      <div className="signin-copy">
        <div className="kicker">VoiceStream</div>
        <h1>Connecting device</h1>
        <p>
          {error
            ? `Device connection failed: ${error}`
            : connected
              ? closeAttempted
                ? 'Device connected. You can close this tab.'
                : 'Device connected. Closing this tab.'
              : 'Finishing sign in.'}
        </p>
        {error ? <button type="button" onClick={() => window.location.assign('/')}>Open dashboard</button> : null}
      </div>
    </div>
  );
}

function ClerkDashboard() {
  const { getToken } = useAuth();
  const client = React.useMemo(() => createClerkClient(getToken), [getToken]);
  return (
    <DesktopAutoConnect client={client}>
      <AppShell
        client={client}
        identitySlot={
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: {
                  width: '28px',
                  height: '28px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                },
                userButtonPopoverCard: {
                  backgroundColor: '#171B21',
                  border: '1px solid #2D3340',
                  boxShadow: '0 24px 80px rgba(0,0,0,.35)',
                },
                userButtonPopoverActionButton: {
                  color: '#B8BFD0',
                },
                userButtonPopoverActionButtonText: {
                  fontFamily: 'var(--sans)',
                },
              },
            }}
          />
        }
      />
    </DesktopAutoConnect>
  );
}

function DevDashboard() {
  const devUser = React.useMemo(readDevUser, []);
  const client = React.useMemo(() => createDevClient(devUser), [devUser]);
  return (
    <DesktopAutoConnect client={client}>
      <AppShell
        client={client}
        identitySlot={
          <div className="grid h-7 w-7 place-items-center rounded border border-[var(--border-subtle)] bg-white/[.02] font-display text-[11px] font-semibold uppercase text-[var(--muted)]" title="Dev auth is active. Configure VITE_CLERK_PUBLISHABLE_KEY to enable login and logout.">
            D
          </div>
        }
      />
    </DesktopAutoConnect>
  );
}

function NativeWebViewDashboard() {
  const client = React.useMemo(createCookieClient, []);
  return (
    <AppShell
      client={client}
      identitySlot={
        <div className="grid h-7 w-7 place-items-center rounded border border-[var(--border-subtle)] bg-white/[.02] font-display text-[11px] font-semibold uppercase text-[var(--muted)]" title="Native Android session is active.">
          A
        </div>
      }
    />
  );
}

function shouldCheckNativeWebViewSession(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('nativeWebView') === '1';
}

function NativeWebViewSessionGate({ children }: { children: React.ReactNode }) {
  const shouldCheckSession = React.useMemo(shouldCheckNativeWebViewSession, []);
  const [state, setState] = React.useState<'checking' | 'active' | 'inactive'>(() =>
    shouldCheckSession ? 'checking' : 'inactive',
  );

  React.useEffect(() => {
    if (!shouldCheckSession) return undefined;
    let cancelled = false;
    void fetch('/api/me', { credentials: 'same-origin' })
      .then(async (response) => {
        const data = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled) setState(data?.authMode === 'webview' ? 'active' : 'inactive');
      })
      .catch(() => {
        if (!cancelled) setState('inactive');
      });
    return () => {
      cancelled = true;
    };
  }, [shouldCheckSession]);

  if (state === 'active') return <NativeWebViewDashboard />;
  if (state === 'checking') {
    return (
      <div className="signin-page">
        <div className="signin-copy">
          <div className="kicker">VoiceStream</div>
          <h1>Opening dashboard</h1>
          <p>Checking your native app session.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function Root() {
  return (
    <NativeWebViewSessionGate>
      {!publishableKey ? (
        <DevDashboard />
      ) : (
        <ClerkProvider
          publishableKey={publishableKey}
          localization={{
            signIn: {
              start: {
                title: 'Sign in to VoiceStream',
                subtitle: 'Welcome back. Continue to your voice workspace.',
              },
            },
          }}
          appearance={{
            variables: {
              colorBackground: '#171b21',
              colorText: '#dfe3ea',
              colorTextSecondary: '#8891a8',
              colorPrimary: '#a78bfa',
              colorInputBackground: 'rgba(255,255,255,.035)',
              colorInputText: '#dfe3ea',
              borderRadius: '8px',
            },
            elements: {
              card: {
                backgroundColor: '#171b21',
                border: '1px solid #2d3340',
                boxShadow: 'none',
              },
              headerTitle: { color: '#dfe3ea' },
              headerSubtitle: { color: '#8891a8' },
              socialButtonsBlockButton: {
                backgroundColor: 'rgba(255,255,255,.035)',
                borderColor: '#2d3340',
                color: '#dfe3ea',
              },
              formButtonPrimary: {
                backgroundColor: '#a78bfa',
                color: '#101216',
              },
            },
          }}
        >
          <SignedOut>
            <div className="signin-page">
              <div className="signin-copy">
                <div className="signin-brand" aria-label="VoiceStream Next">
                  <span className="signin-brand-mark" aria-hidden="true" />
                  <span>VoiceStream Next</span>
                </div>
                <h1>Sign in to VoiceStream</h1>
                <p>Manage assistant threads, voice devices, settings, and app releases from one workspace.</p>
                <SignedOutDownloadLinks />
              </div>
              <div className="signin-auth-card">
                <SignIn routing="hash" />
              </div>
            </div>
          </SignedOut>
          <SignedIn>
            <ClerkDashboard />
          </SignedIn>
        </ClerkProvider>
      )}
    </NativeWebViewSessionGate>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
