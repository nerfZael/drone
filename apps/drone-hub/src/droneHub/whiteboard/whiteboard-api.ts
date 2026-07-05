import { requestJson } from '../http';
import type {
  WhiteboardDocumentResponse,
  WhiteboardListResponse,
  WhiteboardScene,
} from './whiteboard-types';

export async function listWhiteboards(): Promise<WhiteboardListResponse> {
  return await requestJson<WhiteboardListResponse>('/api/whiteboards');
}

export async function readWhiteboard(id: string): Promise<WhiteboardDocumentResponse> {
  return await requestJson<WhiteboardDocumentResponse>(`/api/whiteboards/${encodeURIComponent(id)}`);
}

export async function createWhiteboard(title: string): Promise<WhiteboardDocumentResponse> {
  return await requestJson<WhiteboardDocumentResponse>('/api/whiteboards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function saveWhiteboard(input: {
  id: string;
  baseVersion: number;
  title?: string;
  scene: WhiteboardScene;
}): Promise<WhiteboardDocumentResponse> {
  return await requestJson<WhiteboardDocumentResponse>(`/api/whiteboards/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersion: input.baseVersion,
      title: input.title,
      scene: input.scene,
    }),
  });
}
