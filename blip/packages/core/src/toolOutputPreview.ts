import type { AgentMessage } from '@mariozechner/pi-agent-core/portable';

type ToolResult = Extract<AgentMessage, { role: 'toolResult' }>;

/** Retained source characters; omission/retrieval notices are additional. */
export const TOOL_OUTPUT_CHARS = 24_000;
export const TOOL_BATCH_OUTPUT_CHARS = 48_000;

/** One coordinate system for previews and read_tool_output, including mixed results. */
export function toolOutputText(message: ToolResult): string {
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

export function toolOutputFailed(message: ToolResult): boolean {
  if (message.isError) return true;
  if (!message.details || typeof message.details !== 'object') return false;
  const result = message.details as Record<string, unknown>;
  return result.timedOut === true || result.isError === true || result.success === false ||
    ['exitCode', 'exit_code'].some((key) => key in result && result[key] !== 0);
}

export function previewToolOutput(
  message: ToolResult, text: string, limit: number, older: boolean, instructions: boolean,
): ToolResult {
  if (text.length <= limit) return message;
  let head = Math.floor(limit * 3 / 4);
  let tailStart = text.length - (limit - head);
  // Never leave half a surrogate pair at either cut.
  if (head > 0 && isHighSurrogate(text.charCodeAt(head - 1))) head--;
  if (tailStart > 0 && isHighSurrogate(text.charCodeAt(tailStart - 1))) tailStart++;
  const notice = `\n[${older ? 'Older tool output' : 'Tool output'} shortened from ${text.length} characters; ` +
    `${tailStart - head} characters omitted. ${toolOutputFailed(message) ? 'Tool reported failure. ' : ''}` +
    `Original saved in this session. Use read_tool_output with call_id=${JSON.stringify(message.toolCallId)}, ` +
    `offset=${head} to read omitted text. Omitted content is not evidence of success or absence. ` +
    (instructions ? 'Read omitted instructions before acting on them. ' : '') + ']\n';
  let offset = 0;
  let inserted = false;
  const content = message.content.flatMap((part): ToolResult['content'] => {
    if (part.type !== 'text') return [part];
    const start = offset;
    const end = start + part.text.length;
    offset = end + 1; // The newline used by toolOutputText.
    if (end <= head) return [part];
    if (start >= tailStart) {
      // The omitted range can consist only of a separator between text blocks.
      if (inserted) return [part];
      inserted = true;
      return [{ ...part, text: notice + part.text }];
    }
    const prefix = part.text.slice(0, Math.max(0, head - start));
    const suffix = part.text.slice(Math.max(0, tailStart - start));
    const marker = inserted ? '' : notice;
    inserted = true;
    const projected = prefix + marker + suffix;
    return projected ? [{ type: 'text', text: projected }] : [];
  });
  return { ...message, content };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
