import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';

export function readBuiltinTranscriptSessionId(
  chatEntry: any,
  agentId: Extract<BuiltinTranscriptAgentId, 'codex' | 'opencode' | 'pi' | 'blip'>,
): string {
  if (agentId === 'codex') {
    return typeof chatEntry?.codexThreadId === 'string' ? String(chatEntry.codexThreadId).trim() : '';
  }
  if (agentId === 'opencode') {
    return typeof chatEntry?.openCodeSessionId === 'string' ? String(chatEntry.openCodeSessionId).trim() : '';
  }
  if (agentId === 'pi') {
    return typeof chatEntry?.piSessionId === 'string' ? String(chatEntry.piSessionId).trim() : '';
  }
  return typeof chatEntry?.blipSessionId === 'string' ? String(chatEntry.blipSessionId).trim() : '';
}

export function hasKnownBuiltinTranscriptSession(chatEntry: any, agentId: BuiltinTranscriptAgentId): boolean {
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
type CodexJsonlParseResult = { threadId: string | null; message: string | null; terminalEvent?: CodexTerminalEvent };
type PiJsonlParseResult = { sessionId: string | null; message: string | null };
type BlipJsonlParseResult = { sessionId: string | null; message: string | null; terminalEvent?: 'session_finished' | 'session_error' };

function createCodexJsonlParser(): { pushLine: (line: string) => void; result: () => CodexJsonlParseResult } {
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
      if (type === 'turn.completed' || type === 'response.completed' || type === 'response.failed' || type === 'error') {
        terminalEvent = type;
      }
      if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
        threadId = obj.thread_id;
        return;
      }
      if ((obj.type === 'item.completed' || obj.type === 'item.started') && obj.item && typeof obj.item === 'object') {
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

function createPiJsonlParser(): { pushLine: (line: string) => void; result: () => PiJsonlParseResult } {
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

function createBlipJsonlParser(): { pushLine: (line: string) => void; result: () => BlipJsonlParseResult } {
  let sessionId: string | null = null;
  let lastMsg: string | null = null;
  let streamedMsg = '';
  let terminalEvent: BlipJsonlParseResult['terminalEvent'];

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
        return;
      }
      if (type === 'session_error') {
        terminalEvent = 'session_error';
      }
    },
    result() {
      return { sessionId, message: lastMsg ?? (streamedMsg ? streamedMsg : null), ...(terminalEvent ? { terminalEvent } : {}) };
    },
  };
}

export function parseCodexJsonl(stdout: string): CodexJsonlParseResult {
  const parser = createCodexJsonlParser();
  for (const line of String(stdout || '').split('\n')) parser.pushLine(line);
  return parser.result();
}

export async function parseCodexJsonlLines(lines: AsyncIterable<string> | Iterable<string>): Promise<CodexJsonlParseResult> {
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

export async function parsePiJsonlLines(lines: AsyncIterable<string> | Iterable<string>): Promise<PiJsonlParseResult> {
  const parser = createPiJsonlParser();
  for await (const line of lines) parser.pushLine(line);
  return parser.result();
}

export async function parseBlipJsonlLines(lines: AsyncIterable<string> | Iterable<string>): Promise<BlipJsonlParseResult> {
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
    ...(typeof opts?.stdoutTruncated === 'boolean' ? { stdoutTruncated: opts.stdoutTruncated } : {}),
    ...(typeof opts?.parsedAt === 'string' && opts.parsedAt.trim() ? { parsedAt: opts.parsedAt.trim() } : {}),
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
      ...promptJobTranscriptMeta(opts),
    };
  }
  return null;
}

export function parseCodexJobTranscript(job: any): { threadId: string | null; message: string | null; terminalEvent?: CodexTerminalEvent } {
  const transcript = job?.transcript;
  if (transcript && typeof transcript === 'object' && String(transcript.kind ?? '').trim() === 'codex') {
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

export function parsePiJobTranscript(job: any): { sessionId: string | null; message: string | null } {
  const transcript = job?.transcript;
  if (transcript && typeof transcript === 'object' && String(transcript.kind ?? '').trim() === 'pi') {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      return {
        sessionId: optionalString(transcript.sessionId),
        message: optionalString(transcript.message),
      };
    }
  }
  return parsePiJsonl(String(job?.stdout ?? ''));
}

export function parseBlipJobTranscript(job: any): { sessionId: string | null; message: string | null; terminalEvent?: 'session_finished' | 'session_error' } {
  const transcript = job?.transcript;
  if (transcript && typeof transcript === 'object' && String(transcript.kind ?? '').trim() === 'blip') {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      const terminalEventRaw = String(transcript.terminalEvent ?? '').trim();
      const terminalEvent =
        terminalEventRaw === 'session_finished' || terminalEventRaw === 'session_error' ? terminalEventRaw : undefined;
      return {
        sessionId: optionalString(transcript.sessionId),
        message: optionalString(transcript.message),
        ...(terminalEvent ? { terminalEvent } : {}),
      };
    }
  }
  return parseBlipJsonl(String(job?.stdout ?? ''));
}

export function formatCodexJobFailure(stdoutRaw: string, stderrRaw: string, fallbackRaw: string): string {
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
