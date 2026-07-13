import { WORKSPACE_CAPABILITY } from '@drone/device-protocol';
import type { HomeWorkspaceTarget } from './policy-types';

type MeshRequest = (
  targetDeviceId: string,
  capability: string,
  operation: string,
  payload: unknown,
) => Promise<any>;

const OPERATIONS: Record<string, string> = {
  list_files: 'files.list',
  read_file: 'files.read',
  search_files: 'files.search',
  write_file: 'files.write',
};

export class RemoteWorkspaceTarget {
  readonly descriptor: {
    id: string;
    kind: 'remote-device';
    label: string;
    rootLabel: string;
    capabilities: Array<'files.list' | 'files.read' | 'files.search' | 'files.write'>;
  };

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
      label: `${targetDeviceName} · ${policy.rootId}`,
      rootLabel: policy.rootId,
      capabilities: [
        ...(policy.read ? (['files.list', 'files.read', 'files.search'] as const) : []),
        ...(policy.write ? (['files.write'] as const) : []),
      ],
    };
  }

  async execute(call: { tool: string; args: Record<string, unknown> }): Promise<any> {
    const operation = OPERATIONS[call.tool];
    if (!operation)
      throw Object.assign(new Error(`remote workspace does not support ${call.tool}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    const result = await this.request(
      this.policy.targetDeviceId,
      WORKSPACE_CAPABILITY.id,
      operation,
      {
        ...call.args,
        actor: {
          assistantHomeDeviceId: this.homeDeviceId,
          threadId: this.threadId,
          rootId: this.policy.rootId,
          read: this.policy.read,
          write: this.policy.write,
        },
      },
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
