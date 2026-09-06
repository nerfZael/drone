import React from 'react';
import {
  parseChatWorkspaceAccess,
  type ChatWorkspaceCatalog,
  type ChatWorkspaceTarget,
  type ChatWorkspaceOption,
} from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';
import { useLocalAssistant } from './LocalAssistantContext';
import type { LocalAssistantThread } from './local-assistant-types';
import { WorkspaceAccessEditor } from './WorkspaceAccessEditor';
import {
  validateMobileWorkspaceSelection,
  workspaceAccessSignature,
} from './workspace-access-model';

export function LocalWorkspaceEditor({
  thread,
  onRequestClose,
  onApplied,
  onDirtyChange,
}: {
  thread: LocalAssistantThread;
  onRequestClose(): void;
  onApplied(): void;
  onDirtyChange(dirty: boolean): void;
}) {
  const mesh = useMesh();
  const assistant = useLocalAssistant();
  const current = () => assistant.threads.find((item) => item.id === thread.id) ?? thread;
  const access = () => {
    const targets: ChatWorkspaceTarget[] = current().workspaceTargets.map((target) => ({
      id: `remote:${target.targetDeviceId}:${target.workspaceId}`,
      kind: 'remote',
      deviceId: target.targetDeviceId,
      deviceName: target.deviceName,
      workspaceId: target.workspaceId,
      name: target.workspaceName,
      read: target.read,
      write: target.write,
      execute: target.execute,
    }));
    return { targets, defaultTargetId: targets[0]?.id ?? null };
  };
  const loadTargets = async (
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<ChatWorkspaceOption[]> => {
    const device = mesh.devices.find((item) => item.id === deviceId && !item.revokedAt);
    if (!device || deviceId === mesh.identity?.id) throw new Error('Device unavailable');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 10_000);
    try {
      const result = await mesh.request(
        deviceId,
        'workspace',
        'workspaces.list',
        {},
        controller.signal,
      );
      return (Array.isArray(result?.workspaces) ? result.workspaces : []).map((root: any) => ({
        id: `remote:${deviceId}:${root.id}`,
        kind: 'remote',
        deviceId,
        deviceName: device.name,
        workspaceId: root.id,
        name: root.name,
        read: root.read === true,
        write: root.write === true,
        execute: root.execute === true,
      }));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
  return (
    <WorkspaceAccessEditor
      disabled={thread.status === 'running'}
      onRequestClose={onRequestClose}
      onApplied={onApplied}
      onDirtyChange={onDirtyChange}
      load={async (deviceId, signal): Promise<ChatWorkspaceCatalog> => {
        const selection = access();
        const devices: ChatWorkspaceCatalog['devices'] = mesh.devices
          .filter(
            (device) =>
              device.id !== mesh.identity?.id &&
              !device.revokedAt &&
              (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
                (capability) => capability.id === 'workspace',
              ),
          )
          .map((device) => ({ id: device.id, name: device.name }));
        for (const target of selection.targets) {
          if (!devices.some((device) => device.id === target.deviceId))
            devices.push({
              id: target.deviceId,
              name: target.deviceName,
              error: 'Device unavailable',
            });
        }
        return {
          revision: workspaceAccessSignature(selection),
          access: selection,
          defaults: { targets: [], defaultTargetId: null },
          devices,
          workspaces: deviceId ? await loadTargets(deviceId, signal) : [],
        };
      }}
      save={async (raw, revision) => {
        const previous = access();
        const expectedWorkspaceTargets = current().workspaceTargets;
        const requested = parseChatWorkspaceAccess(raw);
        if (current().status === 'running')
          throw new Error('Stop the agent before changing workspace access.');
        if (revision !== workspaceAccessSignature(previous))
          throw new Error('Workspace access changed elsewhere. Reload before applying.');
        const selected = await validateMobileWorkspaceSelection(requested, previous, loadTargets);
        // The phone runtime uses the first stored target as its default.
        const targets = [...selected.targets].sort(
          (a, b) =>
            Number(b.id === selected.defaultTargetId) - Number(a.id === selected.defaultTargetId),
        );
        await assistant.updateThread(thread.id, {
          expectedWorkspaceTargets,
          workspaceTargets: targets.map((target) => ({
            targetDeviceId: target.deviceId,
            deviceName: target.deviceName,
            workspaceId: target.workspaceId!,
            workspaceName: target.name,
            read: target.read,
            write: target.write,
            execute: target.execute,
          })),
        });
      }}
    />
  );
}
