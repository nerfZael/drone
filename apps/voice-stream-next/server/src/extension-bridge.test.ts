import { describe, expect, test } from 'bun:test';

import { extensionToolName, type AssistantExtensionManifest, type AssistantExtensionToolRoute } from './assistant-extensions.js';
import { ExtensionBridgeRegistry, type ExtensionBridgeSocket } from './extension-bridge.js';

const manifest: AssistantExtensionManifest = {
  id: 'quick-extension',
  name: 'Quick Extension',
  version: '0.1.0',
  tools: [{
    name: 'echo',
    label: 'Echo',
    description: 'Echoes the input.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: true },
    approval: 'never',
    supportedTargets: ['device', 'any_device'],
    defaultTarget: 'device',
  }],
};

const toolName = extensionToolName(manifest.id, 'echo');
const route: AssistantExtensionToolRoute = {
  userId: 'user-1',
  toolName,
  enabled: true,
  targetKind: 'device',
  targetDeviceId: 'device-1',
  updatedAt: new Date(0).toISOString(),
};

function registerSocket(registry: ExtensionBridgeRegistry, socket: ExtensionBridgeSocket): void {
  registry.register(socket, {
    userId: 'user-1',
    deviceId: 'device-1',
    deviceType: 'desktop',
    displayName: 'Desktop',
    manifests: [manifest],
  });
}

describe('extension bridge registry', () => {
  test('handles an immediate extension tool result', async () => {
    const registry = new ExtensionBridgeRegistry();
    const socket: ExtensionBridgeSocket = {
      readyState: 1,
      send(data) {
        const request = JSON.parse(data);
        registry.handleClientMessage('device-1', JSON.stringify({
          type: 'extension_tool_result',
          requestId: request.requestId,
          ok: true,
          result: { args: request.args },
        }));
      },
    };
    registerSocket(registry, socket);

    const result = await registry.executeTool({
      userId: 'user-1',
      toolName,
      args: { text: 'hello' },
      route,
    });

    expect(result).toEqual({ args: { text: 'hello' } });
  });

  test('handles an immediate extension approval result', async () => {
    const registry = new ExtensionBridgeRegistry();
    const socket: ExtensionBridgeSocket = {
      readyState: 1,
      send(data) {
        const request = JSON.parse(data);
        registry.handleClientMessage('device-1', JSON.stringify({
          type: 'extension_approval_result',
          requestId: request.requestId,
          ok: true,
          approvalRequired: request.args.target !== 'created-by-extension',
        }));
      },
    };
    registerSocket(registry, socket);

    const approvalRequired = await registry.evaluateApproval({
      userId: 'user-1',
      toolName,
      args: { target: 'created-by-extension' },
      route,
    });

    expect(approvalRequired).toBe(false);
  });

  test('rejects unexpected response types instead of waiting for timeout', async () => {
    const registry = new ExtensionBridgeRegistry();
    const socket: ExtensionBridgeSocket = {
      readyState: 1,
      send(data) {
        const request = JSON.parse(data);
        registry.handleClientMessage('device-1', JSON.stringify({
          type: 'extension_tool_result',
          requestId: request.requestId,
          ok: true,
          result: {},
        }));
      },
    };
    registerSocket(registry, socket);

    await expect(registry.evaluateApproval({
      userId: 'user-1',
      toolName,
      args: {},
      route,
    })).rejects.toThrow('unexpected extension response type');
  });

  test('rejects pending tool calls when a runner disconnects', async () => {
    const registry = new ExtensionBridgeRegistry();
    const socket: ExtensionBridgeSocket = { readyState: 1, send() {} };
    registerSocket(registry, socket);
    expect(registry.hasConnectedExtension('user-1', manifest.id)).toBe(true);

    const pending = registry.executeTool({
      userId: 'user-1',
      toolName,
      args: {},
      route,
    });
    const registration = registry.unregister(socket);

    expect(registration?.manifests[0]?.id).toBe(manifest.id);
    expect(registry.hasConnectedExtension('user-1', manifest.id)).toBe(false);
    await expect(pending).rejects.toThrow('extension runner disconnected');
  });
});
