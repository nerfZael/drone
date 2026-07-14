import type { StreamFn } from '@mariozechner/pi-agent-core/portable';
import {
  AssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type Usage,
} from '@mariozechner/pi-ai/agent-core';

type ProviderToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type ProviderMessage =
  | { role: 'developer' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ProviderToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function contentText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function providerMessages(context: Context): ProviderMessage[] {
  return context.messages.map((message): ProviderMessage => {
    if (message.role === 'user') return { role: 'user', content: contentText(message.content) };
    if (message.role === 'toolResult') {
      return {
        role: 'tool',
        content: contentText(message.content),
        tool_call_id: message.toolCallId,
      };
    }
    const calls = message.content.filter((part): part is ToolCall => part.type === 'toolCall');
    return {
      role: 'assistant',
      content:
        message.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .filter(Boolean)
          .join('\n') || null,
      ...(calls.length > 0
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }
        : {}),
    };
  });
}

function toolArguments(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function usage(value: any): Usage {
  const input = Number(value?.prompt_tokens) || 0;
  const output = Number(value?.completion_tokens) || 0;
  return {
    ...EMPTY_USAGE,
    input,
    output,
    totalTokens: Number(value?.total_tokens) || input + output,
  };
}

function assistantMessage(
  model: Model<any>,
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
  input?: { usage?: unknown; errorMessage?: string },
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(input?.usage),
    stopReason,
    errorMessage: input?.errorMessage,
    timestamp: Date.now(),
  };
}

export function createOpenAiMobileStream(apiKey: string): StreamFn {
  return (
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const stream = new AssistantMessageEventStream();
    void (async () => {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          signal: options?.signal,
          body: JSON.stringify({
            model: model.id,
            ...(options?.reasoning ? { reasoning_effort: options.reasoning } : {}),
            messages: [
              ...(context.systemPrompt
                ? [{ role: 'developer' as const, content: context.systemPrompt }]
                : []),
              ...providerMessages(context),
            ],
            ...(context.tools?.length
              ? {
                  tools: context.tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                  tool_choice: 'auto',
                }
              : {}),
          }),
        });
        const body: any = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            String(body?.error?.message ?? `OpenAI request failed (${response.status})`),
          );
        const choice = body?.choices?.[0];
        if (!choice?.message) throw new Error('OpenAI returned no assistant message');
        const calls: ProviderToolCall[] = Array.isArray(choice.message.tool_calls)
          ? choice.message.tool_calls
          : [];
        const text =
          typeof choice.message.content === 'string' ? choice.message.content.slice(0, 48_000) : '';
        const content: AssistantMessage['content'] = [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...calls.map((call) => ({
            type: 'toolCall' as const,
            id: String(call.id),
            name: String(call.function?.name ?? ''),
            arguments: toolArguments(call.function?.arguments),
          })),
        ];
        const stopReason =
          calls.length > 0 ? 'toolUse' : choice.finish_reason === 'length' ? 'length' : 'stop';
        const message = assistantMessage(model, content, stopReason, { usage: body.usage });
        stream.push({ type: 'done', reason: stopReason, message });
      } catch (error: any) {
        const aborted = options?.signal?.aborted || error?.name === 'AbortError';
        const message = assistantMessage(model, [], aborted ? 'aborted' : 'error', {
          errorMessage: aborted ? 'Assistant run was stopped' : (error?.message ?? String(error)),
        });
        stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: message });
      }
    })();
    return stream;
  };
}
