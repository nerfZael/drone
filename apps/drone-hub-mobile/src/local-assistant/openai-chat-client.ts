import * as Crypto from 'expo-crypto';
import { messageText, toolCalls } from '@drone/assistant-chat';
import type {
  LocalAssistantMessage,
  LocalAssistantThinkingLevel,
  LocalAssistantThread,
} from './local-assistant-types';
import type { LocalAssistantTool } from './workspace-tools';

type ProviderToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type ProviderMessage =
  | { role: 'developer' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ProviderToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

const MAX_CONTEXT_MESSAGES = 100;
const MAX_CONTEXT_CHARACTERS = 600_000;

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

function providerMessages(messages: LocalAssistantMessage[]): ProviderMessage[] {
  return boundedContext(messages).map((message): ProviderMessage => {
    if (message.role === 'user') return { role: 'user', content: messageText(message) };
    if (message.role === 'toolResult') {
      return {
        role: 'tool',
        content: messageText(message),
        tool_call_id: String(message.toolCallId ?? ''),
      };
    }
    const calls = toolCalls(message);
    return {
      role: 'assistant',
      content: messageText(message) || null,
      ...(calls.length > 0
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          }
        : {}),
    };
  });
}

function responseText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 48_000);
  if (!Array.isArray(content)) return '';
  return content
    .map((part: any) => String(part?.text ?? ''))
    .join('\n')
    .slice(0, 48_000);
}

function toolArguments(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

export async function runOpenAiChat(input: {
  apiKey: string;
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
}): Promise<LocalAssistantMessage[]> {
  let messages = [...input.thread.messages];
  for (let step = 0; step < 8; step += 1) {
    const target = input.thread.workspaceTarget;
    const developer = [
      'You are the coding assistant running directly on an Android phone in Drone Hub.',
      'Be concise, inspect files before editing, and use baseHash when overwriting a file you read.',
      target
        ? `The selected workspace is root ${target.rootId} on device ${target.targetDeviceId}. Use the available tools for it.`
        : 'No workspace is selected. Explain that file tools require a remote workspace when relevant.',
    ].join('\n');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: input.signal,
      body: JSON.stringify({
        model: input.model,
        ...(input.thinkingLevel !== 'off' ? { reasoning_effort: input.thinkingLevel } : {}),
        messages: [{ role: 'developer', content: developer }, ...providerMessages(messages)],
        ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: 'auto' } : {}),
      }),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(String(body?.error?.message ?? `OpenAI request failed (${response.status})`));
    const choice = body?.choices?.[0]?.message;
    if (!choice) throw new Error('OpenAI returned no assistant message');
    const calls: ProviderToolCall[] = Array.isArray(choice.tool_calls)
      ? choice.tool_calls.slice(0, 8)
      : [];
    const assistant = newMessage({
      role: 'assistant',
      content: [
        ...(responseText(choice.content)
          ? [{ type: 'text', text: responseText(choice.content) }]
          : []),
        ...calls.map((call) => ({
          type: 'toolCall',
          id: String(call.id),
          name: String(call.function?.name ?? ''),
          arguments: toolArguments(call.function?.arguments),
        })),
      ],
    });
    messages = [...messages, assistant];
    await input.onMessages(messages);
    if (calls.length === 0) return messages;

    for (const call of calls) {
      let result: { text: string; details: unknown };
      let error: Error | null = null;
      try {
        const args = toolArguments(call.function?.arguments);
        result = await input.executeTool(String(call.function?.name ?? ''), args);
      } catch (nextError: any) {
        error = nextError instanceof Error ? nextError : new Error(String(nextError));
        result = { text: error.message, details: null };
      }
      messages = [
        ...messages,
        newMessage({
          role: 'toolResult',
          content: result.text,
          toolName: String(call.function?.name ?? ''),
          toolCallId: String(call.id),
          isError: Boolean(error),
          errorMessage: error?.message,
          details: result.details,
        }),
      ];
      await input.onMessages(messages);
    }
  }
  throw new Error('The assistant reached the eight-step tool limit');
}
