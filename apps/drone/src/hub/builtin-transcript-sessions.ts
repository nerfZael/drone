import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';

export function readBuiltinTranscriptSessionId(
  chatEntry: any,
  agentId: Extract<BuiltinTranscriptAgentId, 'codex' | 'opencode' | 'pi'>,
): string {
  if (agentId === 'codex') {
    return typeof chatEntry?.codexThreadId === 'string' ? String(chatEntry.codexThreadId).trim() : '';
  }
  if (agentId === 'opencode') {
    return typeof chatEntry?.openCodeSessionId === 'string' ? String(chatEntry.openCodeSessionId).trim() : '';
  }
  return typeof chatEntry?.piSessionId === 'string' ? String(chatEntry.piSessionId).trim() : '';
}

export function hasKnownBuiltinTranscriptSession(chatEntry: any, agentId: BuiltinTranscriptAgentId): boolean {
  if (agentId === 'codex' || agentId === 'opencode' || agentId === 'pi') {
    return Boolean(readBuiltinTranscriptSessionId(chatEntry, agentId));
  }
  return true;
}

function takeStringText(raw: any): string | null {
  if (typeof raw === 'string' && raw) return raw;
  return null;
}

function parseUuid(text: string): string | null {
  const match = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}

export function parseCodexJsonl(stdout: string): { threadId: string | null; message: string | null } {
  let threadId: string | null = null;
  let lastMsg: string | null = null;
  let streamedMsg = '';

  function extractItemText(item: any): string | null {
    if (!item || typeof item !== 'object') return null;
    const direct = takeStringText(item.text) ?? takeStringText(item.output_text);
    if (direct) return direct;
    const content = item.content;
    if (!Array.isArray(content)) return null;
    const parts: string[] = [];
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const t = takeStringText((c as any).text) ?? takeStringText((c as any).output_text);
      if (t) parts.push(t);
    }
    if (parts.length === 0) return null;
    return parts.join('\n');
  }

  const lines = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    let obj: any = null;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
      threadId = obj.thread_id;
      continue;
    }
    if ((obj.type === 'item.completed' || obj.type === 'item.started') && obj.item && typeof obj.item === 'object') {
      const itemType = String(obj.item.type ?? '');
      const text = extractItemText(obj.item);
      if (text && (itemType === 'agent_message' || itemType === 'assistant_message')) {
        lastMsg = text;
      }
      continue;
    }

    if (obj.type === 'response.output_text.delta') {
      const delta = takeStringText(obj.delta);
      if (delta) streamedMsg += delta;
      continue;
    }
    if (obj.type === 'response.output_text.done') {
      const text = takeStringText(obj.text);
      if (text) lastMsg = text;
      continue;
    }

    const responseText = takeStringText(obj?.response?.output_text);
    if (responseText) lastMsg = responseText;
  }
  if (!lastMsg && streamedMsg) lastMsg = streamedMsg;
  return { threadId, message: lastMsg };
}

export function parsePiJsonl(stdout: string): { sessionId: string | null; message: string | null } {
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

  const lines = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    let obj: any = null;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    if (obj.type === 'session') {
      const parsedId = parseUuid(String(obj.id ?? obj.sessionId ?? obj.session_id ?? '').trim());
      if (parsedId) sessionId = parsedId;
    }
    considerMessage(obj.message);
    if (Array.isArray(obj.messages)) {
      for (const message of obj.messages) considerMessage(message);
    }
  }

  return { sessionId, message: lastMsg };
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
