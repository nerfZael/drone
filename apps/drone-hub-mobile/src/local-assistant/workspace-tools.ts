import type { LocalAssistantThread } from './local-assistant-types';

export type LocalAssistantTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type MeshRequest = (
  targetDeviceId: string,
  capability: string,
  operation: string,
  payload: unknown,
) => Promise<any>;

const tools: Record<string, LocalAssistantTool> = {
  list_files: {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories inside the selected remote workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative directory, or . for the root.' },
          limit: { type: 'number', description: 'Maximum entries to return.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  read_file: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the selected remote workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number', description: 'Zero-based first line.' },
          limit: { type: 'number', description: 'Maximum lines to return.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  search_files: {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file names or text content inside the selected remote workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          query: { type: 'string' },
          mode: { type: 'string', enum: ['name', 'content'] },
          limit: { type: 'number' },
        },
        required: ['path', 'query', 'mode'],
        additionalProperties: false,
      },
    },
  },
  write_file: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a text file in the selected remote workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['create', 'overwrite'] },
          baseHash: {
            type: 'string',
            description: 'Optional SHA-256 returned by read_file to prevent overwriting changes.',
          },
        },
        required: ['path', 'content', 'mode'],
        additionalProperties: false,
      },
    },
  },
};

export function workspaceToolsForThread(thread: LocalAssistantThread): LocalAssistantTool[] {
  const target = thread.workspaceTarget;
  if (!target) return [];
  return [
    ...(target.read ? [tools.list_files, tools.read_file, tools.search_files] : []),
    ...(target.write ? [tools.write_file] : []),
  ];
}

export async function executeWorkspaceTool(input: {
  thread: LocalAssistantThread;
  phoneDeviceId: string;
  name: string;
  args: Record<string, unknown>;
  request: MeshRequest;
}): Promise<{ text: string; details: unknown }> {
  const target = input.thread.workspaceTarget;
  if (!target) throw new Error('This thread has no remote workspace');
  const operation = {
    list_files: 'files.list',
    read_file: 'files.read',
    search_files: 'files.search',
    write_file: 'files.write',
  }[input.name];
  if (
    !operation ||
    !workspaceToolsForThread(input.thread).some((tool) => tool.function.name === input.name)
  )
    throw new Error(`Tool is not allowed for this thread: ${input.name}`);
  const result = await input.request(target.targetDeviceId, 'workspace', operation, {
    ...input.args,
    actor: {
      assistantHomeDeviceId: input.phoneDeviceId,
      threadId: input.thread.id,
      rootId: target.rootId,
      read: target.read,
      write: target.write,
    },
  });
  return {
    text: String(result?.text ?? '').slice(0, 24_000),
    details: result?.details ?? null,
  };
}
