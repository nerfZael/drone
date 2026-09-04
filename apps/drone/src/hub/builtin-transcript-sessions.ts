import {
  normalizeAgentPlan,
  normalizeAgentSkillUses,
  type AgentPlan,
  type AgentRunActivity,
  type AgentSkillUse,
} from '@drone/assistant-chat';
import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';
import { BuiltinAgentActivityCollector, normalizeAgentRunActivity } from './builtin-agent-activity';

export { readBuiltinTranscriptSessionId } from './builtin-transcript-session-metadata';

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

function extractModelId(raw: any): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const direct =
    raw.model ??
    raw.modelId ??
    raw.modelID ??
    raw.model_id ??
    raw.metadata?.model ??
    raw.info?.model ??
    raw.info?.modelId ??
    raw.info?.modelID;
  const value =
    direct && typeof direct === 'object'
      ? (direct.id ?? direct.modelId ?? direct.modelID ?? direct.model_id ?? direct.name)
      : direct;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 160 || /[\r\n\t]/.test(text)) return null;
  return text;
}

function extractReasoningEffort(raw: any): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const value =
    raw.reasoning_effort ??
    raw.reasoningEffort ??
    raw.thinking_level ??
    raw.thinkingLevel ??
    raw.metadata?.reasoning_effort ??
    raw.metadata?.reasoningEffort ??
    raw.info?.reasoning_effort ??
    raw.info?.reasoningEffort;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text || text.length > 32 || !/^[a-z0-9._-]+$/.test(text)) return null;
  return text;
}

type CodexTerminalEvent = 'turn.completed' | 'response.completed' | 'response.failed' | 'error';
type CodexTerminalStatus = 'completed' | 'failed' | 'canceled';
type CodexJsonlParseResult = {
  threadId: string | null;
  message: string | null;
  activity?: AgentRunActivity;
  model?: string;
  reasoning?: string;
  terminalEvent?: CodexTerminalEvent;
  terminalStatus?: CodexTerminalStatus;
  agentPlan?: AgentPlan;
  skillsUsed?: AgentSkillUse[];
};
type StructuredAgentJsonlParseResult = {
  sessionId: string | null;
  message: string | null;
  activity?: AgentRunActivity;
  model?: string;
  reasoning?: string;
  agentPlan?: AgentPlan;
  terminalStatus?: 'completed' | 'failed';
  error?: string;
};
type PiJsonlParseResult = {
  sessionId: string | null;
  message: string | null;
  activity?: AgentRunActivity;
  model?: string;
  reasoning?: string;
};
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
  activity?: AgentRunActivity;
  model?: string;
  reasoning?: string;
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
};

