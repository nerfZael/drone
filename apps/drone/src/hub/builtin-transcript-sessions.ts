import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';

export function readBuiltinTranscriptSessionId(
  chatEntry: any,
  agentId: Extract<BuiltinTranscriptAgentId, 'codex' | 'opencode' | 'pi' | 'blip'>,
): string {
  if (agentId === 'codex') {
    return typeof chatEntry?.codexThreadId === 'string'
      ? String(chatEntry.codexThreadId).trim()
      : '';
  }
  if (agentId === 'opencode') {
    return typeof chatEntry?.openCodeSessionId === 'string'
      ? String(chatEntry.openCodeSessionId).trim()
      : '';
  }
  if (agentId === 'pi') {
    return typeof chatEntry?.piSessionId === 'string' ? String(chatEntry.piSessionId).trim() : '';
  }
  return typeof chatEntry?.blipSessionId === 'string' ? String(chatEntry.blipSessionId).trim() : '';
}

export function hasKnownBuiltinTranscriptSession(
  chatEntry: any,
  agentId: BuiltinTranscriptAgentId,
): boolean {
  if (agentId === 'codex' || agentId === 'opencode' || agentId === 'pi' || agentId === 'blip') {
    return Boolean(readBuiltinTranscriptSessionId(chatEntry, agentId));
  }
  return true;
}

function takeStringText(raw: any): string | null {
  if (typeof raw === 'string' && raw) return raw;
  return null;
}

function extractContentText(raw: any): string | null {
  if (typeof raw === 'string') return raw || null;
  if (!Array.isArray(raw)) return null;
  const parts: string[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const t = takeStringText((c as any).text) ?? takeStringText((c as any).output_text);
    if (t) parts.push(t);
  }
  if (parts.length === 0) return null;
  return parts.join('\n');
}

function contentHasOutputText(raw: any): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some((c) => {
    if (!c || typeof c !== 'object') return false;
    const type = String((c as any).type ?? '').trim();
    return type === 'output_text' || typeof (c as any).output_text === 'string';
  });
}

function parseUuid(text: string): string | null {
  const match = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}

type CodexTerminalEvent = 'turn.completed' | 'response.completed' | 'response.failed' | 'error';
type CodexJsonlParseResult = {
  threadId: string | null;
  message: string | null;
  terminalEvent?: CodexTerminalEvent;
};
type PiJsonlParseResult = { sessionId: string | null; message: string | null };
export type BlipCloneActivity = {
  status: 'running';
  count: number;
  tasks: string[];
};

export type BlipToolCallSummary = {
  callId?: string;
  tool: string;
  status: 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  exitCode?: number;
  error?: string;
};

type BlipJsonlParseResult = {
  sessionId: string | null;
  message: string | null;
  terminalEvent?: 'session_finished' | 'session_error';
  firstEventAt?: string;
  lastEventAt?: string;
  terminalEventAt?: string;
  terminalStatus?: string;
  terminalError?: string;
  durationMs?: number;
  eventCounts?: Record<string, number>;
  toolCallCount?: number;
  toolCallCompletedCount?: number;
  toolCallFailedCount?: number;
  longestToolCall?: BlipToolCallSummary;
  cloneActivity?: BlipCloneActivity;
};

