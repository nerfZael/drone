import {
  WorkspaceTargetCatalog,
  type WorkspaceCapability,
  type WorkspaceTarget,
  type WorkspaceTargetCall,
} from '@blip/workspace';
import { runWorkspaceTransfer } from '@blip/workspace';
import { createPortableId } from '@blip/core';
import { runWorkspaceCommandJob } from '@drone/device-protocol';
import type { LocalAssistantThread, LocalWorkspaceTarget } from './local-assistant-types';

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
  signal?: AbortSignal,
) => Promise<any>;

const definitions: Record<
  string,
  {
    capability: WorkspaceCapability;
    description: string;
    properties: Record<string, unknown>;
    required: string[];
  }
> = {
  list_files: {
    capability: 'files.list',
    description: 'List files and directories inside a selected remote workspace.',
    properties: {
      path: { type: 'string', description: 'Workspace-relative directory, or . for the root.' },
      limit: { type: 'number', description: 'Maximum entries to return.' },
    },
    required: ['path'],
  },
  read_file: {
    capability: 'files.read',
    description: 'Read a text file from a selected remote workspace.',
    properties: {
      path: { type: 'string' },
      offset: { type: 'number', description: 'Zero-based first line.' },
      limit: { type: 'number', description: 'Maximum lines to return.' },
    },
    required: ['path'],
  },
  search_files: {
    capability: 'files.search',
    description: 'Search file names or text content inside a selected remote workspace.',
    properties: {
      path: { type: 'string' },
      query: { type: 'string' },
      mode: { type: 'string', enum: ['name', 'content'] },
      limit: { type: 'number' },
    },
    required: ['path', 'query', 'mode'],
  },
  write_file: {
    capability: 'files.write',
    description: 'Create or overwrite a text file in a selected remote workspace.',
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
  },
  bash: {
    capability: 'shell.execute',
    description:
      'Run Bash on a selected device, starting in the selected workspace. The command is not confined to that folder.',
    properties: {
      command: { type: 'string' },
      timeoutMs: {
        type: 'number',
        minimum: 1_000,
        maximum: 3_600_000,
        description: 'Timeout in milliseconds; defaults to 30 minutes and is capped at one hour.',
      },
    },
    required: ['command'],
  },
};

const operationForTool: Record<string, string> = {
  list_files: 'files.list',
  read_file: 'files.read',
  search_files: 'files.search',
  write_file: 'files.write',
};

export function workspaceHandle(target: LocalWorkspaceTarget): string {
  return `${target.deviceName} / ${target.workspaceName}`;
}

