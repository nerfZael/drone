import { AgentToolResultError, type AgentTool, type AgentToolResult } from './types.js';

export type AgentToolProgressSink<T = any> = (
  partialResult: AgentToolResult<T>,
) => Promise<void> | void;

export type ExecuteAgentToolOptions<T = any> = {
  tool: AgentTool<any, T>;
  toolCallId: string;
  args: unknown;
  signal?: AbortSignal;
  onUpdate?: AgentToolProgressSink<T>;
};

/**
 * Executes one already-validated tool call and drains progress callbacks before
 * returning. Progress-listener failures never change the result of a completed
 * side effect.
 */
export async function executeAgentTool<T>(
  options: ExecuteAgentToolOptions<T>,
): Promise<AgentToolResult<T>> {
  const updateEvents: Promise<void>[] = [];
  let updateQueue = Promise.resolve();

  try {
    return await options.tool.execute(
      options.toolCallId,
      options.args as never,
      options.signal,
      (partialResult) => {
        const updateEvent = updateQueue.then(() =>
          Promise.resolve(options.onUpdate?.(partialResult)),
        );
        updateEvents.push(updateEvent);
        updateQueue = updateEvent.catch(() => undefined);
      },
    );
  } finally {
    await Promise.allSettled(updateEvents);
  }
}

/** Converts a thrown tool failure into the result shown to the model. */
export function agentToolErrorResult(error: unknown): AgentToolResult<any> {
  if (error instanceof AgentToolResultError) return error.result;
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    details: {},
  };
}