function createCodexJsonlParser(): {
  pushLine: (line: string) => void;
  result: () => CodexJsonlParseResult;
} {
  let threadId: string | null = null;
  let lastMsg: string | null = null;
  let streamedMsg = '';
  let terminalEvent: CodexTerminalEvent | null = null;

  function extractItemText(item: any): string | null {
    if (!item || typeof item !== 'object') return null;
    const direct =
      takeStringText(item.text) ??
      takeStringText(item.output_text) ??
      takeStringText(item.message) ??
      takeStringText(item.last_agent_message);
    if (direct) return direct;
    return extractContentText(item.content);
  }

  function isAssistantItem(item: any): boolean {
    if (!item || typeof item !== 'object') return false;
    const itemType = String(item.type ?? '').trim();
    const role = String(item.role ?? '').trim();
    return (
      itemType === 'agent_message' ||
      itemType === 'assistant_message' ||
      role === 'assistant' ||
      itemType === 'assistant' ||
      (itemType === 'message' && role !== 'user' && contentHasOutputText(item.content))
    );
  }

  function considerAssistantItem(item: any) {
    if (!isAssistantItem(item)) return;
    const text = extractItemText(item);
    if (text) lastMsg = text;
  }

  function considerResponse(response: any) {
    const responseText = takeStringText(response?.output_text);
    if (responseText) {
      lastMsg = responseText;
      return;
    }
    if (!Array.isArray(response?.output)) return;
    for (const item of response.output) considerAssistantItem(item);
  }

  return {
    pushLine(lineRaw: string) {
      const line = String(lineRaw ?? '').trim();
      if (!line) return;
      let obj: any = null;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (!obj || typeof obj !== 'object') return;
      const type = String(obj.type ?? '').trim();
      if (
        type === 'turn.completed' ||
        type === 'response.completed' ||
        type === 'response.failed' ||
        type === 'error'
      ) {
        terminalEvent = type;
      }
      if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
        threadId = obj.thread_id;
        return;
      }
      if (
        (obj.type === 'item.completed' || obj.type === 'item.started') &&
        obj.item &&
        typeof obj.item === 'object'
      ) {
        considerAssistantItem(obj.item);
        return;
      }

      if (obj.type === 'response.output_text.delta') {
        const delta = takeStringText(obj.delta);
        if (delta) streamedMsg += delta;
        return;
      }
      if (obj.type === 'response.output_text.done') {
        const text = takeStringText(obj.text);
        if (text) lastMsg = text;
        return;
      }
      if (obj.type === 'turn.completed') {
        const text = takeStringText(obj.last_agent_message) ?? takeStringText(obj.message);
        if (text) lastMsg = text;
      }

      considerAssistantItem(obj);
      considerAssistantItem(obj.message);
      considerResponse(obj?.response);
    },
    result() {
      return {
        threadId,
        message: lastMsg ?? (streamedMsg ? streamedMsg : null),
        ...(terminalEvent ? { terminalEvent } : {}),
      };
    },
  };
}

function createPiJsonlParser(): {
  pushLine: (line: string) => void;
  result: () => PiJsonlParseResult;
} {
  let sessionId: string | null = null;
  let lastMsg: string | null = null;

  const extractAssistantText = (message: any): string | null => {
    if (!message || typeof message !== 'object') return null;
    if (String(message.role ?? '').trim() !== 'assistant') return null;
    if (typeof message.content === 'string') {
      const text = message.content.trim();
      return text || null;
    }
    if (!Array.isArray(message.content)) return null;
    const parts: string[] = [];
    for (const item of message.content) {
      if (!item || typeof item !== 'object') continue;
      if (String((item as any).type ?? '').trim() !== 'text') continue;
      const text = String((item as any).text ?? '').trim();
      if (text) parts.push(text);
    }
    if (parts.length === 0) return null;
    return parts.join('\n');
  };

  const considerMessage = (message: any) => {
    const text = extractAssistantText(message);
    if (text) lastMsg = text;
  };

  return {
    pushLine(lineRaw: string) {
      const line = String(lineRaw ?? '').trim();
      if (!line) return;
      let obj: any = null;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (!obj || typeof obj !== 'object') return;
      if (obj.type === 'session') {
        const parsedId = parseUuid(String(obj.id ?? obj.sessionId ?? obj.session_id ?? '').trim());
        if (parsedId) sessionId = parsedId;
      }
      considerMessage(obj.message);
      if (Array.isArray(obj.messages)) {
        for (const message of obj.messages) considerMessage(message);
      }
    },
    result() {
      return { sessionId, message: lastMsg };
    },
  };
}

function normalizeBlipCloneActivity(raw: any): BlipCloneActivity | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
  const tasks = tasksRaw
    .map((task: any) => String(task ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tasks.length === 0) return undefined;
  const countRaw = Number(raw.count);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : tasks.length;
  return { status: 'running', count: Math.max(1, count), tasks };
}

