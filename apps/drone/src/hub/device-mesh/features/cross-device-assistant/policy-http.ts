import type http from 'node:http';
import {
  deviceMeshJson,
  readDeviceMeshBody,
  type DeviceMeshHttpExtension,
} from '../../device-mesh-http';
import { CrossDeviceAssistantPolicyStore } from './policy-store';

export class CrossDeviceAssistantPolicyHttp implements DeviceMeshHttpExtension {
  constructor(private readonly policies: CrossDeviceAssistantPolicyStore) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (url.pathname !== '/api/device-mesh/cross-device-assistant') return false;
    if (request.method === 'GET') {
      deviceMeshJson(response, 200, { ok: true, policy: await this.policies.read() });
      return true;
    }
    if (request.method === 'PUT') {
      deviceMeshJson(response, 200, {
        ok: true,
        policy: await this.policies.replace(await readDeviceMeshBody(request)),
      });
      return true;
    }
    deviceMeshJson(response, 405, { ok: false, error: 'method not allowed' });
    return true;
  }
}