function createCodexJsonlParser(): {
  pushLine: (line: string) => void;
  result: () => CodexJsonlParseResult;
} {
  let threadId: string | null = null;
  let lastMsg: string | null = null;
  let lastModel: string | null = null;
  let lastReasoning: string | null = null;
  let streamedMsg = '';
  let streamedItemId = 'response-stream';
  let terminalEvent: CodexTerminalEvent | null = null;
  let terminalStatus: CodexTerminalStatus | null = null;
  let agentPlan: AgentPlan | undefined;
  let assistantSequence = 0;
  let lastActivityText = '';
  const activity = new BuiltinAgentActivityCollector('codex');
  const skillsUsed = new Map<string, AgentSkillUse>();
  type CommandSkillReadEvidence = { structured: string[]; commandFallback: string[] };
  const pendingCommandSkillReads = new Map<string, CommandSkillReadEvidence>();

  function recordSkillUse(nameRaw: unknown, source: AgentSkillUse['source']) {
    const normalized = normalizeAgentSkillUses([{ name: nameRaw, source }])[0];
    if (!normalized) return;
    const key = normalized.name.toLowerCase();
    const existing = skillsUsed.get(key);
    if (!existing || normalized.source === 'explicit') skillsUsed.set(key, normalized);
  }

  function skillNameFromFileRead(pathRaw: unknown, nameRaw?: unknown): string | null {
    if (typeof pathRaw !== 'string') return null;
    const path = pathRaw.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = path.split('/').filter(Boolean);
    if (String(parts.at(-1) ?? '').toLowerCase() === 'skill.md') {
      return String(parts.at(-2) ?? '').trim() || null;
    }
    if (typeof nameRaw !== 'string') return null;
    const nameParts = nameRaw.trim().replace(/\\/g, '/').split('/').filter(Boolean);
    if (String(nameParts.at(-1) ?? '').toLowerCase() !== 'skill.md') return null;
    if (nameParts.length > 1) return String(nameParts.at(-2) ?? '').trim() || null;
    return String(parts.at(-1) ?? '').trim() || null;
  }

  function recordExplicitSkillInputs(content: unknown) {
    if (!Array.isArray(content)) return;
    for (const input of content) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
      if (String((input as any).type ?? '').trim() !== 'skill') continue;
      const name = String((input as any).name ?? '').trim();
      if (name) recordSkillUse(name, 'explicit');
    }
  }

  function dedupeSkillNames(names: string[]): string[] {
    const seen = new Set<string>();
    return names.filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function commandFallbackSkillReads(item: any, actions: any[]): string[] {
    const commands = [item?.command, ...actions.map((action) => action?.command)].filter(
      (command): command is string => typeof command === 'string' && command.trim().length > 0,
    );
    const readCommandPattern =
      /(?:^|[\s"';&|()])(?:\/(?:usr\/)?bin\/)?(?:awk|bat|batcat|cat|head|less|more|sed|tail)(?=$|[\s"';&|()])/i;
    const skillPathPattern = /(?:[A-Za-z]:)?[\\/][^"'`\r\n]*?[\\/]SKILL\.md/gi;
    const names: string[] = [];
    for (const command of commands) {
      if (!readCommandPattern.test(command)) continue;
      skillPathPattern.lastIndex = 0;
      for (const match of command.matchAll(skillPathPattern)) {
        const name = skillNameFromFileRead(match[0]);
        if (name) names.push(name);
      }
    }
    return dedupeSkillNames(names);
  }

  function commandSkillReads(item: any): CommandSkillReadEvidence {
    const actions = Array.isArray(item?.commandActions) ? item.commandActions : [];
    const legacyActions = Array.isArray(item?.command_actions) ? item.command_actions : [];
    const availableActions = actions.length > 0 ? actions : legacyActions;
    const structured: string[] = [];
    for (const action of availableActions) {
      if (String(action?.type ?? '').trim() !== 'read') continue;
      const name = skillNameFromFileRead(action?.path, action?.name);
      if (name) structured.push(name);
    }
    return {
      structured: dedupeSkillNames(structured),
      commandFallback: commandFallbackSkillReads(item, availableActions),
    };
  }

  function recordCommandSkillReads(item: any, eventType: string) {
    const itemId = String(item?.id ?? '').trim();
    const evidence = commandSkillReads(item);
    if (eventType !== 'item.completed') {
      if (itemId && (evidence.structured.length > 0 || evidence.commandFallback.length > 0)) {
        if (!pendingCommandSkillReads.has(itemId) && pendingCommandSkillReads.size >= 256) {
          const oldestItemId = pendingCommandSkillReads.keys().next().value;
          if (oldestItemId) pendingCommandSkillReads.delete(oldestItemId);
        }
        const current = pendingCommandSkillReads.get(itemId);
        pendingCommandSkillReads.set(itemId, {
          structured: dedupeSkillNames([...(current?.structured ?? []), ...evidence.structured]),
          commandFallback: dedupeSkillNames([
            ...(current?.commandFallback ?? []),
            ...evidence.commandFallback,
          ]),
        });
      }
      return;
    }
    const pendingEvidence = itemId ? pendingCommandSkillReads.get(itemId) : undefined;
    if (itemId) pendingCommandSkillReads.delete(itemId);
    if (String(item?.source ?? '').trim() === 'userShell') return;
    const status = String(item?.status ?? '').trim().toLowerCase();
    const exitCode = item?.exit_code ?? item?.exitCode;
    if (status !== 'completed') return;
    if (typeof exitCode === 'number' && exitCode !== 0) return;
    const output = takeStringText(item?.aggregated_output) ?? takeStringText(item?.aggregatedOutput);
    const names = dedupeSkillNames([
      ...(pendingEvidence?.structured ?? []),
      ...evidence.structured,
      ...(output ? pendingEvidence?.commandFallback ?? [] : []),
      ...(output ? evidence.commandFallback : []),
    ]);
    for (const name of names) {
      recordSkillUse(name, 'skill-file-read');
    }
  }

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
    if (text) {
      lastMsg = text;
      lastActivityText = text;
      activity.upsertAssistant({
        id: String(item?.id ?? `assistant-${assistantSequence++}`),
        text,
        createdAt: item?.timestamp,
      });
    }
    lastModel = extractModelId(item) ?? lastModel;
    lastReasoning = extractReasoningEffort(item) ?? lastReasoning;
  }

  function considerItem(item: any, eventType = 'item.completed') {
    if (!item || typeof item !== 'object') return;
    const itemType = String(item.type ?? '').trim();
    const id = String(item.id ?? `${itemType || 'item'}-${assistantSequence++}`);
    if (
      itemType === 'user_message' ||
      (itemType === 'message' && String(item.role ?? '').trim() === 'user')
    ) {
      recordExplicitSkillInputs(item.content);
    }
    if (itemType === 'command_execution') {
      recordCommandSkillReads(item, eventType);
    }
    if (itemType === 'reasoning') {
      const thinking =
        takeStringText(item.text) ??
        takeStringText(item.summary) ??
        extractContentText(item.summary) ??
        extractContentText(item.content);
      if (thinking) activity.upsertAssistant({ id, thinking, createdAt: item.timestamp });
      return;
    }
    const toolName =
      itemType === 'command_execution'
        ? 'command_execution'
        : itemType === 'mcp_tool_call'
          ? [item.server, item.tool]
              .map((value) => String(value ?? '').trim())
              .filter(Boolean)
              .join('.') || 'mcp_tool_call'
          : itemType === 'web_search'
            ? 'web_search'
            : itemType === 'file_change'
              ? 'file_change'
              : '';
    if (toolName) {
      const args =
        itemType === 'command_execution'
          ? { command: item.command }
          : itemType === 'mcp_tool_call'
            ? (item.arguments ?? item.args ?? {})
            : itemType === 'web_search'
              ? { query: item.query }
              : { changes: item.changes };
      activity.upsertToolCall({ id, name: toolName, arguments: args, createdAt: item.timestamp });
      const status = String(item.status ?? '')
        .trim()
        .toLowerCase();
      const completed =
        eventType === 'item.completed' ||
        status === 'completed' ||
        status === 'failed' ||
        status === 'declined';
      if (completed) {
        const error =
          item.error ??
          (status === 'failed' || status === 'declined'
            ? (item.aggregated_output ?? item.output ?? status)
            : undefined);
        activity.upsertToolResult({
          id,
          name: toolName,
          result:
            item.result ??
            item.aggregated_output ??
            item.output ??
            item.changes ??
            (status ? { status } : undefined),
          error,
          createdAt: item.timestamp,
        });
      }
      return;
    }
    considerAssistantItem(item);
  }

  function considerResponse(response: any) {
    lastModel = extractModelId(response) ?? lastModel;
    lastReasoning = extractReasoningEffort(response) ?? lastReasoning;
    const responseText = takeStringText(response?.output_text);
    if (responseText) {
      lastMsg = responseText;
      lastActivityText = responseText;
      activity.upsertAssistant({ id: 'response-output', text: responseText });
      return;
    }
    if (!Array.isArray(response?.output)) return;
    for (const item of response.output) considerItem(item, 'item.completed');
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
      lastModel = extractModelId(obj) ?? lastModel;
      lastReasoning = extractReasoningEffort(obj) ?? lastReasoning;
      if (
        type === 'turn.completed' ||
        type === 'response.completed' ||
        type === 'response.failed' ||
        type === 'error'
      ) {
        terminalEvent = type;
        if (type === 'turn.completed') {
          const status = String(obj.status ?? 'completed')
            .trim()
            .toLowerCase();
          terminalStatus =
            status === 'completed'
              ? 'completed'
              : status === 'interrupted' || status === 'canceled' || status === 'cancelled'
                ? 'canceled'
                : 'failed';
        } else {
          terminalStatus = type === 'response.completed' ? 'completed' : 'failed';
        }
        activity.settleOpenTools();
      }
      if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
        threadId = obj.thread_id;
        return;
      }
      if (
        (obj.type === 'item.completed' ||
          obj.type === 'item.started' ||
          obj.type === 'item.updated') &&
        obj.item &&
        typeof obj.item === 'object'
      ) {
        if (String(obj.item.type ?? '').trim() === 'todo_list') {
          agentPlan = normalizeAgentPlan(obj.item.items, 'codex', new Date().toISOString());
          return;
        }
        considerItem(obj.item, obj.type);
        return;
      }

      if (obj.type === 'response.output_text.delta') {
        const delta = takeStringText(obj.delta);
        if (delta) {
          const nextStreamedItemId = String(obj.item_id ?? obj.itemId ?? '').trim();
          if (nextStreamedItemId && nextStreamedItemId !== streamedItemId) {
            streamedMsg = '';
            streamedItemId = nextStreamedItemId;
          }
          streamedMsg += delta;
          lastActivityText = streamedMsg;
          activity.upsertAssistant({ id: streamedItemId, text: streamedMsg });
        }
        return;
      }
      if (obj.type === 'response.output_text.done') {
        const text = takeStringText(obj.text);
        if (text) {
          lastMsg = text;
          lastActivityText = text;
          activity.upsertAssistant({ id: streamedItemId, text });
        }
        return;
      }
      if (obj.type === 'turn.completed') {
        const text = takeStringText(obj.last_agent_message) ?? takeStringText(obj.message);
        if (text) {
          lastMsg = text;
          if (text !== lastActivityText) {
            activity.upsertAssistant({ id: 'turn-final', text });
            lastActivityText = text;
          }
        }
        lastModel = extractModelId(obj) ?? lastModel;
      }

      considerAssistantItem(obj);
      considerAssistantItem(obj.message);
      considerResponse(obj?.response);
    },
    result() {
      const agentActivity = activity.result();
      const agentSkillsUsed = normalizeAgentSkillUses([...skillsUsed.values()]);
      return {
        threadId,
        message: lastMsg ?? (streamedMsg ? streamedMsg : null),
        ...(agentActivity ? { activity: agentActivity } : {}),
        ...(lastModel ? { model: lastModel } : {}),
        ...(lastReasoning ? { reasoning: lastReasoning } : {}),
        ...(terminalEvent ? { terminalEvent } : {}),
        ...(terminalStatus ? { terminalStatus } : {}),
        ...(agentPlan ? { agentPlan } : {}),
        ...(agentSkillsUsed.length > 0 ? { skillsUsed: agentSkillsUsed } : {}),
      };
    },
  };
}

