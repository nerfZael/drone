import type { ChangeRequestChanges, ChangeRequestView } from '@drone/hub-model/change-requests';

import { requestJson } from '../http';
type RequestPayload = { ok: true; request: ChangeRequestView };
type ChangesPayload = Pick<ChangeRequestChanges, 'counts' | 'entries'> & { ok: true };
export type GithubMirrorMergeMethod = 'merge' | 'squash' | 'rebase';

export function listChangeRequests(droneId: string): Promise<ChangeRequestView[]> {
  return requestJson<{ ok: true; requests: ChangeRequestView[] }>(
    `/api/change-requests?droneId=${encodeURIComponent(droneId)}`,
  ).then((payload) => payload.requests);
}

export function createChangeRequest(input: {
  droneRef: string;
  chatName: string;
  title: string;
  description?: string;
  destinationBranch?: string;
}): Promise<ChangeRequestView> {
  return requestMutation('/api/change-requests', 'POST', {
    ...input,
    actor: userActor(),
  });
}

export function loadChangeRequestChanges(requestId: string): Promise<ChangesPayload> {
  return requestJson<ChangesPayload>(`${requestPath(requestId)}/changes`);
}

export function loadChangeRequestDiff(
  requestId: string,
  filePath: string,
): Promise<{ diff: string; truncated: boolean }> {
  return requestJson<{ ok: true; diff: string; truncated: boolean }>(
    `${requestPath(requestId)}/diff?path=${encodeURIComponent(filePath)}&contextLines=5`,
  );
}

export function refreshChangeRequestAssessment(requestId: string): Promise<ChangeRequestView> {
  return requestMutation(`${requestPath(requestId)}/refresh-assessment`, 'POST');
}

export function updateChangeRequest(
  requestId: string,
  input: {
    title?: string;
    description?: string;
    destinationBranch?: string;
    refreshSnapshot?: boolean;
  },
): Promise<ChangeRequestView> {
  return requestMutation(requestPath(requestId), 'PATCH', input);
}

export function mergeChangeRequest(
  requestId: string,
  commitMessage?: string,
): Promise<ChangeRequestView> {
  return requestMutation(`${requestPath(requestId)}/merge`, 'POST', {
    actor: userActor(),
    commitMessage,
  });
}

export function closeChangeRequest(requestId: string): Promise<ChangeRequestView> {
  return requestMutation(`${requestPath(requestId)}/close`, 'POST');
}

export function publishChangeRequestMirror(
  requestId: string,
  input: { merge: boolean; mergeMethod: GithubMirrorMergeMethod },
): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestId)}/publish`, 'POST', input);
}

export function syncChangeRequestMirror(requestId: string): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestId)}/sync`, 'POST');
}

export function refreshChangeRequestMirror(requestId: string): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestId)}/refresh`, 'POST');
}

export function setChangeRequestMirrorAutoUpdate(
  requestId: string,
  autoUpdate: boolean,
): Promise<ChangeRequestView> {
  return requestMutation(githubPath(requestId), 'PATCH', { autoUpdate });
}

export function mergeChangeRequestMirror(
  requestId: string,
  method: GithubMirrorMergeMethod,
): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestId)}/merge`, 'POST', { method });
}

export function closeChangeRequestMirror(requestId: string): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestId)}/close`, 'POST');
}

async function requestMutation(
  pathname: string,
  method: 'PATCH' | 'POST',
  body?: Record<string, unknown>,
): Promise<ChangeRequestView> {
  const payload = await requestJson<RequestPayload>(pathname, {
    method,
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  return payload.request;
}

function requestPath(requestId: string): string {
  return `/api/change-requests/${encodeURIComponent(requestId)}`;
}

function githubPath(requestId: string): string {
  return `${requestPath(requestId)}/github`;
}

function userActor() {
  return { kind: 'user' as const, id: null, label: 'DroneHub user' };
}
