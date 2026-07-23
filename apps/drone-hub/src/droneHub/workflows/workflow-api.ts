import { requestJson } from '../http';
import type { DroneWorkflow, WorkflowInvocation, WorkflowRun } from './workflow-types';

function dronePath(droneId: string): string {
  return `/api/drones/${encodeURIComponent(droneId)}`;
}

export async function loadWorkflows(droneId: string): Promise<DroneWorkflow[]> {
  const response = await requestJson<{ workflows: DroneWorkflow[] }>(
    `${dronePath(droneId)}/workflows`,
  );
  return response.workflows;
}

export async function loadWorkflowRuns(droneId: string): Promise<WorkflowRun[]> {
  const response = await requestJson<{ runs: WorkflowRun[] }>(
    `${dronePath(droneId)}/workflow-runs`,
  );
  return response.runs;
}

export async function loadWorkflowInvocations(
  droneId: string,
  runId: string,
): Promise<WorkflowInvocation[]> {
  const invocations: WorkflowInvocation[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '250' });
    if (cursor) query.set('cursor', cursor);
    const response = await requestJson<{
      invocations: WorkflowInvocation[];
      nextCursor: string | null;
    }>(`${dronePath(droneId)}/workflow-runs/${encodeURIComponent(runId)}/invocations?${query}`);
    invocations.push(...response.invocations);
    cursor = response.nextCursor;
  } while (cursor);
  return invocations;
}

async function postRunAction(
  droneId: string,
  runId: string,
  action: 'approve' | 'deny' | 'cancel',
): Promise<WorkflowRun> {
  const response = await requestJson<{ run: WorkflowRun }>(
    `${dronePath(droneId)}/workflow-runs/${encodeURIComponent(runId)}/${action}`,
    { method: 'POST', body: '{}' },
  );
  return response.run;
}

export const approveWorkflowRun = (droneId: string, runId: string) =>
  postRunAction(droneId, runId, 'approve');
export const denyWorkflowRun = (droneId: string, runId: string) =>
  postRunAction(droneId, runId, 'deny');
export const cancelWorkflowRun = (droneId: string, runId: string) =>
  postRunAction(droneId, runId, 'cancel');

export async function requestWorkflowRun(
  droneId: string,
  workflowId: string,
  input: unknown,
): Promise<WorkflowRun> {
  const response = await requestJson<{ run: WorkflowRun }>(
    `${dronePath(droneId)}/workflows/${encodeURIComponent(workflowId)}/runs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    },
  );
  return response.run;
}

export async function deleteWorkflowRun(droneId: string, runId: string): Promise<void> {
  await requestJson(`${dronePath(droneId)}/workflow-runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });
}

export async function deleteWorkflow(droneId: string, workflowId: string): Promise<void> {
  await requestJson(`${dronePath(droneId)}/workflows/${encodeURIComponent(workflowId)}`, {
    method: 'DELETE',
  });
}

export function workflowEventUrl(droneId: string): string {
  return `${dronePath(droneId)}/workflows/events`;
}
