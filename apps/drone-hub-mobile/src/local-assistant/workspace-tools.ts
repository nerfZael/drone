import {
  WorkspaceTargetCatalog,
  type WorkspaceCapability,
  type WorkspaceTarget,
  type WorkspaceTargetCall,
} from '@blip/tools/workspace-target-catalog';
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
    const targets = workspaceChoices(thread.workspaceTargets).map(
      (choice) => new MobileWorkspaceTarget(choice.target, choice.handle, request),
    );
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
    this.tools = [...selectionTools, ...workspaceTools];
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
    const definition = definitions[name];
    if (!definition) throw new Error(`Unsupported workspace tool: ${input.name}`);
    const requestedTarget = String(input.args.target ?? input.args.workspace ?? '').trim();
    let targetId = requestedTarget;
    if (!targetId) {
      const active = this.catalog.active();
      if (active?.capabilities.includes(definition.capability)) targetId = active.id;
      else {
        const eligible = this.catalog
          .list()
          .filter((target) => target.capabilities.includes(definition.capability));
        if (eligible.length === 1) targetId = eligible[0].id;
      }
    }
    const invocation = this.catalog.beginCall(targetId);
    try {
      if (!invocation.target.descriptor.capabilities.includes(definition.capability))
        throw new Error(
          `Workspace target ${invocation.target.descriptor.label} does not allow ${name}`,
        );
      const { target: _target, workspace: _workspace, ...args } = input.args;
      const result = await invocation.target.execute({
        callId: `mobile_${Date.now()}`,
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
