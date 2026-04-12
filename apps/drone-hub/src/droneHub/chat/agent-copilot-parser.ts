import {
  extractStructuredMessageItems,
  MessageLiteralParser,
  type ExtractedLiteralRange,
} from './helpers/message-literal-parser';

export type AgentCopilotRequest = {
  type: 'agent-copilot';
  name: string;
  message: string;
};

const MULTIPLE_AGENT_COPILOT_ERROR = 'Multiple agent copilot objects were found in one message. Only one is supported.';

function isPlaceholderAgentCopilotField(valueRaw: string): boolean {
  const value = String(valueRaw ?? '').trim();
  if (!value) return true;
  return /^(?:\.\.\.|…+|agent-copilot-name|<?message-to-send-to-the-agent-copilot>?|<message-to-send-to-the-agent-copilot>)$/i.test(
    value,
  );
}

function normalizeAgentCopilotRequest(raw: unknown): AgentCopilotRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const type = String(record.type ?? '').trim();
  if (type !== 'agent-copilot') return null;
  const name = String(record.name ?? '').trim();
  const message = String(record.message ?? '').trim();
  if (!name || !message) return null;
  if (isPlaceholderAgentCopilotField(name) || isPlaceholderAgentCopilotField(message)) return null;
  return {
    type: 'agent-copilot',
    name,
    message,
  };
}

function normalizeAgentCopilotRequestList(raw: unknown): AgentCopilotRequest[] | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const copilots = raw.map(normalizeAgentCopilotRequest);
    if (copilots.some((copilot) => copilot == null)) return null;
    return copilots as AgentCopilotRequest[];
  }
  const single = normalizeAgentCopilotRequest(raw);
  return single ? [single] : null;
}

function tryParseAgentCopilotLiteral(text: string): AgentCopilotRequest[] | null {
  const parser = new MessageLiteralParser(text);
  const parsed = parser.parseRoot();
  if (!parsed) return null;
  if (parsed.nextIndex !== text.length) return null;
  return normalizeAgentCopilotRequestList(parsed.value);
}

function tryParseAgentCopilotLiteralAt(text: string, startIndex: number): ExtractedLiteralRange<AgentCopilotRequest> | null {
  const parser = new MessageLiteralParser(text, startIndex);
  const parsed = parser.parseRoot();
  if (!parsed) return null;
  const items = normalizeAgentCopilotRequestList(parsed.value);
  if (!items || items.length === 0) return null;
  let end = parsed.nextIndex;
  while (end > startIndex && /\s/.test(text[end - 1] ?? '')) end -= 1;
  if (text[end - 1] === ';') {
    end -= 1;
    while (end > startIndex && /\s/.test(text[end - 1] ?? '')) end -= 1;
  }
  return {
    start: startIndex,
    end,
    items,
  };
}

export function extractAgentCopilotFromAgentMessage(textRaw: string): {
  cleanedText: string;
  copilot: AgentCopilotRequest | null;
  error: string | null;
} {
  const extracted = extractStructuredMessageItems<AgentCopilotRequest>({
    text: textRaw,
    tryParseLiteral: tryParseAgentCopilotLiteral,
    tryParseLiteralAt: tryParseAgentCopilotLiteralAt,
  });
  if (extracted.items.length === 0) {
    return {
      cleanedText: extracted.cleanedText,
      copilot: null,
      error: null,
    };
  }
  if (extracted.items.length > 1) {
    return {
      cleanedText: extracted.cleanedText,
      copilot: null,
      error: MULTIPLE_AGENT_COPILOT_ERROR,
    };
  }
  return {
    cleanedText: extracted.cleanedText,
    copilot: extracted.items[0] ?? null,
    error: null,
  };
}