type PromptJobTranscriptMeta = {
  stdoutBytes?: number;
  stdoutTruncated?: boolean;
  parsedAt?: string;
};

function codexPromptJobTranscript(
  parsed: CodexJsonlParseResult,
  opts?: PromptJobTranscriptMeta,
): Extract<BuiltinPromptJobTranscript, { kind: 'codex' }> {
  return {
    kind: 'codex',
    message: parsed.message,
    threadId: parsed.threadId,
    ...(parsed.activity ? { activity: parsed.activity } : {}),
    ...(parsed.model ? { model: parsed.model } : {}),
    ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
    ...(parsed.terminalEvent ? { terminalEvent: parsed.terminalEvent } : {}),
    ...(parsed.terminalStatus ? { terminalStatus: parsed.terminalStatus } : {}),
    ...(parsed.agentPlan ? { agentPlan: parsed.agentPlan } : {}),
    ...(parsed.skillsUsed ? { skillsUsed: parsed.skillsUsed } : {}),
    ...promptJobTranscriptMeta(opts),
  };
}

/**
 * Stateful parser used by the daemon while a Codex App Server run is active.
 * Callers can feed only newly appended JSONL rows and materialize the same
 * bounded transcript shape without reparsing the run from byte zero.
 */
export function createCodexPromptJobTranscriptAccumulator(): {
  pushLine(line: string): void;
  transcript(opts?: PromptJobTranscriptMeta): Extract<BuiltinPromptJobTranscript, { kind: 'codex' }>;
} {
  const parser = createCodexJsonlParser();
  return {
    pushLine: parser.pushLine,
    transcript: (opts) => codexPromptJobTranscript(parser.result(), opts),
  };
}

