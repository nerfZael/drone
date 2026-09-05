import type http from 'node:http';
import {
  deviceMeshJson,
  readDeviceMeshBody,
  type DeviceMeshHttpExtension,
} from './device-mesh-http';
import { DeviceMeshIngress } from './device-mesh-ingress';
import { tailscaleSetupError } from './device-mesh-tailscale';

export class DeviceMeshIngressHttp implements DeviceMeshHttpExtension {
  constructor(private readonly ingress: DeviceMeshIngress) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const method = String(request.method ?? 'GET').toUpperCase();
    if (url.pathname === '/api/device-mesh/ingress' && method === 'GET') {
      deviceMeshJson(response, 200, { ok: true, status: this.ingress.status() });
      return true;
    }
    if (url.pathname === '/api/device-mesh/ingress' && method === 'PUT') {
      const body = await readDeviceMeshBody(request);
      const status = await this.ingress.update({
        port: body.port,
        publicEndpoint: body.publicEndpoint,
      });
      deviceMeshJson(response, 200, { ok: true, status });
      return true;
    }
    if (url.pathname === '/api/device-mesh/ingress/tailscale' && method === 'GET') {
      const tailscale = await this.ingress.refreshTailscale();
      deviceMeshJson(response, 200, { ok: true, tailscale });
      return true;
    }
    if (url.pathname === '/api/device-mesh/ingress/tailscale' && method === 'POST') {
      try {
        const status = await this.ingress.enableTailscale();
        deviceMeshJson(response, 200, { ok: true, status });
      } catch (error) {
        const failure = tailscaleSetupError(error);
        deviceMeshJson(response, 400, {
          ok: false,
          error: failure.message,
          code: failure.code,
          details: failure.details,
        });
      }
      return true;
    }
    return false;
  }
}
