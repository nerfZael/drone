export const COMPANION_MAX_PROMPT_CHARS = 20_000;
export const COMPANION_MAX_RUN_ID_CHARS = 128;

export const COMPANION_BROWSER_TOOL_NAMES = [
  'get_app_context',
  'read_active_composer',
  'apply_composer_patch',
  'read_open_file',
  'apply_editor_patch',
  'read_companion_proposal',
  'apply_companion_proposal_patch',
  'open_drone_chat',
  'highlight_drones',
] as const;

export type CompanionBrowserToolName = (typeof COMPANION_BROWSER_TOOL_NAMES)[number];

/** Resolve an existing chat for Companion navigation without inventing a `default` chat. */
export function resolveCompanionChatName(
  chatNames: readonly string[],
  requestedChatName: unknown,
): string | null {
  const available = [...new Set(chatNames.map((name) => String(name ?? '').trim()).filter(Boolean))];
  const requested = String(requestedChatName ?? '').trim();
  if (requested) return available.includes(requested) ? requested : null;
  return available.includes('default') ? 'default' : available[0] ?? null;
}

export type CompanionStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'transcribing'
  | 'working'
  | 'completed'
  | 'cancelled'
  | 'error';

export type CompanionTextMode =
  | 'edit'
  | 'preview'
  | 'read-only'
  | 'loading'
  | 'saving'
  | 'large-file';

export type CompanionTextSnapshot = {
  targetId: string;
  path: string;
  content: string;
  revision: string;
  mode: CompanionTextMode;
  dirty?: boolean;
};

export type CompanionToolActivity = {
  callId: string;
  tool: string;
  turnId?: string;
  parallelGroupId?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  status: 'running' | 'completed' | 'failed';
};

export type CompanionToolActivityEvent = {
  type: string;
  callId?: unknown;
  tool?: unknown;
  turnId?: unknown;
  args?: unknown;
  result?: unknown;
  error?: unknown;
};

export type CompanionToolActivityGroup = {
  key: string;
  parallel: boolean;
  items: CompanionToolActivity[];
};

function activityRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activityText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function activityPathLabel(value: unknown): string {
  const path = activityText(value);
  if (!path) return '';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function activityPreview(value: unknown, maxLength = 64): string {
  const text = activityText(value).replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function activityResultCount(item: CompanionToolActivity): number | null {
  const result = activityRecord(item.result);
  const value = result?.count ?? result?.total;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

function activityCountLabel(tool: string, count: number | null): string {
  if (count === null) return '';
  const noun = tool === 'list_drones'
    ? 'drone'
    : tool === 'list_groups'
      ? 'group'
    : tool === 'list_repos'
      ? 'repository'
      : tool === 'list_chats'
        ? 'chat'
        : tool === 'search_chat_messages'
          ? 'match'
          : 'result';
  const plural = noun === 'repository' ? 'repositories' : noun === 'match' ? 'matches' : `${noun}s`;
  return `${count} ${count === 1 ? noun : plural}`;
}

/** A compact, argument-aware description for Companion's visible tool activity. */
export function companionToolActivityLabel(item: CompanionToolActivity): string {
  const args = activityRecord(item.args) ?? {};
  const result = activityRecord(item.result) ?? {};
  const repository = activityPathLabel(args.repoPath);
  const count = activityCountLabel(item.tool, activityResultCount(item));
  let label = '';

  if (item.tool === 'list_drones') {
    const names = Array.isArray(args.names)
      ? args.names.map(activityText).filter(Boolean)
      : [];
    if (names.length === 1) label = `Find drone “${activityPreview(names[0])}”`;
    else if (names.length > 1) label = `Find ${names.length} named drones`;
    else if (repository) label = `List drones in ${repository}`;
    else if (activityText(args.group)) label = `List drones in group “${activityPreview(args.group)}”`;
    else label = 'List drones';
  } else if (item.tool === 'list_repos') {
    label = 'List repositories';
  } else if (item.tool === 'list_groups') {
    label = activityText(args.repoPath)
      ? `List groups in ${activityPathLabel(args.repoPath)}`
      : 'List groups';
  } else if (item.tool === 'search_chat_messages') {
    const query = activityPreview(args.query);
    label = query ? `Search chats for “${query}”` : 'Search chat messages';
    if (repository) label += ` in ${repository}`;
  } else if (item.tool === 'open_drone_chat') {
    const chatName = activityPreview(result.chatName) || activityPreview(args.chatName);
    const droneName = activityPreview(result.droneName);
    if (chatName && droneName) label = `Open “${chatName}” in ${droneName}`;
    else if (droneName) label = `Open ${droneName}`;
    else label = chatName ? `Open chat “${chatName}”` : 'Open drone chat';
  } else if (item.tool === 'get_app_context') {
    label = 'Read app context';
  } else if (item.tool === 'read_companion_proposal') {
    label = 'Read proposal';
  } else if (item.tool === 'apply_companion_proposal_patch') {
    label = 'Update proposal';
  } else {
    label = item.tool.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return count ? `${label} · ${count}` : label;
}

export type CompanionBrowserToolRequest = {
  type: 'tool_call';
  generation: number;
  callId: string;
  tool: CompanionBrowserToolName;
  args: Record<string, unknown>;
};

/**
 * Privacy-safe client measurements attached to a Companion message. These
 * values intentionally contain no transcript, prompt, or device metadata.
 */
export type CompanionClientTelemetry = {
  version: 1;
  transcriptionMs?: number;
  audioDurationMs?: number;
  connectionMs?: number;
  connectionReused?: boolean;
};

export type CompanionRunEvent =
  | CompanionBrowserToolRequest
  | { type: 'activity'; event: CompanionToolActivityEvent }
  | { type: 'reply'; reply: string }
  | { type: 'status'; status: 'working' | 'completed' | 'cancelled' }
  | { type: 'error'; error: string };

export type CompanionClientMessage =
  | {
      type: 'start_run';
      runId: string;
      messageId?: string;
      prompt: string;
      telemetry?: CompanionClientTelemetry;
    }
  | { type: 'cancel_run'; runId: string }
  | {
      type: 'tool_result';
      runId: string;
      generation: number;
      callId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    };

export type CompanionServerMessage = CompanionRunEvent & { runId?: string; messageId?: string };

export type CompanionRunInputValidation =
  | {
      ok: true;
      runId: string;
      messageId?: string;
      prompt: string;
      telemetry?: CompanionClientTelemetry;
    }
  | { ok: false; runId: string; error: string };

export function validateCompanionRunInput(input: {
  runId?: unknown;
  messageId?: unknown;
  prompt?: unknown;
  telemetry?: unknown;
}): CompanionRunInputValidation {
  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  const messageId = typeof input.messageId === 'string' ? input.messageId.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (
    !runId ||
    runId.length > COMPANION_MAX_RUN_ID_CHARS ||
    /[\u0000-\u001f\u007f]/.test(runId)
  ) {
    return {
      ok: false,
      runId: runId.slice(0, COMPANION_MAX_RUN_ID_CHARS),
      error: 'A valid runId is required.',
    };
  }
  if (!prompt) return { ok: false, runId, error: 'A non-empty prompt is required.' };
  if (prompt.length > COMPANION_MAX_PROMPT_CHARS) {
    return {
      ok: false,
      runId,
      error: `Companion prompts cannot exceed ${COMPANION_MAX_PROMPT_CHARS} characters.`,
    };
  }
  if (
    messageId &&
    (messageId.length > COMPANION_MAX_RUN_ID_CHARS || /[\u0000-\u001f\u007f]/.test(messageId))
  ) {
    return { ok: false, runId, error: 'A valid messageId is required.' };
  }
  const telemetry = normalizeCompanionClientTelemetry(input.telemetry);
  return {
    ok: true,
    runId,
    ...(messageId ? { messageId } : {}),
    prompt,
    ...(telemetry ? { telemetry } : {}),
  };
}

function normalizeCompanionClientTelemetry(value: unknown): CompanionClientTelemetry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return undefined;
  const duration = (candidate: unknown, max: number): number | undefined => {
    const number = Number(candidate);
    if (!Number.isFinite(number) || number < 0) return undefined;
    return Math.min(max, Math.round(number * 10) / 10);
  };
  const transcriptionMs = duration(raw.transcriptionMs, 60 * 60 * 1_000);
  const audioDurationMs = duration(raw.audioDurationMs, 60 * 60 * 1_000);
  const connectionMs = duration(raw.connectionMs, 60_000);
  const normalized: CompanionClientTelemetry = {
    version: 1,
    ...(transcriptionMs !== undefined ? { transcriptionMs } : {}),
    ...(audioDurationMs !== undefined ? { audioDurationMs } : {}),
    ...(connectionMs !== undefined ? { connectionMs } : {}),
    ...(typeof raw.connectionReused === 'boolean'
      ? { connectionReused: raw.connectionReused }
      : {}),
  };
  return Object.keys(normalized).length > 1 ? normalized : undefined;
}

export function reduceCompanionToolActivity(
  current: CompanionToolActivity[],
  event: CompanionToolActivityEvent,
): CompanionToolActivity[] {
  const type = String(event?.type ?? '');
  const callId = String(event?.callId ?? '');
  const turnId = String(event?.turnId ?? '');
  if (!callId) return current;
  if (type === 'tool_call_started') {
    if (current.some((item) => item.callId === callId)) return current;
    const runningSiblings = turnId
      ? current.filter((item) => item.turnId === turnId && item.status === 'running')
      : [];
    const parallelGroupId = runningSiblings.length
      ? runningSiblings.find((item) => item.parallelGroupId)?.parallelGroupId ??
        `parallel:${turnId}:${runningSiblings[0]!.callId}`
      : undefined;
    const nextCurrent = parallelGroupId
      ? current.map((item) =>
          runningSiblings.some((sibling) => sibling.callId === item.callId)
            ? { ...item, parallelGroupId }
            : item,
        )
      : current;
    return [
      ...nextCurrent,
      {
        callId,
        tool: String(event.tool ?? 'tool'),
        ...(turnId ? { turnId } : {}),
        ...(parallelGroupId ? { parallelGroupId } : {}),
        args: event.args,
        status: 'running',
      },
    ];
  }
  if (type !== 'tool_call_completed' && type !== 'tool_call_failed') return current;
  const status: CompanionToolActivity['status'] =
    type === 'tool_call_completed' ? 'completed' : 'failed';
  const error = event.error == null ? undefined : String(event.error);
  const existing = current.find((item) => item.callId === callId);
  if (!existing) {
    return [
      ...current,
      {
        callId,
        tool: String(event.tool ?? 'tool'),
        ...(turnId ? { turnId } : {}),
        args: event.args,
        result: event.result,
        ...(error ? { error } : {}),
        status,
      },
    ];
  }
  return current.map((item) => {
    if (item.callId !== callId) return item;
    const next = { ...item, status, result: event.result };
    delete next.error;
    if (error) next.error = error;
    return next;
  });
}

export function groupCompanionToolActivity(
  activity: CompanionToolActivity[],
): CompanionToolActivityGroup[] {
  const groups: CompanionToolActivityGroup[] = [];
  for (const item of activity) {
    const previous = groups[groups.length - 1];
    if (item.parallelGroupId && previous?.key === item.parallelGroupId) {
      previous.items.push(item);
      previous.parallel = previous.items.length > 1;
      continue;
    }
    groups.push({
      key: item.parallelGroupId ?? item.callId,
      parallel: false,
      items: [item],
    });
  }
  return groups;
}
