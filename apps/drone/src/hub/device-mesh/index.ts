import type http from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { CapabilityRegistry } from './capability-registry';
import { DeviceMeshAuditStore } from './device-mesh-audit-store';
import { createDeviceCoreCapability } from './device-core-capability';
import { loadOrCreateDeviceIdentity } from './device-identity';
import { DeviceMeshHttp, type DeviceMeshHttpExtension } from './device-mesh-http';
import { DeviceMeshIngressHttp } from './device-mesh-ingress-http';
import { DeviceMeshIngress } from './device-mesh-ingress';
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
import { ProviderCredentialsHttp } from './features/provider-credentials/provider-credentials-http';

export async function createDeviceMeshService(options: {
  rootDir: string;
  apiToken: string;
  localHubBaseUrl(): string;
  ingressPort?: number;
  createdDroneAutoRename?: CreatedDroneAutoRenameOperations;
  sidebarCommands?: SidebarCommandService;
}) {
  const identity = await loadOrCreateDeviceIdentity(options.rootDir);
  const store = new DeviceMeshStore(path.join(options.rootDir, 'state.json'), identity);
  await store.read();
  await store.prunePairingState();
  const capabilities = new CapabilityRegistry();
  const chatAttachments = new MeshChatAttachmentStore(path.join(options.rootDir, 'attachments'));
  await chatAttachments.initialize();
  let router: DeviceMeshRouter;
  capabilities.register(
    createDeviceCoreCapability(
      store,
      () => capabilities.list(),
      () => router.broadcastMembership(),
    ),
  );
  capabilities.register(
    createDroneControlCapability(
      { baseUrl: options.localHubBaseUrl, apiToken: options.apiToken },
      chatAttachments,
      {
        sidebarCommands: options.sidebarCommands,
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
  capabilities.register(createWorkspaceCapability(assistantPolicies));
  capabilities.register(createProviderCredentialsCapability(identity));
  const routeManager = new DeviceRouteManager(identity, store);
  const audit = new DeviceMeshAuditStore(path.join(options.rootDir, 'audit.json'));
  router = new DeviceMeshRouter(identity, store, capabilities, routeManager, audit);
  const extensions: DeviceMeshHttpExtension[] = [
    new DesktopDroneControlHttp(router, store),
    new MeshChatAttachmentHttp(chatAttachments),
    new CrossDeviceAssistantPolicyHttp(assistantPolicies, (targetDeviceId) =>
      router.request(targetDeviceId, 'workspace', 'workspaces.list', {}),
    ),
    new ProviderCredentialsHttp(identity, router, store),
  ];
  let ingress: DeviceMeshIngress;
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
  ingress = new DeviceMeshIngress(
    options.rootDir,
    options.ingressPort ?? 0,
    (request, response, url) => httpHandler.handlePublic(request, response, url),
    (request, socket, head) => router.handleUpgrade(request, socket, head),
    (endpoint) => router.announceEndpoint(endpoint),
  );
  extensions.push(new DeviceMeshIngressHttp(ingress));
  let pairingPruneTimer: ReturnType<typeof setInterval> | null = null;

  return {
    handleHttp: (request: http.IncomingMessage, response: http.ServerResponse, url: URL) =>
      httpHandler.handle(request, response, url),
    handleUpgrade: (request: http.IncomingMessage, socket: Duplex, head: Buffer) =>
      router.handleUpgrade(request, socket, head),
    start: async () => {
      router.start();
      await ingress.start();
      pairingPruneTimer = setInterval(
        () => void store.prunePairingState().catch(() => undefined),
        10 * 60_000,
      );
      pairingPruneTimer.unref?.();
    },
    close: async () => {
      if (pairingPruneTimer) clearInterval(pairingPruneTimer);
      pairingPruneTimer = null;
      await ingress.close();
      await chatAttachments.close();
      await capabilities.close();
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
    store,
    onAssistantPolicyChange: (listener: (threadIds: string[]) => void) =>
      assistantPolicies.onChange(listener),
    broadcastDroneListChange: (payload: Record<string, any>) =>
      router.broadcastCapabilityEvent('drone-control', 'drones.changed', payload, 'drones.list'),
    broadcastDroneChatChange: (payload: Record<string, any>) =>
      router.broadcastCapabilityEvent('drone-control', 'chat.changed', payload, 'chat.read'),
    remoteWorkspaceTargets: async (threadId: string) => {
      const policies = await assistantPolicies.homeTargets(threadId);
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
