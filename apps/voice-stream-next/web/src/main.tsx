import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react';
import QRCode from 'qrcode';
import { ApprovalCodeRecognizer, type ApprovalCodeUpdate } from '../../server/src/approval-code.js';
import {
  approvalRecognizerOptions,
  VOICE_APPROVAL_SETTINGS_DEFAULT,
} from '../../server/src/voice-approval-settings.js';
import { createClerkClient, createDevClient, readDevUser } from './apiClient.js';
import type {
  ApiClient,
  AndroidApkInfo,
  AndroidSetupInfo,
  AssistantApprovalRecord,
  AssistantArtifactRecord,
  AssistantMessage,
  AssistantModelOption,
  AssistantQueuedPromptRecord,
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
  VoiceApprovalFormState,
  VoiceSettings,
} from './dashboardTypes.js';
import { timeLabel } from './time.js';
import { TranscriptPanel } from './TranscriptPanel.js';
import { AssistantFilesPanel, type ArtifactPanelMode } from './assistant/AssistantFilesPanel.js';
import { AssistantSystemPromptModal, type AssistantSystemPromptKind, type AssistantSystemPromptMode } from './assistant/AssistantSystemPromptModal.js';
import { cn } from './ui/cn.js';
import { MarkdownMessage } from './ui/MarkdownMessage.js';
import { UiMenuSelect, type UiMenuSelectEntry } from './ui/MenuSelect.js';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const desktopDeviceStorageKey = 'voiceStreamNext.desktopDevice';
const ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT = 'You are VoiceStream, a concise standalone assistant. Answer directly and keep useful context in the thread.';
const ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT = 'You are VoiceStream, a concise voice assistant. Keep spoken replies short and practical.';
const ASSISTANT_SYSTEM_PROMPT_MAX_CHARS = 20_000;

