import { createPortableId } from '@blip/core';
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
import type { LocalCodexAuth } from './codex-auth-format';
import { consumeCodexSseResponse } from './codex-sse';

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
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

function codexCallId(value: string): string {
  return value.split('|', 1)[0] || value;
}

function codexInput(context: Context): any[] {
  return context.messages.flatMap((message) => {
    if (message.role === 'user') {
      const text = contentText(message.content);
      return text ? [{ role: 'user', content: [{ type: 'input_text', text }] }] : [];
    }
    if (message.role === 'toolResult') {
      return [
        {
          type: 'function_call_output',
          call_id: codexCallId(message.toolCallId),
          output: contentText(message.content),
        },
      ];
    }
    const items: any[] = [];
    const text = message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('');
    if (text) {
      items.push({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      });
    }
    for (const part of message.content) {
      if (part.type !== 'toolCall') continue;
      items.push({
        type: 'function_call',
        call_id: codexCallId(part.id),
        name: part.name,
        arguments: JSON.stringify(part.arguments),
      });
    }
    return items;
  });
}

function toolArguments(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function responseContent(response: any): AssistantMessage['content'] {
  const content: AssistantMessage['content'] = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
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
    const name = String(item.name ?? '').trim();
    if (callId && name)
      content.push({
        type: 'toolCall',
        id: callId,
        name,
        arguments: toolArguments(item.arguments),
      });
  }
  return content;
}

function usage(value: any): Usage {
  const input = Number(value?.input_tokens) || 0;
  const output = Number(value?.output_tokens) || 0;
  return { ...EMPTY_USAGE, input, output, totalTokens: input + output };
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

export function createCodexMobileStream(auth: LocalCodexAuth, threadId: string): StreamFn {
  return (
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const stream = new AssistantMessageEventStream();
    void (async () => {
      let streamingThinking = '';
      let streamingText = '';
      const partial = () =>
        assistantMessage(
          model,
          [
            ...(streamingThinking
              ? [{ type: 'thinking' as const, thinking: streamingThinking.slice(-48_000) }]
              : []),
            ...(streamingText
              ? [{ type: 'text' as const, text: streamingText.slice(-48_000) }]
              : []),
          ],
          'stop',
        );
      try {
        stream.push({ type: 'start', partial: partial() });
        const response = await fetch(CODEX_RESPONSES_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'ChatGPT-Account-ID': auth.accountId,
            originator: 'codex_cli_rs',
            accept: 'text/event-stream',
            'content-type': 'application/json',
            session_id: threadId,
            'x-client-request-id': createPortableId(),
          },
          signal: options?.signal,
          body: JSON.stringify({
            model: model.id,
            store: false,
            stream: true,
            instructions: context.systemPrompt,
            input: codexInput(context),
            text: { verbosity: 'low' },
            reasoning: {
              effort: options?.reasoning ?? 'none',
              summary: 'auto',
            },
            include: ['reasoning.encrypted_content'],
            prompt_cache_key: threadId.slice(0, 64),
            tool_choice: 'auto',
            parallel_tool_calls: true,
            ...(context.tools?.length
              ? {
                  tools: context.tools.map((tool) => ({
                    type: 'function',
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
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
        const body = await consumeCodexSseResponse(response, (event) => {
          const type = String(event?.type ?? '');
          if (type === 'response.reasoning_summary_text.delta') {
            streamingThinking += String(event?.delta ?? '');
            stream.push({
              type: 'thinking_delta',
              contentIndex: 0,
              delta: String(event?.delta ?? ''),
              partial: partial(),
            });
          } else if (type === 'response.output_text.delta') {
            streamingText += String(event?.delta ?? '');
            stream.push({
              type: 'text_delta',
              contentIndex: streamingThinking ? 1 : 0,
              delta: String(event?.delta ?? ''),
              partial: partial(),
            });
          }
        });
        const content = responseContent(body);
        const calls = content.filter((part): part is ToolCall => part.type === 'toolCall');
        const stopReason = calls.length > 0 ? 'toolUse' : 'stop';
        const message = assistantMessage(model, content, stopReason, { usage: body?.usage });
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
