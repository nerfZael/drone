import crypto from 'node:crypto';
import {
  parseChatWorkspaceAccess,
  validateChatWorkspaceSelection,
  type ChatWorkspaceAccess,
  type ChatWorkspaceCatalog,
  type ChatWorkspaceOption,
  type ChatWorkspaceTarget,
} from '@drone/assistant-chat';
import type { HubAssistantService } from '../assistant';
import { hostWorkspaceId, hostWorkspaceRoot } from './host-workspaces';

export type WorkspaceAccessMesh = {
  workspaceAccessDevices(): Promise<{
    self: { id: string; name: string };
    devices: Array<{ id: string; name: string }>;
  }>;
  listWorkspaceAccessTargets(deviceId: string): Promise<ChatWorkspaceOption[]>;
  legacyWorkspaceAccessTargets(threadId: string): Promise<ChatWorkspaceTarget[]>;
};

export function createChatWorkspaceAccessService(
  assistant: HubAssistantService,
  mesh: WorkspaceAccessMesh,
) {
  async function catalog(threadId: string, deviceId?: string): Promise<ChatWorkspaceCatalog> {
    const [state, directory, legacy] = await Promise.all([
      assistant.workspaceAccessState(threadId),
      mesh.workspaceAccessDevices(),
      mesh.legacyWorkspaceAccessTargets(threadId),
    ]);
    const { thread } = state;
    const droneOptions: ChatWorkspaceOption[] = state.drones.map((drone) => ({
      id: `drone:${drone.id}`,
      kind: 'drone',
      droneId: drone.id,
      deviceId: directory.self.id,
      deviceName: directory.self.name,
      name: drone.name || drone.id,
      path: drone.repoPath,
      runtime: drone.runtime,
      status: drone.status,
      read: true,
      write: true,
      execute: drone.runtime === 'container',
    }));
    const hostOptions: ChatWorkspaceOption[] = state.hostWorkspaces.map(
      ({ droneName, ...workspace }) => {
        // A drone's private workspace lists as the drone itself. Shared folders
        // name the host drones working in them so the picker can show who is there.
        const hostDrones = droneName
          ? []
          : state.drones
              .filter(
                (drone) =>
                  drone.runtime === 'host' &&
                  hostWorkspaceId(hostWorkspaceRoot(drone)) === workspace.id,
              )
              .map((drone) => drone.name || drone.id);
        return {
          ...workspace,
          kind: 'host',
          deviceId: directory.self.id,
          deviceName: directory.self.name,
          ...(droneName ? { runtime: 'host' } : {}),
          ...(hostDrones.length > 0
            ? {
                status: `Host drone${hostDrones.length === 1 ? '' : 's'}: ${hostDrones.join(', ')}`,
              }
            : {}),
          read: true,
          write: true,
          execute: false,
        };
      },
    );
    const local = [...hostOptions, ...droneOptions.filter((target) => target.runtime !== 'host')];
    // Old selections referred to drones even when several shared exactly the same host folder.
    // Merge their permissions, and preserve the default's underlying directory.
    const normalize = (access: ChatWorkspaceAccess): ChatWorkspaceAccess => {
      const targets = new Map<string, ChatWorkspaceTarget>();
      let defaultTargetId = access.defaultTargetId;
      for (const target of access.targets) {
        const drone =
          target.kind === 'drone'
            ? state.drones.find((item) => item.id === target.droneId && item.runtime === 'host')
            : undefined;
        const host = drone
          ? hostOptions.find((item) => item.id === hostWorkspaceId(hostWorkspaceRoot(drone)))
          : undefined;
        const next = host
          ? { ...host, read: target.read, write: target.write, execute: false }
          : target;
        if (target.id === defaultTargetId) defaultTargetId = next.id;
        const previous = targets.get(next.id);
        targets.set(
          next.id,
          previous
            ? {
                ...next,
                read: previous.read || next.read,
                write: previous.write || next.write,
                execute: previous.execute || next.execute,
              }
            : next,
        );
      }
      return { targets: [...targets.values()], defaultTargetId };
    };
    const owner = droneOptions.find((target) => target.droneId === thread.ownerDroneId);
    const defaults = normalize({
      targets: owner ? [owner] : [],
      defaultTargetId: owner?.id ?? null,
    });
    const inherited = droneOptions.flatMap((target) => {
      if (!assistant.workspaceIsEnabled(threadId, target.id)) return [];
      const scope = thread.accessScope;
      const allowed = (kind: 'read' | 'write' | 'execute') =>
        scope[`${kind}Mode`] === 'all' || scope.droneIds.includes(target.droneId!);
      const read = allowed('read'),
        write = allowed('write'),
        execute = allowed('execute') && target.execute;
      return read || write || execute ? [{ ...target, read, write, execute }] : [];
    });
    const targets = [...inherited, ...legacy];
    const access = normalize(
      thread.workspaceAccess ?? {
        targets,
        defaultTargetId:
          targets.find((target) => target.droneId === thread.ownerDroneId)?.id ??
          targets[0]?.id ??
          null,
      },
    );
    const devices: ChatWorkspaceCatalog['devices'] = [directory.self, ...directory.devices];
    for (const target of access.targets) {
      if (!devices.some((device) => device.id === target.deviceId))
        devices.push({ id: target.deviceId, name: target.deviceName, error: 'Device unavailable' });
    }
    let remote: ChatWorkspaceOption[] = [];
    if (deviceId && deviceId !== directory.self.id) {
      if (!directory.devices.some((device) => device.id === deviceId))
        throw new Error('Device unavailable to the device running this chat.');
      try {
        remote = await mesh.listWorkspaceAccessTargets(deviceId);
      } catch (error: any) {
        const device = devices.find((item) => item.id === deviceId)!;
        device.error = error?.message ?? 'Unable to load shared folders';
      }
    }
    return {
      revision: `${state.revision}:${crypto
        .createHash('sha256')
        .update(JSON.stringify(thread.workspaceAccess ? [] : legacy))
        .digest('hex')}`,
      access,
      defaults,
      workspaces: [...local, ...remote],
      devices,
    };
  }

  async function save(threadId: string, raw: unknown, revision: string) {
    const requested = parseChatWorkspaceAccess(raw);
    const current = await catalog(threadId);
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
        try {
          return await mesh.listWorkspaceAccessTargets(id);
        } catch {
          return [];
        }
      }),
    );
    const validated = validateChatWorkspaceSelection(requested, current.access, [
      ...current.workspaces,
      ...remote.flat(),
    ]);
    const latest = await catalog(threadId);
    if (latest.revision !== revision)
      throw new Error('Workspace access changed elsewhere. Reload before applying.');
    const saved = await assistant.saveWorkspaceAccess(threadId, validated, revision.split(':')[0]);
    // Discovery must not turn a committed save into a reported failure or skip runtime invalidation.
    return {
      ...latest,
      access: saved.access,
      revision: `${saved.revision}:${crypto.createHash('sha256').update('[]').digest('hex')}`,
    };
  }
  return { catalog, save };
}
