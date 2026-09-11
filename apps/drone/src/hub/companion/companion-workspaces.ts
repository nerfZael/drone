import { hostWorkspaceId, hostWorkspaceRoot } from '../assistant/host-workspaces';
import crypto from 'node:crypto';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { WorkspaceTarget, WorkspaceCapability } from '@blip/tools';
import {
  parseChatWorkspaceAccess,
  validateChatWorkspaceSelection,
  type ChatWorkspaceAccess,
  type ChatWorkspaceCatalog,
  type ChatWorkspaceTarget,
} from '@drone/assistant-chat';
import { getHubSettingsRepository } from '../../host/hub-settings-repository';
import type { HubAssistantService } from '../assistant';
import {
  localWorkspaceOptions,
  type WorkspaceAccessMesh,
} from '../assistant/chat-workspace-access';
import { loadBlipTools } from '../assistant/blip-runtime-loader';
import { DroneWorkspaceTarget, HostWorkspaceTarget } from '../assistant/targets/workspace-targets';

const SETTING_KEY = 'companion.workspace-access';
const EMPTY: ChatWorkspaceAccess = { targets: [], defaultTargetId: null };
const READ: WorkspaceCapability[] = ['files.list', 'files.read', 'files.search', 'git.status'];
const WRITE: WorkspaceCapability[] = [
  'files.write',
  'files.delete',
  'files.move',
  'directories.create',
  'directories.delete',
  'patch.apply',
];
type Permission = 'read' | 'write' | 'execute';
type Mesh = WorkspaceAccessMesh & {
  remoteWorkspaceTargets(
    threadId: string,
    selection: ChatWorkspaceTarget[],
  ): Promise<WorkspaceTarget[]>;
};
type Storage = {
  read(): Promise<ChatWorkspaceAccess>;
  write(access: ChatWorkspaceAccess): Promise<void>;
};
const storage: Storage = {
  async read() {
    const value = (await getHubSettingsRepository()).get<ChatWorkspaceAccess>(SETTING_KEY)?.value;
    return value ? parseCompanionWorkspaceAccess(value) : structuredClone(EMPTY);
  },
  async write(access) {
    await (await getHubSettingsRepository()).put(SETTING_KEY, access);
  },
};

export function parseCompanionWorkspaceAccess(value: unknown): ChatWorkspaceAccess {
  const access = parseChatWorkspaceAccess(value);
  if (access.targets.some((target) => !target.read)) {
    throw new Error(
      'Selected Companion workspaces must allow Read. Remove the workspace to disable access.',
    );
  }
  return access;
}
export function companionWorkspaceRevision(access: ChatWorkspaceAccess): string {
  return crypto.createHash('sha256').update(JSON.stringify(access)).digest('hex');
}
export function assertCompanionWorkspacePermission(
  access: ChatWorkspaceAccess,
  id: string,
  permission: Permission,
): void {
  if (!access.targets.find((target) => target.id === id)?.[permission]) {
    throw Object.assign(
      new Error(`Companion does not have ${permission} access to workspace ${id}.`),
      { code: 'WORKSPACE_POLICY_DENIED' },
    );
  }
}

