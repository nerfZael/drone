import type {
  AgentRunActivity,
  AgentRunActivitySource,
  AssistantMessage,
  AssistantMessageContentPart,
} from '@drone/assistant-chat';

const MAX_ACTIVITY_MESSAGES = 200;
const MAX_ACTIVITY_BYTES = 512 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_STRING_BYTES = 16 * 1024;
const MAX_COLLECTION_ITEMS = 100;
const MAX_VALUE_DEPTH = 8;
const REDACTED = '[redacted]';
const TRUNCATED = '… [truncated]';

const SENSITIVE_KEY_SUFFIXES = [
  'password',
  'passwd',
  'secret',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'privatekey',
];

const ACTIVITY_SOURCES = new Set<AgentRunActivitySource>([
  'cursor',
  'codex',
  'claude',
  'opencode',
  'pi',
  'blip',
]);

function isAgentRunActivityMessage(message: unknown): message is AssistantMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    !Array.isArray(message) &&
    ['user', 'assistant', 'toolResult', 'runSummary'].includes(
      String((message as Record<string, unknown>).role ?? ''),
    ),
  );
}

// Keep runtime normalization local to the CommonJS drone package. Importing the browser-oriented
// assistant-chat ESM bundle here would make the Node 18 daemon unable to load this module.
export function normalizeAgentRunActivity(value: unknown): AgentRunActivity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const source = String(raw.source ?? '').trim() as AgentRunActivitySource;
  if (raw.version !== 1 || !ACTIVITY_SOURCES.has(source) || !Array.isArray(raw.messages)) {
    return undefined;
  }
  const messages = raw.messages.every(isAgentRunActivityMessage)
    ? raw.messages
    : raw.messages.filter(isAgentRunActivityMessage);
  return {
    version: 1,
    source,
    updatedAt: String(raw.updatedAt ?? '').trim(),
    messages,
    ...(raw.truncated === true ? { truncated: true } : {}),
  };
}

export function settleAgentRunActivity(
  value: unknown,
  errorMessage = 'Tool completion was not reported.',
): AgentRunActivity | undefined {
  const activity = normalizeAgentRunActivity(value);
  if (!activity) return undefined;

  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();
  for (const message of activity.messages) {
    if (message.role === 'toolResult') {
      const toolCallId = String(message.toolCallId ?? '');
      if (toolCallId) toolResultIds.add(toolCallId);
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === 'toolCall') {
        const toolCallId = String(part.id ?? '');
        if (toolCallId) toolCallIds.add(toolCallId);
      }
    }
  }

  const unresolvedToolCallIds = [...toolCallIds].filter(
    (toolCallId) => !toolResultIds.has(toolCallId),
  );
  if (unresolvedToolCallIds.length === 0) return activity;

  return {
    ...activity,
    messages: [
      ...activity.messages,
      ...unresolvedToolCallIds.map((toolCallId, index) => ({
        id: `settled-tool-${toolCallId}-${index}`,
        role: 'toolResult' as const,
        toolCallId,
        content: errorMessage,
        isError: true,
        errorMessage,
        createdAt: activity.updatedAt,
      })),
    ],
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function trimJsonArrayToBytes<T>(
  items: T[],
  maxBytes: number,
  keep: 'start' | 'end' = 'end',
): { items: T[]; truncated: boolean } {
  if (items.length <= 1) return { items, truncated: false };
  const sizes = items.map((item) => byteLength(JSON.stringify(item)));
  let totalBytes =
    2 + sizes.reduce((total, size) => total + size, 0) + Math.max(0, items.length - 1);
  let startIndex = 0;
  let endIndex = items.length;
  while (endIndex - startIndex > 1 && totalBytes > maxBytes) {
    if (keep === 'start') {
      endIndex -= 1;
      totalBytes -= sizes[endIndex] + 1;
    } else {
      totalBytes -= sizes[startIndex] + 1;
      startIndex += 1;
    }
  }
  return {
    items: startIndex > 0 || endIndex < items.length ? items.slice(startIndex, endIndex) : items,
    truncated: startIndex > 0 || endIndex < items.length,
  };
}

function truncateUtf8(
  value: unknown,
  maxBytes = MAX_STRING_BYTES,
): {
  value: string;
  truncated: boolean;
} {
  const source = String(value ?? '');
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return { value: source, truncated: false };
  const suffixBytes = Buffer.byteLength(TRUNCATED);
  return {
    value: `${bytes
      .subarray(0, Math.max(0, maxBytes - suffixBytes))
      .toString('utf8')
      .replace(/\uFFFD+$/u, '')}${TRUNCATED}`,
    truncated: true,
  };
}

function sanitizeValue(
  value: unknown,
  state: { truncated: boolean },
  depth = 0,
  key = '',
): unknown {
  const normalizedKey = key.replace(/[_-]/g, '').toLowerCase();
  if (SENSITIVE_KEY_SUFFIXES.some((suffix) => normalizedKey.endsWith(suffix))) return REDACTED;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const result = truncateUtf8(value);
    if (result.truncated) state.truncated = true;
    return result.value;
  }
  if (typeof value === 'bigint') return String(value);
  if (depth >= MAX_VALUE_DEPTH) {
    state.truncated = true;
    return '[maximum depth reached]';
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS) state.truncated = true;
    return value
      .slice(0, MAX_COLLECTION_ITEMS)
      .map((item) => sanitizeValue(item, state, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_COLLECTION_ITEMS) state.truncated = true;
    return Object.fromEntries(
      entries
        .slice(0, MAX_COLLECTION_ITEMS)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(entryValue, state, depth + 1, entryKey),
        ]),
    );
  }
  return String(value);
}