function findTodoList(raw: unknown): unknown[] | null {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw)) {
    for (const value of raw) {
      const found = findTodoList(value);
      if (found) return found;
    }
    return null;
  }
  const value = raw as any;
  if (Array.isArray(value.todos)) return value.todos;
  if (
    Array.isArray(value.items) &&
    /todo|plan/i.test(String(value.name ?? value.tool ?? value.type ?? ''))
  )
    return value.items;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'content' || key === 'text') continue;
    const found = findTodoList(child);
    if (found) return found;
  }
  return null;
}

function createStructuredAgentJsonlParser(
  source: Extract<AgentPlan['source'], 'cursor' | 'claude' | 'opencode'>,
): { pushLine: (line: string) => void; result: () => StructuredAgentJsonlParseResult } {
  let sessionId: string | null = null;
  let message: string | null = null;
  let model: string | null = null;
  let reasoning: string | null = null;
  let agentPlan: AgentPlan | undefined;
  let cursorAssistantText = '';
  let terminalStatus: StructuredAgentJsonlParseResult['terminalStatus'];
  let error: string | null = null;
  let activitySequence = 0;
  let lastActivityText = '';
  const activity = new BuiltinAgentActivityCollector(source);

  const considerText = (raw: any) => {
    if (typeof raw === 'string' && raw.trim()) message = raw.trimEnd();
  };

  const recordAssistant = (input: {
    id?: unknown;
    text?: unknown;
    thinking?: unknown;
    createdAt?: unknown;
    replaceLastText?: boolean;
  }) => {
    const text = typeof input.text === 'string' ? input.text.trimEnd() : '';
    const thinking = typeof input.thinking === 'string' ? input.thinking.trimEnd() : '';
    if (!text && !thinking) return;
    if (text && text === lastActivityText && !thinking) return;
    if (text) lastActivityText = text;
    activity.upsertAssistant({
      id: String(
        input.id ??
          (input.replaceLastText
            ? `${source}-stream`
            : `${source}-assistant-${activitySequence++}`),
      ),
      ...(text ? { text } : {}),
      ...(thinking ? { thinking } : {}),
      createdAt: input.createdAt,
    });
  };

  const cursorTool = (obj: any): { id: string; name: string; payload: any } | null => {
    const root = obj?.tool_call;
    if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
    const [entryName, payloadRaw] =
      Object.entries(root).find(([, value]) => value && typeof value === 'object') ?? [];
    const payload: any = payloadRaw ?? {};
    const name = String(entryName ?? '')
      .replace(/ToolCall$/i, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
    const id = String(
      obj.call_id ?? obj.tool_call_id ?? payload?.id ?? `cursor-tool-${activitySequence++}`,
    );
    return name ? { id, name, payload } : null;
  };

  return {
    pushLine(lineRaw: string) {
      const line = String(lineRaw ?? '').trim();
      if (!line) return;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (!obj || typeof obj !== 'object') return;
      sessionId = optionalString(obj.session_id ?? obj.sessionId ?? obj.sessionID) ?? sessionId;
      model = extractModelId(obj) ?? model;
      reasoning = extractReasoningEffort(obj) ?? reasoning;

      const eventType = String(obj.type ?? '').trim();
      if (eventType === 'error' || eventType === 'session.error') {
        terminalStatus = 'failed';
        error =
          optionalString(obj.error?.data?.message) ??
          optionalString(obj.error?.message) ??
          optionalString(obj.message) ??
          optionalString(obj.error) ??
          error;
      }
      if (eventType === 'result') {
        const failed =
          obj.is_error === true ||
          String(obj.subtype ?? '')
            .trim()
            .toLowerCase() === 'error';
        terminalStatus = failed ? 'failed' : 'completed';
        if (failed) error = optionalString(obj.result) ?? optionalString(obj.error) ?? error;
        activity.settleOpenTools(
          failed
            ? 'The agent stopped before this tool reported completion.'
            : 'The agent completed without a matching tool result.',
        );
      }
      const isToolEvent =
        eventType === 'tool_call' || eventType === 'tool_use' || eventType === 'assistant';
      if (isToolEvent) {
        const todos = findTodoList(obj.tool_call ?? obj.part ?? obj.message?.content ?? obj);
        if (todos) agentPlan = normalizeAgentPlan(todos, source, new Date().toISOString());
      }

      if (source === 'claude') {
        const content = Array.isArray(obj.message?.content) ? obj.message.content : [];
        const messageId = String(obj.message?.id ?? `claude-${activitySequence++}`);
        if (eventType === 'assistant') {
          const text = content
            .filter((item: any) => item?.type === 'text')
            .map((item: any) => String(item.text ?? ''))
            .join('\n');
          considerText(text);
          for (let index = 0; index < content.length; index += 1) {
            const block = content[index];
            const blockId = `${messageId}:${index}`;
            if (block?.type === 'text') {
              recordAssistant({ id: blockId, text: block.text });
            } else if (block?.type === 'thinking') {
              recordAssistant({ id: blockId, thinking: block.thinking ?? block.text });
            } else if (block?.type === 'tool_use') {
              activity.upsertToolCall({
                id: String(block.id ?? blockId),
                name: String(block.name ?? 'tool'),
                arguments: block.input ?? {},
              });
            }
          }
        }
        if (eventType === 'user') {
          for (let index = 0; index < content.length; index += 1) {
            const block = content[index];
            if (block?.type !== 'tool_result') continue;
            const id = String(block.tool_use_id ?? `${messageId}:${index}`);
            activity.upsertToolResult({
              id,
              result: block.content,
              ...(block.is_error === true ? { error: block.content ?? 'Tool call failed.' } : {}),
            });
          }
        }
        if (eventType === 'result') {
          considerText(obj.result);
          recordAssistant({ id: 'claude-result', text: obj.result });
        }
      } else if (source === 'opencode') {
        const part = obj.part && typeof obj.part === 'object' ? obj.part : {};
        const partId = String(
          part.id ?? part.callID ?? part.callId ?? `opencode-${activitySequence++}`,
        );
        const partType = String(part.type ?? eventType).trim();
        if (eventType === 'text' || partType === 'text') {
          considerText(part.text);
          recordAssistant({ id: partId, text: part.text });
        }
        if (eventType === 'reasoning' || partType === 'reasoning') {
          recordAssistant({ id: partId, thinking: part.text ?? part.reasoning });
        }
        if (eventType === 'tool_use' || partType === 'tool') {
          const state = part.state && typeof part.state === 'object' ? part.state : {};
          const callId = String(part.callID ?? part.callId ?? part.id ?? partId);
          const toolName = String(part.tool ?? part.name ?? 'tool');
          activity.upsertToolCall({
            id: callId,
            name: toolName,
            arguments: state.input ?? part.input ?? {},
          });
          const status = String(state.status ?? '')
            .trim()
            .toLowerCase();
          if (status === 'completed' || status === 'error' || status === 'failed') {
            activity.upsertToolResult({
              id: callId,
              name: toolName,
              result: state.output ?? state.result,
              ...(status === 'error' || status === 'failed'
                ? { error: state.error ?? state.output ?? 'Tool call failed.' }
                : {}),
            });
          }
        }
      } else {
        if (eventType === 'assistant') {
          const content = obj.message?.content;
          const text = typeof content === 'string' ? content : extractContentText(content);
          if (text) {
            cursorAssistantText += text;
            considerText(cursorAssistantText);
            recordAssistant({
              id: 'cursor-stream',
              text: cursorAssistantText,
              replaceLastText: true,
            });
          }
        }
        if (eventType === 'thinking' || eventType === 'reasoning') {
          recordAssistant({
            id: String(obj.id ?? `cursor-reasoning-${activitySequence++}`),
            thinking: obj.text ?? obj.reasoning ?? obj.message?.content,
          });
        }
        if (eventType === 'tool_call') {
          const tool = cursorTool(obj);
          if (tool) {
            activity.upsertToolCall({
              id: tool.id,
              name: tool.name,
              arguments: tool.payload?.args ?? tool.payload?.input ?? {},
            });
            const subtype = String(obj.subtype ?? tool.payload?.status ?? '')
              .trim()
              .toLowerCase();
            const result = tool.payload?.result ?? tool.payload?.output;
            const toolError = tool.payload?.error;
            if (
              subtype === 'completed' ||
              subtype === 'failed' ||
              result !== undefined ||
              toolError !== undefined
            ) {
              activity.upsertToolResult({
                id: tool.id,
                name: tool.name,
                result,
                ...(subtype === 'failed' || toolError !== undefined
                  ? { error: toolError ?? result ?? 'Tool call failed.' }
                  : {}),
              });
            }
          }
        }
        if (eventType === 'result') {
          considerText(obj.result);
          recordAssistant({ id: 'cursor-result', text: obj.result });
        }
      }
    },
    result() {
      const agentActivity = activity.result();
      return {
        sessionId,
        message,
        ...(agentActivity ? { activity: agentActivity } : {}),
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(agentPlan ? { agentPlan } : {}),
        ...(terminalStatus ? { terminalStatus } : {}),
        ...(error ? { error } : {}),
      };
    },
  };
}

function parseStructuredAgentJsonl(
  source: Extract<AgentPlan['source'], 'cursor' | 'claude' | 'opencode'>,
  stdout: string,
): StructuredAgentJsonlParseResult {
  const parser = createStructuredAgentJsonlParser(source);
  for (const line of String(stdout ?? '').split('\n')) parser.pushLine(line);
  return parser.result();
}

export const parseCursorJsonl = (stdout: string) => parseStructuredAgentJsonl('cursor', stdout);
export const parseClaudeJsonl = (stdout: string) => parseStructuredAgentJsonl('claude', stdout);
export const parseOpenCodeJsonl = (stdout: string) => parseStructuredAgentJsonl('opencode', stdout);

function createPiJsonlParser(): {
  pushLine: (line: string) => void;
  result: () => PiJsonlParseResult;
} {
  let sessionId: string | null = null;
  let lastMsg: string | null = null;
  let lastModel: string | null = null;
  let lastReasoning: string | null = null;
  let messageSequence = 0;
  const activity = new BuiltinAgentActivityCollector('pi');

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
    if (!message || typeof message !== 'object') return;
    const text = extractAssistantText(message);
    const baseId = String(message.id ?? message.timestamp ?? `pi-message-${messageSequence++}`);
    if (String(message.role ?? '').trim() === 'assistant' && Array.isArray(message.content)) {
      for (let index = 0; index < message.content.length; index += 1) {
        const part = message.content[index];
        if (!part || typeof part !== 'object') continue;
        const partId = `${baseId}:${index}`;
        const partType = String(part.type ?? '').trim();
        if (partType === 'text') {
          activity.upsertAssistant({ id: partId, text: part.text });
        } else if (partType === 'thinking') {
          activity.upsertAssistant({ id: partId, thinking: part.thinking ?? part.text });
        } else if (partType === 'toolCall') {
          activity.upsertToolCall({
            id: String(part.id ?? partId),
            name: String(part.name ?? 'tool'),
            arguments: part.arguments ?? {},
          });
        }
      }
    } else if (text) {
      activity.upsertAssistant({ id: baseId, text });
    }
    if (String(message.role ?? '').trim() === 'toolResult') {
      activity.upsertToolResult({
        id: String(message.toolCallId ?? message.tool_call_id ?? baseId),
        name: String(message.toolName ?? message.tool_name ?? 'tool'),
        result: message.content ?? message.result,
        ...(message.isError === true
          ? { error: message.errorMessage ?? message.content ?? 'Tool call failed.' }
          : {}),
      });
    }
    if (text) lastMsg = text;
    lastModel = extractModelId(message) ?? lastModel;
    lastReasoning = extractReasoningEffort(message) ?? lastReasoning;
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
      lastModel = extractModelId(obj) ?? lastModel;
      lastReasoning = extractReasoningEffort(obj) ?? lastReasoning;
      if (obj.type === 'session') {
        const parsedId = parseUuid(String(obj.id ?? obj.sessionId ?? obj.session_id ?? '').trim());
        if (parsedId) sessionId = parsedId;
      }
      if (obj.type === 'tool_execution_start' || obj.type === 'tool_execution_update') {
        activity.upsertToolCall({
          id: String(obj.toolCallId ?? obj.tool_call_id ?? `pi-tool-${messageSequence++}`),
          name: String(obj.toolName ?? obj.tool_name ?? ''),
          arguments: obj.args,
        });
      }
      if (obj.type === 'tool_execution_end') {
        activity.upsertToolResult({
          id: String(obj.toolCallId ?? obj.tool_call_id ?? `pi-tool-${messageSequence++}`),
          name: String(obj.toolName ?? obj.tool_name ?? 'tool'),
          result: obj.result,
          ...(obj.isError === true ? { error: obj.result ?? 'Tool call failed.' } : {}),
        });
      }
      if (obj.type === 'agent_end') activity.settleOpenTools();
      considerMessage(obj.message);
      if (Array.isArray(obj.messages)) {
        for (const message of obj.messages) considerMessage(message);
      }
    },
    result() {
      const agentActivity = activity.result();
      return {
        sessionId,
        message: lastMsg,
        ...(agentActivity ? { activity: agentActivity } : {}),
        ...(lastModel ? { model: lastModel } : {}),
        ...(lastReasoning ? { reasoning: lastReasoning } : {}),
      };
    },
  };
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
  let lastModel: string | null = null;
  let lastReasoning: string | null = null;
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
  let assistantSequence = 0;
  let reasoningSequence = 0;
  let streamedReasoning = '';
  const activity = new BuiltinAgentActivityCollector('blip');
  const eventCounts: Record<string, number> = {};
  const activeToolCalls = new Map<
    string,
    { tool: string; startedAt?: string; startedAtMs?: number }
  >();

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
      lastModel = extractModelId(obj) ?? lastModel;
      lastReasoning = extractReasoningEffort(obj) ?? lastReasoning;
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
        activity.upsertToolCall({
          id: callId || `blip-tool-${toolCallCount}`,
          name: tool || 'tool',
          arguments: obj.args ?? {},
          createdAt: timestamp,
        });
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
        activity.upsertToolResult({
          id: callId || `blip-tool-${toolCallCount}`,
          name: tool || started?.tool || 'tool',
          result: obj.result,
          ...(type === 'tool_call_failed' ? { error: obj.error ?? 'Tool call failed.' } : {}),
          createdAt: timestamp,
        });
      }
      if (type === 'assistant_delta') {
        const delta = takeStringText(obj.text);
        if (delta) {
          streamedMsg += delta;
          activity.upsertAssistant({
            id: `blip-assistant-${assistantSequence}`,
            text: streamedMsg,
            createdAt: timestamp,
          });
        }
        lastModel = extractModelId(obj) ?? lastModel;
        return;
      }
      if (type === 'assistant_message') {
        const text = takeStringText(obj.text) ?? takeStringText(obj.message);
        if (text) {
          lastMsg = text;
          activity.upsertAssistant({
            id: `blip-assistant-${assistantSequence}`,
            text,
            createdAt: timestamp,
          });
          assistantSequence += 1;
          streamedMsg = '';
        }
        lastModel = extractModelId(obj) ?? lastModel;
        return;
      }
      if (type === 'reasoning_delta') {
        const delta = takeStringText(obj.text);
        if (delta) {
          streamedReasoning += delta;
          activity.upsertAssistant({
            id: `blip-reasoning-${reasoningSequence}`,
            thinking: streamedReasoning,
            createdAt: timestamp,
          });
        }
        return;
      }
      if (type === 'reasoning_message') {
        const text = takeStringText(obj.text);
        if (text) {
          activity.upsertAssistant({
            id: `blip-reasoning-${reasoningSequence}`,
            thinking: text,
            createdAt: timestamp,
          });
          reasoningSequence += 1;
          streamedReasoning = '';
        }
        return;
      }
      if (type === 'session_finished') {
        activity.settleOpenTools();
        terminalEvent = 'session_finished';
        terminalEventAt = timestamp;
        terminalStatus = String(obj.status ?? '').trim() || null;
        terminalError = extractBlipErrorText(obj.error);
        durationMs = optionalFiniteDurationMs(obj.durationMs);
        lastModel = extractModelId(obj) ?? lastModel;
        return;
      }
      if (type === 'session_error') {
        activity.settleOpenTools('The session ended before this tool reported completion.');
        terminalEvent = 'session_error';
        terminalEventAt = timestamp;
        terminalStatus = String(obj.status ?? '').trim() || null;
        terminalError = extractBlipErrorText(obj.error);
        durationMs = optionalFiniteDurationMs(obj.durationMs);
      }
    },
    result() {
      const eventCountsOut = Object.keys(eventCounts).length > 0 ? eventCounts : null;
      const agentActivity = activity.result();
      return {
        sessionId,
        message: lastMsg ?? (streamedMsg ? streamedMsg : null),
        ...(agentActivity ? { activity: agentActivity } : {}),
        ...(lastModel ? { model: lastModel } : {}),
        ...(lastReasoning ? { reasoning: lastReasoning } : {}),
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
      };
    },
  };
}

