import * as Crypto from 'expo-crypto';
import { messageText } from '@drone/assistant-chat';
import type { LocalCodexAuth } from './codex-auth-format';
import { consumeCodexSseResponse } from './codex-sse';
import type {
  LocalAssistantMessage,
  LocalAssistantThinkingLevel,
  LocalAssistantThread,
} from './local-assistant-types';
import type { LocalAssistantTool } from './workspace-tools';

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const MAX_CONTEXT_MESSAGES = 100;
const MAX_CONTEXT_CHARACTERS = 600_000;

type CodexToolCall = {
  callId: string;
  itemId: string;
  displayId: string;
  name: string;
  arguments: Record<string, unknown>;
};

function boundedContext(messages: LocalAssistantMessage[]): LocalAssistantMessage[] {
  let start = Math.max(0, messages.length - MAX_CONTEXT_MESSAGES);
  let characters = 0;
  for (let index = messages.length - 1; index >= start; index -= 1) {
    characters += JSON.stringify(messages[index]).length;
    if (characters > MAX_CONTEXT_CHARACTERS) {
      start = index + 1;
      break;
    }
  }
  while (start < messages.length && messages[start].role !== 'user') start += 1;
  return messages.slice(start);
}

function historicalInput(messages: LocalAssistantMessage[]): any[] {
  return boundedContext(messages).flatMap((message, index) => {
    const content = messageText(message).trim();
    if (!content || message.role === 'toolResult') return [];
    if (message.role === 'user') {
      return [{ role: 'user', content: [{ type: 'input_text', text: content }] }];
    }
    return [
      {
        type: 'message',
        id: `msg_history_${index}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: content, annotations: [] }],
      },
    ];
  });
}

function newMessage(
  message: Omit<LocalAssistantMessage, 'id' | 'createdAt'>,
): LocalAssistantMessage {
  return {
    ...message,
    id: Crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

function toolArguments(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function responseContent(response: any): {
  content: Array<{ type: string; [key: string]: unknown }>;
  calls: CodexToolCall[];
  output: any[];
} {
  const output = Array.isArray(response?.output) ? response.output : [];
  const content: Array<{ type: string; [key: string]: unknown }> = [];
  const calls: CodexToolCall[] = [];
  for (const item of output) {
    if (item?.type === 'reasoning') {
      const thinking = (Array.isArray(item.summary) ? item.summary : [])
        .map((part: any) => String(part?.text ?? ''))
        .filter(Boolean)
        .join('\n\n');
      if (thinking) content.push({ type: 'thinking', thinking });
      continue;
    }
    if (item?.type === 'message') {
      const text = (Array.isArray(item.content) ? item.content : [])
        .map((part: any) => String(part?.text ?? part?.refusal ?? ''))
        .filter(Boolean)
        .join('')
        .slice(0, 48_000);
      if (text) content.push({ type: 'text', text });
      continue;
    }
    if (item?.type !== 'function_call') continue;
    const callId = String(item.call_id ?? '').trim();
    const itemId = String(item.id ?? '').trim();
    const name = String(item.name ?? '').trim();
    if (!callId || !name) continue;
    const args = toolArguments(item.arguments);
    const displayId = itemId ? `${callId}|${itemId}` : callId;
    calls.push({ callId, itemId, displayId, name, arguments: args });
    content.push({ type: 'toolCall', id: displayId, name, arguments: args });
  }
  return { content, calls, output };
}

async function requestCodex(input: {
  auth: LocalCodexAuth;
  model: string;
  thinkingLevel: LocalAssistantThinkingLevel;
  threadId: string;
  instructions: string;
  items: any[];
  tools: LocalAssistantTool[];
  signal: AbortSignal;
  onEvent?: (event: any) => Promise<void> | void;
}): Promise<any> {
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.auth.accessToken}`,
      'ChatGPT-Account-ID': input.auth.accountId,
      originator: 'codex_cli_rs',
      accept: 'text/event-stream',
      'content-type': 'application/json',
      session_id: input.threadId,
      'x-client-request-id': Crypto.randomUUID(),
    },
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      store: false,
      stream: true,
      instructions: input.instructions,
      input: input.items,
      text: { verbosity: 'low' },
      reasoning: {
        effort: input.thinkingLevel === 'off' ? 'none' : input.thinkingLevel,
        summary: 'auto',
      },
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: input.threadId.slice(0, 64),
      tool_choice: 'auto',
      parallel_tool_calls: true,
      ...(input.tools.length > 0
        ? {
            tools: input.tools.map((tool) => ({
              type: 'function',
              name: tool.function.name,
              description: tool.function.description,
              parameters: tool.function.parameters,
              strict: null,
            })),
          }
        : {}),
    }),
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = '';
    try {
      const body = JSON.parse(raw);
      message = String(body?.error?.message ?? body?.detail ?? '');
    } catch {
      message = raw.slice(0, 500);
    }
    throw new Error(message || `Codex request failed (${response.status})`);
  }
  return await consumeCodexSseResponse(response, input.onEvent);
}

