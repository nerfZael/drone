import type { ChatWorkspaceTarget, ChatWorkspaceOption } from '@drone/assistant-chat';
import type http from 'node:http';
import path from 'node:path';
import { canonicalJson, isGranted } from '@drone/device-protocol';
import { CapabilityRegistry } from './capability-registry';
import { DeviceMeshAuditStore } from './device-mesh-audit-store';
import { createDeviceCoreCapability } from './device-core-capability';
import { loadOrCreateDeviceIdentity, signDeviceText } from './device-identity';
import { DeviceMeshHttp, type DeviceMeshHttpExtension } from './device-mesh-http';
import { DeviceMeshIngressHttp } from './device-mesh-ingress-http';
import { DeviceMeshIngress } from './device-mesh-ingress';
import { DeviceMeshDiscovery } from './device-mesh-discovery';
import { DevicePhoneDiscovery } from './device-phone-discovery';
import { DeviceLanDiscovery } from './device-lan-discovery';
import { DeviceHttpTransfers } from './device-http-transfers';
import { DeviceRequestJournal } from './device-request-journal';
import { WorkspaceHttpTransfers } from './workspace-http-transfers';
import { DeviceResultUploads } from './device-result-uploads';
import { MeshChatAttachmentHttp } from './mesh-chat-attachment-http';
import { MeshChatAttachmentStore } from './mesh-chat-attachment-store';
import { DeviceMeshRouter } from './device-mesh-router';
import { DeviceMeshStore } from './device-mesh-store';
import { DeviceRouteManager } from './device-route-manager';
import { DesktopDroneControlHttp } from './desktop-drone-control-http';
import { createDroneControlCapability } from './drone-control-capability';
import type { CreatedDroneAutoRenameOperations } from './auto-rename-created-drone';
import { CrossDeviceAssistantPolicyHttp } from './features/cross-device-assistant/policy-http';
import { CrossDeviceAssistantPolicyStore } from './features/cross-device-assistant/policy-store';
import { RemoteWorkspaceTarget } from './features/cross-device-assistant/remote-workspace-target';
import { createWorkspaceCapability } from './features/cross-device-assistant/workspace-capability';
import { createProviderCredentialsCapability } from './features/provider-credentials/provider-credentials-capability';
import type { SidebarCommandService } from '../sidebar-command-service';
import type { HubServices } from '../application/hub-services';
import { ProviderCredentialsHttp } from './features/provider-credentials/provider-credentials-http';
import type { CapabilityHandler } from './device-mesh-types';