export function boundedActivityValue(value: unknown): {
  value: unknown;
  truncated: boolean;
} {
  const state = { truncated: false };
  const sanitized = sanitizeValue(value, state);
  let serialized = '';
  try {
    serialized = JSON.stringify(sanitized) ?? 'null';
  } catch {
    return { value: '[unserializable payload]', truncated: true };
  }
  if (byteLength(serialized) <= MAX_PAYLOAD_BYTES) {
    return { value: sanitized, truncated: state.truncated };
  }
  const result = truncateUtf8(serialized, MAX_PAYLOAD_BYTES);
  return { value: result.value, truncated: true };
}

export function boundedActivityText(value: unknown): {
  value: string;
  truncated: boolean;
} {
  return truncateUtf8(value, MAX_PAYLOAD_BYTES);
}

export function activityPayloadText(value: unknown): {
  value: string;
  truncated: boolean;
} {
  if (typeof value === 'string') return boundedActivityText(value);
  const bounded = boundedActivityValue(value);
  if (typeof bounded.value === 'string')
    return { value: bounded.value, truncated: bounded.truncated };
  try {
    return {
      value: JSON.stringify(bounded.value, null, 2) ?? 'null',
      truncated: bounded.truncated,
    };
  } catch {
    return { value: '[unserializable payload]', truncated: true };
  }
}

type AssistantActivityInput = {
  id: string;
  text?: unknown;
  thinking?: unknown;
  createdAt?: unknown;
};

export class BuiltinAgentActivityCollector {
  private readonly messages: AssistantMessage[] = [];
  private readonly messageKeys: string[] = [];
  private readonly indexes = new Map<string, number>();
  private readonly openTools = new Map<string, string>();
  private readonly toolArguments = new Map<string, unknown>();
  private truncated = false;

  constructor(private readonly source: AgentRunActivitySource) {}

  private setMessage(key: string, message: AssistantMessage): void {
    const existing = this.indexes.get(key);
    if (existing !== undefined) {
      this.messages[existing] = message;
      return;
    }
    this.indexes.set(key, this.messages.length);
    this.messageKeys.push(key);
    this.messages.push(message);
    if (this.messages.length <= MAX_ACTIVITY_MESSAGES) return;

    const evictedKey = this.messageKeys.shift();
    this.messages.shift();
    this.indexes.clear();
    for (let index = 0; index < this.messageKeys.length; index += 1) {
      this.indexes.set(this.messageKeys[index]!, index);
    }
    if (evictedKey?.startsWith('tool-call:')) {
      const toolCallId = evictedKey.slice('tool-call:'.length);
      this.openTools.delete(toolCallId);
      this.toolArguments.delete(toolCallId);
    }
    this.truncated = true;
  }

