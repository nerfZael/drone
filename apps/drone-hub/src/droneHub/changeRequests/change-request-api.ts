import type {
  ChangeRequestChanges,
  ChangeRequestRevisionView,
  ChangeRequestView,
} from '@drone/hub-model/change-requests';

import { requestJson } from '../http';
type RequestPayload = { ok: true; request: ChangeRequestView };
type ChangesPayload = Pick<ChangeRequestChanges, 'counts' | 'entries' | 'revision'> & { ok: true };
export type GithubMirrorMergeMethod = 'merge' | 'squash' | 'rebase';

export function listRepositoryChangeRequests(droneId: string): Promise<ChangeRequestView[]> {
  return requestJson<{ ok: true; requests: ChangeRequestView[] }>(
    `/api/change-requests?droneId=${encodeURIComponent(droneId)}`,
  ).then((payload) => payload.requests);
}

export function changeRequestEventsUrl(droneId: string): string {
  return `/api/change-requests/events?droneId=${encodeURIComponent(droneId)}`;
}

export function getRepositoryChangeRequestByNumber(
  droneId: string,
  requestNumber: number,
): Promise<ChangeRequestView> {
  return requestJson<RequestPayload>(
    `${requestPath(requestNumber)}?droneId=${encodeURIComponent(droneId)}`,
  ).then((payload) => payload.request);
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

export function loadChangeRequestRevisions(
  requestNumber: number,
): Promise<ChangeRequestRevisionView[]> {
  return requestJson<{ ok: true; revisions: ChangeRequestRevisionView[] }>(
    `${requestPath(requestNumber)}/revisions`,
  ).then((payload) => payload.revisions);
}

export function loadChangeRequestChanges(
  requestNumber: number,
  revision?: number,
): Promise<ChangesPayload> {
  const query = revision ? `?revision=${encodeURIComponent(revision)}` : '';
  return requestJson<ChangesPayload>(`${requestPath(requestNumber)}/changes${query}`);
}

export function loadChangeRequestDiff(
  requestNumber: number,
  filePath: string,
  revision?: number,
): Promise<{ diff: string; truncated: boolean }> {
  const revisionQuery = revision ? `&revision=${encodeURIComponent(revision)}` : '';
  return requestJson<{ ok: true; diff: string; truncated: boolean }>(
    `${requestPath(requestNumber)}/diff?path=${encodeURIComponent(filePath)}&contextLines=5${revisionQuery}`,
  );
}

export function refreshChangeRequestAssessment(requestNumber: number): Promise<ChangeRequestView> {
  return requestMutation(`${requestPath(requestNumber)}/refresh-assessment`, 'POST');
}

export function updateChangeRequest(
  requestNumber: number,
  input: {
    title?: string;
    description?: string;
    destinationBranch?: string;
    refreshSnapshot?: boolean;
  },
): Promise<ChangeRequestView> {
  return requestMutation(requestPath(requestNumber), 'PATCH', input);
}

export function mergeChangeRequest(
  requestNumber: number,
  commitMessage?: string,
): Promise<ChangeRequestView> {
  return requestMutation(`${requestPath(requestNumber)}/merge`, 'POST', {
    actor: userActor(),
    commitMessage,
  });
}

export function closeChangeRequest(requestNumber: number): Promise<ChangeRequestView> {
  return requestMutation(`${requestPath(requestNumber)}/close`, 'POST');
}

export function publishChangeRequestMirror(
  requestNumber: number,
  input: { merge: boolean; mergeMethod: GithubMirrorMergeMethod },
): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestNumber)}/publish`, 'POST', input);
}

export function syncChangeRequestMirror(requestNumber: number): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestNumber)}/sync`, 'POST');
}

export function refreshChangeRequestMirror(requestNumber: number): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestNumber)}/refresh`, 'POST');
}

export function setChangeRequestMirrorAutoUpdate(
  requestNumber: number,
  autoUpdate: boolean,
): Promise<ChangeRequestView> {
  return requestMutation(githubPath(requestNumber), 'PATCH', { autoUpdate });
}

export function mergeChangeRequestMirror(
  requestNumber: number,
  method: GithubMirrorMergeMethod,
): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestNumber)}/merge`, 'POST', { method });
}

export function closeChangeRequestMirror(requestNumber: number): Promise<ChangeRequestView> {
  return requestMutation(`${githubPath(requestNumber)}/close`, 'POST');
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

function requestPath(requestNumber: number): string {
  return `/api/change-requests/${encodeURIComponent(requestNumber)}`;
}

function githubPath(requestNumber: number): string {
  return `${requestPath(requestNumber)}/github`;
}

function userActor() {
  return { kind: 'user' as const, id: null, label: 'DroneHub user' };
}
