import type http from 'node:http';
import { DRONE_CONTROL_CAPABILITY } from '@drone/device-protocol';
import type { DeviceMeshHttpExtension } from './device-mesh-http';
import { deviceMeshJson, readDeviceMeshBody } from './device-mesh-http-helpers';
import type { DeviceMeshRouter } from './device-mesh-router';
import type { DeviceMeshStore } from './device-mesh-store';

const DESKTOP_DRONE_CONTROL_PATH = '/api/device-mesh/drone-control';

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

/**
 * Local-admin bridge used by the desktop UI. It deliberately exposes only the versioned
 * drone-control capability instead of turning the mesh into a generic HTTP proxy.
 */
export class DesktopDroneControlHttp implements DeviceMeshHttpExtension {
  constructor(
    private readonly router: DeviceMeshRouter,
    private readonly store: DeviceMeshStore,
  ) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== DESKTOP_DRONE_CONTROL_PATH) return false;
    if (String(request.method ?? 'GET').toUpperCase() !== 'POST') {
      deviceMeshJson(response, 405, { ok: false, error: 'method not allowed' });
      return true;
    }

    const body = await readDeviceMeshBody(request);
    const targetDeviceId = requiredText(body.targetDeviceId, 'targetDeviceId');
    const operation = requiredText(body.operation, 'operation');
    if (!DRONE_CONTROL_CAPABILITY.operations.includes(operation as any)) {
      deviceMeshJson(response, 400, {
        ok: false,
        error: `unsupported drone-control operation: ${operation}`,
      });
      return true;
    }

    const state = await this.store.read();
    const target = state.devices[targetDeviceId];
    if (!target || target.revokedAt) {
      deviceMeshJson(response, 404, { ok: false, error: 'target device is not active' });
      return true;
    }
    if (targetDeviceId === state.selfDeviceId) {
      deviceMeshJson(response, 400, {
        ok: false,
        error: 'local drone requests must use the local Hub API',
      });
      return true;
    }

    const payload =
      body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : {};
    const result = await this.router.request(
      targetDeviceId,
      DRONE_CONTROL_CAPABILITY.id,
      operation,
      payload,
    );
    deviceMeshJson(response, 200, { ok: true, result });
    return true;
  }
}
