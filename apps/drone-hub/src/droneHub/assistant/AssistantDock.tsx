import React from 'react';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import { requestJson } from '../http';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { parseDroneHubDragData } from '../app/drone-hub-dnd';
import { IconChatThread, IconPlus, IconSidebarCollapse, IconSidebarExpand, IconTrash } from '../app/icons';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';

const ASSISTANT_AUTO_APPROVE_STORAGE_KEY = 'droneHub.assistant.autoApprove';
const ASSISTANT_SCOPE_STORAGE_KEY = 'droneHub.assistant.scope';
const ASSISTANT_THREAD_SIDEBAR_OPEN_STORAGE_KEY = 'droneHub.assistant.threadSidebarOpen';

type AssistantThreadStatus = 'idle' | 'running' | 'waiting_for_approval' | 'error';

type AssistantMessage = {
  role: 'user' | 'assistant' | 'toolResult';
  content?: string | Array<{ type: string; text?: string; thinking?: string; name?: string; arguments?: any; id?: string }>;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  errorMessage?: string;
};

type AssistantQueuedPrompt = {
  id: string;
  prompt: string;
  createdAt: string;
  provider: 'openai' | 'gemini';
  model: string;
  thinkingLevel: string;
};

type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: 'openai' | 'gemini';
  thinkingLevel: string;
  accessScope: AssistantAccessScope;
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
  provider: 'openai' | 'gemini';
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevel: string;
};

type AssistantAccessScope = { readMode: 'all' | 'selected'; writeMode: 'all' | 'selected'; droneIds: string[]; updatedAt: string };

type AssistantSnapshot = {
  ok: true;
  activeThreadId: string;
  threads: AssistantThread[];
  pendingApprovals: AssistantApproval[];
  models: AssistantModelOption[];
  accessScope?: AssistantAccessScope;
  streamingMessage?: AssistantMessage;
};

type AssistantScopeDrone = { id: string; name: string };
type AssistantScopeMode = 'all' | 'selected';

function readInitialAutoApprove(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ASSISTANT_AUTO_APPROVE_STORAGE_KEY) === '1';
}

function readInitialThreadSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(ASSISTANT_THREAD_SIDEBAR_OPEN_STORAGE_KEY) !== '0';
}

function readInitialScope(): { readMode: AssistantScopeMode; writeMode: AssistantScopeMode; drones: AssistantScopeDrone[] } {
  if (typeof window === 'undefined') return { readMode: 'all', writeMode: 'all', drones: [] };
  try {
    const raw = JSON.parse(window.localStorage.getItem(ASSISTANT_SCOPE_STORAGE_KEY) || 'null');
    const readMode: AssistantScopeMode = (raw?.readMode ?? raw?.mode) === 'selected' ? 'selected' : 'all';
    const writeMode: AssistantScopeMode = (raw?.writeMode ?? raw?.mode) === 'selected' ? 'selected' : 'all';
    const drones = Array.isArray(raw?.drones)
      ? raw.drones
          .map((item: any) => ({
            id: String(item?.id ?? '').trim(),
            name: String(item?.name ?? item?.id ?? '').trim(),
          }))
          .filter((item: AssistantScopeDrone) => item.id)
      : [];
    return drones.length > 0
      ? { readMode, writeMode, drones }
      : { readMode: 'all', writeMode: 'all', drones: [] };
  } catch {
    return { readMode: 'all', writeMode: 'all', drones: [] };
  }
}

function assistantScopeSyncKey(readMode: AssistantScopeMode, writeMode: AssistantScopeMode, droneIds: string[]): string {
  return `${readMode}\u0000${writeMode}\u0000${droneIds.join('\u0000')}`;
}

type AssistantToolCall = { id: string; name: string; args: any };

type AssistantRenderItem =
  | { type: 'message'; key: string; message: AssistantMessage; showToolCalls?: boolean }
  | { type: 'tool'; key: string; call?: AssistantToolCall; result?: AssistantMessage }
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
  create_drone: 'Create drone',
  get_current_context: 'Read current context',
  get_chat_overview: 'Read chat overview',
  inspect_drone: 'Inspect drone',
  list_drones: 'List drones',
  message_drone: 'Send user message to drone',
  read_chat_messages: 'Read chat messages',
  search_chat_messages: 'Search chat messages',
  set_drone_group: 'Set drone group',
  wait_for_agent_chats_idle: 'Wait for chats idle',
};