export function parseCodexJsonl(stdout: string): CodexJsonlParseResult {
  const parser = createCodexJsonlParser();
  for (const line of String(stdout || '').split('\n')) parser.pushLine(line);
  return parser.result();
}

export type AgentTurnRuntimeMetadata = { model?: string; reasoning?: string };

export function parseCodexRolloutRuntime(raw: string): AgentTurnRuntimeMetadata {
  let lastModel: string | null = null;
  let lastReasoning: string | null = null;
  for (const lineRaw of String(raw ?? '').split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (String(event?.type ?? '').trim() !== 'turn_context') continue;
      const context = event?.payload ?? event;
      lastModel = extractModelId(context) ?? lastModel;
      lastReasoning = extractReasoningEffort(context) ?? lastReasoning;
    } catch {
      // Ignore malformed or unrelated rollout rows.
    }
  }
  return {
    ...(lastModel ? { model: lastModel } : {}),
    ...(lastReasoning ? { reasoning: lastReasoning } : {}),
  };
}

export function parseCodexRolloutModel(raw: string): string | null {
  return parseCodexRolloutRuntime(raw).model ?? null;
}

export async function parseCodexJsonlLines(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<CodexJsonlParseResult> {
  const parser = createCodexJsonlParser();
  for await (const line of lines) parser.pushLine(line);
  return parser.result();
}

async function parseStructuredAgentJsonlLines(
  source: Extract<AgentPlan['source'], 'cursor' | 'claude' | 'opencode'>,
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<StructuredAgentJsonlParseResult> {
  const parser = createStructuredAgentJsonlParser(source);
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
      kind: 'cursor' | 'claude' | 'opencode';
      message: string | null;
      sessionId: string | null;
      activity?: AgentRunActivity;
      model?: string;
      reasoning?: string;
      agentPlan?: AgentPlan;
      terminalStatus?: 'completed' | 'failed';
      error?: string;
      stdoutBytes?: number;
      stdoutTruncated?: boolean;
      parsedAt?: string;
    }
  | {
      kind: 'codex';
      message: string | null;
      threadId: string | null;
      activity?: AgentRunActivity;
      model?: string;
      reasoning?: string;
      terminalEvent?: CodexTerminalEvent;
      terminalStatus?: CodexTerminalStatus;
      agentPlan?: AgentPlan;
      skillsUsed?: AgentSkillUse[];
      stdoutBytes?: number;
      stdoutTruncated?: boolean;
      parsedAt?: string;
    }
  | {
      kind: 'pi';
      message: string | null;
      sessionId: string | null;
      activity?: AgentRunActivity;
      model?: string;
      reasoning?: string;
      stdoutBytes?: number;
      stdoutTruncated?: boolean;
      parsedAt?: string;
    }
  | {
      kind: 'blip';
      message: string | null;
      sessionId: string | null;
      activity?: AgentRunActivity;
      model?: string;
      reasoning?: string;
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
    return codexPromptJobTranscript(parseCodexJsonl(stdout), opts);
  }
  if (kind === 'cursor' || kind === 'claude' || kind === 'opencode') {
    const parsed = parseStructuredAgentJsonl(kind, stdout);
    return {
      kind,
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.activity ? { activity: parsed.activity } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      ...(parsed.agentPlan ? { agentPlan: parsed.agentPlan } : {}),
      ...(parsed.terminalStatus ? { terminalStatus: parsed.terminalStatus } : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'pi') {
    const parsed = parsePiJsonl(stdout);
    return {
      kind: 'pi',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.activity ? { activity: parsed.activity } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'blip') {
    const parsed = parseBlipJsonl(stdout);
    return {
      kind: 'blip',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.activity ? { activity: parsed.activity } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      ...(parsed.terminalEvent ? { terminalEvent: parsed.terminalEvent } : {}),
      ...blipTranscriptDiagnostics(parsed),
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
    return codexPromptJobTranscript(await parseCodexJsonlLines(lines), opts);
  }
  if (kind === 'cursor' || kind === 'claude' || kind === 'opencode') {
    const parsed = await parseStructuredAgentJsonlLines(kind, lines);
    return {
      kind,
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.activity ? { activity: parsed.activity } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      ...(parsed.agentPlan ? { agentPlan: parsed.agentPlan } : {}),
      ...(parsed.terminalStatus ? { terminalStatus: parsed.terminalStatus } : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'pi') {
    const parsed = await parsePiJsonlLines(lines);
    return {
      kind: 'pi',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.activity ? { activity: parsed.activity } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      ...promptJobTranscriptMeta(opts),
    };
  }
  if (kind === 'blip') {
    const parsed = await parseBlipJsonlLines(lines);
    return {
      kind: 'blip',
      message: parsed.message,
      sessionId: parsed.sessionId,
      ...(parsed.activity ? { activity: parsed.activity } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}),
      ...(parsed.terminalEvent ? { terminalEvent: parsed.terminalEvent } : {}),
      ...blipTranscriptDiagnostics(parsed),
      ...promptJobTranscriptMeta(opts),
    };
  }
  return null;
}

export function parseCodexJobTranscript(job: any): {
  threadId: string | null;
  message: string | null;
  activity?: AgentRunActivity;
  model?: string;
  reasoning?: string;
  terminalEvent?: CodexTerminalEvent;
  terminalStatus?: CodexTerminalStatus;
  agentPlan?: AgentPlan;
  skillsUsed?: AgentSkillUse[];
} {
  const transcript = job?.transcript;
  if (
    transcript &&
    typeof transcript === 'object' &&
    String(transcript.kind ?? '').trim() === 'codex'
  ) {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      const model = optionalString(transcript.model);
      const reasoning = optionalString(transcript.reasoning);
      const activity = normalizeAgentRunActivity(transcript.activity);
      const terminalEventRaw = String(transcript.terminalEvent ?? '').trim();
      const terminalEvent =
        terminalEventRaw === 'turn.completed' ||
        terminalEventRaw === 'response.completed' ||
        terminalEventRaw === 'response.failed' ||
        terminalEventRaw === 'error'
          ? terminalEventRaw
          : undefined;
      const terminalStatusRaw = String(transcript.terminalStatus ?? '').trim();
      const terminalStatus =
        terminalStatusRaw === 'completed' ||
        terminalStatusRaw === 'failed' ||
        terminalStatusRaw === 'canceled'
          ? terminalStatusRaw
          : undefined;
      const agentPlan = normalizeAgentPlan(
        transcript.agentPlan,
        'codex',
        transcript.agentPlan?.updatedAt,
      );
      const skillsUsed = normalizeAgentSkillUses(transcript.skillsUsed);
      return {
        threadId: optionalString(transcript.threadId),
        message: optionalString(transcript.message),
        ...(activity ? { activity } : {}),
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(terminalEvent ? { terminalEvent } : {}),
        ...(terminalStatus ? { terminalStatus } : {}),
        ...(agentPlan ? { agentPlan } : {}),
        ...(skillsUsed.length > 0 ? { skillsUsed } : {}),
      };
    }
  }
  return parseCodexJsonl(String(job?.stdout ?? ''));
}

export function parseStructuredAgentJobTranscript(
  kind: Extract<AgentPlan['source'], 'cursor' | 'claude' | 'opencode'>,
  job: any,
): StructuredAgentJsonlParseResult {
  const transcript = job?.transcript;
  if (
    transcript &&
    typeof transcript === 'object' &&
    String(transcript.kind ?? '').trim() === kind &&
    Object.prototype.hasOwnProperty.call(transcript, 'message')
  ) {
    const agentPlan = normalizeAgentPlan(
      transcript.agentPlan,
      kind,
      transcript.agentPlan?.updatedAt,
    );
    const activity = normalizeAgentRunActivity(transcript.activity);
    const model = optionalString(transcript.model);
    const reasoning = optionalString(transcript.reasoning);
    const error = optionalString(transcript.error);
    const terminalStatus =
      transcript.terminalStatus === 'completed' || transcript.terminalStatus === 'failed'
        ? transcript.terminalStatus
        : undefined;
    return {
      sessionId: optionalString(transcript.sessionId),
      message: optionalString(transcript.message),
      ...(activity ? { activity } : {}),
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(agentPlan ? { agentPlan } : {}),
      ...(terminalStatus ? { terminalStatus } : {}),
      ...(error ? { error } : {}),
    };
  }
  return parseStructuredAgentJsonl(kind, String(job?.stdout ?? ''));
}

export function parsePiJobTranscript(job: any): {
  sessionId: string | null;
  message: string | null;
  activity?: AgentRunActivity;
  model?: string;
  reasoning?: string;
} {
  const transcript = job?.transcript;
  if (
    transcript &&
    typeof transcript === 'object' &&
    String(transcript.kind ?? '').trim() === 'pi'
  ) {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      const model = optionalString(transcript.model);
      const reasoning = optionalString(transcript.reasoning);
      const activity = normalizeAgentRunActivity(transcript.activity);
      return {
        sessionId: optionalString(transcript.sessionId),
        message: optionalString(transcript.message),
        ...(activity ? { activity } : {}),
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
      };
    }
  }
  return parsePiJsonl(String(job?.stdout ?? ''));
}

export function parseBlipJobTranscript(job: any): {
  sessionId: string | null;
  message: string | null;
  activity?: AgentRunActivity;
  model?: string;
  reasoning?: string;
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
} {
  const transcript = job?.transcript;
  if (
    transcript &&
    typeof transcript === 'object' &&
    String(transcript.kind ?? '').trim() === 'blip'
  ) {
    if (Object.prototype.hasOwnProperty.call(transcript, 'message')) {
      const model = optionalString(transcript.model);
      const reasoning = optionalString(transcript.reasoning);
      const activity = normalizeAgentRunActivity(transcript.activity);
      const terminalEventRaw = String(transcript.terminalEvent ?? '').trim();
      const terminalEvent =
        terminalEventRaw === 'session_finished' || terminalEventRaw === 'session_error'
          ? terminalEventRaw
          : undefined;
      return {
        sessionId: optionalString(transcript.sessionId),
        message: optionalString(transcript.message),
        ...(activity ? { activity } : {}),
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(terminalEvent ? { terminalEvent } : {}),
        ...blipTranscriptDiagnostics(transcript as any),
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
  const specificFallback = String(fallbackRaw ?? '').trim();
  const fallback = specificFallback || 'Codex turn failed.';
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
  if (lifecycleOnly) {
    // A durable job error describes why the lifecycle stopped. Preserve it
    // unless the caller merely used the captured stream itself as fallback.
    if (
      specificFallback &&
      specificFallback !== stdout &&
      specificFallback !== stderr &&
      specificFallback !== merged
    ) {
      return specificFallback;
    }
    return 'Codex turn started but exited before producing a response.';
  }
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

  const genericFallback = `${opts.agentId} agent failed`;
  let detail =
    fallback && fallback !== genericFallback ? fallback : stderr || stdout || fallback || '';
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
