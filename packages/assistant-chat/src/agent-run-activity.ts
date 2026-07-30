import type { AssistantMessage } from './assistant-message-types.js';
import { messageVisibleText } from './assistant-message-model.js';

export type AgentRunActivitySource = 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip';

export type AgentRunActivity = {
  version: 1;
  source: AgentRunActivitySource;
  updatedAt: string;
  messages: AssistantMessage[];
  truncated?: boolean;
};

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
  const updatedAt = String(raw.updatedAt ?? '').trim();
  return {
    version: 1,
    source,
    updatedAt,
    messages,
    ...(raw.truncated === true ? { truncated: true } : {}),
  };
}

export function agentRunActivityHasResponse(activity: AgentRunActivity | undefined): boolean {
  return Boolean(
    activity?.messages.some(
      (message) =>
        message.role === 'assistant' &&
        (messageVisibleText(message).trim() || message.errorMessage),
    ),
  );
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
        toolCallIds.add(String(part.id ?? ''));
      }
    }
  }

  const unresolvedToolCallIds = [...toolCallIds].filter(
    (toolCallId) => toolCallId && !toolResultIds.has(toolCallId),
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
