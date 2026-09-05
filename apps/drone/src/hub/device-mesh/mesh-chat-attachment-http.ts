import type http from 'node:http';
import { deviceMeshJson, type DeviceMeshHttpExtension } from './device-mesh-http';
import { MeshChatAttachmentStore } from './mesh-chat-attachment-store';

export class MeshChatAttachmentHttp implements DeviceMeshHttpExtension {
  constructor(private readonly attachments: MeshChatAttachmentStore) {}

  async handle(): Promise<boolean> {
    return false;
  }

  async handlePublic(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const parts = url.pathname.split('/').filter(Boolean);
    if (
      parts.length === 4 &&
      parts[0] === 'api' &&
      parts[1] === 'device-mesh' &&
      parts[2] === 'attachments'
    ) {
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('access-control-allow-methods', 'PUT, OPTIONS');
      response.setHeader(
        'access-control-allow-headers',
        'content-type, x-upload-token, x-upload-offset',
      );
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
        return true;
      }
    }
    if (
      String(request.method ?? 'GET').toUpperCase() !== 'PUT' ||
      parts.length !== 4 ||
      parts[0] !== 'api' ||
      parts[1] !== 'device-mesh' ||
      parts[2] !== 'attachments'
    )
      return false;
    try {
      const result = await this.attachments.writeHttp(
        decodeURIComponent(parts[3]!),
        String(request.headers['x-upload-token'] ?? ''),
        request.headers['x-upload-offset'] ?? 0,
        request,
      );
      deviceMeshJson(response, 200, { ok: true, ...result });
    } catch (error: any) {
      const status = error?.code === 'UNAUTHORIZED' ? 401 : error?.code === 'NOT_FOUND' ? 404 : 400;
      deviceMeshJson(response, status, { ok: false, error: error?.message ?? String(error) });
    }
    return true;
  }
}