  upsertAssistant(input: AssistantActivityInput): void {
    const parts: AssistantMessageContentPart[] = [];
    if (input.thinking != null) {
      const thinking = boundedActivityText(input.thinking);
      if (thinking.value) parts.push({ type: 'thinking', thinking: thinking.value });
      if (thinking.truncated) this.truncated = true;
    }
    if (input.text != null) {
      const text = boundedActivityText(input.text);
      if (text.value) parts.push({ type: 'text', text: text.value });
      if (text.truncated) this.truncated = true;
    }
    if (parts.length === 0) return;
    const boundedId = truncateUtf8(input.id || `assistant-${this.messages.length}`, 512);
    if (boundedId.truncated) this.truncated = true;
    const id = boundedId.value;
    this.setMessage(`assistant:${id}`, {
      id,
      role: 'assistant',
      content: parts,
      ...(typeof input.createdAt === 'string' && input.createdAt.trim()
        ? { createdAt: input.createdAt.trim() }
        : {}),
    });
  }

  upsertToolCall(input: {
    id: string;
    name: string;
    arguments?: unknown;
    createdAt?: unknown;
  }): void {
    const boundedId = truncateUtf8(input.id, 512);
    const boundedName = truncateUtf8(input.name, 512);
    if (boundedId.truncated || boundedName.truncated) this.truncated = true;
    const id = boundedId.value.trim();
    const requestedName = boundedName.value.trim();
    const previousName = this.openTools.get(id);
    const name =
      requestedName && requestedName !== 'tool' ? requestedName : previousName || requestedName;
    if (!id || !name) return;
    const args =
      input.arguments === undefined && this.toolArguments.has(id)
        ? { value: this.toolArguments.get(id), truncated: false }
        : boundedActivityValue(input.arguments ?? {});
    if (args.truncated) this.truncated = true;
    this.openTools.set(id, name);
    this.toolArguments.set(id, args.value);
    this.setMessage(`tool-call:${id}`, {
      id: `tool-call:${id}`,
      role: 'assistant',
      content: [{ type: 'toolCall', id, name, arguments: args.value }],
      ...(typeof input.createdAt === 'string' && input.createdAt.trim()
        ? { createdAt: input.createdAt.trim() }
        : {}),
    });
  }

  upsertToolResult(input: {
    id: string;
    name?: string;
    result?: unknown;
    error?: unknown;
    createdAt?: unknown;
  }): void {
    const boundedId = truncateUtf8(input.id, 512);
    if (boundedId.truncated) this.truncated = true;
    const id = boundedId.value.trim();
    if (!id) return;
    const boundedName = truncateUtf8(input.name ?? this.openTools.get(id) ?? 'tool', 512);
    if (boundedName.truncated) this.truncated = true;
    const name = boundedName.value.trim() || 'tool';
    const isError = input.error != null;
    const payload = activityPayloadText(isError ? input.error : input.result);
    if (payload.truncated) this.truncated = true;
    this.openTools.delete(id);
    this.toolArguments.delete(id);
    this.setMessage(`tool-result:${id}`, {
      id: `tool-result:${id}`,
      role: 'toolResult',
      toolCallId: id,
      toolName: name,
      content: payload.value,
      ...(isError ? { isError: true, errorMessage: payload.value || 'Tool call failed.' } : {}),
      ...(typeof input.createdAt === 'string' && input.createdAt.trim()
        ? { createdAt: input.createdAt.trim() }
        : {}),
      ...(payload.truncated ? { details: { truncated: true } } : {}),
    });
  }

  settleOpenTools(reason = 'Tool execution ended without a completion event.'): void {
    for (const [id, name] of this.openTools) {
      this.upsertToolResult({ id, name, error: reason });
    }
  }

  result(updatedAt?: string): AgentRunActivity | undefined {
    if (this.messages.length === 0) return undefined;
    let messages = this.messages;
    if (messages.length > MAX_ACTIVITY_MESSAGES) {
      messages = messages.slice(-MAX_ACTIVITY_MESSAGES);
      this.truncated = true;
    }
    const boundedMessages = trimJsonArrayToBytes(messages, MAX_ACTIVITY_BYTES);
    messages = boundedMessages.items;
    if (boundedMessages.truncated) this.truncated = true;
    let latestCreatedAt = '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      latestCreatedAt = String(messages[index]?.createdAt ?? '').trim();
      if (latestCreatedAt) break;
    }
    return {
      version: 1,
      source: this.source,
      updatedAt: String(updatedAt ?? '').trim() || latestCreatedAt || '1970-01-01T00:00:00.000Z',
      messages,
      ...(this.truncated ? { truncated: true } : {}),
    };
  }
}
