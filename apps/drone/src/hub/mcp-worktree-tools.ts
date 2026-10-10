import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type RequestJson = (pathname: string, init?: RequestInit, timeoutMs?: number) => Promise<any>;

export const SET_CURRENT_WORKTREE_TOOL_NAME = 'set_current_worktree';

/**
 * Lets an agent chat say which git worktree of its drone's repository it works in. The user's Changes explorer can
 * follow the chat and show that worktree's changes instead of the main checkout's.
 */
export function registerCurrentWorktreeTool(
  server: McpServer,
  input: {
    /** The chat the call is made for, read at call time. */
    chat: () => { droneId: string; chatName: string };
    requestJson: RequestJson;
  },
): void {
  server.registerTool(
    SET_CURRENT_WORKTREE_TOOL_NAME,
    {
      title: 'Set current worktree',
      description:
        "Tell DroneHub which git worktree of this drone's repository you are working in, so the user's Changes explorer can show its changes. Call it right after you create or move into a worktree (git worktree add), and call it with clear: true when you go back to the main checkout or remove the worktree. Give the worktree's path as you see it (any folder inside it works) or the branch checked out there. Only worktrees git lists for this repository are accepted.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Absolute path of the worktree, or of any folder inside it, as seen where you run commands.'),
        branch: z.string().optional().describe('Branch checked out in the worktree; used when path is not given.'),
        clear: z.boolean().optional().describe('Go back to the main checkout.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args: { path?: string; branch?: string; clear?: boolean }, extra: { signal?: AbortSignal }) => {
      const chat = input.chat();
      const clear = args.clear === true || (!args.path?.trim() && !args.branch?.trim());
      const result = await input.requestJson(
        `/api/drones/${encodeURIComponent(chat.droneId)}/chats/${encodeURIComponent(chat.chatName)}/worktree`,
        {
          method: 'POST',
          body: JSON.stringify(clear ? { clear: true } : { path: args.path, branch: args.branch }),
          ...(extra?.signal ? { signal: extra.signal } : {}),
        },
      );
      const data = {
        worktree: result?.main ? null : (result?.worktree ?? null),
        mainCheckout: Boolean(result?.main),
        message: result?.main
          ? 'The Changes explorer shows the main checkout for this chat.'
          : `The Changes explorer can now follow this chat to ${result?.worktree?.path}${result?.worktree?.branch ? ` (${result.worktree.branch})` : ''}.`,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  );
}
