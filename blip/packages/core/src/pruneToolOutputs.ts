import type { AgentMessage } from '@mariozechner/pi-agent-core/portable';
import { previewToolOutput, toolOutputFailed, toolOutputText, TOOL_BATCH_OUTPUT_CHARS, TOOL_OUTPUT_CHARS } from './toolOutputPreview.js';

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
  const candidates = new Map<AgentMessage, {
    text: string; limit: number; older: boolean; instructions: boolean;
  }>();
  const batches = new Map<number, Array<{ limit: number }>>();
  for (const message of messages) {
    if (message.role !== 'toolResult' || !originals.has(message)) continue;
    const call = calls.get(message.toolCallId);
    // Results without their original call, including injected host context, are left intact.
    if (!call) continue;
    const text = toolOutputText(message);
    const instructions = INSTRUCTIONS.test(text);
    const older = !call.protected && call.batch <= batch - 2 && !toolOutputFailed(message) &&
      message.content.every((part) => part.type === 'text') && !instructions && text.length > MIN_OUTPUT_CHARS;
    const candidate = {
      text, older, instructions: instructions || call.protected,
      limit: Math.min(text.length, older ? PREVIEW_CHARS : TOOL_OUTPUT_CHARS),
    };
    candidates.set(message, candidate);
    const group = batches.get(call.batch) ?? [];
    group.push(candidate);
    batches.set(call.batch, group);
  }
  // Share a batch budget fairly, letting small results keep their full allowance.
  for (const group of batches.values()) {
    group.sort((a, b) => a.limit - b.limit);
    let remaining = TOOL_BATCH_OUTPUT_CHARS;
    for (const [index, candidate] of group.entries()) {
      candidate.limit = Math.min(candidate.limit, Math.floor(remaining / (group.length - index)));
      remaining -= candidate.limit;
    }
  }
  return messages.map((message) => {
    const candidate = candidates.get(message);
    if (message.role !== 'toolResult' || !candidate) return message;
    return previewToolOutput(message, candidate.text, candidate.limit, candidate.older, candidate.instructions);
  });
}
