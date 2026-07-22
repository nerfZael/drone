import { requestJsonWithTimeout } from '../http';
import type {
  WhiteboardDocumentResponse,
  WhiteboardListResponse,
  WhiteboardScene,
} from './whiteboard-types';

const WHITEBOARD_REQUEST_TIMEOUT_MS = 15_000;

export async function listWhiteboards(droneId?: string): Promise<WhiteboardListResponse> {
  const scopeValue = String(droneId ?? '').trim();
  const query = scopeValue ? `?scopeType=drone&scopeValue=${encodeURIComponent(scopeValue)}` : '';
  return await requestJsonWithTimeout<WhiteboardListResponse>(`/api/whiteboards${query}`, undefined, WHITEBOARD_REQUEST_TIMEOUT_MS);
}

export async function readWhiteboard(id: string): Promise<WhiteboardDocumentResponse> {
  return await requestJsonWithTimeout<WhiteboardDocumentResponse>(`/api/whiteboards/${encodeURIComponent(id)}`, undefined, WHITEBOARD_REQUEST_TIMEOUT_MS);
}

export async function createWhiteboard(title: string, droneId?: string, id?: string): Promise<WhiteboardDocumentResponse> {
  const scopeValue = String(droneId ?? '').trim();
  const requestedId = String(id ?? '').trim();
  return await requestJsonWithTimeout<WhiteboardDocumentResponse>('/api/whiteboards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title,
      ...(requestedId ? { id: requestedId } : {}),
      ...(scopeValue ? { scopeType: 'drone', scopeValue } : {}),
    }),
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
