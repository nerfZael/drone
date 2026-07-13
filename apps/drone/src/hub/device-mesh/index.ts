import type http from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { CapabilityRegistry } from './capability-registry';
import { DeviceMeshAuditStore } from './device-mesh-audit-store';
import { createDeviceCoreCapability } from './device-core-capability';
import { loadOrCreateDeviceIdentity } from './device-identity';
import { DeviceMeshHttp } from './device-mesh-http';
import { DeviceMeshRouter } from './device-mesh-router';
import { DeviceMeshStore } from './device-mesh-store';
import { DeviceRouteManager } from './device-route-manager';
import { createDroneControlCapability } from './drone-control-capability';
import { createAssistantThreadsCapability } from './features/cross-device-assistant/assistant-threads-capability';
import { CrossDeviceAssistantPolicyHttp } from './features/cross-device-assistant/policy-http';
import { CrossDeviceAssistantPolicyStore } from './features/cross-device-assistant/policy-store';
import { RemoteWorkspaceTarget } from './features/cross-device-assistant/remote-workspace-target';
import { createWorkspaceCapability } from './features/cross-device-assistant/workspace-capability';

export async function createDeviceMeshService(options: {
  rootDir: string;
  apiToken: string;
  localHubBaseUrl(): string;
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
  const routeManager = new DeviceRouteManager(identity, store);
  const audit = new DeviceMeshAuditStore(path.join(options.rootDir, 'audit.json'));
  const router = new DeviceMeshRouter(identity, store, capabilities, routeManager, audit);
  const httpHandler = new DeviceMeshHttp(store, capabilities, router, audit, options.apiToken, [
    new CrossDeviceAssistantPolicyHttp(assistantPolicies),
  ]);

  return {
    handleHttp: (request: http.IncomingMessage, response: http.ServerResponse, url: URL) =>
      httpHandler.handle(request, response, url),
    handleUpgrade: (request: http.IncomingMessage, socket: Duplex, head: Buffer) =>
      router.handleUpgrade(request, socket, head),
    start: () => router.start(),
    close: () => router.close(),
    request: (targetDeviceId: string, capability: string, operation: string, payload: unknown) =>
      router.request(targetDeviceId, capability, operation, payload),
    capabilities,
    store,
    onAssistantPolicyChange: (listener: (threadIds: string[]) => void) =>
      assistantPolicies.onChange(listener),
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
