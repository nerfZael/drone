import { createHttpWorkspaceAdapter } from '@drone/device-protocol';
import { createWorkspaceUploadSink } from '../../workspace-upload-sink';
import { runWorkspaceCommandJob, WORKSPACE_CAPABILITY } from '@drone/device-protocol';
import type { HomeWorkspaceTarget } from './policy-types';

type MeshRequest = (
  targetDeviceId: string,
  capability: string,
  operation: string,
  payload: unknown,
  signal?: AbortSignal,
) => Promise<any>;

const OPERATIONS: Record<string, string> = {
  list_files: 'files.list',
  read_file: 'files.read',
  search_files: 'files.search',
  write_file: 'files.write',
  bash: 'commands.run',
};

export class RemoteWorkspaceTarget {
  readonly descriptor: {
    id: string;
    kind: 'remote-device';
    label: string;
    rootLabel: string;
    capabilities: Array<
      'files.list' | 'files.read' | 'files.search' | 'files.write' | 'shell.execute'
    >;
  };
  readonly transfer;

  constructor(
    private readonly homeDeviceId: string,
    private readonly threadId: string,
    private readonly policy: HomeWorkspaceTarget,
    targetDeviceName: string,
    private readonly request: MeshRequest,
  ) {
    this.descriptor = {
      id: `remote:${policy.targetDeviceId}:${policy.rootId}`,
      kind: 'remote-device',
      label: `${targetDeviceName} · ${policy.workspaceName}`,
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
        WORKSPACE_CAPABILITY.id,
        operation,
        {
          ...payload,
          workspaceId: this.policy.rootId,
        },
        signal,
      );
    this.transfer = createHttpWorkspaceAdapter({
      request: transferRequest,
      read: policy.read,
      write: policy.write,
      createSink: createWorkspaceUploadSink,
    });
  }

  async execute(call: {
    tool: string;
    args: Record<string, unknown>;
    signal?: AbortSignal;
    onUpdate?: (result: any) => void;
  }): Promise<any> {
    const operation = OPERATIONS[call.tool];
    if (!operation)
      throw Object.assign(new Error(`remote workspace does not support ${call.tool}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    const result =
      call.tool === 'bash'
        ? await runWorkspaceCommandJob({
            workspaceId: this.policy.rootId,
            command: String(call.args.command ?? ''),
            timeoutMs: typeof call.args.timeoutMs === 'number' ? call.args.timeoutMs : undefined,
            signal: call.signal,
            request: (nextOperation, payload, signal) =>
              this.request(
                this.policy.targetDeviceId,
                WORKSPACE_CAPABILITY.id,
                nextOperation,
                payload,
                signal,
              ),
            onOutput: (update) =>
              call.onUpdate?.({
                content: [{ type: 'text', text: update.text }],
                details: { ...update.job, streaming: true },
              }),
          })
        : await this.request(
            this.policy.targetDeviceId,
            WORKSPACE_CAPABILITY.id,
            operation,
            {
              ...call.args,
              workspaceId: this.policy.rootId,
            },
            call.signal,
          );
    return {
      content: [{ type: 'text', text: String(result?.text ?? '') }],
      details: {
        ...(result?.details ?? {}),
        meshRoute: {
          assistantHomeDeviceId: this.homeDeviceId,
          targetDeviceId: this.policy.targetDeviceId,
          threadId: this.threadId,
          rootId: this.policy.rootId,
        },
      },
    };
  }
}
