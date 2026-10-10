import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  workspaceToolDefinitions,
  type WorkspaceToolDefinition,
} from './assistant/workspace-tool-definitions';

type RequestJson = (pathname: string, init?: RequestInit, timeoutMs?: number) => Promise<any>;

/** Blip's parameter names, as the agent sees them: these tools act on workspaces, not on "targets". */
const RENAMED_PARAMETERS: Record<string, string> = {
  target: 'workspace',
  sourceTarget: 'sourceWorkspace',
  destinationTarget: 'destinationWorkspace',
};
const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  workspace: 'Workspace id from list_workspaces; omitted calls use the default workspace.',
  sourceWorkspace: 'Workspace id from list_workspaces to copy from.',
  destinationWorkspace: 'Workspace id from list_workspaces to copy to.',
};
const READ_ONLY_TOOLS = new Set([
  'list_workspaces',
  'read_file',
  'search_files',
  'list_files',
  'get_working_tree_status',
]);
const DESTRUCTIVE_TOOLS = new Set(['delete_file', 'delete_directory', 'move_path', 'bash']);
const TOOL_TIMEOUT_MS = 5 * 60_000;
// bash runs for up to an hour; a transfer is bounded by its file count rather than by time.
const LONG_TOOL_TIMEOUT_MS = 65 * 60_000;

export const AGENT_CHAT_WORKSPACE_TOOL_NAMES = [
  'list_workspaces',
  'read_file',
  'search_files',
  'list_files',
  'get_working_tree_status',
  'write_file',
  'apply_patch',
  'delete_file',
  'create_directory',
  'delete_directory',
  'move_path',
  'bash',
  'transfer_files',
] as const;

let definitions: Promise<WorkspaceToolDefinition[]> | null = null;

/** Loaded once (blip is ESM); the MCP transport awaits this before building a chat's tool list. */
export function loadAgentChatWorkspaceToolDefinitions(): Promise<WorkspaceToolDefinition[]> {
  definitions ??= workspaceToolDefinitions().catch((error) => {
    definitions = null;
    throw error;
  });
  return definitions;
}

// The HTTP transport builds a server per request; convert each definition's schema once.
const inputSchemas = new WeakMap<WorkspaceToolDefinition, unknown>();
function inputSchema(definition: WorkspaceToolDefinition): unknown {
  let schema = inputSchemas.get(definition);
  if (!schema) {
    schema = z.fromJSONSchema(renameParameters(JSON.parse(JSON.stringify(definition.parameters))) as any);
    inputSchemas.set(definition, schema);
  }
  return schema;
}

function renameParameters(parameters: Record<string, any>): Record<string, any> {
  const properties = Object.fromEntries(
    Object.entries(parameters.properties ?? {}).map(([key, value]: [string, any]) => {
      const name = RENAMED_PARAMETERS[key] ?? key;
      return [
        name,
        PARAMETER_DESCRIPTIONS[name] ? { ...value, description: PARAMETER_DESCRIPTIONS[name] } : value,
      ];
    }),
  );
  return {
    ...parameters,
    properties,
    ...(Array.isArray(parameters.required)
      ? { required: parameters.required.map((key: string) => RENAMED_PARAMETERS[key] ?? key) }
      : {}),
  };
}

function blipArgs(args: Record<string, unknown>): Record<string, unknown> {
  const renamed = Object.fromEntries(
    Object.entries(RENAMED_PARAMETERS).map(([blip, mcp]) => [mcp, blip]),
  );
  return Object.fromEntries(
    Object.entries(args ?? {}).map(([key, value]) => [renamed[key] ?? key, value]),
  );
}

function mcpContent(result: any): any[] {
  const content = (Array.isArray(result?.content) ? result.content : []).flatMap((part: any) =>
    part?.type === 'text'
      ? [{ type: 'text' as const, text: String(part.text ?? '') }]
      : part?.type === 'image' && typeof part.data === 'string'
        ? [{ type: 'image' as const, data: part.data, mimeType: String(part.mimeType ?? '') }]
        : [],
  );
  return content.length ? content : [{ type: 'text' as const, text: 'done' }];
}

/**
 * The chat's workspaces, as blip's workspace tools. The Hub runs each call against the chat's selection as it is at
 * that moment, so access changed in the Workspaces picker applies to the next call without restarting the agent.
 */
export function registerAgentChatWorkspaceTools(
  server: McpServer,
  input: {
    /** The chat the call is made for, read at call time. */
    chat: () => { droneId: string; chatName: string };
    definitions: WorkspaceToolDefinition[];
    requestJson: RequestJson;
  },
): void {
  const { requestJson } = input;
  const call = async (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    const chat = input.chat();
    const timeout =
      tool === 'transfer_files'
        ? LONG_TOOL_TIMEOUT_MS
        : tool === 'bash'
          ? Math.min(Number(args.timeoutMs) || 30 * 60_000, 60 * 60_000) + 5 * 60_000
          : TOOL_TIMEOUT_MS;
    const response = await requestJson(
      `/api/drones/${encodeURIComponent(chat.droneId)}/chats/${encodeURIComponent(chat.chatName)}/workspaces/tools/${encodeURIComponent(tool)}`,
      { method: 'POST', body: JSON.stringify({ args }), ...(signal ? { signal } : {}) },
      timeout,
    );
    if (typeof response?.error === 'string')
      return { content: [{ type: 'text' as const, text: response.error }], isError: true };
    return response?.result;
  };
  const annotations = (name: string) => ({
    readOnlyHint: READ_ONLY_TOOLS.has(name),
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: READ_ONLY_TOOLS.has(name),
    openWorldHint: false,
  });

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description:
        "List the workspaces this chat may use through the other DroneHub workspace tools: repositories and folders on this device, drone containers, and folders shared by other devices. Shows each workspace's id, what it allows (read, write, execute), the default, and which one is your own workspace.",
      inputSchema: {},
      annotations: annotations('list_workspaces'),
    },
    async (_args: unknown, extra: { signal?: AbortSignal }) => {
      const result = await call('list_workspaces', {}, extra?.signal);
      if (result?.isError) return result;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  for (const definition of input.definitions) {
    if (!AGENT_CHAT_WORKSPACE_TOOL_NAMES.includes(definition.name as any)) continue;
    server.registerTool(
      definition.name,
      {
        title: definition.name.replace(/_/g, ' '),
        description: `${definition.description} Acts on the workspaces this chat was given; see list_workspaces.`,
        inputSchema: inputSchema(definition) as any,
        annotations: annotations(definition.name),
      },
      async (args: Record<string, unknown>, extra: { signal?: AbortSignal }) => {
        const result = await call(definition.name, blipArgs(args), extra?.signal);
        return result?.isError ? result : { content: mcpContent(result) };
      },
    );
  }
}