/** Workspace grants are independent of Companion's model settings and proposal approvals. */
export class CompanionWorkspaceService {
  private saves: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly assistant: Pick<
      HubAssistantService,
      'workspaceInventory' | 'executeAuthorizedWorkspaceTool'
    >,
    private readonly mesh: Mesh,
    private readonly store: Storage = storage,
  ) {}

  async revision() {
    const catalog = await this.catalog();
    // A deleted/recreated local target must refresh even when saved permissions did not change.
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify([
          catalog.revision,
          catalog.workspaces.map((target) => [
            target.id,
            target.read,
            target.write,
            target.execute,
          ]),
          catalog.devices.map((device) => [device.id, device.error ?? '']),
        ]),
      )
      .digest('hex');
  }

  async catalog(deviceId?: string): Promise<ChatWorkspaceCatalog> {
    const [inventory, directory, access] = await Promise.all([
      this.assistant.workspaceInventory(),
      this.mesh.workspaceAccessDevices(),
      this.store.read(),
    ]);
    const workspaces = localWorkspaceOptions(inventory, directory.self).workspaces.map(
      (option) => ({
        ...option,
        // Companion can opt into the existing local shell tool for host folders too.
        execute: option.kind === 'host' || option.execute,
      }),
    );
    const devices: ChatWorkspaceCatalog['devices'] = [directory.self, ...directory.devices];
    for (const target of access.targets) {
      if (!devices.some((device) => device.id === target.deviceId)) {
        devices.push({ id: target.deviceId, name: target.deviceName, error: 'Device unavailable' });
      }
    }
    if (deviceId && deviceId !== directory.self.id) {
      const device = devices.find((item) => item.id === deviceId);
      if (!device || !directory.devices.some((item) => item.id === deviceId))
        throw new Error('Device unavailable');
      try {
        workspaces.push(...(await this.mesh.listWorkspaceAccessTargets(deviceId)));
      } catch (error) {
        device.error = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      revision: companionWorkspaceRevision(access),
      access,
      defaults: structuredClone(EMPTY),
      workspaces,
      devices,
    };
  }

  async current(droneId: string) {
    const [inventory, catalog] = await Promise.all([this.assistant.workspaceInventory(), this.catalog()]);
    const drone = inventory.drones.find(item => item.id === droneId);
    if (!drone) throw new Error('DRONE_UNAVAILABLE');
    const id = drone.runtime === 'host' ? hostWorkspaceId(hostWorkspaceRoot(drone)) : `drone:${drone.id}`;
    const target = catalog.workspaces.find(option => option.id === id);
    if (!target) throw new Error('WORKSPACE_UNAVAILABLE');
    return { ...catalog, target };
  }

  async editorFile(input: { droneId: string; workspaceId?: string; path: string }) {
    if (typeof input.droneId !== 'string' || typeof input.path !== 'string' || !input.path.trim() || input.path.length > 4096 || /[\0\r\n]/.test(input.path)) throw new Error('INVALID_EDITOR_FILE');
    const current = await this.current(input.droneId);
    const target = current.target;
    if (input.workspaceId !== undefined && input.workspaceId !== target.id) throw new Error('WORKSPACE_TARGET_MISMATCH');
    const authorize = async () => assertCompanionWorkspacePermission(await this.store.read(), target.id, 'read');
    const stat = await this.assistant.executeAuthorizedWorkspaceTool(target.kind === 'host' ? target.id : input.droneId, { tool: 'editor_stat', args: { path: input.path } }, authorize);
    if (stat.type !== 'file' || typeof stat.path !== 'string') throw new Error('NOT_A_FILE');
    await authorize();
    return { workspaceId: target.id, droneId: input.droneId, path: stat.path };
  }

  save(value: unknown, revision: string): Promise<ChatWorkspaceCatalog> {
    const operation = this.saves
      .catch(() => {})
      .then(async () => {
        const requested = parseCompanionWorkspaceAccess(value);
        const current = await this.catalog();
        if (revision !== current.revision)
          throw new Error('Workspace access changed elsewhere. Reload before applying.');
        const remoteIds = [
          ...new Set(
            requested.targets
              .filter((target) => target.kind === 'remote')
              .map((target) => target.deviceId),
          ),
        ];
        const remote = await Promise.all(
          remoteIds.map(async (id) => {
            if (!current.devices.some((device) => device.id === id && !device.error)) return [];
            return this.mesh.listWorkspaceAccessTargets(id).catch(() => []);
          }),
        );
        const access = parseCompanionWorkspaceAccess(
          validateChatWorkspaceSelection(requested, current.access, [
            ...current.workspaces,
            ...remote.flat(),
          ]),
        );
        await this.store.write(access);
        return { ...current, access, revision: companionWorkspaceRevision(access) };
      });
    this.saves = operation;
    return operation;
  }

  async tools(runId: string, assertActive: () => void): Promise<AgentTool<any>[]> {
    const [blip, catalog] = await Promise.all([loadBlipTools(), this.catalog()]);
    const access = catalog.access;
    const targets: WorkspaceTarget[] = [];
    const guard = (id: string, permission: Permission) => async () => {
      assertActive();
      assertCompanionWorkspacePermission(await this.store.read(), id, permission);
      assertActive();
    };
    const capabilities = (target: ChatWorkspaceTarget): WorkspaceCapability[] => [
      ...(target.read ? READ : []),
      ...(target.write ? WRITE : []),
      ...(target.execute ? ['shell.execute' as const] : []),
    ];
    const remote = await this.mesh.remoteWorkspaceTargets(`companion:${runId}`, access.targets);
    for (const selected of access.targets) {
      const available = catalog.workspaces.find((option) => option.id === selected.id);
      let target: WorkspaceTarget | undefined;
      if (selected.kind === 'remote')
        target = remote.find((item) => item.descriptor.id === selected.id);
      else if (available) {
        const execute = async (call: Parameters<WorkspaceTarget['execute']>[0]) => {
          const capability = blip.capabilityForWorkspaceTool(call.tool);
          const permission: Permission =
            call.tool === 'bash'
              ? 'execute'
              : WRITE.includes(capability!) ||
                  [
                    'transfer_mkdir',
                    'transfer_prepare',
                    'transfer_write',
                    'transfer_commit',
                    'transfer_abort',
                  ].includes(call.tool)
                ? 'write'
                : 'read';
          return this.assistant.executeAuthorizedWorkspaceTool(
            selected.kind === 'host' ? selected.id : selected.droneId!,
            call,
            guard(selected.id, permission),
            { parse: blip.parsePatch, applyHunks: blip.applyPatchHunks },
          );
        };
        if (selected.kind === 'drone') {
          target = new DroneWorkspaceTarget({
            id: selected.id,
            droneId: selected.droneId!,
            label: available.name,
            rootLabel: available.name,
            capabilities: capabilities({
              ...selected,
              read: selected.read && available.read,
              write: selected.write && available.write,
              execute: selected.execute && available.execute,
            }).filter(
              (capability) =>
                available.kind !== 'host' || available.repository || capability !== 'git.status',
            ),
            execute,
          });
        } else {
          const folder = available.path
            ? { name: available.name, path: available.path }
            : undefined;
          if (folder) {
            const local = new blip.LocalWorkspaceTarget({
              id: selected.id,
              label: folder.name,
              workspaceRoot: folder.path,
              permissionMode: 'workspace-write',
              profile: 'local-trusted-write',
            });
            target = new HostWorkspaceTarget({
              id: selected.id,
              label: folder.name,
              rootLabel: folder.path,
              capabilities: capabilities({
                ...selected,
                read: selected.read && available.read,
                write: selected.write && available.write,
                execute: selected.execute && available.execute,
              }).filter(
                (capability) =>
                  available.kind !== 'host' || available.repository || capability !== 'git.status',
              ),
              execute: async (call) => {
                if (call.tool !== 'bash') return execute(call);
                await guard(selected.id, 'execute')();
                return local.execute(call);
              },
            });
          }
        }
      }
      if (!target) {
        targets.push({
          descriptor: {
            id: selected.id,
            kind: selected.kind === 'remote' ? 'remote-device' : selected.kind,
            label: `${selected.name} (unavailable)`,
            rootLabel: selected.name,
            capabilities: [],
          },
          execute: async () => {
            throw new Error('Workspace unavailable');
          },
        });
        continue;
      }
      const original = target;
      // Transfer adapters bypass execute(), so check access on every source/destination operation too.
      const wrapTransfer = <T extends object>(
        adapter: T | undefined,
        permission: Permission,
      ): T | undefined =>
        adapter &&
        (Object.fromEntries(
          Object.entries(adapter).map(([key, value]) => [
            key,
            typeof value === 'function'
              ? async (...args: unknown[]) => {
                  await guard(selected.id, permission)();
                  return value.apply(adapter, args);
                }
              : value,
          ]),
        ) as T);
      targets.push({
        descriptor: original.descriptor,
        transfer: original.transfer
          ? {
              source: selected.read ? wrapTransfer(original.transfer.source, 'read') : undefined,
              destination: selected.write
                ? wrapTransfer(original.transfer.destination, 'write')
                : undefined,
            }
          : undefined,
        execute: async (call) => {
          const capability = blip.capabilityForWorkspaceTool(call.tool);
          await guard(
            selected.id,
            capability === 'shell.execute'
              ? 'execute'
              : WRITE.includes(capability!)
                ? 'write'
                : 'read',
          )();
          return original.execute(call);
        },
      });
    }
    if (!targets.length) return [];
    const targetCatalog = new blip.WorkspaceTargetCatalog(
      targets,
      access.defaultTargetId ?? undefined,
    );
    const supported = new Set(targets.flatMap((target) => target.descriptor.capabilities));
    const tools = [
      ...blip.createWorkspaceTargetSelectionTools(targetCatalog, { includeSingleTarget: true }),
      ...blip
        .createWorkspaceTargetTools({
          profile: 'no-shell-workspace-write',
          includeShell: true,
          catalog: targetCatalog,
          exposeTargetParameter: true,
        })
        .filter((tool: any) => {
          const capability = blip.capabilityForWorkspaceTool(tool.name);
          return !capability || supported.has(capability);
        }),
      ...blip.createWorkspaceTransferTools(targetCatalog),
    ];
    return tools.map((tool: AgentTool<any>) => ({
      ...tool,
      execute: async (...args: Parameters<AgentTool<any>['execute']>) => {
        assertActive();
        // Refresh the tool catalog on the next turn; never let a stale catalog retain removed access.
        if (companionWorkspaceRevision(await this.store.read()) !== catalog.revision)
          throw new Error(
            'Workspace access changed. Send a new message to use the updated selection.',
          );
        return tool.execute(...args);
      },
    }));
  }
}
