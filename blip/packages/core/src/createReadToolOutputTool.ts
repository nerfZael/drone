import { Type, type AgentTool } from '@mariozechner/pi-agent-core/portable';
import type { SessionRepository } from './session-repository.js';
import type { BlipSessionState } from './types.js';

const parameters = Type.Object({
  call_id: Type.String({ description: 'Original tool call ID shown in a shortened output preview.' }),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Zero-based character offset. Defaults to 0.' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12_000, description: 'Maximum characters to return. Defaults to 12000.' })),
}, { additionalProperties: false });

/** Reads saved output, never re-executes the original command or accesses another session. */
export function createReadToolOutputTool(repository: SessionRepository, session: BlipSessionState): AgentTool<typeof parameters> {
  return {
    name: 'read_tool_output',
    label: 'Read saved tool output',
    description: 'Retrieve original text omitted from an older tool output in this session. Read additional pages using the returned next offset. This is historical output, which may no longer describe current state.',
    parameters,
    executionMode: 'parallel',
    async execute(_callId, params, signal) {
      signal?.throwIfAborted();
      let result;
      if (repository.readToolResult) {
        result = await repository.readToolResult(session, params.call_id);
      } else {
        const entries = await repository.readTranscript(session);
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const entry = entries[index]!;
          if (entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === params.call_id) {
            result = entry.message;
            break;
          }
        }
      }
      signal?.throwIfAborted();
      if (!result) throw new Error(`No saved tool output for call ID ${params.call_id} in this session`);
      const text = result.content.map((part) => part.type === 'text' ? part.text : '[image]').join('\n');
      const offset = params.offset ?? 0;
      const limit = params.limit ?? 12_000;
      if (offset > text.length) throw new Error(`Offset ${offset} exceeds the saved output length (${text.length})`);
      const end = Math.min(text.length, offset + limit);
      const next = end < text.length ? end : undefined;
      return {
        content: [{ type: 'text', text:
          `Saved output of ${result.toolName} (${params.call_id}), characters ${offset}-${end} of ${text.length}. ` +
          (next === undefined ? 'End of output.' : `Continue with offset=${next}.`) + '\n' + text.slice(offset, end),
        }],
        details: { callId: params.call_id, offset, end, totalChars: text.length, nextOffset: next },
      };
    },
  };
}