export async function runCodexChat(input: {
  auth: LocalCodexAuth;
  model: string;
  thinkingLevel: LocalAssistantThinkingLevel;
  thread: LocalAssistantThread;
  tools: LocalAssistantTool[];
  signal: AbortSignal;
  executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; details: unknown }>;
  onMessages(messages: LocalAssistantMessage[]): Promise<void>;
  onStreamingMessages?(messages: LocalAssistantMessage[]): Promise<void> | void;
}): Promise<LocalAssistantMessage[]> {
  let messages = [...input.thread.messages];
  let items = historicalInput(messages);
  for (let step = 0; step < 8; step += 1) {
    const target = input.thread.workspaceTarget;
    const instructions = [
      'You are the coding assistant running directly on an Android phone in Drone Hub.',
      'Be concise, inspect files before editing, and use baseHash when overwriting a file you read.',
      target
        ? `The selected workspace is root ${target.rootId} on device ${target.targetDeviceId}. Use the available tools for it.`
        : 'No workspace is selected. Explain that file tools require a remote workspace when relevant.',
    ].join('\n');
    const preview = newMessage({ role: 'assistant', content: [] });
    let streamingThinking = '';
    let streamingText = '';
    const response = await requestCodex({
      auth: input.auth,
      model: input.model,
      thinkingLevel: input.thinkingLevel,
      threadId: input.thread.id,
      instructions,
      items,
      tools: input.tools,
      signal: input.signal,
      onEvent: async (event) => {
        const type = String(event?.type ?? '');
        if (type === 'response.reasoning_summary_text.delta') {
          streamingThinking += String(event?.delta ?? '');
        } else if (type === 'response.output_text.delta') {
          streamingText += String(event?.delta ?? '');
        } else {
          return;
        }
        const content = [
          ...(streamingThinking
            ? [{ type: 'thinking', thinking: streamingThinking.slice(-48_000) }]
            : []),
          ...(streamingText ? [{ type: 'text', text: streamingText.slice(-48_000) }] : []),
        ];
        await input.onStreamingMessages?.([...messages, { ...preview, content }]);
      },
    });
    const parsed = responseContent(response);
    const assistant = newMessage({ role: 'assistant', content: parsed.content });
    messages = [...messages, assistant];
    await input.onMessages(messages);
    items = [...items, ...parsed.output];
    if (parsed.calls.length === 0) return messages;

    for (const call of parsed.calls.slice(0, 8)) {
      let result: { text: string; details: unknown };
      let error: Error | null = null;
      try {
        result = await input.executeTool(call.name, call.arguments);
      } catch (nextError: any) {
        error = nextError instanceof Error ? nextError : new Error(String(nextError));
        result = { text: error.message, details: null };
      }
      messages = [
        ...messages,
        newMessage({
          role: 'toolResult',
          content: result.text,
          toolName: call.name,
          toolCallId: call.displayId,
          isError: Boolean(error),
          errorMessage: error?.message,
          details: result.details,
        }),
      ];
      items.push({
        type: 'function_call_output',
        call_id: call.callId,
        output: result.text,
      });
      await input.onMessages(messages);
    }
  }
  throw new Error('The assistant reached the eight-step tool limit');
}
