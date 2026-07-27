import { Type } from '@mariozechner/pi-ai';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createProfileTools } from './tools.js';
import { assertWorkspacePath } from './path-utils.js';
import type {
  BlipTool,
  BlipToolContext,
  FileOperationKind,
  PermissionMode,
  ToolProfile,
} from './types.js';
import {
  capabilityForWorkspaceTool,
  isWorkspaceTransferTemporaryName,
  WorkspaceTargetCatalog,
  type WorkspaceCapability,
  type WorkspaceTarget,
  type WorkspaceTargetCall,
  type WorkspaceTargetDescriptor,
} from './workspace-target-catalog.js';
export * from './workspace-target-catalog.js';

function isInsideWorkspace(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<boolean> {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (result.bytesRead <= 0) return false;
    read += result.bytesRead;
  }
  return true;
}

async function writeTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(buffer, written, buffer.length - written, position + written);
    if (result.bytesWritten <= 0) throw new Error('destination stopped writing transfer data');
    written += result.bytesWritten;
  }
}

async function existingWorkspaceTransferPath(root: string, relativePath: string): Promise<string> {
  const realRoot = await realpath(root);
  const target = await realpath(assertWorkspacePath(realRoot, relativePath));
  if (!isInsideWorkspace(realRoot, target))
    throw Object.assign(new Error(`path escapes workspace: ${relativePath}`), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return target;
}

async function writableWorkspaceTransferPath(root: string, relativePath: string): Promise<string> {
  const realRoot = await realpath(root);
  const target = assertWorkspacePath(realRoot, relativePath);
  if (target === realRoot) return target;
  let ancestor = path.dirname(target);
  while (ancestor !== realRoot) {
    try {
      const resolvedAncestor = await realpath(ancestor);
      if (!isInsideWorkspace(realRoot, resolvedAncestor)) throw new Error('outside workspace');
      break;
    } catch (error: any) {
      if (error?.code !== 'ENOENT')
        throw Object.assign(new Error(`path escapes workspace: ${relativePath}`), {
          code: 'PATH_OUTSIDE_ROOT',
        });
      ancestor = path.dirname(ancestor);
    }
  }
  const existing = await realpath(target).catch((error: any) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && !isInsideWorkspace(realRoot, existing))
    throw Object.assign(new Error(`path escapes workspace: ${relativePath}`), {
      code: 'PATH_OUTSIDE_ROOT',
    });
  return target;
}

export function capabilitiesForProfile(profile: ToolProfile): WorkspaceCapability[] {
  return Array.from(
    new Set(
      createProfileTools({
        workspaceRoot: process.cwd(),
        permissionMode: profile === 'read-only' ? 'read-only' : 'workspace-write',
        profile,
      })
        .map((tool) => capabilityForWorkspaceTool(tool.name))
        .filter((capability): capability is WorkspaceCapability => Boolean(capability)),
    ),
  );
}

export class LocalWorkspaceTarget implements WorkspaceTarget {
  readonly descriptor: WorkspaceTargetDescriptor;
  readonly transfer;
  private readonly tools: Map<string, BlipTool>;

  constructor(input: {
    id?: string;
    label?: string;
    workspaceRoot: string;
    permissionMode: PermissionMode;
    profile: ToolProfile;
    onFileOperation?: (kind: FileOperationKind, path: string) => void;
  }) {
    this.descriptor = {
      id: input.id ?? 'local',
      kind: 'local',
      label: input.label ?? 'Local workspace',
      rootLabel: input.workspaceRoot,
      capabilities: capabilitiesForProfile(input.profile),
    };
    this.tools = new Map(
      createProfileTools({
        workspaceRoot: input.workspaceRoot,
        permissionMode: input.permissionMode,
        profile: input.profile,
        onFileOperation: input.onFileOperation,
      }).map((tool) => [tool.name, tool]),
    );
    const transferTempPath = (targetPath: string, transferId: string) =>
      path.join(path.dirname(targetPath), `.blip-transfer-${transferId}.part`);
    const canRead = this.descriptor.capabilities.includes('files.read');
    const canWrite = this.descriptor.capabilities.includes('files.write');
    this.transfer = {
      ...(canRead
        ? {
            source: {
              stat: async (relativePath: string) => {
                const info = await stat(
                  await existingWorkspaceTransferPath(input.workspaceRoot, relativePath),
                );
                if (!info.isFile() && !info.isDirectory())
                  throw new Error(`transfer source is not a file or directory: ${relativePath}`);
                return {
                  type: info.isDirectory() ? ('directory' as const) : ('file' as const),
                  size: info.isFile() ? info.size : 0,
                  mtimeMs: info.mtimeMs,
                };
              },
              list: async (relativePath: string) => {
                const directory = await existingWorkspaceTransferPath(
                  input.workspaceRoot,
                  relativePath,
                );
                const entries = await readdir(directory, { withFileTypes: true });
                return await Promise.all(
                  entries
                    .flatMap((entry) =>
                      (entry.isFile() || entry.isDirectory()) &&
                      !isWorkspaceTransferTemporaryName(entry.name)
                        ? [entry]
                        : [],
                    )
                    .map(async (entry) => {
                      const info = await stat(path.join(directory, entry.name));
                      return {
                        name: entry.name,
                        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
                        size: entry.isFile() ? info.size : 0,
                        mtimeMs: info.mtimeMs,
                      };
                    }),
                );
              },
              readChunk: async (relativePath: string, offset: number, length: number) => {
                const file = await open(
                  await existingWorkspaceTransferPath(input.workspaceRoot, relativePath),
                  'r',
                );
                try {
                  const buffer = Buffer.alloc(length);
                  const { bytesRead } = await file.read(buffer, 0, length, offset);
                  return {
                    dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
                    bytes: bytesRead,
                  };
                } finally {
                  await file.close();
                }
              },
            },
          }
        : {}),
      ...(canWrite
        ? {
            destination: {
              createDirectory: async (relativePath: string) => {
                await mkdir(
                  await writableWorkspaceTransferPath(input.workspaceRoot, relativePath),
                  {
                    recursive: true,
                  },
                );
              },
              prepareFile: async ({
                path: relativePath,
                transferId,
                size,
                overwrite,
              }: {
                path: string;
                transferId: string;
                size: number;
                overwrite: boolean;
              }) => {
                const target = await writableWorkspaceTransferPath(
                  input.workspaceRoot,
                  relativePath,
                );
                const existing = await stat(target).catch((error: any) => {
                  if (error?.code === 'ENOENT') return null;
                  throw error;
                });
                if (existing && !existing.isFile())
                  throw Object.assign(
                    new Error(`destination path is not a file: ${relativePath}`),
                    { code: 'INVALID_REQUEST' },
                  );
                if (existing && !overwrite) {
                  const error = Object.assign(
                    new Error(`destination already exists: ${relativePath}`),
                    {
                      code: 'FILE_EXISTS',
                    },
                  );
                  throw error;
                }
                await mkdir(path.dirname(target), { recursive: true });
                const temp = transferTempPath(target, transferId);
                const tempInfo = await lstat(temp).catch((error: any) => {
                  if (error?.code === 'ENOENT') return null;
                  throw error;
                });
                if (!tempInfo) {
                  const handle = await open(temp, 'wx');
                  await handle.close();
                  return { offset: 0 };
                }
                if (!tempInfo.isFile() || tempInfo.size > size) {
                  await rm(temp, { force: true });
                  const handle = await open(temp, 'wx');
                  await handle.close();
                  return { offset: 0 };
                }
                return { offset: tempInfo.size };
              },
              writeChunk: async ({
                path: relativePath,
                transferId,
                offset,
                dataBase64,
              }: {
                path: string;
                transferId: string;
                offset: number;
                dataBase64: string;
              }) => {
                const target = await writableWorkspaceTransferPath(
                  input.workspaceRoot,
                  relativePath,
                );
                const temp = transferTempPath(target, transferId);
                const data = Buffer.from(dataBase64, 'base64');
                const tempInfo = await lstat(temp);
                if (!tempInfo.isFile())
                  throw Object.assign(new Error('transfer temporary path is not a file'), {
                    code: 'INVALID_REQUEST',
                  });
                const handle = await open(temp, 'r+');
                try {
                  const info = await handle.stat();
                  if (info.size === offset + data.length) {
                    const existing = Buffer.alloc(data.length);
                    if (
                      (await readTransferBytes(handle, existing, offset)) &&
                      existing.equals(data)
                    )
                      return { offset: info.size };
                  }
                  if (info.size !== offset)
                    throw new Error(
                      `transfer offset mismatch: expected ${info.size}, received ${offset}`,
                    );
                  await writeTransferBytes(handle, data, offset);
                  await handle.sync();
                  return { offset: offset + data.length };
                } finally {
                  await handle.close();
                }
              },
              commitFile: async ({
                path: relativePath,
                transferId,
                size,
                overwrite,
              }: {
                path: string;
                transferId: string;
                size: number;
                overwrite: boolean;
              }) => {
                const target = await writableWorkspaceTransferPath(
                  input.workspaceRoot,
                  relativePath,
                );
                const temp = transferTempPath(target, transferId);
                const info = await lstat(temp).catch((error: any) => {
                  if (error?.code !== 'ENOENT') throw error;
                  return null;
                });
                if (!info) {
                  const committed = await stat(target).catch(() => null);
                  if (committed?.isFile() && committed.size === size) return;
                  throw new Error('transfer temporary file was not found');
                }
                if (!info.isFile())
                  throw Object.assign(new Error('transfer temporary path is not a file'), {
                    code: 'INVALID_REQUEST',
                  });
                if (info.size !== size)
                  throw new Error(
                    `incomplete transfer: expected ${size} bytes, received ${info.size}`,
                  );
                if (!overwrite) {
                  const existing = await stat(target).catch((error: any) => {
                    if (error?.code === 'ENOENT') return null;
                    throw error;
                  });
                  if (existing)
                    throw Object.assign(new Error(`destination already exists: ${relativePath}`), {
                      code: 'FILE_EXISTS',
                    });
                }
                await rename(temp, target);
              },
              abortFile: async ({
                path: relativePath,
                transferId,
              }: {
                path: string;
                transferId: string;
              }) => {
                const target = await writableWorkspaceTransferPath(
                  input.workspaceRoot,
                  relativePath,
                );
                await rm(transferTempPath(target, transferId), { force: true });
              },
            },
          }
        : {}),
    };
  }

  async execute(call: WorkspaceTargetCall): Promise<AgentToolResult<unknown>> {
    const tool = this.tools.get(call.tool);
    if (!tool)
      throw new Error(`workspace target ${this.descriptor.id} does not support ${call.tool}`);
    return tool.execute(call.callId, call.args as never, call.signal, call.onUpdate);
  }
}

function withTargetDetails(
  result: AgentToolResult<unknown>,
  target: WorkspaceTargetDescriptor,
): AgentToolResult<unknown> {
  const details = result.details;
  return {
    ...result,
    details:
      details && typeof details === 'object' && !Array.isArray(details)
        ? { ...details, target }
        : { value: details, target },
  };
}

/** Creates the canonical coding tools and dispatches each call through one frozen target resolution. */
export function createWorkspaceTargetTools(input: {
  profile: ToolProfile;
  includeShell?: boolean;
  catalog?: WorkspaceTargetCatalog;
  resolveTarget?: (targetId?: string) => WorkspaceTarget | Promise<WorkspaceTarget>;
  exposeTargetParameter?: boolean;
}): BlipTool[] {
  if (!input.catalog && !input.resolveTarget)
    throw new Error('workspace target tools require a catalog or target resolver');
  const context = {
    workspaceRoot: process.cwd(),
    permissionMode: input.profile === 'read-only' ? 'read-only' : 'workspace-write',
    profile: input.profile,
  } as BlipToolContext;
  const definitions = createProfileTools(context);
  if (input.includeShell && !definitions.some((tool) => tool.name === 'bash')) {
    const bash = createProfileTools({ ...context, profile: 'local-trusted-write' }).find(
      (tool) => tool.name === 'bash',
    );
    if (bash) definitions.push(bash);
  }
  const exposeTargetParameter = input.exposeTargetParameter ?? (input.catalog?.size() ?? 0) > 1;
  return definitions.map((definition) => {
    const properties = (definition.parameters as { properties?: Record<string, any> }).properties;
    if (!properties)
      throw new Error(`workspace tool ${definition.name} must use an object parameter schema`);
    const parameters = Type.Object(
      {
        ...properties,
        ...(exposeTargetParameter
          ? {
              target: Type.Optional(
                Type.String({
                  description: 'Optional workspace target id; omitted calls use the active target.',
                }),
              ),
            }
          : {}),
      },
      { additionalProperties: false },
    );
    return {
      ...definition,
      parameters,
      async execute(callId, args: any, signal, onUpdate) {
        const invocation = input.catalog?.beginCall(
          exposeTargetParameter ? args.target : undefined,
        );
        try {
          const target =
            invocation?.target ??
            (await input.resolveTarget!(exposeTargetParameter ? args.target : undefined));
          const capability = capabilityForWorkspaceTool(definition.name);
          if (capability && !target.descriptor.capabilities.includes(capability)) {
            throw new Error(
              `workspace target ${target.descriptor.id} lacks capability ${capability}`,
            );
          }
          const { target: _target, ...targetArgs } = args;
          const result = await target.execute({
            callId,
            tool: definition.name,
            args: targetArgs,
            signal,
            onUpdate: onUpdate as ((result: AgentToolResult<unknown>) => void) | undefined,
          });
          if ('suspended' in result && result.suspended) return result;
          return withTargetDetails(result as AgentToolResult<unknown>, target.descriptor);
        } finally {
          invocation?.release();
        }
      },
    };
  }) as BlipTool[];
}

/** Creates explicit discovery and selection tools for hosts with multiple workspace targets. */
export function createWorkspaceTargetSelectionTools(catalog: WorkspaceTargetCatalog): BlipTool[] {
  if (catalog.size() <= 1) return [];
  return [
    {
      name: 'list_targets',
      label: 'List workspace targets',
      description: 'List available workspace targets and identify the active default target.',
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const active = catalog.active();
        const targets = catalog.list();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ activeTargetId: active?.id ?? null, targets }, null, 2),
            },
          ],
          details: { activeTargetId: active?.id ?? null, targets },
        };
      },
    },
    {
      name: 'set_target',
      label: 'Set workspace target',
      description:
        'Set the active default workspace target for later file, patch, Git, and shell calls.',
      parameters: Type.Object(
        { target: Type.String({ description: 'Workspace target id returned by list_targets.' }) },
        { additionalProperties: false },
      ),
      async execute(_callId, args: any) {
        const target = await catalog.setActiveForTool(String(args.target ?? '').trim());
        return {
          content: [
            {
              type: 'text' as const,
              text: `Active workspace target set to ${target.label} (${target.id}).`,
            },
          ],
          details: { target },
        };
      },
    },
  ] as BlipTool[];
}