function workspaceChoices(targets: LocalWorkspaceTarget[]) {
  const totals = new Map<string, number>();
  for (const target of targets) {
    const base = workspaceHandle(target);
    totals.set(base, (totals.get(base) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  return targets.map((target) => {
    const base = workspaceHandle(target);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      target,
      handle: totals.get(base) === 1 ? base : `${base} (${occurrence})`,
    };
  });
}

class MobileWorkspaceTarget implements WorkspaceTarget {
  readonly descriptor;
  readonly transfer;

  constructor(
    readonly policy: LocalWorkspaceTarget,
    id: string,
    private readonly request: MeshRequest,
  ) {
    this.descriptor = {
      id,
      kind: 'remote-device' as const,
      label: id,
      rootLabel: policy.workspaceName,
      capabilities: [
        ...(policy.read ? (['files.list', 'files.read', 'files.search'] as const) : []),
        ...(policy.write ? (['files.write'] as const) : []),
        ...(policy.execute ? (['shell.execute'] as const) : []),
      ],
    };
    const transferRequest = (
      operation: string,
      payload: Record<string, unknown>,
      signal?: AbortSignal,
    ) =>
      this.request(
        this.policy.targetDeviceId,
        'workspace',
        operation,
        {
          ...payload,
          workspaceId: this.policy.workspaceId,
        },
        signal,
      );
    this.transfer = {
      ...(policy.read
        ? {
            source: {
              stat: (path: string, signal?: AbortSignal) =>
                transferRequest('files.transfer.stat', { path }, signal),
              list: async (path: string, signal?: AbortSignal) =>
                (await transferRequest('files.transfer.list', { path }, signal)).entries,
              readChunk: (path: string, offset: number, length: number, signal?: AbortSignal) =>
                transferRequest('files.transfer.read', { path, offset, length }, signal),
            },
          }
        : {}),
      ...(policy.write
        ? {
            destination: {
              createDirectory: async (path: string, signal?: AbortSignal) => {
                await transferRequest('files.transfer.mkdir', { path }, signal);
              },
              prepareFile: (input: Record<string, unknown>, signal?: AbortSignal) =>
                transferRequest('files.transfer.prepare', input, signal),
              writeChunk: (input: Record<string, unknown>, signal?: AbortSignal) =>
                transferRequest('files.transfer.write', input, signal),
              commitFile: async (input: Record<string, unknown>, signal?: AbortSignal) => {
                await transferRequest('files.transfer.commit', input, signal);
              },
              abortFile: async (input: Record<string, unknown>, signal?: AbortSignal) => {
                await transferRequest('files.transfer.abort', input, signal);
              },
            },
          }
        : {}),
    };
  }

  async execute(call: WorkspaceTargetCall): Promise<any> {
    if (call.tool === 'bash') {
      const result = await runWorkspaceCommandJob({
        workspaceId: this.policy.workspaceId,
        command: String(call.args.command ?? ''),
        timeoutMs: typeof call.args.timeoutMs === 'number' ? call.args.timeoutMs : undefined,
        signal: call.signal,
        request: (operation, payload, signal) =>
          this.request(this.policy.targetDeviceId, 'workspace', operation, payload, signal),
        onOutput: (update) =>
          call.onUpdate?.({
            content: [{ type: 'text', text: update.text }],
            details: { ...update.job, target: this.descriptor },
          }),
      });
      return {
        content: [{ type: 'text', text: result.text }],
        details: { ...result.details, target: this.descriptor },
      };
    }
    const operation = operationForTool[call.tool];
    if (!operation) throw new Error(`Unsupported workspace tool: ${call.tool}`);
    const result = await this.request(
      this.policy.targetDeviceId,
      'workspace',
      operation,
      { ...call.args, workspaceId: this.policy.workspaceId },
      call.signal,
    );
    return {
      content: [{ type: 'text', text: String(result?.text ?? '') }],
      details: { ...(result?.details ?? {}), target: this.descriptor },
    };
  }
}

function artifactPathParts(value: unknown): string[] {
  const path = String(value ?? '.').trim().replace(/\\/g, '/');
  if (!path || path === '.') return [];
  if (path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Artifact paths must be workspace-relative and cannot contain . or ..');
  }
  return path.split('/');
}

class MobileArtifactsTarget implements WorkspaceTarget {
  readonly descriptor;

  constructor(threadId: string) {
    this.descriptor = {
      id: 'Assistant Artifacts',
      kind: 'local' as const,
      label: 'Assistant Artifacts',
      rootLabel: 'Assistant Artifacts',
      capabilities: ['files.list', 'files.read', 'files.search', 'files.write'] as WorkspaceCapability[],
    };
    this.threadId = threadId;
  }

  private readonly threadId: string;

  private directory(root: any, Directory: any, parts: string[]): any {
    return parts.length === 0 ? root : new Directory(root, ...parts);
  }

  private file(root: any, File: any, parts: string[]): any {
    if (parts.length === 0) throw new Error('A file path is required');
    return new File(root, ...parts);
  }

  private async search(directory: any, Directory: any, File: any, base: string, query: string, mode: string, output: string[], limit: number): Promise<void> {
    if (output.length >= limit || !directory.exists) return;
    for (const entry of directory.list()) {
      if (output.length >= limit) return;
      const relative = base ? `${base}/${entry.name}` : entry.name;
      if (entry instanceof Directory) {
        if (mode === 'name' && entry.name.toLowerCase().includes(query)) output.push(`${relative}/`);
        await this.search(entry, Directory, File, relative, query, mode, output, limit);
      } else if (entry instanceof File) {
        if (mode === 'name' && entry.name.toLowerCase().includes(query)) output.push(relative);
        if (mode === 'content' && (await entry.text()).toLowerCase().includes(query)) output.push(relative);
      }
    }
  }

  async execute(call: WorkspaceTargetCall): Promise<any> {
    // Expo's filesystem module loads React Native bindings, so defer it until an artifact tool is
    // actually used. This also keeps the portable workspace runtime testable outside Android.
    const { Directory, File, Paths } = await import('expo-file-system');
    const root = new Directory(Paths.document, 'drone-hub-native-artifacts-v1', encodeURIComponent(this.threadId));
    root.create({ idempotent: true, intermediates: true });
    const parts = artifactPathParts(call.args.path);
    if (call.tool === 'list_files') {
      const directory = this.directory(root, Directory, parts);
      if (!directory.exists) throw new Error(`Artifact directory not found: ${parts.join('/') || '.'}`);
      const limit = Math.max(1, Math.min(1000, Number(call.args.limit) || 200));
      const entries = directory.list().slice(0, limit).map((entry: any) => ({
        name: entry.name,
        type: entry instanceof Directory ? 'directory' : 'file',
        ...(entry instanceof File ? { size: entry.size } : {}),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }], details: { entries, target: this.descriptor } };
    }
    if (call.tool === 'read_file') {
      const file = this.file(root, File, parts);
      if (!file.exists) throw new Error(`Artifact file not found: ${parts.join('/')}`);
      const lines = (await file.text()).split('\n');
      const offset = Math.max(0, Number(call.args.offset) || 0);
      const limit = Math.max(1, Math.min(5000, Number(call.args.limit) || 1000));
      const text = lines.slice(offset, offset + limit).join('\n');
      return { content: [{ type: 'text', text }], details: { path: parts.join('/'), offset, lines: Math.min(limit, Math.max(0, lines.length - offset)), target: this.descriptor } };
    }
    if (call.tool === 'search_files') {
      const directory = this.directory(root, Directory, parts);
      const query = String(call.args.query ?? '').toLowerCase();
      if (!query) throw new Error('A search query is required');
      const mode = call.args.mode === 'content' ? 'content' : 'name';
      const matches: string[] = [];
      await this.search(directory, Directory, File, parts.join('/'), query, mode, matches, Math.max(1, Math.min(500, Number(call.args.limit) || 100)));
      return { content: [{ type: 'text', text: matches.join('\n') }], details: { matches, target: this.descriptor } };
    }
    if (call.tool === 'write_file') {
      const file = this.file(root, File, parts);
      if (call.args.mode === 'create' && file.exists) throw new Error(`Artifact file already exists: ${parts.join('/')}`);
      const parentParts = parts.slice(0, -1);
      if (parentParts.length > 0) this.directory(root, Directory, parentParts).create({ idempotent: true, intermediates: true });
      file.create({ overwrite: true, intermediates: true });
      file.write(String(call.args.content ?? ''));
      return { content: [{ type: 'text', text: `Wrote ${parts.join('/')}.` }], details: { path: parts.join('/'), size: file.size, target: this.descriptor } };
    }
    throw new Error(`Unsupported artifact tool: ${call.tool}`);
  }
}

function textFromResult(result: any): string {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => String(part.text ?? ''))
    .join('\n')
    .slice(-96_000);
}

export class MobileWorkspaceToolRuntime {
  readonly tools: LocalAssistantTool[];
  private readonly catalog: WorkspaceTargetCatalog;

  constructor(thread: LocalAssistantThread, request: MeshRequest) {
    const targets: WorkspaceTarget[] = [...workspaceChoices(thread.workspaceTargets).map(
      (choice) => new MobileWorkspaceTarget(choice.target, choice.handle, request),
    ), ...(thread.artifactWorkspace ? [new MobileArtifactsTarget(thread.id)] : [])];
    this.catalog = new WorkspaceTargetCatalog(targets);
    const descriptors = this.catalog.list();
    const workspaceTools = Object.entries(definitions).flatMap(([name, definition]) => {
      const eligible = descriptors.filter((target) =>
        target.capabilities.includes(definition.capability),
      );
      if (eligible.length === 0) return [];
      return [
        {
          type: 'function' as const,
          function: {
            name,
            description: definition.description,
            parameters: {
              type: 'object',
              properties: {
                ...(descriptors.length > 1
                  ? {
                      target: {
                        type: 'string',
                        enum: eligible.map((target) => target.id),
                        description:
                          'Optional workspace target; omitted calls use the active target.',
                      },
                    }
                  : {}),
                ...definition.properties,
              },
              required: definition.required,
              additionalProperties: false,
            },
          },
        },
      ];
    });
    const transferSources = descriptors.filter((target) =>
      Boolean(this.catalog.resolve(target.id).transfer?.source),
    );
    const transferDestinations = descriptors.filter((target) =>
      Boolean(this.catalog.resolve(target.id).transfer?.destination),
    );
    const transferTools: LocalAssistantTool[] =
      descriptors.length > 1 && transferSources.length > 0 && transferDestinations.length > 0
        ? [
            {
              type: 'function',
              function: {
                name: 'transfer_files',
                description:
                  'Copy one file or a folder between different workspace targets. Requires read access on the source and write access on the destination.',
                parameters: {
                  type: 'object',
                  properties: {
                    sourceTarget: {
                      type: 'string',
                      enum: transferSources.map((target) => target.id),
                    },
                    sourcePath: { type: 'string' },
                    destinationTarget: {
                      type: 'string',
                      enum: transferDestinations.map((target) => target.id),
                    },
                    destinationPath: { type: 'string' },
                    overwrite: { type: 'boolean' },
                    resumeToken: {
                      type: 'string',
                      description:
                        'Token returned by a partially completed transfer. Reuse it with the same source and destination.',
                    },
                  },
                  required: ['sourceTarget', 'sourcePath', 'destinationTarget', 'destinationPath'],
                  additionalProperties: false,
                },
              },
            },
          ]
        : [];
    const selectionTools: LocalAssistantTool[] =
      descriptors.length > 1
        ? [
            {
              type: 'function',
              function: {
                name: 'list_targets',
                description: 'List workspace targets and identify the active default target.',
                parameters: { type: 'object', properties: {}, additionalProperties: false },
              },
            },
            {
              type: 'function',
              function: {
                name: 'set_target',
                description:
                  'Choose the active default target for later filesystem and Bash calls.',
                parameters: {
                  type: 'object',
                  properties: {
                    target: { type: 'string', enum: descriptors.map((target) => target.id) },
                  },
                  required: ['target'],
                  additionalProperties: false,
                },
              },
            },
          ]
        : [];
    this.tools = [...selectionTools, ...workspaceTools, ...transferTools];
  }

  private resolveTargetId(
    capability: WorkspaceCapability,
    args: Record<string, unknown>,
  ): string {
    const requestedTarget = String(args.target ?? args.workspace ?? '').trim();
    let targetId = requestedTarget;
    if (!targetId) {
      const active = this.catalog.active();
      if (active?.capabilities.includes(capability)) targetId = active.id;
      else {
        const eligible = this.catalog
          .list()
          .filter((target) => target.capabilities.includes(capability));
        if (eligible.length === 1) targetId = eligible[0].id;
      }
    }
    const target = this.catalog.resolve(targetId).descriptor;
    if (!target.capabilities.includes(capability))
      throw new Error(`Workspace target ${target.label} does not allow ${capability}`);
    return target.id;
  }

  resolveExecutionApproval(args: Record<string, unknown>) {
    const target = this.catalog.resolve(this.resolveTargetId('shell.execute', args)).descriptor;
    return {
      requested: args,
      resolved: {
        targetId: target.id,
        targetLabel: target.label,
        targetKind: target.kind,
        command: String(args.command ?? ''),
        timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 30 * 60_000,
      },
    };
  }

  async execute(input: {
    name: string;
    args: Record<string, unknown>;
    signal?: AbortSignal;
    onOutput?: (update: { text: string; details: unknown }) => void | Promise<void>;
  }): Promise<{ text: string; details: unknown }> {
    const name = input.name === 'run_command' ? 'bash' : input.name;
    if (name === 'list_targets') {
      const details = {
        activeTargetId: this.catalog.active()?.id ?? null,
        targets: this.catalog.list(),
      };
      return { text: JSON.stringify(details, null, 2), details };
    }
    if (name === 'set_target') {
      const target = await this.catalog.setActiveForTool(String(input.args.target ?? ''));
      return { text: `Active workspace target set to ${target.label}.`, details: { target } };
    }
    if (name === 'transfer_files') {
      const result = await runWorkspaceTransfer({
        catalog: this.catalog,
        callId: `mobile_${createPortableId()}`,
        sourceTarget: String(input.args.sourceTarget ?? ''),
        sourcePath: String(input.args.sourcePath ?? ''),
        destinationTarget: String(input.args.destinationTarget ?? ''),
        destinationPath: String(input.args.destinationPath ?? ''),
        overwrite: input.args.overwrite === true,
        resumeToken: String(input.args.resumeToken ?? '').trim() || undefined,
        signal: input.signal,
        onUpdate: (update) =>
          void input.onOutput?.({ text: textFromResult(update), details: update.details }),
      });
      return { text: textFromResult(result), details: result.details };
    }
    const definition = definitions[name];
    if (!definition) throw new Error(`Unsupported workspace tool: ${input.name}`);
    const invocation = this.catalog.beginCall(this.resolveTargetId(definition.capability, input.args));
    try {
      const { target: _target, workspace: _workspace, ...args } = input.args;
      const result = await invocation.target.execute({
        callId: `mobile_${createPortableId()}`,
        tool: name,
        args,
        signal: input.signal,
        onUpdate: (update) =>
          void input.onOutput?.({ text: textFromResult(update), details: update.details }),
      });
      return { text: textFromResult(result), details: result.details };
    } finally {
      invocation.release();
    }
  }
}

export function createWorkspaceToolRuntime(thread: LocalAssistantThread, request: MeshRequest) {
  return new MobileWorkspaceToolRuntime(thread, request);
}

export function workspaceToolsForThread(thread: LocalAssistantThread): LocalAssistantTool[] {
  return new MobileWorkspaceToolRuntime(thread, async () => {
    throw new Error('Workspace request transport is unavailable');
  }).tools;
}

export async function executeWorkspaceTool(input: {
  thread: LocalAssistantThread;
  name: string;
  args: Record<string, unknown>;
  request: MeshRequest;
  signal?: AbortSignal;
  onOutput?: (update: { text: string; details: unknown }) => void | Promise<void>;
}) {
  return await new MobileWorkspaceToolRuntime(input.thread, input.request).execute(input);
}