function cloneActivityFromArgs(args: any): BlipCloneActivity | undefined {
  const tasksRaw =
    args && typeof args === 'object' && Array.isArray(args.agents)
      ? args.agents.map((agent: any) => agent?.task)
      : args && typeof args === 'object' && Array.isArray(args.tasks)
        ? args.tasks
        : [];
  const tasks = tasksRaw
    .map((task: any) => String(task ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tasks.length === 0) return undefined;
  return { status: 'running', count: tasks.length, tasks };
}

function optionalBlipTimestamp(raw: any): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function optionalFiniteDurationMs(raw: any): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function optionalToolExitCode(raw: any): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function truncateBlipDiagnosticText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 500) return trimmed;
  return `${trimmed.slice(0, 497)}...`;
}

function extractBlipErrorText(raw: any): string | null {
  if (typeof raw === 'string' && raw.trim()) return truncateBlipDiagnosticText(raw);
  if (!raw || typeof raw !== 'object') return null;
  const direct =
    takeStringText(raw.message) ?? takeStringText(raw.error) ?? takeStringText(raw.detail);
  if (direct) return truncateBlipDiagnosticText(direct);
  try {
    const json = JSON.stringify(raw);
    return json ? truncateBlipDiagnosticText(json) : null;
  } catch {
    return null;
  }
}

