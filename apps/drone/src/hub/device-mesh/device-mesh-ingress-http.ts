import type http from 'node:http';
import {
  deviceMeshJson,
  readDeviceMeshBody,
  type DeviceMeshHttpExtension,
} from './device-mesh-http';
import { DeviceMeshIngress } from './device-mesh-ingress';

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
    if (url.pathname === '/api/device-mesh/ingress/ngrok/detect' && method === 'POST') {
      const status = await this.ingress.detectAndUseNgrok();
      deviceMeshJson(response, 200, { ok: true, status });
      return true;
    }
    if (url.pathname === '/api/device-mesh/ingress/ngrok/start' && method === 'POST') {
      const result = await this.ingress.startNgrok();
      deviceMeshJson(response, 200, { ok: true, ...result });
      return true;
    }
    return false;
  }
}