function toolLabel(name: string | undefined): string {
  const key = String(name ?? '').trim();
  if (!key) return 'Tool';
  return TOOL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderItemsFromMessages(messages: AssistantMessage[]): AssistantRenderItem[] {
  const consumedToolResults = new Set<number>();
  const items: AssistantRenderItem[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'toolResult') {
      if (consumedToolResults.has(index)) continue;
      items.push({ type: 'tool', key: `tool-result:${index}:${message.toolCallId ?? ''}`, result: message });
      continue;
    }

    const calls = toolCalls(message);
    if (message.role !== 'assistant' || calls.length === 0) {
      items.push({ type: 'message', key: `message:${index}:${message.role}`, message });
      continue;
    }

    if (messageText(message).trim() || message.errorMessage) {
      items.push({ type: 'message', key: `message:${index}:${message.role}`, message, showToolCalls: false });
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
      items.push({ type: 'tool', key: `tool-call:${index}:${call.id}`, call, result });
    }
  }
  return items;
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

function assistantThreadStatusTone(status: AssistantThreadStatus): string {
  if (status === 'running') return 'bg-[var(--green)]';
  if (status === 'waiting_for_approval') return 'bg-[var(--accent)]';
  if (status === 'error') return 'bg-[var(--red)]';
  return 'bg-[var(--muted-dim)]';
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
        <span className="w-3 text-center text-[11px] text-[var(--muted-dim)]">{open ? '-' : '+'}</span>
        {status ? <span className={`h-1.5 w-1.5 rounded-full ${status === 'error' ? 'bg-[var(--red)]' : 'bg-[var(--green)]'}`} /> : null}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open ? <div className="border-t border-[var(--border-subtle)] px-2 py-1.5">{children}</div> : null}
    </div>
  );
}

function AssistantThinkingRow() {
  return (
    <div className="px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
        Assistant
      </div>
      <div className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] px-2.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" style={{ animationDelay: '120ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" style={{ animationDelay: '240ms' }} />
      </div>
    </div>
  );
}

