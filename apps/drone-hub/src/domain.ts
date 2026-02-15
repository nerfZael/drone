export type ChatAgentConfig =
  | { kind: 'builtin'; id: 'cursor' | 'codex' | 'claude' | 'opencode' }
  | { kind: 'custom'; id: string; label: string; command: string };

export type ChatInfo = {
  name: string;
  chat: string;
  agent: ChatAgentConfig;
  model: string | null;
  sessionName: string;
  createdAt: string;
};

export function isValidDroneNameDashCase(name: string): boolean {
  const s = String(name ?? '').trim();
  if (!s) return false;
  if (s.length > 48) return false;
  // Conservative: docker-ish, URL-ish, and consistent with the hub UI.
  // - lower-case letters/numbers
  // - single hyphens between segments
  // - no leading/trailing hyphen
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

function isNumberedItemStart(line: string): boolean {
  return /^\s*\d+\s*[\)\.\:]\s+/.test(line);
}

export function extractNumberedItemBlocks(text: string): Array<{ startLine: number; endLine: number; text: string }> {
  const lines = String(text ?? '').split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isNumberedItemStart(lines[i] ?? '')) starts.push(i + 1);
  }
  if (starts.length === 0) return [];

  const blocks: Array<{ startLine: number; endLine: number; text: string }> = [];
  for (let i = 0; i < starts.length; i++) {
    const startLine = starts[i];
    const nextStart = starts[i + 1] ?? (lines.length + 1);
    const endLine = Math.max(startLine, nextStart - 1);
    const t = lines.slice(startLine - 1, endLine).join('\n').trim();
    if (t) blocks.push({ startLine, endLine, text: t });
  }
  return blocks;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(
    /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[A-Z@-_]|\r/g,
    '',
  );
}

export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = nowMs - t;
  if (diff < 0) return 'just now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function isUngroupedGroupName(name: string): boolean {
  return name.trim().toLowerCase() === 'ungrouped';
}

export function normalizeChatInfoPayload(data: any): ChatInfo {
  const name = String(data?.name ?? '');
  const chat = String(data?.chat ?? 'default').trim() || 'default';
  const modelRaw = String(data?.model ?? '').trim();
  const model = modelRaw || null;
  const sessionName = String(data?.sessionName ?? '').trim() || `drone-hub-chat-${chat}`;
  const createdAt = String(data?.createdAt ?? '').trim() || new Date().toISOString();

  const raw = data?.agent;
  const normalizeBuiltin = (v: any): 'cursor' | 'codex' | 'claude' | 'opencode' | null => {
    const id = String(v ?? '')
      .trim()
      .toLowerCase();
    if (id === 'cursor' || id === 'codex' || id === 'claude' || id === 'opencode') return id;
    if (id === 'cloud') return 'claude';
    if (id === 'open-code' || id === 'open_code') return 'opencode';
    return null;
  };
  const builtinId = normalizeBuiltin(raw?.id);
  if (
    raw &&
    raw.kind === 'builtin' &&
    builtinId
  ) {
    return {
      name,
      chat,
      model,
      sessionName,
      createdAt,
      agent: { kind: 'builtin', id: builtinId },
    };
  }
  if (raw && raw.kind === 'custom') {
    const id = String(raw.id ?? '').trim();
    const label = String(raw.label ?? '').trim();
    const command = String(raw.command ?? '').trim();
    if (id && label && command) return { name, chat, model, sessionName, createdAt, agent: { kind: 'custom', id, label, command } };
  }

  if (String(data?.claudeSessionId ?? '').trim()) return { name, chat, model, sessionName, createdAt, agent: { kind: 'builtin', id: 'claude' } };
  if (String(data?.openCodeSessionId ?? '').trim() || String(data?.opencodeSessionId ?? '').trim()) {
    return { name, chat, model, sessionName, createdAt, agent: { kind: 'builtin', id: 'opencode' } };
  }
  if (String(data?.codexThreadId ?? '').trim()) return { name, chat, model, sessionName, createdAt, agent: { kind: 'builtin', id: 'codex' } };
  if (String(data?.chatId ?? '').trim()) return { name, chat, model, sessionName, createdAt, agent: { kind: 'builtin', id: 'cursor' } };
  return { name, chat, model, sessionName, createdAt, agent: { kind: 'builtin', id: 'cursor' } };
}
