import { Type } from '@mariozechner/pi-ai';
import { runWorkspaceTransfer, type WorkspaceTargetCatalog } from '@blip/workspace';
import type { BlipTool } from './types.js';

export function createWorkspaceTransferTools(catalog: WorkspaceTargetCatalog): BlipTool[] {
  if (catalog.size() <= 1) return [];
  const descriptors = catalog.list();
  const sources = descriptors.filter((item) => catalog.resolve(item.id).transfer?.source);
  const destinations = descriptors.filter((item) => catalog.resolve(item.id).transfer?.destination);
  if (!sources.length || !destinations.length) return [];
  return [
    {
      name: 'transfer_files',
      label: 'Transfer files',
      description:
        'Copy one file or a folder between different workspace targets. Requires read access on the source and write access on the destination.',
      parameters: Type.Object(
        {
          sourceTarget: Type.String({ enum: sources.map((item) => item.id) }),
          sourcePath: Type.String({ description: 'Workspace-relative source file or folder.' }),
          destinationTarget: Type.String({ enum: destinations.map((item) => item.id) }),
          destinationPath: Type.String({ description: 'Workspace-relative destination path.' }),
          overwrite: Type.Optional(
            Type.Boolean({ description: 'Replace existing destination files. Defaults to false.' }),
          ),
          resumeToken: Type.Optional(
            Type.String({
              description:
                'Token returned by a partially completed transfer. Reuse it with the same source and destination to skip files already committed.',
            }),
          ),
        },
        { additionalProperties: false },
      ),
      execute: (callId, args: any, signal, onUpdate) =>
        runWorkspaceTransfer({
          catalog,
          callId,
          sourceTarget: String(args.sourceTarget ?? ''),
          sourcePath: String(args.sourcePath ?? ''),
          destinationTarget: String(args.destinationTarget ?? ''),
          destinationPath: String(args.destinationPath ?? ''),
          overwrite: args.overwrite === true,
          resumeToken: String(args.resumeToken ?? '').trim() || undefined,
          signal,
          onUpdate: onUpdate as any,
        }),
    },
  ] as BlipTool[];
}
