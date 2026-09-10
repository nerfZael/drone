import type { AgentMessage } from '@mariozechner/pi-agent-core/portable';

const MIN_OUTPUT_CHARS = 12_000;
const PREVIEW_CHARS = 4_000;
const INSTRUCTIONS = /\b(?:AGENTS\.md|SKILL\.md|instructions?)\b|<INSTRUCTIONS>/i;

/** Model-only projection. Never changes the messages saved in the transcript. */
export function pruneToolOutputs(messages: AgentMessage[], originals = new Set(messages)): AgentMessage[] {
  const calls = new Map<string, { protected: boolean; batch: number }>();
  let batch = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const toolCalls = message.content.filter((part) => part.type === 'toolCall');
    if (toolCalls.length === 0) continue;
    batch += 1;
    for (const call of toolCalls) {
      calls.set(call.id, {
        batch,
        protected: /skill|instruction|read_tool_output/i.test(call.name) ||
          INSTRUCTIONS.test(JSON.stringify(call.arguments)),
      });
    }
  }
  return messages.map((message) => {
    if (message.role !== 'toolResult' || message.isError || !originals.has(message)) return message;
    const call = calls.get(message.toolCallId);
    // Results without their original call, including injected host context, are left intact.
    if (!call || call.protected || call.batch > batch - 2 || failed(message.details)) return message;
    if (message.content.some((part) => part.type !== 'text')) return message;
    const text = message.content.map((part) => part.type === 'text' ? part.text : '').join('\n');
    if (text.length <= MIN_OUTPUT_CHARS || INSTRUCTIONS.test(text)) return message;
    const head = PREVIEW_CHARS * 3 / 4;
    const tail = PREVIEW_CHARS - head;
    return {
      ...message,
      content: [{ type: 'text', text:
        `[Older tool output shortened from ${text.length} characters. Original saved in this session. ` +
        `Use read_tool_output with call_id=${JSON.stringify(message.toolCallId)}, offset=${head} to read omitted text.]\n` +
        text.slice(0, head) + `\n[... ${text.length - PREVIEW_CHARS} characters omitted ...]\n` + text.slice(-tail),
      }],
    };
  });
}

function failed(details: unknown): boolean {
  if (!details || typeof details !== 'object') return false;
  const result = details as Record<string, unknown>;
  return result.timedOut === true || result.isError === true || result.success === false ||
    ['exitCode', 'exit_code'].some((key) => key in result && result[key] !== 0);
}