function createBlipJsonlParser(): {
  pushLine: (line: string) => void;
  result: () => BlipJsonlParseResult;
} {
  let sessionId: string | null = null;
  let lastMsg: string | null = null;
  let streamedMsg = '';
  let terminalEvent: BlipJsonlParseResult['terminalEvent'];
  let firstEventAt: string | null = null;
  let lastEventAt: string | null = null;
  let terminalEventAt: string | null = null;
  let terminalStatus: string | null = null;
  let terminalError: string | null = null;
  let durationMs: number | null = null;
  let toolCallCount = 0;
  let toolCallCompletedCount = 0;
  let toolCallFailedCount = 0;
  let longestToolCall: BlipToolCallSummary | null = null;
  const eventCounts: Record<string, number> = {};
  const activeToolCalls = new Map<
    string,
    { tool: string; startedAt?: string; startedAtMs?: number }
  >();
  const activeAgentCallActivities = new Map<string, BlipCloneActivity>();
  const activeAgentRunActivities = new Map<string, BlipCloneActivity>();

  return {
    pushLine(lineRaw: string) {
      const line = String(lineRaw ?? '').trim();
      if (!line) return;
      let obj: any = null;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (!obj || typeof obj !== 'object') return;
      const parsedSessionId = String(obj.sessionId ?? '').trim();
      if (parsedSessionId) sessionId = parsedSessionId;
      const type = String(obj.type ?? '').trim();
      if (type) eventCounts[type] = (eventCounts[type] ?? 0) + 1;
      const timestamp = optionalBlipTimestamp(obj.timestamp);
      if (timestamp) {
        if (!firstEventAt) firstEventAt = timestamp;
        lastEventAt = timestamp;
      }
      const tool = String(obj.tool ?? '').trim();
      const callId = String(obj.callId ?? '').trim();
      if (type === 'tool_call_started') {
        toolCallCount += 1;
        if (callId) {
          activeToolCalls.set(callId, {
            tool: tool || 'unknown',
            ...(timestamp ? { startedAt: timestamp, startedAtMs: Date.parse(timestamp) } : {}),
          });
        }
      }
      if (type === 'tool_call_completed' || type === 'tool_call_failed') {
        if (type === 'tool_call_completed') toolCallCompletedCount += 1;
        else toolCallFailedCount += 1;
        const started = callId ? activeToolCalls.get(callId) : undefined;
        const completedAtMs = timestamp ? Date.parse(timestamp) : null;
        const explicitDurationMs = optionalFiniteDurationMs(obj.durationMs);
        const computedDurationMs =
          explicitDurationMs ??
          (started?.startedAtMs != null && completedAtMs != null
            ? Math.max(0, Math.round(completedAtMs - started.startedAtMs))
            : null);
        if (computedDurationMs != null) {
          const summary: BlipToolCallSummary = {
            ...(callId ? { callId } : {}),
            tool: tool || started?.tool || 'unknown',
            status: type === 'tool_call_completed' ? 'completed' : 'failed',
            ...(started?.startedAt ? { startedAt: started.startedAt } : {}),
            ...(timestamp ? { completedAt: timestamp } : {}),
            durationMs: computedDurationMs,
            ...(optionalToolExitCode(obj.exitCode) != null
              ? { exitCode: optionalToolExitCode(obj.exitCode)! }
              : {}),
            ...(extractBlipErrorText(obj.error) ? { error: extractBlipErrorText(obj.error)! } : {}),
          };
          if (!longestToolCall || summary.durationMs > longestToolCall.durationMs)
            longestToolCall = summary;
        }
        if (callId) activeToolCalls.delete(callId);
      }
      if (
        tool === 'agent' &&
        type === 'tool_call_started' &&
        String(obj.args?.action ?? 'run') !== 'collect' &&
        String(obj.args?.action ?? 'run') !== 'cancel'
      ) {
        const cloneActivity = cloneActivityFromArgs(obj.args);
        if (callId && cloneActivity) activeAgentCallActivities.set(callId, cloneActivity);
        return;
      }
      if (
        tool === 'agent' &&
        (type === 'tool_call_completed' || type === 'tool_call_failed')
      ) {
        const callActivity = callId ? activeAgentCallActivities.get(callId) : undefined;
        if (callId) activeAgentCallActivities.delete(callId);
        const runId = String(obj.result?.runId ?? '').trim();
        const status = String(obj.result?.status ?? '').trim();
        if (type === 'tool_call_completed' && status === 'running' && runId && callActivity) {
          activeAgentRunActivities.set(runId, callActivity);
        } else if (runId) {
          activeAgentRunActivities.delete(runId);
        } else if (type === 'tool_call_failed' || status === 'completed' || status === 'cancelled' || status === 'error') {
          activeAgentRunActivities.clear();
        }
        return;
      }
      if (type === 'assistant_delta') {
        const delta = takeStringText(obj.text);
        if (delta) streamedMsg += delta;
        return;
      }
      if (type === 'assistant_message') {
        const text = takeStringText(obj.text) ?? takeStringText(obj.message);
        if (text) lastMsg = text;
        return;
      }
      if (type === 'session_finished') {
        terminalEvent = 'session_finished';
        terminalEventAt = timestamp;
        terminalStatus = String(obj.status ?? '').trim() || null;
        terminalError = extractBlipErrorText(obj.error);
        durationMs = optionalFiniteDurationMs(obj.durationMs);
        return;
      }
      if (type === 'session_error') {
        terminalEvent = 'session_error';
        terminalEventAt = timestamp;
        terminalStatus = String(obj.status ?? '').trim() || null;
        terminalError = extractBlipErrorText(obj.error);
        durationMs = optionalFiniteDurationMs(obj.durationMs);
      }
    },
    result() {
      const activeCloneActivities = [
        ...Array.from(activeAgentRunActivities.values()),
        ...Array.from(activeAgentCallActivities.values()),
      ];
      const cloneActivity = activeCloneActivities[activeCloneActivities.length - 1];
      const eventCountsOut = Object.keys(eventCounts).length > 0 ? eventCounts : null;
      return {
        sessionId,
        message: lastMsg ?? (streamedMsg ? streamedMsg : null),
        ...(terminalEvent ? { terminalEvent } : {}),
        ...(firstEventAt ? { firstEventAt } : {}),
        ...(lastEventAt ? { lastEventAt } : {}),
        ...(terminalEventAt ? { terminalEventAt } : {}),
        ...(terminalStatus ? { terminalStatus } : {}),
        ...(terminalError ? { terminalError } : {}),
        ...(durationMs != null ? { durationMs } : {}),
        ...(eventCountsOut ? { eventCounts: eventCountsOut } : {}),
        ...(toolCallCount > 0 ? { toolCallCount } : {}),
        ...(toolCallCompletedCount > 0 ? { toolCallCompletedCount } : {}),
        ...(toolCallFailedCount > 0 ? { toolCallFailedCount } : {}),
        ...(longestToolCall ? { longestToolCall } : {}),
        ...(cloneActivity ? { cloneActivity } : {}),
      };
    },
  };
}

export function parseCodexJsonl(stdout: string): CodexJsonlParseResult {
  const parser = createCodexJsonlParser();
  for (const line of String(stdout || '').split('\n')) parser.pushLine(line);
  return parser.result();
}

