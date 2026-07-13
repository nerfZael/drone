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
import { DeviceMeshRouter } from './device-mesh-router';
import { DeviceMeshStore } from './device-mesh-store';
import { DeviceRouteManager } from './device-route-manager';
import { createDroneControlCapability } from './drone-control-capability';
import { createAssistantThreadsCapability } from './features/cross-device-assistant/assistant-threads-capability';
import { CrossDeviceAssistantPolicyHttp } from './features/cross-device-assistant/policy-http';
import { CrossDeviceAssistantPolicyStore } from './features/cross-device-assistant/policy-store';
import { RemoteWorkspaceTarget } from './features/cross-device-assistant/remote-workspace-target';
import { createWorkspaceCapability } from './features/cross-device-assistant/workspace-capability';
import { createProviderCredentialsCapability } from './features/provider-credentials/provider-credentials-capability';
import { ProviderCredentialsHttp } from './features/provider-credentials/provider-credentials-http';

export async function createDeviceMeshService(options: {
  rootDir: string;
  apiToken: string;
  localHubBaseUrl(): string;
  ingressPort?: number;
}) {
  const identity = await loadOrCreateDeviceIdentity(options.rootDir);
  const store = new DeviceMeshStore(path.join(options.rootDir, 'state.json'), identity);
  await store.read();
  const capabilities = new CapabilityRegistry();
  capabilities.register(createDeviceCoreCapability(store, () => capabilities.list()));
  capabilities.register(
    createDroneControlCapability({ baseUrl: options.localHubBaseUrl, apiToken: options.apiToken }),
  );
  const assistantPolicies = new CrossDeviceAssistantPolicyStore(
    path.join(options.rootDir, 'cross-device-assistant.json'),
  );
  const localHubAccess = { baseUrl: options.localHubBaseUrl, apiToken: options.apiToken };
  capabilities.register(createAssistantThreadsCapability(localHubAccess, assistantPolicies));
  capabilities.register(createWorkspaceCapability(assistantPolicies));
  capabilities.register(createProviderCredentialsCapability(identity));
  const routeManager = new DeviceRouteManager(identity, store);
  const audit = new DeviceMeshAuditStore(path.join(options.rootDir, 'audit.json'));
  const router = new DeviceMeshRouter(identity, store, capabilities, routeManager, audit);
  const extensions: DeviceMeshHttpExtension[] = [
    new CrossDeviceAssistantPolicyHttp(assistantPolicies),
    new ProviderCredentialsHttp(identity, router, store),
  ];
  let ingress: DeviceMeshIngress;
  const httpHandler = new DeviceMeshHttp(
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

  return {
    handleHttp: (request: http.IncomingMessage, response: http.ServerResponse, url: URL) =>
      httpHandler.handle(request, response, url),
    handleUpgrade: (request: http.IncomingMessage, socket: Duplex, head: Buffer) =>
      router.handleUpgrade(request, socket, head),
    start: async () => {
      router.start();
      await ingress.start();
    },
    close: async () => {
      await ingress.close();
      router.close();
    },
    request: (targetDeviceId: string, capability: string, operation: string, payload: unknown) =>
      router.request(targetDeviceId, capability, operation, payload),
    capabilities,
    store,
    onAssistantPolicyChange: (listener: (threadIds: string[]) => void) =>
      assistantPolicies.onChange(listener),
    broadcastAssistantThreadChange: (payload: Record<string, any>) =>
      router.broadcastCapabilityEvent(
        'assistant-threads',
        'threads.changed',
        payload,
        'threads.list',
      ),
    remoteWorkspaceTarget: async (threadId: string) => {
      const policy = await assistantPolicies.homeTarget(threadId);
      if (!policy) return null;
      const state = await store.read();
      const target = state.devices[policy.targetDeviceId];
      if (!target || target.revokedAt) return null;
      return new RemoteWorkspaceTarget(
        state.selfDeviceId,
        threadId,
        policy,
        target.name,
        (targetDeviceId, capability, operation, payload) =>
          router.request(targetDeviceId, capability, operation, payload),
      );
    },
  };
}