export async function createDeviceMeshService(options: {
  rootDir: string;
  apiToken: string;
  localHubBaseUrl(): string;
  ingressPort?: number;
  createdDroneAutoRename?: CreatedDroneAutoRenameOperations;
  sidebarCommands: SidebarCommandService;
  hubServices?: HubServices;
}) {
  const identity = await loadOrCreateDeviceIdentity(options.rootDir);
  const store = new DeviceMeshStore(path.join(options.rootDir, 'state.json'), identity);
  await store.read();
  await store.prunePairingState();
  const capabilities = new CapabilityRegistry();
  let ingress: DeviceMeshIngress;
  const transfers = new DeviceHttpTransfers(
    { baseUrl: options.localHubBaseUrl, apiToken: options.apiToken },
    store,
    () => ingress?.status().publicEndpoint ?? null,
  );
  const chatAttachments = new MeshChatAttachmentStore(
    path.join(options.rootDir, 'attachments'),
    async (source) => {
      const device = (await store.read()).devices[source];
      return Boolean(
        device && !device.revokedAt && isGranted(device.grants, 'drone-control', 1, 'chat.prompt'),
      );
    },
  );
  await chatAttachments.initialize();
  let router: DeviceMeshRouter;
  capabilities.register(
    createDeviceCoreCapability(
      store,
      () => capabilities.list(),
      () => router.broadcastMembership(),
      (deviceId) => router.accessChanged(deviceId),
      (value) => signDeviceText(identity, `drone-directory-v2\n${canonicalJson(value)}`),
    ),
  );
  capabilities.register(
    createDroneControlCapability(
      { baseUrl: options.localHubBaseUrl, apiToken: options.apiToken },
      chatAttachments,
      {
        transfers,
        sidebarCommands: options.sidebarCommands,
        hubServices: options.hubServices,
        createdDroneAutoRename: options.createdDroneAutoRename,
        broadcastFileChange: (payload, targetDeviceIds) =>
          router.broadcastCapabilityEvent(
            'drone-control',
            'file.changed',
            payload,
            'file.preview',
            targetDeviceIds,
          ),
      },
    ),
  );
  const assistantPolicies = new CrossDeviceAssistantPolicyStore(
    path.join(options.rootDir, 'cross-device-assistant.json'),
  );
  const localHubAccess = { baseUrl: options.localHubBaseUrl, apiToken: options.apiToken };
  const workspaceTransfers = new WorkspaceHttpTransfers(
    store,
    () => ingress?.status().publicEndpoint ?? null,
  );
  capabilities.register(createWorkspaceCapability(assistantPolicies, workspaceTransfers));
  capabilities.register(createProviderCredentialsCapability(identity));
  const routeManager = new DeviceRouteManager(identity, store);
  const audit = new DeviceMeshAuditStore(path.join(options.rootDir, 'audit.json'));
  const resultUploads = new DeviceResultUploads(
    path.join(options.rootDir, 'http-result-previews'),
    store,
    workspaceTransfers,
  );
  router = new DeviceMeshRouter(
    identity,
    store,
    capabilities,
    routeManager,
    audit,
    new DeviceRequestJournal(path.join(options.rootDir, 'http-request-journal')),
    (request, size, revision) => resultUploads.prepare(request, size, revision),
  );
  const extensions: DeviceMeshHttpExtension[] = [
    new DesktopDroneControlHttp(router, store),
    new MeshChatAttachmentHttp(chatAttachments),
    new CrossDeviceAssistantPolicyHttp(assistantPolicies, (targetDeviceId) =>
      router.request(targetDeviceId, 'workspace', 'workspaces.list', {}),
    ),
    new ProviderCredentialsHttp(identity, router, store),
  ];
  extensions.push(transfers);
  extensions.push(workspaceTransfers);
  const httpHandler = new DeviceMeshHttp(
    identity,
    store,
    capabilities,
    router,
    audit,
    options.apiToken,
    extensions,
    () => {
      const status = ingress.status();
      return status.running ? status.publicEndpoint : null;
    },
  );
  // Shared-folder roots and per-device grants live in the policy store; phones
  // showing a workspace picker refresh from this instead of polling.
  const unsubscribeWorkspaceChanges = assistantPolicies.onChange(() => {
    void router
      .broadcastCapabilityEvent('workspace', 'workspaces.changed', {}, 'workspaces.list')
      .catch(() => undefined);
  });
  ingress = new DeviceMeshIngress(
    options.rootDir,
    options.ingressPort ?? 0,
    (request, response, url) => httpHandler.handlePublic(request, response, url),
    (endpoint) => router.announceEndpoint(endpoint),
  );
  extensions.push(new DeviceMeshIngressHttp(ingress));
  const discovery = new DeviceMeshDiscovery(ingress, store, routeManager);
  extensions.push(discovery);
  const lanDiscovery = new DeviceLanDiscovery(identity, () => ingress.status().publicEndpoint);
  extensions.push(lanDiscovery);
  extensions.push(
    new DevicePhoneDiscovery(ingress, store, identity, fetch, () => lanDiscovery.phonePeers()),
  );
  let discoveryTimer: ReturnType<typeof setInterval> | null = null;
  let pairingPruneTimer: ReturnType<typeof setInterval> | null = null;

  return {
    handleHttp: (request: http.IncomingMessage, response: http.ServerResponse, url: URL) =>
      httpHandler.handle(request, response, url),
    start: async () => {
      router.start();
      await ingress.start();
      void discovery.scan().catch(() => undefined);
      discoveryTimer = setInterval(() => void discovery.scan().catch(() => undefined), 60_000);
      discoveryTimer.unref?.();
      pairingPruneTimer = setInterval(
        () => void store.prunePairingState().catch(() => undefined),
        10 * 60_000,
      );
      pairingPruneTimer.unref?.();
    },
    close: async () => {
      unsubscribeWorkspaceChanges();
      lanDiscovery.close();
      if (discoveryTimer) clearInterval(discoveryTimer);
      discoveryTimer = null;
      if (pairingPruneTimer) clearInterval(pairingPruneTimer);
      pairingPruneTimer = null;
      await ingress.close();
      await chatAttachments.close();
      transfers.close();
      workspaceTransfers.close();
      resultUploads.close();
      await capabilities.close();
      httpHandler.close();
      router.close();
    },
    request: (
      targetDeviceId: string,
      capability: string,
      operation: string,
      payload: unknown,
      signal?: AbortSignal,
    ) => router.request(targetDeviceId, capability, operation, payload, signal),
    capabilities,
    registerCapability: (handler: CapabilityHandler) => capabilities.register(handler),
    broadcastCapabilityEvent: (
      capability: string,
      event: string,
      payload: Record<string, any>,
      requiredOperation: string,
      targetDeviceIds?: Iterable<string>,
    ) =>
      router.broadcastCapabilityEvent(
        capability,
        event,
        payload,
        requiredOperation,
        targetDeviceIds,
      ),
    store,
    onAssistantPolicyChange: (listener: (threadIds: string[]) => void) =>
      assistantPolicies.onChange(listener),
    broadcastDroneListChange: (payload: Record<string, any>) =>
      router.broadcastCapabilityEvent('drone-control', 'drones.changed', payload, 'drones.list'),
    broadcastDroneChatChange: (payload: Record<string, any>) =>
      router.broadcastCapabilityEvent('drone-control', 'chat.changed', payload, 'chat.read'),
    workspaceAccessDevices: async () => {
      const state = await store.read();
      const self = state.devices[state.selfDeviceId];
      return {
        self: { id: self.id, name: self.name },
        devices: Object.values(state.devices)
          .filter((device) => device.id !== self.id && !device.revokedAt)
          .map((device) => ({ id: device.id, name: device.name })),
      };
    },
    listWorkspaceAccessTargets: async (deviceId: string): Promise<ChatWorkspaceOption[]> => {
      const state = await store.read();
      const device = state.devices[deviceId];
      if (!device || device.revokedAt || deviceId === state.selfDeviceId)
        throw new Error('Device unavailable');
      const result: any = await router.request(
        deviceId,
        'workspace',
        'workspaces.list',
        {},
        AbortSignal.timeout(10_000),
      );
      return (Array.isArray(result?.workspaces) ? result.workspaces : []).map((root: any) => ({
        id: `remote:${deviceId}:${root.id}`,
        kind: 'remote',
        workspaceId: String(root.id),
        deviceId,
        deviceName: device.name,
        name: String(root.name),
        read: root.read === true,
        write: root.write === true,
        execute: root.execute === true,
      }));
    },
    legacyWorkspaceAccessTargets: async (threadId: string): Promise<ChatWorkspaceTarget[]> =>
      (await assistantPolicies.homeTargets(threadId)).map((target) => ({
        id: `remote:${target.targetDeviceId}:${target.rootId}`,
        kind: 'remote',
        deviceId: target.targetDeviceId,
        deviceName: target.deviceName,
        workspaceId: target.rootId,
        name: target.workspaceName,
        read: target.read,
        write: target.write,
        execute: target.execute,
      })),
    remoteWorkspaceTargets: async (threadId: string, selection?: ChatWorkspaceTarget[]) => {
      const policies = selection
        ? selection
            .filter((target) => target.kind === 'remote')
            .map((target) => ({
              threadId,
              targetDeviceId: target.deviceId,
              deviceName: target.deviceName,
              rootId: target.workspaceId!,
              workspaceName: target.name,
              read: target.read,
              write: target.write,
              execute: target.execute,
            }))
        : await assistantPolicies.homeTargets(threadId);
      const state = await store.read();
      return policies.flatMap((policy) => {
        const target = state.devices[policy.targetDeviceId];
        if (!target || target.revokedAt) return [];
        return [
          new RemoteWorkspaceTarget(
            state.selfDeviceId,
            threadId,
            policy,
            target.name,
            (targetDeviceId, capability, operation, payload, signal) =>
              router.request(targetDeviceId, capability, operation, payload, signal),
          ),
        ];
      });
    },
  };
}