const ASSISTANT_PROVIDERS: Array<{ id: 'codex' | 'openai'; label: string; title: string }> = [
  { id: 'codex', label: 'Codex', title: 'Use connected Codex ChatGPT authentication for Codex models.' },
  { id: 'openai', label: 'OpenAI', title: 'Use the configured OpenAI API key for OpenAI models.' },
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

declare global {
  interface Window {
    voiceStreamDesktop?: {
      isDesktop?: boolean;
      writeClipboard?: (text: string) => void;
      voskStatus?: () => Promise<DesktopVoskStatus>;
      startVosk?: () => Promise<DesktopVoskStatus>;
      stopVosk?: () => Promise<DesktopVoskStatus>;
      resetVosk?: () => Promise<DesktopVoskStatus>;
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

const TOOL_LABELS: Record<string, string> = {
  assistant_artifacts: 'Assistant artifacts',
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

function messageParts(message: AssistantMessage | undefined): AssistantContentPart[] {
  if (!message) return [];
  const parsed = safeJsonText(message.contentJson);
  if (Array.isArray(parsed)) return parsed.filter((part): part is AssistantContentPart => Boolean(part && typeof part === 'object'));
  return [];
}

function messageText(message: AssistantMessage | undefined): string {
  if (!message) return '';
  const textFromParts = messageParts(message)
    .filter((part) => part.type === 'text' || part.type === 'thinking')
    .map((part) => String(part.text ?? part.thinking ?? ''))
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

const speechAudioQueue: Array<{ src: string; revoke?: () => void }> = [];
let speechAudioPlaying = false;

function queueSpeechAudio(audioBase64: string, contentType = 'audio/wav'): void {
  const clean = audioBase64.trim();
  if (!clean || typeof Audio === 'undefined') return;
  speechAudioQueue.push({ src: `data:${contentType.trim() || 'audio/wav'};base64,${clean}` });
  void drainSpeechAudioQueue();
}

function queueSpeechAudioBytes(data: BlobPart, contentType = 'audio/wav'): void {
  if (typeof Audio === 'undefined') return;
  const url = URL.createObjectURL(new Blob([data], { type: contentType }));
  speechAudioQueue.push({ src: url, revoke: () => URL.revokeObjectURL(url) });
  void drainSpeechAudioQueue();
}

async function drainSpeechAudioQueue(): Promise<void> {
  if (speechAudioPlaying) return;
  speechAudioPlaying = true;
  try {
    while (speechAudioQueue.length > 0) {
      const item = speechAudioQueue.shift()!;
      try {
        await playSpeechAudio(item.src);
      } finally {
        item.revoke?.();
      }
    }
  } finally {
    speechAudioPlaying = false;
  }
}

function playSpeechAudio(src: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(src);
    const finish = () => resolve();
    audio.addEventListener('ended', finish, { once: true });
    audio.addEventListener('error', finish, { once: true });
    audio.play().catch(finish);
  });
}

function ReasoningBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const trimmed = text.trim();
  if (!trimmed && !streaming) return null;
  return (
    <div className="overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)]">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 border-0 bg-transparent px-2 py-1.5 text-left text-[var(--muted-dim)]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="shrink-0 font-display text-[10px] font-bold uppercase">Reasoning</span>
        {streaming ? <ThinkingPulseDots /> : null}
        <small className="ml-auto text-[10px] text-[var(--muted)]">{open ? 'Hide' : 'Show'}</small>
      </button>
      {trimmed && open ? <div className="max-h-[min(70vh,28rem)] overflow-auto whitespace-pre-wrap border-t border-[var(--border-subtle)] p-2 text-[11px] leading-relaxed text-[var(--muted)]">{trimmed}</div> : null}
    </div>
  );
}

function AssistantMessageRow({ message, streaming = false }: { message: AssistantMessage; streaming?: boolean }) {
  const parts = messageParts(message);
  const hasStructuredContent = parts.some((part) => part.type === 'text' || part.type === 'thinking');
  return (
    <article
      className={cn(
        'w-full px-5 py-3 text-[13px] leading-relaxed',
        message.role === 'user' && 'border-y border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--fg-secondary)]',
        message.role === 'assistant' && 'text-[var(--fg)]',
        message.role === 'system' && 'bg-[rgba(255,255,255,.018)] text-[var(--fg-secondary)]',
        message.role === 'toolResult' && 'border-y border-[var(--border-subtle)] bg-[rgba(74,222,128,.045)] text-[var(--fg-secondary)]',
        streaming && 'assistant-streaming-message',
      )}
    >
      <div className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-normal text-[var(--muted-dim)]">{messageRoleLabel(message)}</div>
      {hasStructuredContent ? (
        parts.map((part, index) => {
          if (part.type === 'thinking') return <ReasoningBlock key={index} text={String(part.thinking ?? '')} streaming={streaming && index === parts.length - 1} />;
          if (part.type === 'text') return <MarkdownMessage key={index} text={String(part.text ?? '')} />;
          return null;
        })
      ) : (
        <MarkdownMessage text={message.content} />
      )}
    </article>
  );
}

function ToolActivityMessage({ call, result }: { call?: AssistantToolCall; result?: AssistantMessage }) {
  const [open, setOpen] = React.useState(false);
  const resultText = messageText(result);
  const title = toolLabel(call?.name || result?.toolName || undefined);
  const status = result ? (result.isError ? 'error' : 'done') : 'pending';
  return (
    <div
      className={cn(
        'mx-5 my-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.018)] text-[var(--fg-secondary)]',
        status === 'error' && 'border-[rgba(248,113,113,.22)]',
      )}
    >
      <button
        type="button"
        className="flex min-h-[38px] w-full min-w-0 items-center gap-2 border-0 bg-transparent px-3 py-2 text-left font-display text-[10px] font-semibold uppercase tracking-normal text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]"
        onClick={() => setOpen((value) => !value)}
      >
        {result ? (
          <span
            className={cn(
              'inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full text-[#071015]',
              result.isError ? 'bg-[#f87171]' : 'bg-[#4ade80]',
            )}
          >
            {result.isError ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <ToolCheckIcon />}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-[var(--border-subtle)] px-3 py-2.5">
          {call ? (
            <div>
              <div className="font-display text-[10px] font-bold uppercase tracking-normal text-[var(--muted-dim)]">Arguments</div>
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] p-2 font-mono text-[11px] leading-normal text-[var(--fg-secondary)]">{JSON.stringify(call.args ?? {}, null, 2)}</pre>
            </div>
          ) : null}
          {result ? (
            <div className={call ? 'border-t border-[var(--border-subtle)] pt-2' : ''}>
              <div className="font-display text-[10px] font-bold uppercase tracking-normal text-[var(--muted-dim)]">Result</div>
              {resultText ? (
                <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] p-2 font-mono text-[11px] leading-normal text-[var(--fg-secondary)]">{resultText}</pre>
              ) : (
                <div className="text-[11px] leading-normal text-[var(--muted-dim)]">No result payload.</div>
              )}
            </div>
          ) : (
            <div className={cn('text-[11px] leading-normal text-[var(--muted-dim)]', call && 'border-t border-[var(--border-subtle)] pt-2')}>Waiting for result...</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ToolCheckIcon() {
  return (
    <svg className="h-2.5 w-2.5 shrink-0" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    <div className="w-full px-5 py-3" role="status" aria-label="Assistant is thinking">
      <div className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-normal text-[var(--muted-dim)]">Assistant</div>
      <ThinkingPulseDots />
    </div>
  );
}

const ASSISTANT_TOOL_CATEGORY_LABELS: Record<string, string> = {
  artifacts: 'Artifacts',
  speech: 'Speech',
  prompts: 'Prompts',
  settings: 'Settings',
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
    <div className="absolute right-2 top-[50px] z-[35] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_rgba(0,0,0,.48)]">
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
      <div className="max-h-[min(520px,calc(100vh-190px))] overflow-y-auto p-2">
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
  const [threadSidebarOpen, setThreadSidebarOpen] = React.useState(true);
  const [threadFilter, setThreadFilter] = React.useState<'all' | 'normal' | 'voice'>('all');
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [streamingReply, setStreamingReply] = React.useState('');
  const [streamingThinking, setStreamingThinking] = React.useState('');
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
  const [systemPromptGlobalKind, setSystemPromptGlobalKind] = React.useState<AssistantSystemPromptKind>('normal');
  const [normalSystemPromptDraft, setNormalSystemPromptDraft] = React.useState(ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT);
  const [voiceSystemPromptDraft, setVoiceSystemPromptDraft] = React.useState(ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT);
  const [threadSystemPromptDraft, setThreadSystemPromptDraft] = React.useState('');
  const [systemPromptSaving, setSystemPromptSaving] = React.useState(false);
  const [promoteSystemPromptSaving, setPromoteSystemPromptSaving] = React.useState(false);
  const [systemPromptError, setSystemPromptError] = React.useState<string | null>(null);
  const [systemPromptNotice, setSystemPromptNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [toasts, setToasts] = React.useState<AppToast[]>([]);
  const [messageDraft, setMessageDraft] = React.useState('');
  const [threadTitleDraft, setThreadTitleDraft] = React.useState('');
  const [codexConnectFlow, setCodexConnectFlow] = React.useState<{ state: string; authorizationUrl: string; redirectUri: string; expiresAt: string } | null>(null);
  const [codexCodeDraft, setCodexCodeDraft] = React.useState('');
  const [deviceName, setDeviceName] = React.useState('Android voice client');
  const [deviceType, setDeviceType] = React.useState('android');
  const [androidApkInfo, setAndroidApkInfo] = React.useState<AndroidApkInfo | null>(null);
  const [desktopAppInfo, setDesktopAppInfo] = React.useState<DesktopAppInfo | null>(null);
  const [adminAndroidFile, setAdminAndroidFile] = React.useState<File | null>(null);
  const [adminDesktopFile, setAdminDesktopFile] = React.useState<File | null>(null);
  const [androidSetupInfo, setAndroidSetupInfo] = React.useState<AndroidSetupInfo | null>(null);
  const [androidSetupQr, setAndroidSetupQr] = React.useState('');
  const [pairingText, setPairingText] = React.useState('');
  const [pairingQr, setPairingQr] = React.useState('');
  const [pairingExpiresAt, setPairingExpiresAt] = React.useState<string | null>(null);
  const [pairingDeviceId, setPairingDeviceId] = React.useState<string | null>(null);
  const [approvalSettings, setApprovalSettings] = React.useState<VoiceApprovalFormState>(VOICE_APPROVAL_SETTINGS_DEFAULT);
  const settingsHydratedRef = React.useRef(false);
  const assistantEventRefreshTimerRef = React.useRef<number | null>(null);

  const assistantThreads = assistantSnapshotData?.threads ?? dashboard?.threads ?? [];
  const activeThread =
    assistantThreads.find((thread) => thread.id === activeThreadId) ??
    assistantThreads[0] ??
    null;
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
    if (activeThread?.voiceEnabled) return settings?.voiceSystemPrompt ?? ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT;
    return settings?.normalSystemPrompt ?? ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT;
  }, [activeThread?.voiceEnabled, assistantSnapshotData?.assistantSettings]);
  const seedSystemPromptDrafts = React.useCallback(() => {
    const normalPrompt = assistantSnapshotData?.assistantSettings.normalSystemPrompt ?? ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT;
    const voicePrompt = assistantSnapshotData?.assistantSettings.voiceSystemPrompt ?? ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT;
    setNormalSystemPromptDraft(normalPrompt);
    setVoiceSystemPromptDraft(voicePrompt);
    setThreadSystemPromptDraft(activeThread?.systemPrompt ?? '');
    setSystemPromptGlobalKind(activeThread?.voiceEnabled ? 'voice' : 'normal');
  }, [activeThread?.systemPrompt, activeThread?.voiceEnabled, assistantSnapshotData?.assistantSettings]);

  React.useEffect(() => {
    if (systemPromptOpen) seedSystemPromptDrafts();
  }, [activeThread?.id, seedSystemPromptDrafts, systemPromptOpen]);

  function openSystemPromptEditor() {
    seedSystemPromptDrafts();
    setSystemPromptMode('thread');
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    setSystemPromptOpen(true);
  }

  const loadAssistantSnapshot = React.useCallback(
    async (preferredThreadId?: string | null) => {
      const query = preferredThreadId ? `?activeThreadId=${encodeURIComponent(preferredThreadId)}` : '';
      const snapshot = await client.request<AssistantSnapshot>(`/api/assistant/threads${query}`);
      setAssistantSnapshotData(snapshot);
      const nextThreadId = snapshot.activeThreadId ?? snapshot.threads[0]?.id ?? null;
      if (!activeThreadId && nextThreadId) setActiveThreadId(nextThreadId);
      const visibleThreadId = preferredThreadId ?? activeThreadId ?? nextThreadId;
      const visibleThread = snapshot.threads.find((thread) => thread.id === visibleThreadId) ?? snapshot.threads[0] ?? null;
      if (visibleThread) setMessages(visibleThread.messages);
      return snapshot;
    },
    [activeThreadId, client],
  );

  const loadDashboard = React.useCallback(async () => {
    setError(null);
    try {
      const data = await client.request<DashboardData>('/api/dashboard');
      setDashboard(data);
      await loadAssistantSnapshot(activeThreadId);
      if (!settingsHydratedRef.current) {
        setApprovalSettings({
          triggerPhrase: data.settings.triggerPhrase,
          unlockCode: data.settings.unlockCode,
          lockCode: data.settings.lockCode,
          lockedOffCode: data.settings.lockedOffCode,
          minDigits: data.settings.minDigits,
          maxDigits: data.settings.maxDigits,
          stableMs: data.settings.stableMs,
          collectTimeoutMs: data.settings.collectTimeoutMs,
          duplicateCooldownMs: data.settings.duplicateCooldownMs,
          finalizeCheckIntervalMs: data.settings.finalizeCheckIntervalMs,
          postPromptCommandSuppressionMs: data.settings.postPromptCommandSuppressionMs,
        });
        settingsHydratedRef.current = true;
      }
      if (!activeThreadId && data.threads[0]) setActiveThreadId(data.threads[0].id);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [activeThreadId, client, loadAssistantSnapshot]);

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
      void loadDashboard();
    }, 160);
  }, [loadDashboard]);

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
    void refreshAndroidSetup();
  }, [refreshAndroidSetup]);

  React.useEffect(() => {
    void loadMessages(activeThread?.id ?? null);
  }, [activeThread?.id, loadMessages]);

  React.useEffect(() => {
    void loadArtifacts(activeThread?.id ?? null);
  }, [activeThread?.id]);

  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void loadDashboard();
    };
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [loadDashboard]);

  React.useEffect(() => {
    if (typeof window.EventSource === 'undefined') return undefined;
    let closed = false;
    const source = new window.EventSource('/api/assistant/events');
    const refresh = () => {
      if (closed) return;
      scheduleAssistantEventRefresh();
    };
    source.onopen = refresh;
    source.onmessage = refresh;
    source.addEventListener('connected', refresh);
    source.addEventListener('assistant_change', refresh);
    source.onerror = () => {
      if (closed) return;
      scheduleAssistantEventRefresh();
    };
    return () => {
      closed = true;
      source.close();
      if (assistantEventRefreshTimerRef.current !== null) {
        window.clearTimeout(assistantEventRefreshTimerRef.current);
        assistantEventRefreshTimerRef.current = null;
      }
    };
  }, [scheduleAssistantEventRefresh]);

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
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void loadMessages(threadId);
    };
    const timer = window.setInterval(refresh, 2500);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [activeThread?.id, loadMessages]);

  async function createThread(options: { voiceEnabled?: boolean } = {}) {
    setBusy(true);
    setError(null);
    try {
      const data = await client.request<{ ok: true; thread: AssistantThread; snapshot: AssistantSnapshot }>('/api/assistant/threads', {
        method: 'POST',
        body: JSON.stringify({
          title: options.voiceEnabled ? 'Voice thread' : 'Assistant thread',
          source: options.voiceEnabled ? 'voice' : 'web',
          voiceEnabled: Boolean(options.voiceEnabled),
        }),
      });
      setActiveThreadId(data.thread.id);
      setAssistantSnapshotData(data.snapshot);
      if (options.voiceEnabled) setThreadFilter('voice');
      await loadDashboard();
      setNotice(options.voiceEnabled ? 'Created voice assistant thread.' : 'Created assistant thread.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const content = messageDraft.trim();
    if (!activeThread || !content) return;
    setBusy(true);
    setError(null);
    setStreamingReply('');
    setStreamingThinking('');
    try {
      const response = await client.stream(
        `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/stream`,
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
      setMessageDraft('');
      await readAssistantEventStream(response, (promptEvent) => {
        if (promptEvent.type === 'delta') {
          setStreamingReply((current) => `${current}${String(promptEvent.delta ?? '')}`);
          return;
        }
        if (promptEvent.type === 'thinking_delta') {
          setStreamingThinking((current) => `${current}${String(promptEvent.delta ?? '')}`);
          return;
        }
        if (promptEvent.type === 'message' && promptEvent.message) {
          setMessages((current) => upsertMessage(current, promptEvent.message as AssistantMessage));
          return;
        }
        if ((promptEvent.type === 'snapshot' || promptEvent.type === 'approval_pending' || promptEvent.type === 'queued' || promptEvent.type === 'done') && promptEvent.snapshot) {
          const snapshot = promptEvent.snapshot as AssistantSnapshot;
          setAssistantSnapshotData(snapshot);
          const visibleThread = snapshot.threads.find((thread) => thread.id === activeThread.id);
          if (visibleThread) setMessages(visibleThread.messages);
          if (promptEvent.type === 'done') setStreamingReply('');
          return;
        }
        if (promptEvent.type === 'error') {
          throw new Error(String(promptEvent.error ?? 'Assistant stream failed'));
        }
      });
      await Promise.all([loadAssistantSnapshot(activeThread.id), loadDashboard()]);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setStreamingReply('');
      setStreamingThinking('');
      setBusy(false);
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
      setActiveThreadId(nextThreadId);
      const visibleThread = data.snapshot.threads.find((thread) => thread.id === nextThreadId) ?? null;
      setMessages(visibleThread?.messages ?? []);
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
      const nextSelected = chooseDefaultArtifact(data.artifacts, selectedArtifact?.path);
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

  async function deleteArtifact() {
    if (!activeThread || !selectedArtifact) return;
    const artifactPath = selectedArtifact.path;
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
      setApprovalSettings({
        triggerPhrase: data.settings.triggerPhrase,
        unlockCode: data.settings.unlockCode,
        lockCode: data.settings.lockCode,
        lockedOffCode: data.settings.lockedOffCode,
        minDigits: data.settings.minDigits,
        maxDigits: data.settings.maxDigits,
        stableMs: data.settings.stableMs,
        collectTimeoutMs: data.settings.collectTimeoutMs,
        duplicateCooldownMs: data.settings.duplicateCooldownMs,
        finalizeCheckIntervalMs: data.settings.finalizeCheckIntervalMs,
        postPromptCommandSuppressionMs: data.settings.postPromptCommandSuppressionMs,
      });
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

  async function updateAssistantSettings(patch: Partial<NonNullable<AssistantSnapshot['assistantSettings']>>) {
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
      setAssistantSnapshotData(data.snapshot);
      setNotice('Saved assistant settings.');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveGlobalSystemPrompt() {
    const prompt = systemPromptGlobalKind === 'voice' ? voiceSystemPromptDraft : normalSystemPromptDraft;
    if (!prompt.trim()) {
      setSystemPromptError('System prompt is required.');
      return;
    }
    setSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const patch = systemPromptGlobalKind === 'voice'
        ? { voiceSystemPrompt: prompt }
        : { normalSystemPrompt: prompt };
      const data = await client.request<{ ok: true; settings: AssistantSnapshot['assistantSettings']; snapshot: AssistantSnapshot }>(
        '/api/assistant/settings',
        { method: 'PATCH', body: JSON.stringify(patch) },
      );
      setAssistantSnapshotData(data.snapshot);
      setNormalSystemPromptDraft(data.snapshot.assistantSettings.normalSystemPrompt);
      setVoiceSystemPromptDraft(data.snapshot.assistantSettings.voiceSystemPrompt);
      setSystemPromptNotice(`Saved ${systemPromptGlobalKind} default prompt.`);
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
    const kind: AssistantSystemPromptKind = activeThread?.voiceEnabled ? 'voice' : 'normal';
    setPromoteSystemPromptSaving(true);
    setSystemPromptError(null);
    setSystemPromptNotice(null);
    try {
      const data = await client.request<{ ok: true; settings: AssistantSnapshot['assistantSettings']; snapshot: AssistantSnapshot }>(
        '/api/assistant/settings',
        {
          method: 'PATCH',
          body: JSON.stringify(kind === 'voice' ? { voiceSystemPrompt: prompt } : { normalSystemPrompt: prompt }),
        },
      );
      setAssistantSnapshotData(data.snapshot);
      setNormalSystemPromptDraft(data.snapshot.assistantSettings.normalSystemPrompt);
      setVoiceSystemPromptDraft(data.snapshot.assistantSettings.voiceSystemPrompt);
      setSystemPromptNotice(`Saved thread prompt as the ${kind} default.`);
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

  function openThreadFromTranscript(threadId: string) {
    setActiveView('threads');
    setActiveThreadId(threadId);
    setNotice('Opened assistant thread from transcript session.');
  }

  if (loading) {
    return <div className="loading-screen">Loading Voice Stream...</div>;
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
  const normalThreadCount = threads.filter((thread) => !thread.voiceEnabled && thread.source !== 'voice').length;
  const voiceThreadCount = threads.filter((thread) => thread.voiceEnabled || thread.source === 'voice').length;
  const visibleThreads = threads.filter((thread) => {
    if (threadFilter === 'voice') return Boolean(thread.voiceEnabled) || thread.source === 'voice';
    if (threadFilter === 'normal') return !thread.voiceEnabled && thread.source !== 'voice';
    return true;
  });
  const logs = dashboard?.logs ?? [];
  const transcripts = dashboard?.transcripts ?? [];
  const speechPlayback = dashboard?.speechPlayback;
  const speechPlaybackTarget = dashboard?.settings.speechPlaybackTarget ?? speechPlayback?.preferredTarget ?? 'auto';
  const pendingApprovals = assistantSnapshotData?.pendingApprovals ?? [];
  const activePendingApprovals = pendingApprovals.filter((approval) => approval.threadId === activeThread?.id && approval.status === 'pending');
  const activeRuns = (activeThread as AssistantThreadView | null)?.runs?.filter((run) => run.status === 'running' || run.status === 'waiting_for_approval') ?? [];
  const queuedPrompts = (activeThread as AssistantThreadView | null)?.queuedPrompts ?? [];
  const enabledTools = new Set(activeThread?.enabledTools ?? []);
  const enabledToolNames = activeThread?.enabledTools ?? [];
  const availableTools = assistantSnapshotData?.availableTools ?? [];
  const autoApprove = Boolean(activeThread?.autoApprove);
  const codexConnection = assistantSnapshotData?.codexConnection ?? { connected: false, accountId: null, expiresAt: null, updatedAt: null };
  const activeProvider = activeThread?.provider ?? 'openai';
  const activeModel = activeThread?.model ?? 'gpt-5.5';
  const activeThinkingLevel = activeThread?.thinkingLevel ?? 'off';
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
  const modelMenuEntries: UiMenuSelectEntry[] = displayedModelOptions.map((model) => {
    const key = `${model.provider}:${model.id}:${model.thinkingLevel}`;
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
  });
  const selectedModelLabel = activeThread
    ? modelSelectionLabel({ provider: activeProvider, model: activeModel, thinkingLevel: activeThinkingLevel }, modelOptions)
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
    { id: 'devices', label: 'Devices', count: devices.length },
    { id: 'settings', label: 'Settings' },
    { id: 'activity', label: 'Activity', count: transcripts.length + logs.length },
    ...(dashboard?.user.admin ? [{ id: 'admin' as const, label: 'Admin' }] : []),
  ];

  return (
    <main className="assistant-dock-shell relative flex h-screen min-h-0 overflow-hidden bg-[var(--panel-alt)] text-[var(--fg)]">
      {threadSidebarOpen ? <aside className="relative z-[1] flex min-h-0 w-52 max-w-[46%] shrink-0 flex-col border-r border-[var(--border)] bg-black/[.14] max-[880px]:w-full max-[880px]:max-w-none max-[880px]:border-b max-[880px]:border-r-0">
        <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-2">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[var(--border-subtle)] bg-white/[.03] text-[var(--muted)]" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
              <path d="M4 5h16v10H8l-4 4V5Z" />
            </svg>
          </div>
          <div className="grid min-w-0 gap-px">
            <span className={assistantKickerClass}>Threads</span>
            <small className="text-[10px] leading-tight text-[var(--muted)]">{threads.length} assistant</small>
          </div>
          <button
            type="button"
            className={cn(assistantIconButtonClass, 'ml-auto')}
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
          <button type="button" className={assistantPrimaryButtonClass} onClick={() => void createThread()} disabled={busy}>
            + New Thread
          </button>
          <button type="button" className={assistantPrimaryButtonClass} onClick={() => void createThread({ voiceEnabled: true })} disabled={busy}>
            + Voice Thread
          </button>
        </div>

        <div className="m-2 grid grid-cols-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-white/[.025]" role="group" aria-label="Thread filter">
          <button type="button" className={cn('flex h-7 min-w-0 items-center justify-center gap-1 border-0 border-r border-[var(--border-subtle)] bg-transparent px-1.5 font-display text-[10px] font-bold uppercase text-[var(--muted)]', threadFilter === 'all' && '!bg-[rgba(74,222,128,.10)] !text-[var(--green)]')} onClick={() => setThreadFilter('all')}>
            All <span className="text-[var(--muted-dim)]">{threads.length}</span>
          </button>
          <button type="button" className={cn('flex h-7 min-w-0 items-center justify-center gap-1 border-0 border-r border-[var(--border-subtle)] bg-transparent px-1.5 font-display text-[10px] font-bold uppercase text-[var(--muted)]', threadFilter === 'normal' && '!bg-[rgba(74,222,128,.10)] !text-[var(--green)]')} onClick={() => setThreadFilter('normal')}>
            Normal <span className="text-[var(--muted-dim)]">{normalThreadCount}</span>
          </button>
          <button type="button" className={cn('flex h-7 min-w-0 items-center justify-center gap-1 border-0 bg-transparent px-1.5 font-display text-[10px] font-bold uppercase text-[var(--muted)]', threadFilter === 'voice' && '!bg-[rgba(74,222,128,.10)] !text-[var(--green)]')} onClick={() => setThreadFilter('voice')}>
            Voice <span className="text-[var(--muted-dim)]">{voiceThreadCount}</span>
          </button>
        </div>

        <div className="grid min-h-0 content-start gap-1.5 overflow-auto p-1.5 max-[880px]:grid-flow-col max-[880px]:auto-cols-[minmax(180px,220px)] max-[880px]:overflow-x-auto max-[880px]:overflow-y-hidden">
          {visibleThreads.map((thread) => {
            const active = thread.id === activeThread?.id;
            const messageCount = active ? messages.length : 0;
            const queuedCount = (thread as AssistantThreadView).queuedPrompts?.length ?? 0;
            return (
              <button
                key={thread.id}
                type="button"
                className={cn(
                  'grid min-h-[58px] w-full content-center gap-1 rounded border border-transparent bg-transparent py-1.5 pl-2 pr-8 text-left text-[var(--fg-secondary)] transition hover:border-[rgba(136,145,168,.24)] hover:bg-white/[.04] hover:text-[var(--fg)]',
                  active && '!border-[rgba(136,145,168,.24)] !bg-white/[.04] !text-[var(--fg)]',
                )}
                onClick={() => {
                  setActiveView('threads');
                  setActiveThreadId(thread.id);
                }}
              >
                <div className="flex min-w-0 items-center gap-[7px]">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted-dim)]', active && '!bg-[var(--green)] shadow-[0_0_10px_rgba(74,222,128,.22)]')} />
                  <strong className="min-w-0 truncate text-xs font-semibold">{thread.title || 'Untitled thread'}</strong>
                </div>
                <small className="min-w-0 truncate text-[10px] leading-tight text-[var(--muted)]">
                  {thread.voiceEnabled || thread.source === 'voice' ? 'voice' : 'normal'} · {timeLabel(thread.updatedAt)}
                  {messageCount ? ` · ${messageCount}` : ''}
                  {queuedCount ? ` · ${queuedCount} queued` : ''}
                </small>
              </button>
            );
          })}
          {visibleThreads.length === 0 ? <div className={assistantEmptyClass}>No {threadFilter === 'all' ? 'assistant' : threadFilter} threads yet.</div> : null}
        </div>

        <div className="grid gap-2 border-t border-[var(--border)] bg-white/[.018] p-2 max-[880px]:hidden">
          <div className="grid gap-2 rounded border border-[var(--border-subtle)] bg-white/[.025] p-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate font-display text-[10px] font-bold uppercase text-[var(--muted)]">Android Setup</span>
              {androidApkInfo?.available ? (
                <span className="shrink-0 text-[10px] text-[var(--muted)]">v{androidApkInfo.versionName ?? androidApkInfo.versionCode ?? '?'}</span>
              ) : null}
            </div>
            {androidSetupQr && androidSetupInfo?.setupUrl ? (
              <a href={androidSetupInfo.setupUrl} className="block w-fit rounded-[7px] border border-[var(--border)] bg-white p-1 transition hover:border-[rgba(136,145,168,.5)]" title="Android setup QR">
                <img src={androidSetupQr} alt="Android setup QR" className="h-[112px] w-[112px]" />
              </a>
            ) : (
              <div className="rounded border border-[var(--border-subtle)] bg-black/[.12] p-2 text-[10px] leading-tight text-[var(--muted)]">No setup QR</div>
            )}
            <AppDownloadLinks androidInfo={androidApkInfo} desktopInfo={desktopAppInfo} />
          </div>
          <button type="button" className="grid min-h-[104px] w-full justify-items-center gap-[7px] rounded border border-[var(--border-subtle)] bg-white/[.025] p-3 font-display text-[10px] font-bold uppercase text-[var(--muted)] transition hover:bg-white/[.05] hover:text-[var(--fg-secondary)] disabled:pointer-events-none disabled:opacity-50" onClick={() => void createThread({ voiceEnabled: true })} disabled={busy}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-11 w-11 rounded-full bg-white/[.045] p-2.5 fill-none stroke-current stroke-[1.8]">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
              <path d="M8 21h8" />
            </svg>
            <span>Start Voice</span>
          </button>
          <button
            type="button"
            className={cn(assistantPrimaryButtonClass, 'h-[34px] text-[var(--muted)]', threadFilter === 'voice' && assistantIconButtonActiveClass)}
            onClick={() => {
              setThreadFilter('voice');
              setActiveView('threads');
            }}
          >
            Voice Mode
          </button>
          <button
            type="button"
            className={cn(assistantPrimaryButtonClass, 'h-[34px] text-[var(--muted)]')}
            onClick={() => {
              setDeviceType('android');
              if (!deviceName.trim() || deviceName === 'Desktop dev client') setDeviceName('Android voice client');
              setActiveView('devices');
            }}
          >
            Android Setup
          </button>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] leading-tight text-[var(--muted)]">Connected devices</span>
            <strong className="text-xs text-[var(--fg)]">{connectedDeviceIds.size}/{devices.length}</strong>
          </div>
        </div>
      </aside> : null}

      <section className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="relative z-[1] flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-white/[.025] px-2 max-[620px]:h-auto max-[620px]:items-stretch max-[620px]:flex-col max-[620px]:p-2">
          <button
            type="button"
            className={cn(assistantIconButtonClass, 'h-8 w-8', threadSidebarOpen && assistantIconButtonActiveClass)}
            onClick={() => setThreadSidebarOpen((open) => !open)}
            title={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-label={threadSidebarOpen ? 'Hide thread sidebar' : 'Show thread sidebar'}
            aria-pressed={threadSidebarOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
              {threadSidebarOpen ? (
                <>
                  <path d="M15 18l-6-6 6-6" />
                  <path d="M20 4v16" />
                </>
              ) : (
                <>
                  <path d="M9 18l6-6-6-6" />
                  <path d="M4 4v16" />
                </>
              )}
            </svg>
          </button>
          <div className="grid min-w-[140px] flex-1 gap-px">
            <strong className="min-w-0 truncate text-xs font-semibold leading-tight text-[var(--fg)]">{activeView === 'threads' ? activeThread?.title ?? 'Assistant' : navItems.find((item) => item.id === activeView)?.label}</strong>
            <span className="flex items-center gap-1.5 font-display text-[10px] font-medium uppercase leading-tight text-[var(--muted-dim)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)] shadow-[0_0_12px_rgba(74,222,128,.32)]" />
              {activeView === 'threads' ? (activeThread ? activeThread.status ?? 'idle' : 'no thread') : 'live'}
            </span>
          </div>

          <div className="flex min-w-0 shrink items-center justify-end gap-1.5 max-[620px]:justify-start max-[880px]:overflow-x-auto">
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
                  className={cn(assistantIconButtonClass, assistantFilesOpen && assistantIconButtonActiveClass)}
                  onClick={() => setAssistantFilesOpen((open) => !open)}
                  disabled={!activeThread}
                  title={assistantFilesOpen ? 'Hide assistant files' : 'Show assistant files'}
                  aria-label={assistantFilesOpen ? 'Hide assistant files' : 'Show assistant files'}
                  aria-pressed={assistantFilesOpen}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 2v6h6" />
                  </svg>
                  {artifacts.length > 0 ? <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full border border-[var(--panel-alt)] bg-[var(--green)] px-1 text-center text-[9px] font-bold leading-[14px] text-[#071015]">{artifacts.length > 9 ? '9+' : artifacts.length}</span> : null}
                </button>
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
                  className={cn(assistantIconButtonClass, activeThread?.voiceEnabled && assistantIconButtonActiveClass)}
                  onClick={() => void updateThreadSettings({ voiceEnabled: !activeThread?.voiceEnabled })}
                  disabled={!activeThread || busy}
                  title={activeThread?.voiceEnabled ? 'Voice replies are on' : 'Voice replies are off'}
                  aria-label={activeThread?.voiceEnabled ? 'Turn off voice replies' : 'Turn on voice replies'}
                  aria-pressed={Boolean(activeThread?.voiceEnabled)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3" />
                    <path d="M8 21h8" />
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
                  {item.id === 'devices' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className={assistantIconSvgClass}>
                      <rect x="7" y="2" width="10" height="20" rx="2" />
                      <path d="M11 18h2" />
                    </svg>
                  ) : item.id === 'settings' ? (
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
                <div className="grid shrink-0 gap-1 border-b border-[rgba(248,113,113,.24)] bg-[rgba(248,113,113,.08)] px-5 py-3 text-[var(--fg-secondary)]">
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
                  onRefresh={() => void loadArtifacts(activeThread.id)}
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
                  onSave={() => void saveArtifact()}
                  onDelete={() => void deleteArtifact()}
                  onCopy={() => void copyArtifact()}
                  onDownload={downloadArtifact}
                />
              ) : (
                <>
                <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-auto bg-[#151a20] py-4">
                  {assistantRenderItems.map((item) =>
                    item.type === 'message' ? (
                      <AssistantMessageRow key={item.key} message={item.message} streaming={item.message.id === streamingMessage?.id} />
                    ) : (
                      <ToolActivityMessage key={item.key} call={item.call} result={item.result} />
                    ),
                  )}
                  {showThinking ? <AssistantThinkingRow /> : null}
                  {queuedPrompts.length > 0 ? (
                    <div className="mx-5 my-3 grid max-h-[220px] gap-1.5 overflow-auto">
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
                    <div className="mx-5 my-3 grid gap-1.5">
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

                <form className="block shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)] p-2" onSubmit={(event) => void sendMessage(event)}>
                <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
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
                      'inline-flex h-[30px] max-w-[220px] min-w-0 items-center gap-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[var(--muted)]',
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
                  <div className="ml-auto inline-flex items-center gap-1.5">
                    {activeRuns.length > 0 ? (
                      <button type="button" className="h-7 border-[rgba(248,113,113,.45)] bg-[rgba(248,113,113,.10)] px-2.5 font-display text-[10px] font-bold uppercase text-[#fca5a5]" onClick={() => void stopActiveRun()} disabled={busy}>
                        Stop
                      </button>
                    ) : null}
                  </div>
                </div>
                {codexConnectFlow ? (
                  <div className="mb-2 grid grid-cols-[minmax(180px,1fr)_auto] gap-2">
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
                <div className="relative min-h-[92px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)]">
                  <textarea
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (activeThread && messageDraft.trim() && !busy) {
                          void sendMessage();
                        }
                      }
                    }}
                    placeholder={activeRuns.length > 0 ? ((activeThread?.promptDeliveryMode ?? 'queue') === 'asap' ? 'Send at next turn' : 'Queue a message') : 'Ask the assistant'}
                    disabled={!activeThread || busy}
                    className="block min-h-[92px] max-h-[180px] w-full resize-y border-0 bg-transparent px-2.5 pb-9 pt-2 text-xs leading-relaxed text-[var(--fg)] outline-none"
                  />
                  {activeRunningModel ? (
                    <span className="absolute bottom-2 left-2.5 max-w-[calc(100%-106px)] truncate text-[10px] text-[var(--muted-dim)]" title={`Running model: ${activeRunningModelLabel}`}>
                      Running {compactModelSelectionLabel(activeRunningModelLabel)}
                    </span>
                  ) : null}
                  <button type="submit" className="absolute bottom-2 right-2 h-7 border-[rgba(74,222,128,.28)] bg-[rgba(74,222,128,.08)] px-2.5 font-display text-[10px] font-bold uppercase text-[var(--green)]" disabled={!activeThread || !messageDraft.trim() || busy}>
                    Send
                  </button>
                </div>
              </form>
                </>
              )}
            </section>
          ) : null}

          {activeView === 'devices' ? (
            <section className="grid min-h-0 grid-cols-[minmax(280px,.58fr)_minmax(0,1fr)] items-start gap-3 overflow-auto p-3 max-[880px]:grid-cols-1">
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
                <div className="mb-3 grid gap-2 rounded border border-[var(--border-subtle)] bg-white/[.02] p-3">
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
                    <span className={assistantKickerClass}>Fleet</span>
                    <h2 className={assistantPanelTitleClass}>Devices</h2>
                  </div>
                </div>
                <div className="grid gap-2">
                  {devices.map((device) => {
                    const status = dashboard?.clientStatuses.find((entry) => entry.deviceId === device.id);
                    const pairing = dashboard?.pairingSessions.find((entry) => entry.deviceId === device.id);
                    return (
                      <article key={device.id} className={cn(assistantRowClass, 'grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-3 max-[620px]:grid-cols-1')}>
                        <div className="grid min-w-0 gap-1">
                          <strong className="text-xs text-[var(--fg)]">{device.displayName}</strong>
                          <span className="text-xs text-[var(--muted)]">{device.deviceType}</span>
                          <span className="text-xs text-[var(--muted)]">{status ? `${status.mode} / ${status.status}` : 'No live status'}</span>
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
            </section>
          ) : null}

          {activeView === 'settings' ? (
            <section className="grid min-h-0 gap-3 overflow-auto p-3">
              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <span className={assistantKickerClass}>Assistant</span>
                    <h2 className={assistantPanelTitleClass}>System Prompts</h2>
                  </div>
                </div>
                <div className="grid gap-2.5">
                  <label className={assistantFieldLabelClass}>
                    Normal assistant prompt
                    <textarea
                      value={assistantSnapshotData?.assistantSettings.normalSystemPrompt ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAssistantSnapshotData((snapshot) => snapshot
                          ? { ...snapshot, assistantSettings: { ...snapshot.assistantSettings, normalSystemPrompt: value } }
                          : snapshot);
                      }}
                      onBlur={(event) => void updateAssistantSettings({ normalSystemPrompt: event.currentTarget.value })}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Voice assistant prompt
                    <textarea
                      value={assistantSnapshotData?.assistantSettings.voiceSystemPrompt ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAssistantSnapshotData((snapshot) => snapshot
                          ? { ...snapshot, assistantSettings: { ...snapshot.assistantSettings, voiceSystemPrompt: value } }
                          : snapshot);
                      }}
                      onBlur={(event) => void updateAssistantSettings({ voiceSystemPrompt: event.currentTarget.value })}
                    />
                  </label>
                </div>
              </section>

              <section className={assistantPanelClass}>
                <div className={assistantPanelHeaderClass}>
                  <div>
                    <span className={assistantKickerClass}>Assistant</span>
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
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, triggerPhrase: event.target.value }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Unlock
                    <input
                      value={approvalSettings.unlockCode}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, unlockCode: codeValue(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Lock
                    <input
                      value={approvalSettings.lockCode}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, lockCode: codeValue(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Off
                    <input
                      value={approvalSettings.lockedOffCode}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, lockedOffCode: codeValue(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Min digits
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={approvalSettings.minDigits}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, minDigits: Number(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Max digits
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={approvalSettings.maxDigits}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, maxDigits: Number(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Stable ms
                    <input
                      type="number"
                      min={250}
                      max={3000}
                      value={approvalSettings.stableMs}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, stableMs: Number(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Collection timeout ms
                    <input
                      type="number"
                      min={1000}
                      max={15000}
                      value={approvalSettings.collectTimeoutMs}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, collectTimeoutMs: Number(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Duplicate cooldown ms
                    <input
                      type="number"
                      min={0}
                      max={15000}
                      value={approvalSettings.duplicateCooldownMs}
                      onChange={(event) => setApprovalSettings((prev) => ({ ...prev, duplicateCooldownMs: Number(event.target.value) }))}
                    />
                  </label>
                  <label className={assistantFieldLabelClass}>
                    Finalize interval ms
                    <input
                      type="number"
                      min={100}
                      max={1000}
                      value={approvalSettings.finalizeCheckIntervalMs}
                      onChange={(event) =>
                        setApprovalSettings((prev) => ({ ...prev, finalizeCheckIntervalMs: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <button type="submit" className={cn(assistantActionButtonClass, 'w-fit')} disabled={busy}>
                    Save Settings
                  </button>
                </form>
              </section>
            </section>
          ) : null}

          {activeView === 'activity' ? (
            <section className="grid min-h-0 gap-3 overflow-auto p-3">
              <TranscriptPanel transcripts={transcripts} devices={devices} threads={threads} onOpenThread={openThreadFromTranscript} />

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

              {dashboard?.user.admin ? (
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
                      <article key={`status-${status.deviceId}`} className="grid grid-cols-[minmax(0,1fr)_120px_140px_auto] items-center gap-2 rounded-[7px] border border-[rgba(74,222,128,.18)] bg-[rgba(74,222,128,.06)] p-2 text-[var(--fg-secondary)] max-[620px]:grid-cols-1">
                        <strong className="min-w-0 text-xs text-[var(--fg)]">{status.displayName}</strong>
                        <span className="text-xs text-[var(--muted)]">{status.mode}</span>
                        <span className="text-xs text-[var(--muted)]">{status.microphone || status.status}</span>
                        <time className="text-xs text-[var(--muted)]">{timeLabel(status.updatedAt)}</time>
                      </article>
                    ))}
                    {dashboard.adminDevices.length === 0 ? <div className={assistantEmptyClass}>No connected devices yet.</div> : null}
                  </div>
                </section>
              ) : null}
            </section>
          ) : null}

          {activeView === 'admin' ? (
            dashboard?.user.admin ? (
              <section className="grid min-h-0 gap-3 overflow-auto p-3">
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
      <AssistantSystemPromptModal
        open={systemPromptOpen}
        threadTitle={activeThread?.title ?? ''}
        threadVoiceEnabled={Boolean(activeThread?.voiceEnabled)}
        mode={systemPromptMode}
        onModeChange={setSystemPromptMode}
        globalKind={systemPromptGlobalKind}
        onGlobalKindChange={setSystemPromptGlobalKind}
        threadDraft={threadSystemPromptDraft}
        onThreadDraftChange={setThreadSystemPromptDraft}
        normalDraft={normalSystemPromptDraft}
        onNormalDraftChange={setNormalSystemPromptDraft}
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
        onResetGlobal={() => {
          if (systemPromptGlobalKind === 'voice') setVoiceSystemPromptDraft(ASSISTANT_VOICE_SYSTEM_PROMPT_DEFAULT);
          else setNormalSystemPromptDraft(ASSISTANT_NORMAL_SYSTEM_PROMPT_DEFAULT);
        }}
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
      ? (modeRef.current === 'sleeping' ? `Unlock: ${partialCode}` : `Approval: ${partialCode}`)
      : (modeRef.current === 'sleeping' ? 'Unlock code...' : 'Approval code...');
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
        if (audioBase64) queueSpeechAudio(audioBase64, contentType);
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

  async function startVoice(target: VoiceStreamTarget = 'assistant') {
    stopWakeListener();
    let activeDevice = device;
    if (!activeDevice) {
      await pairDesktop();
      activeDevice = JSON.parse(localStorage.getItem(desktopDeviceStorageKey) || 'null');
    }
    if (!activeDevice) return;
    const session = await client.request<{ ok: true; session: { id: string } }>('/api/voice/sessions', {
      method: 'POST',
      body: JSON.stringify({ deviceId: activeDevice.id, mode: target }),
    });
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext({ sampleRate: 16_000 });
    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const socket = openDesktopVoiceSocket(activeDevice, session.session.id, target);
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
          } else if (message.type === 'sleep') {
            let nextStatus = 'Awake. Waiting for voice command.';
            if (target === 'clipboard') {
              const copied = await copyText(message.transcriptText || '');
              nextStatus = copied ? 'Copied voice transcription.' : 'No voice transcription detected.';
            }
            await finishVoiceFromServer(nextStatus);
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
      queueSpeechAudioBytes(event.data, 'audio/wav');
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
    if (nextMode !== 'off') startWakeListener();
  }

  async function finishVoiceFromServer(nextStatus: string) {
    refs.current.socket?.close();
    refs.current.processor?.disconnect();
    refs.current.stream?.getTracks().forEach((track) => track.stop());
    await refs.current.context?.close().catch(() => undefined);
    refs.current = {};
    setStreaming(false);
    setMode('awake');
    setStatus(nextStatus);
    void reportDesktopStatus('awake', nextStatus);
    startWakeListener();
  }

  function enterAwake() {
    resetApprovalCollection();
    setMode('awake');
    void reportDesktopStatus('awake', 'Awake. Listening for voice commands.');
    startWakeListener();
  }

  function enterSleep() {
    if (streaming) void stopVoice('sleeping');
    resetApprovalCollection();
    setMode('sleeping');
    const settings = voiceSettings;
    setStatus(settings ? `Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.` : 'Sleeping.');
    void reportDesktopStatus('sleeping', settings ? `Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.` : 'Sleeping.');
    startWakeListener();
  }

  function turnOff() {
    if (streaming) void stopVoice('off');
    stopWakeListener();
    resetApprovalCollection();
    setMode('off');
    setStatus('Off.');
    void reportDesktopStatus('off', 'Off.');
  }

  async function processPhraseText(text: string, finalizeNow = false) {
    const currentMode = modeRef.current;
    if (acceptApprovalText(text, finalizeNow)) return;
    if (currentMode === 'recording') {
      setStatus('Recording. Voice commands are ignored until capture stops.');
      return;
    }
    const match = wakePhraseMatch(text);
    if (!match) {
      setStatus('No wake command matched.');
      return;
    }
    if (match === 'sleep') {
      enterSleep();
      return;
    }
    if (match === 'status') {
      setStatus(`Mode: ${currentMode}. Device: ${device?.id ? device.id.slice(0, 12) : 'unpaired'}.`);
      return;
    }
    if (currentMode === 'sleeping') {
      setStatus('Sleeping. Press Wake or say the unlock code.');
      return;
    }
    if (currentMode === 'off') enterAwake();
    await startVoice(match === 'patch' || match === 'clipboard' ? match : 'assistant');
  }

  function startWakeListener() {
    if (refs.current.wakeStarting || refs.current.wakeStream || refs.current.recognition) {
      setStatus('Awake. Listening for voice commands.');
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
        if (text === lastRecognizedRef.current.text && now - lastRecognizedRef.current.at < 1500) return;
        lastRecognizedRef.current = { text, at: now };
        void processPhraseText(text).catch((err) => setStatus(err?.message ?? String(err)));
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
      setStatus('Awake. Listening with Vosk.');
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
      setStatus('Awake. Wake recognition is unavailable in this runtime.');
      return;
    }
    if (refs.current.recognition) {
      setStatus('Awake. Listening for voice commands.');
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
      if (text === lastRecognizedRef.current.text && now - lastRecognizedRef.current.at < 1500) return;
      lastRecognizedRef.current = { text, at: now };
      void processPhraseText(text);
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
      setStatus('Awake. Listening for voice commands.');
    } catch {
      refs.current.recognition = undefined;
      setStatus('Awake. Wake recognition is unavailable in this runtime.');
    }
  }

  function stopWakeListener() {
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
    if (currentMode === 'sleeping' && code === settings.unlockCode) {
      setMode('awake');
      setStatus('Unlocked.');
      return;
    }
    if (code === settings.lockedOffCode) {
      turnOff();
      return;
    }
    if (currentMode !== 'sleeping' && code === settings.lockCode) {
      enterSleep();
      return;
    }
    if (currentMode === 'sleeping') {
      setStatus(`Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.`);
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

function wakePhraseMatch(text: string): 'start' | 'patch' | 'clipboard' | 'sleep' | 'status' | null {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const compact = words.join('');
  if (words.some((word, index) => word === 'go' && words[index + 1] === 'to' && words[index + 2] === 'sleep')) return 'sleep';
  if (words.some((word, index) => (word === 'hey' || word === 'hay') && (words[index + 1] === 'sebastian' || words[index + 1] === 'sebastien'))) return 'start';
  if (words.some((word, index) => word === 'patch' && words[index + 1] === 'me' && words[index + 2] === 'in')) return 'patch';
  if (words.includes('transcribe')) return 'clipboard';
  if (words.includes('status') || compact === 'stateus' || compact === 'checkstatus') return 'status';
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
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(trimmed);
    return true;
  } catch {
    return false;
  }
}

function openDesktopVoiceSocket(device: { id: string; token: string }, sessionId: string, target: VoiceStreamTarget): WebSocket {
  const url = new URL('/api/voice/stream', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', device.id);
  url.searchParams.set('token', device.token);
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('mode', target);
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

function appDownloadMeta(info: AndroidApkInfo | DesktopAppInfo | null): string {
  if (!info?.available) return 'Not built yet';
  const parts = [
    info.variant,
    'versionName' in info ? info.versionName ?? info.versionCode : null,
    info.size ? formatBytes(info.size) : null,
  ].filter(Boolean);
  return parts.join(' / ') || 'Ready';
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
    { label: 'Download desktop app', info: desktopInfo, href: desktopInfo?.available ? desktopInfo.downloadUrl : null },
    { label: 'Download Android app', info: androidInfo, href: androidInfo?.available ? androidInfo.downloadUrl : null },
  ];
  return (
    <div className="download-links" aria-label="App downloads">
      {entries.map((entry) => {
        const meta = loading && !entry.info ? 'Checking...' : appDownloadMeta(entry.info);
        const content = (
          <>
            <span>{entry.label}</span>
            <small>{meta}</small>
          </>
        );
        return entry.href ? (
          <a key={entry.label} className="download-link" href={entry.href}>
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
        <div className="kicker">Drone</div>
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

function Root() {
  if (!publishableKey) return <DevDashboard />;
  return (
    <ClerkProvider
      publishableKey={publishableKey}
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
            <div className="kicker">Voice Stream</div>
            <h1>Sign in to Voice Stream</h1>
            <p>Access assistant threads and paired devices from your workspace.</p>
            <SignedOutDownloadLinks />
          </div>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <ClerkDashboard />
      </SignedIn>
    </ClerkProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
