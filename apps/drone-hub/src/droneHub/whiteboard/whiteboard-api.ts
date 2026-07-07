import { requestJsonWithTimeout } from '../http';
import type {
  WhiteboardDocumentResponse,
  WhiteboardListResponse,
  WhiteboardScene,
} from './whiteboard-types';

const WHITEBOARD_REQUEST_TIMEOUT_MS = 15_000;

export async function listWhiteboards(): Promise<WhiteboardListResponse> {
  return await requestJsonWithTimeout<WhiteboardListResponse>('/api/whiteboards', undefined, WHITEBOARD_REQUEST_TIMEOUT_MS);
}

export async function readWhiteboard(id: string): Promise<WhiteboardDocumentResponse> {
  return await requestJsonWithTimeout<WhiteboardDocumentResponse>(`/api/whiteboards/${encodeURIComponent(id)}`, undefined, WHITEBOARD_REQUEST_TIMEOUT_MS);
}

export async function createWhiteboard(title: string): Promise<WhiteboardDocumentResponse> {
  return await requestJsonWithTimeout<WhiteboardDocumentResponse>('/api/whiteboards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  }, WHITEBOARD_REQUEST_TIMEOUT_MS);
}

export async function saveWhiteboard(input: {
  id: string;
  baseVersion: number;
  title?: string;
  scene: WhiteboardScene;
}): Promise<WhiteboardDocumentResponse> {
  return await requestJsonWithTimeout<WhiteboardDocumentResponse>(`/api/whiteboards/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseVersion: input.baseVersion,
      title: input.title,
      scene: input.scene,
    }),
  }, WHITEBOARD_REQUEST_TIMEOUT_MS);
}