export async function parseCodexJsonlLines(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<CodexJsonlParseResult> {
  const parser = createCodexJsonlParser();
  for await (const line of lines) parser.pushLine(line);
  return parser.result();
}

export function parsePiJsonl(stdout: string): PiJsonlParseResult {
  const parser = createPiJsonlParser();
  for (const line of String(stdout || '').split('\n')) parser.pushLine(line);
  return parser.result();
}

export function parseBlipJsonl(stdout: string): BlipJsonlParseResult {
  const parser = createBlipJsonlParser();
  for (const line of String(stdout || '').split('\n')) parser.pushLine(line);
  return parser.result();
}

export async function parsePiJsonlLines(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<PiJsonlParseResult> {
  const parser = createPiJsonlParser();
  for await (const line of lines) parser.pushLine(line);
  return parser.result();
}

export async function parseBlipJsonlLines(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<BlipJsonlParseResult> {
  const parser = createBlipJsonlParser();
  for await (const line of lines) parser.pushLine(line);
  return parser.result();
}

export type BuiltinPromptJobTranscript =
  | {
      kind: 'codex';
      message: string | null;
      threadId: string | null;
      terminalEvent?: CodexTerminalEvent;
      stdoutBytes?: number;
      stdoutTruncated?: boolean;
      parsedAt?: string;
    }
  | {
      kind: 'pi';
      message: string | null;
      sessionId: string | null;
      stdoutBytes?: number;
      stdoutTruncated?: boolean;
      parsedAt?: string;
    }
  | {
      kind: 'blip';
      message: string | null;
      sessionId: string | null;
      terminalEvent?: 'session_finished' | 'session_error';
      firstEventAt?: string;
      lastEventAt?: string;
      terminalEventAt?: string;
      terminalStatus?: string;
      terminalError?: string;
      durationMs?: number;
      eventCounts?: Record<string, number>;
      toolCallCount?: number;
      toolCallCompletedCount?: number;
      toolCallFailedCount?: number;
      longestToolCall?: BlipToolCallSummary;
      cloneActivity?: BlipCloneActivity;
      stdoutBytes?: number;
      stdoutTruncated?: boolean;
      parsedAt?: string;
    };

function optionalString(raw: any): string | null {
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

function promptJobTranscriptMeta(opts?: {
  stdoutBytes?: number;
  stdoutTruncated?: boolean;
  parsedAt?: string;
}): { stdoutBytes?: number; stdoutTruncated?: boolean; parsedAt?: string } {
  return {
    ...(typeof opts?.stdoutBytes === 'number' && Number.isFinite(opts.stdoutBytes)
      ? { stdoutBytes: Math.max(0, Math.floor(opts.stdoutBytes)) }
      : {}),
    ...(typeof opts?.stdoutTruncated === 'boolean'
      ? { stdoutTruncated: opts.stdoutTruncated }
      : {}),
    ...(typeof opts?.parsedAt === 'string' && opts.parsedAt.trim()
      ? { parsedAt: opts.parsedAt.trim() }
      : {}),
  };
}

function blipTranscriptDiagnostics(
  parsed: BlipJsonlParseResult,
): Partial<Extract<BuiltinPromptJobTranscript, { kind: 'blip' }>> {
  return {
    ...(parsed.firstEventAt ? { firstEventAt: parsed.firstEventAt } : {}),
    ...(parsed.lastEventAt ? { lastEventAt: parsed.lastEventAt } : {}),
    ...(parsed.terminalEventAt ? { terminalEventAt: parsed.terminalEventAt } : {}),
    ...(parsed.terminalStatus ? { terminalStatus: parsed.terminalStatus } : {}),
    ...(parsed.terminalError ? { terminalError: parsed.terminalError } : {}),
    ...(typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs)
      ? { durationMs: parsed.durationMs }
      : {}),
    ...(parsed.eventCounts ? { eventCounts: parsed.eventCounts } : {}),
    ...(typeof parsed.toolCallCount === 'number' ? { toolCallCount: parsed.toolCallCount } : {}),
    ...(typeof parsed.toolCallCompletedCount === 'number'
      ? { toolCallCompletedCount: parsed.toolCallCompletedCount }
      : {}),
    ...(typeof parsed.toolCallFailedCount === 'number'
      ? { toolCallFailedCount: parsed.toolCallFailedCount }
      : {}),
    ...(parsed.longestToolCall ? { longestToolCall: parsed.longestToolCall } : {}),
  };
}

export function parseBuiltinPromptJobTranscript(
  kindRaw: unknown,
  stdout: string,
  opts?: { stdoutBytes?: number; stdoutTruncated?: boolean; parsedAt?: string },
): BuiltinPromptJobTranscript | null {
  const kind = String(kindRaw ?? '').trim();
  if (kind === 'codex') {
    const parsed = parseCodexJsonl(stdout);
    return {
      kind: 'codex',
      message: parsed.message,
      threadId: parsed.threadId,
      ...(parsed.terminalEvent ? { terminalEvent: parsed.terminalEvent } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'pi') {
    const parsed = parsePiJsonl(stdout);
    return {
      kind: 'pi',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'blip') {
    const parsed = parseBlipJsonl(stdout);
    return {
      kind: 'blip',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.terminalEvent ? { terminalEvent: parsed.terminalEvent } : {}),
      ...blipTranscriptDiagnostics(parsed),
      ...(parsed.cloneActivity ? { cloneActivity: parsed.cloneActivity } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  return null;
}

export async function parseBuiltinPromptJobTranscriptLines(
  kindRaw: unknown,
  lines: AsyncIterable<string> | Iterable<string>,
  opts?: { stdoutBytes?: number; stdoutTruncated?: boolean; parsedAt?: string },
): Promise<BuiltinPromptJobTranscript | null> {
  const kind = String(kindRaw ?? '').trim();
  if (kind === 'codex') {
    const parsed = await parseCodexJsonlLines(lines);
    return {
      kind: 'codex',
      message: parsed.message,
      threadId: parsed.threadId,
      ...(parsed.terminalEvent ? { terminalEvent: parsed.terminalEvent } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'pi') {
    const parsed = await parsePiJsonlLines(lines);
    return {
      kind: 'pi',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'blip') {
    const parsed = await parseBlipJsonlLines(lines);
    return {
      kind: 'blip',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.terminalEvent ? { terminalEvent: parsed.terminalEvent } : {}),
      ...blipTranscriptDiagnostics(parsed),
      ...(parsed.cloneActivity ? { cloneActivity: parsed.cloneActivity } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  return null;
}

export function parseCodexJobTranscript(job: any): {
  threadId: string | null;
  message: string | null;
  terminalEvent?: CodexTerminalEvent;
} {
  const transcript = job?.transcript;
  if (
    transcript &&
    typeof transcript === 'object' &&
    String(transcript.kind ?? '').trim() === 'codex'
  ) {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      const terminalEventRaw = String(transcript.terminalEvent ?? '').trim();
      const terminalEvent =
        terminalEventRaw === 'turn.completed' ||
        terminalEventRaw === 'response.completed' ||
        terminalEventRaw === 'response.failed' ||
        terminalEventRaw === 'error'
          ? terminalEventRaw
          : undefined;
      return {
        threadId: optionalString(transcript.threadId),
        message: optionalString(transcript.message),
        ...(terminalEvent ? { terminalEvent } : {}),
      };
    }
  }
  return parseCodexJsonl(String(job?.stdout ?? ''));
}

export function parsePiJobTranscript(job: any): {
  sessionId: string | null;
  message: string | null;
} {
  const transcript = job?.transcript;
  if (
    transcript &&
    typeof transcript === 'object' &&
    String(transcript.kind ?? '').trim() === 'pi'
  ) {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      return {
        sessionId: optionalString(transcript.sessionId),
        message: optionalString(transcript.message),
      };
    }
  }
  return parsePiJsonl(String(job?.stdout ?? ''));
}

export function parseBlipJobTranscript(job: any): {
  sessionId: string | null;
  message: string | null;
  terminalEvent?: 'session_finished' | 'session_error';
  firstEventAt?: string;
  lastEventAt?: string;
  terminalEventAt?: string;
  terminalStatus?: string;
  terminalError?: string;
  durationMs?: number;
  eventCounts?: Record<string, number>;
  toolCallCount?: number;
  toolCallCompletedCount?: number;
  toolCallFailedCount?: number;
  longestToolCall?: BlipToolCallSummary;
  cloneActivity?: BlipCloneActivity;
} {
  const transcript = job?.transcript;
  if (
    transcript &&
    typeof transcript === 'object' &&
    String(transcript.kind ?? '').trim() === 'blip'
  ) {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      const terminalEventRaw = String(transcript.terminalEvent ?? '').trim();
      const terminalEvent =
        terminalEventRaw === 'session_finished' || terminalEventRaw === 'session_error'
          ? terminalEventRaw
          : undefined;
      const cloneActivity = normalizeBlipCloneActivity((transcript as any).cloneActivity);
      return {
        sessionId: optionalString(transcript.sessionId),
        message: optionalString(transcript.message),
        ...(terminalEvent ? { terminalEvent } : {}),
        ...blipTranscriptDiagnostics(transcript as any),
        ...(cloneActivity ? { cloneActivity } : {}),
      };
    }
  }
  return parseBlipJsonl(String(job?.stdout ?? ''));
}

export function formatCodexJobFailure(
  stdoutRaw: string,
  stderrRaw: string,
  fallbackRaw: string,
): string {
  const stdout = String(stdoutRaw ?? '').trim();
  const stderr = String(stderrRaw ?? '').trim();
  const fallback = String(fallbackRaw ?? '').trim() || 'Codex turn failed.';
  const merged = [stderr, stdout].filter(Boolean).join('\n');
  if (!merged) return fallback;

  const lifecycleOnlyTypes = new Set([
    'thread.started',
    'turn.started',
    'turn.completed',
    'item.started',
    'item.completed',
    'response.output_text.delta',
    'response.output_text.done',
  ]);
  const explicitErrors: string[] = [];
  let parsedCount = 0;
  let nonLifecycleEventSeen = false;
  let nonJsonLineSeen = false;

  for (const lineRaw of merged.split('\n')) {
    const line = String(lineRaw ?? '').trim();
    if (!line) continue;
    let obj: any = null;
    try {
      obj = JSON.parse(line);
    } catch {
      nonJsonLineSeen = true;
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    parsedCount += 1;
    const type = String(obj.type ?? '').trim();
    if (!lifecycleOnlyTypes.has(type)) nonLifecycleEventSeen = true;
    const push = (raw: any) => {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return;
      if (!explicitErrors.includes(text)) explicitErrors.push(text);
    };
    push(obj.error);
    push(obj.message);
    if (obj.error && typeof obj.error === 'object') {
      push(obj.error.message);
    }
    if (obj.last_error && typeof obj.last_error === 'object') {
      push(obj.last_error.message);
    }
  }

  if (explicitErrors.length > 0) return explicitErrors.join('\n');
  const lifecycleOnly = parsedCount > 0 && !nonLifecycleEventSeen && !nonJsonLineSeen;
  if (lifecycleOnly) return 'Codex turn started but exited before producing a response.';
  return fallback;
}

export function formatTranscriptJobFailure(opts: {
  agentId: BuiltinTranscriptAgentId;
  stdoutRaw: string;
  stderrRaw: string;
  fallbackRaw: string;
  exitCode?: number | null;
}): string {
  const stdout = String(opts.stdoutRaw ?? '').trim();
  const stderr = String(opts.stderrRaw ?? '').trim();
  const fallback = String(opts.fallbackRaw ?? '').trim();
  const exitCode =
    typeof opts.exitCode === 'number' && Number.isFinite(opts.exitCode)
      ? Math.floor(opts.exitCode)
      : null;

  let detail = fallback || stderr || stdout || '';
  if (opts.agentId === 'codex') {
    detail = formatCodexJobFailure(stdout, stderr, detail);
  }
  detail = String(detail ?? '').trim();

  if (!detail || detail === 'failed') {
    if (!stdout && !stderr) {
      return exitCode != null
        ? `prompt command failed without any captured stdout/stderr output (exit ${exitCode})`
        : 'prompt command failed before any stdout/stderr output or exit code was captured';
    }
    return exitCode != null ? `prompt command failed (exit ${exitCode})` : 'prompt command failed';
  }

  if (exitCode != null && detail.length < 220 && !/\bexit\s*\d+\b/i.test(detail)) {
    return `${detail} (exit ${exitCode})`;
  }
  return detail;
}