function ToolActivityRow({ call, result }: { call?: AssistantToolCall; result?: AssistantMessage }) {
  const title = toolLabel(call?.name || result?.toolName);
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

function AssistantMessageRow({ message, showToolCalls = true }: { message: AssistantMessage; showToolCalls?: boolean }) {
  const text = messageText(message);
  const calls = showToolCalls ? toolCalls(message) : [];

  if (message.role === 'toolResult') {
    return <ToolActivityRow result={message} />;
  }

  return (
    <div className={`px-3 py-2 ${message.role === 'user' ? 'bg-[rgba(255,255,255,.025)] border-y border-[var(--border-subtle)]' : ''}`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
        {message.role === 'user' ? 'You' : 'Assistant'}
      </div>
      {text ? (
        message.role === 'assistant' ? (
          <MarkdownMessage text={text} className="dh-markdown text-[12px]" />
        ) : (
          <div className="whitespace-pre-wrap break-words text-[12px] text-[var(--fg-secondary)]">{text}</div>
        )
      ) : message.errorMessage ? (
        <div className="text-[12px] text-[var(--red)]">{message.errorMessage}</div>
      ) : null}
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
  busy,
  onCancel,
}: {
  prompt: AssistantQueuedPrompt;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="px-3 py-2 bg-[rgba(255,255,255,.018)] border-y border-[var(--border-subtle)]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          Queued
        </div>
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

function AssistantThreadSidebar({
  threads,
  activeThreadId,
  onCreateThread,
  onSelectThread,
  onDeleteThread,
  onCollapse,
}: {
  threads: AssistantThread[];
  activeThreadId: string | null;
  onCreateThread: () => void;
  onSelectThread: (thread: AssistantThread) => void;
  onDeleteThread: (thread: AssistantThread) => void;
  onCollapse: () => void;
}) {
  return (
    <aside className="flex w-52 max-w-[46%] min-w-0 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[rgba(0,0,0,.14)]">
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)]">
          <IconChatThread className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            Threads
          </div>
          <div className="text-[10px] text-[var(--muted-dim)]">{threads.length || 0} total</div>
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
          New Thread
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {threads.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-[var(--muted-dim)]">No assistant threads yet.</div>
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => {
              const active = thread.id === activeThreadId;
              const messageCount = thread.messages.length + (thread.queuedPrompts?.length ?? 0);
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
                      <span className="truncate">{thread.status.replace(/_/g, ' ')}</span>
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
    </aside>
  );
}

function ScopeModeControl({
  label,
  mode,
  selectedDisabled,
  onChange,
}: {
  label: string;
  mode: AssistantScopeMode;
  selectedDisabled: boolean;
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
        disabled={selectedDisabled}
        className={`h-5 rounded px-1.5 text-[9px] font-semibold uppercase tracking-wide disabled:opacity-45 ${
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

export function AssistantDock() {
  const [snapshot, setSnapshot] = React.useState<AssistantSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [threadSidebarOpen, setThreadSidebarOpen] = React.useState(readInitialThreadSidebarOpen);
  const [autoApprove, setAutoApprove] = React.useState(readInitialAutoApprove);
  const initialScope = React.useMemo(readInitialScope, []);
  const [scopeReadMode, setScopeReadMode] = React.useState<AssistantScopeMode>(() => initialScope.readMode);
  const [scopeWriteMode, setScopeWriteMode] = React.useState<AssistantScopeMode>(() => initialScope.writeMode);
  const [scopeDrones, setScopeDrones] = React.useState<AssistantScopeDrone[]>(() => initialScope.drones);
  const [scopeSyncReady, setScopeSyncReady] = React.useState(false);
  const [approvalBusyId, setApprovalBusyId] = React.useState<string | null>(null);
  const [queuedCancelBusyId, setQueuedCancelBusyId] = React.useState<string | null>(null);
  const selectedDrone = useDroneHubUiStore((state) => state.selectedDrone);
  const selectedChat = useDroneHubUiStore((state) => state.selectedChat);
  const appView = useDroneHubUiStore((state) => state.appView);
  const draftChat = useDroneHubUiStore((state) => state.draftChat);
  const kanbanBoardOpen = useDroneHubUiStore((state) => state.kanbanBoardOpen);
  const playbookRunsOpen = useDroneHubUiStore((state) => state.playbookRunsOpen);
  const selectedGroupMultiChat = useDroneHubUiStore((state) => state.selectedGroupMultiChat);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const refocusInputWhenIdleRef = React.useRef(false);
  const autoApprovingIdsRef = React.useRef<Set<string>>(new Set());
  const lastSyncedScopeKeyRef = React.useRef('');
  const { isOver: scopeDropIsOver, setNodeRef: setScopeDropNodeRef } = useDroppable({
    id: 'assistant-drone-scope-drop',
    data: { type: 'assistant-drone-scope-drop' },
  });

  const activeThread = React.useMemo(() => {
    if (!snapshot) return null;
    return snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) ?? snapshot.threads[0] ?? null;
  }, [snapshot]);
  const activeAccessScope: AssistantAccessScope | null = activeThread?.accessScope ?? snapshot?.accessScope ?? null;
  const activeAccessScopeDroneIdsKey = activeAccessScope?.droneIds?.join('\u0000') ?? '';
  const activePendingApprovals = React.useMemo(
    () => (snapshot?.pendingApprovals ?? []).filter((approval) => approval.threadId === activeThread?.id && approval.status === 'pending'),
    [activeThread?.id, snapshot?.pendingApprovals],
  );
  const running = activeThread?.status === 'running' || activeThread?.status === 'waiting_for_approval';
  const visibleMessages = React.useMemo(() => {
    const messages = activeThread?.messages ?? [];
    const streaming = snapshot?.streamingMessage;
    if (!streaming || streaming.role !== 'assistant' || activeThread?.status === 'idle') return messages;
    return [...messages, streaming];
  }, [activeThread?.messages, activeThread?.status, snapshot?.streamingMessage]);
  const visibleItems = React.useMemo(() => {
    const items = renderItemsFromMessages(visibleMessages);
    for (const prompt of activeThread?.queuedPrompts ?? []) {
      items.push({ type: 'queued', key: `queued:${prompt.id}`, prompt });
    }
    return items;
  }, [activeThread?.queuedPrompts, visibleMessages]);
  const showThinking = running && activePendingApprovals.length === 0 && !messageText(snapshot?.streamingMessage ?? { role: 'assistant' }).trim();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await requestJson<AssistantSnapshot>('/api/assistant/threads'));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_AUTO_APPROVE_STORAGE_KEY, autoApprove ? '1' : '0');
  }, [autoApprove]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ASSISTANT_THREAD_SIDEBAR_OPEN_STORAGE_KEY, threadSidebarOpen ? '1' : '0');
  }, [threadSidebarOpen]);

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
    const ids = Array.from(new Set((Array.isArray(scope.droneIds) ? scope.droneIds : []).map((id) => String(id ?? '').trim()).filter(Boolean)));
    const readMode: AssistantScopeMode = scope.readMode === 'selected' && ids.length > 0 ? 'selected' : 'all';
    const writeMode: AssistantScopeMode = scope.writeMode === 'selected' && ids.length > 0 ? 'selected' : 'all';
    lastSyncedScopeKeyRef.current = assistantScopeSyncKey(readMode, writeMode, ids);
    setScopeSyncReady(false);
    setScopeReadMode(readMode);
    setScopeWriteMode(writeMode);
    if (ids.length === 0) {
      setScopeDrones([]);
      setScopeSyncReady(true);
      return;
    }
    void resolveScopeDroneNames(ids).then((drones) => {
      if (cancelled) return;
      setScopeDrones(drones);
      setScopeSyncReady(true);
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

  const addScopeDrones = React.useCallback((drones: AssistantScopeDrone[]) => {
    const clean = drones.map((drone) => ({
      id: String(drone.id ?? '').trim(),
      name: String(drone.name ?? drone.id ?? '').trim(),
    })).filter((drone) => drone.id);
    if (clean.length === 0) return;
    setScopeReadMode('selected');
    setScopeWriteMode('selected');
    setScopeDrones((prev) => {
      const byId = new Map(prev.map((drone) => [drone.id, drone]));
      for (const drone of clean) byId.set(drone.id, drone);
      return Array.from(byId.values());
    });
  }, []);

  const removeScopeDrone = React.useCallback((droneId: string) => {
    setScopeDrones((prev) => {
      const next = prev.filter((drone) => drone.id !== droneId);
      if (next.length === 0) {
        setScopeReadMode('all');
        setScopeWriteMode('all');
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!scopeSyncReady || !activeThread) return;
    const selectedDroneIds = scopeDrones.map((drone) => drone.id);
    const scopedDroneIds = scopeReadMode === 'selected' || scopeWriteMode === 'selected' ? selectedDroneIds : [];
    const syncKey = assistantScopeSyncKey(scopeReadMode, scopeWriteMode, scopedDroneIds);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        ASSISTANT_SCOPE_STORAGE_KEY,
        JSON.stringify({
          readMode: scopeReadMode,
          writeMode: scopeWriteMode,
          drones: scopeDrones,
        }),
      );
    }
    if (lastSyncedScopeKeyRef.current === syncKey) return;
    void fetch('/api/assistant/scope', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: activeThread.id,
        readMode: scopeReadMode,
        writeMode: scopeWriteMode,
        droneIds: scopedDroneIds,
      }),
    })
      .then((response) => {
        if (response.ok) lastSyncedScopeKeyRef.current = syncKey;
      })
      .catch(() => {
        // Scope reporting is best effort; the next change will retry.
      });
  }, [activeThread?.id, scopeDrones, scopeReadMode, scopeSyncReady, scopeWriteMode]);

  useDndMonitor({
    onDragEnd: (event) => {
      if (String(event.over?.id ?? '') !== 'assistant-drone-scope-drop') return;
      const data = parseDroneHubDragData(event.active.data.current);
      if (!data) return;
      let ids: string[] = [];
      let fallbackLabel = '';
      if (data.type === 'sidebar-drone') {
        ids = data.droneIds;
        fallbackLabel = data.droneIds.length === 1 ? data.label : '';
      } else if (data.type === 'sidebar-group') {
        ids = data.droneIds;
      } else if (data.type === 'sidebar-chat') {
        ids = [data.droneId];
        fallbackLabel = data.label.split('/')[0]?.trim() || '';
      }
      if (ids.length === 0) return;
      void resolveScopeDroneNames(ids, fallbackLabel).then(addScopeDrones);
    },
  });

  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleItems.length, activePendingApprovals.length, snapshot?.streamingMessage, showThinking]);

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
    try {
      const activeDroneId = selectedDroneChatOpen ? String(selectedDrone ?? '').trim() : '';
      const next = await requestJson<AssistantSnapshot>('/api/assistant/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          activeDroneId: activeDroneId || null,
          activeChatName: activeDroneId ? String(selectedChat ?? '').trim() || 'default' : null,
        }),
      });
      setSnapshot(next);
      setDraft('');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }, [selectedChat, selectedDrone, selectedDroneChatOpen]);

  const selectThread = React.useCallback(async (thread: AssistantThread) => {
    try {
      const next = await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(thread.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setSnapshot(next);
      setDraft('');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }, []);

  const deleteThread = React.useCallback(async (thread: AssistantThread) => {
    try {
      setSnapshot(await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(thread.id)}`, { method: 'DELETE' }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }, []);

  const updateThread = React.useCallback(async (patch: Partial<Pick<AssistantThread, 'model' | 'provider' | 'thinkingLevel'>>) => {
    if (!activeThread) return;
    try {
      setSnapshot(
        await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }),
      );
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }, [activeThread]);

  const sendPrompt = React.useCallback(async () => {
    if (!activeThread) return;
    const prompt = draft.trim();
    if (!prompt) return;
    setDraft('');
    setError(null);
    refocusInputWhenIdleRef.current = true;
    const response = await fetch(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        provider: activeThread.provider,
        model: activeThread.model,
        thinkingLevel: activeThread.thinkingLevel,
      }),
    });
    try {
      await readNdjson(response, (event) => {
        if (event?.type === 'snapshot' && event.snapshot) setSnapshot(event.snapshot);
        if (event?.type === 'approval_pending' && event.snapshot) setSnapshot(event.snapshot);
        if (event?.type === 'error') setError(String(event.error ?? 'Assistant failed.'));
      });
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setDraft((cur) => (cur.trim() ? cur : prompt));
    } finally {
      void refresh();
    }
  }, [activeThread, draft, refresh]);

  const stop = React.useCallback(async () => {
    if (!activeThread) return;
    try {
      setSnapshot(await requestJson<AssistantSnapshot>(`/api/assistant/threads/${encodeURIComponent(activeThread.id)}/stop`, { method: 'POST' }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }, [activeThread]);

  const cancelQueuedPrompt = React.useCallback(async (prompt: AssistantQueuedPrompt) => {
    if (!activeThread) return;
    setQueuedCancelBusyId(prompt.id);
    try {
      setSnapshot(
        await requestJson<AssistantSnapshot>(
          `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/queued/${encodeURIComponent(prompt.id)}`,
          { method: 'DELETE' },
        ),
      );
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setQueuedCancelBusyId(null);
    }
  }, [activeThread]);

  const resolveApproval = React.useCallback(async (approval: AssistantApproval, approved: boolean) => {
    if (!activeThread) return;
    setApprovalBusyId(approval.id);
    try {
      setSnapshot(
        await requestJson<AssistantSnapshot>(
          `/api/assistant/threads/${encodeURIComponent(activeThread.id)}/approvals/${encodeURIComponent(approval.id)}/${approved ? 'approve' : 'deny'}`,
          { method: 'POST' },
        ),
      );
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setApprovalBusyId(null);
    }
  }, [activeThread]);

  React.useEffect(() => {
    if (!autoApprove || approvalBusyId) return;
    const approval = activePendingApprovals.find((item) => !autoApprovingIdsRef.current.has(item.id));
    if (!approval) return;
    autoApprovingIdsRef.current.add(approval.id);
    void resolveApproval(approval, true).finally(() => {
      autoApprovingIdsRef.current.delete(approval.id);
    });
  }, [activePendingApprovals, approvalBusyId, autoApprove, resolveApproval]);

  const modelOptions = snapshot?.models ?? [];
  const selectedModelKey = activeThread ? `${activeThread.provider}:${activeThread.model}:${activeThread.thinkingLevel}` : '';
  const selectedScopeDisabled = scopeDrones.length === 0;

  return (
    <div className="flex h-full min-h-0 bg-[var(--panel-alt)]">
      {threadSidebarOpen ? (
        <AssistantThreadSidebar
          threads={snapshot?.threads ?? []}
          activeThreadId={activeThread?.id ?? null}
          onCreateThread={() => void createThread()}
          onSelectThread={(thread) => void selectThread(thread)}
          onDeleteThread={(thread) => void deleteThread(thread)}
          onCollapse={() => setThreadSidebarOpen(false)}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[rgba(255,255,255,.025)] px-2">
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
              <span className="truncate">{activeThread?.status?.replace(/_/g, ' ') ?? (loading ? 'loading' : 'idle')}</span>
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
            onClick={() => setAutoApprove((value) => !value)}
            aria-pressed={autoApprove}
            aria-label="Toggle auto-approve proposals"
            title={autoApprove ? 'Auto-approve proposals is on' : 'Auto-approve proposals is off'}
            className={`h-8 w-8 flex-shrink-0 rounded border text-[var(--muted)] hover:text-[var(--fg)] ${
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
        </div>

      <div
        ref={setScopeDropNodeRef}
        className={`flex-shrink-0 border-b border-[var(--border)] px-2 py-1.5 transition-colors ${
          scopeDropIsOver ? 'bg-[var(--accent-subtle)]' : 'bg-[rgba(0,0,0,.08)]'
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="mr-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Access
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <ScopeModeControl label="R" mode={scopeReadMode} selectedDisabled={selectedScopeDisabled} onChange={setScopeReadMode} />
            <ScopeModeControl label="W" mode={scopeWriteMode} selectedDisabled={selectedScopeDisabled} onChange={setScopeWriteMode} />
          </div>
          <div className="min-w-[120px] flex-1 overflow-hidden">
            {scopeDrones.length === 0 ? (
              <div className="truncate text-[10px] text-[var(--muted-dim)]">Drop drones here to limit access.</div>
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

      <div ref={scrollRef} className="flex-1 min-h-0 space-y-2 overflow-y-auto py-3">
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
              <AssistantMessageRow key={item.key} message={item.message} showToolCalls={item.showToolCalls} />
            ) : item.type === 'tool' ? (
              <ToolActivityRow key={item.key} call={item.call} result={item.result} />
            ) : (
              <QueuedPromptRow
                key={item.key}
                prompt={item.prompt}
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

      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)] p-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendPrompt();
            }
          }}
          disabled={!activeThread}
          placeholder={running ? 'Queue a message' : 'Ask the assistant'}
          className="h-20 w-full resize-none rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-2 text-[12px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-50"
        />
        <div className="mt-2 flex items-center gap-2">
          <select
            value={selectedModelKey}
            disabled={!activeThread || running}
            onChange={(event) => {
              const [provider, model, thinkingLevel] = event.target.value.split(':');
              void updateThread({ provider: provider as AssistantThread['provider'], model, thinkingLevel });
            }}
            className="min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1 text-[11px] text-[var(--fg-secondary)] focus:outline-none disabled:opacity-50"
          >
            {modelOptions.map((model) => (
              <option key={`${model.provider}:${model.id}:${model.thinkingLevel}`} value={`${model.provider}:${model.id}:${model.thinkingLevel}`}>
                {model.name}
              </option>
            ))}
          </select>
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="h-8 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--red)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Stop
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void sendPrompt()}
            disabled={!draft.trim() || !activeThread}
            className="h-8 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] disabled:opacity-40"
            style={{ fontFamily: 'var(--display)' }}
          >
            Send
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
