import { loadBlipTools } from './blip-runtime-loader';

export type WorkspaceToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Blip's workspace tools (names, descriptions, parameters) for consumers whose tool list is fixed while the selection
 * changes underneath it: the entity, and agent chats over the DroneHub MCP server. Every call names a target or goes
 * to the default; the workspace service checks the current selection at call time.
 */
export async function workspaceToolDefinitions(
  options: { transferExample?: string; transferDestinationHint?: string } = {},
): Promise<WorkspaceToolDefinition[]> {
  const blip: any = await loadBlipTools();
  return blip
    .createWorkspaceTargetTools({
      profile: 'no-shell-workspace-write',
      includeShell: true,
      resolveTarget: () => {
        throw new Error('definitions only');
      },
      exposeTargetParameter: true,
    })
    .map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
    .concat(transferDefinition(options));
}

/**
 * Copying between workspaces (a file or folder from one to another). Blip builds this tool per selection, listing the
 * workspace ids it allows; here the ids are plain strings, and the service's own tool checks read access on the
 * source and write access on the destination at call time.
 */
function transferDefinition({
  transferExample,
  transferDestinationHint,
}: {
  transferExample?: string;
  transferDestinationHint?: string;
}): WorkspaceToolDefinition {
  return {
    name: 'transfer_files',
    description: `Copy one file or a folder between two workspaces${transferExample ? ` (${transferExample})` : ''}. Needs Read on the source and Write on the destination.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceTarget', 'sourcePath', 'destinationTarget', 'destinationPath'],
      properties: {
        sourceTarget: { type: 'string', description: 'The workspace id to copy from' },
        sourcePath: { type: 'string', description: 'Workspace-relative source file or folder' },
        destinationTarget: {
          type: 'string',
          description: `The workspace id to copy to${transferDestinationHint ? ` (${transferDestinationHint})` : ''}`,
        },
        destinationPath: { type: 'string', description: 'Workspace-relative destination path' },
        overwrite: {
          type: 'boolean',
          description: 'Replace existing destination files. Defaults to false.',
        },
        resumeToken: {
          type: 'string',
          description:
            'Token returned by a partially completed transfer, to skip files already copied',
        },
      },
    },
  };
}
