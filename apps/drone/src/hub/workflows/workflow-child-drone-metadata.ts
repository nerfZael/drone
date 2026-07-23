import { commitDroneMetadataPatch } from '../drone-metadata-commands';
import type { WorkflowChatOrigin } from './workflow-runner';

export type WorkflowChildDroneMetadata = WorkflowChatOrigin & {
  ownerDroneId: string;
};

export function workflowChildDroneMetadata(entry: unknown): WorkflowChildDroneMetadata | null {
  const metadata = (entry as any)?.workflowChild;
  if (!metadata || typeof metadata !== 'object') return null;
  const ownerDroneId = String(metadata.ownerDroneId ?? '').trim();
  const workflowId = String(metadata.workflowId ?? '').trim();
  const runId = String(metadata.runId ?? '').trim();
  const invocationId = String(metadata.invocationId ?? '').trim();
  if (!ownerDroneId || !workflowId || !runId || !invocationId) return null;
  return { ownerDroneId, workflowId, runId, invocationId };
}

export function isWorkflowChildDroneEntry(entry: unknown): boolean {
  return workflowChildDroneMetadata(entry) !== null;
}

export async function tagWorkflowChildDrone(input: {
  droneId: string;
  state: 'pending' | 'real';
  metadata: WorkflowChildDroneMetadata;
}): Promise<void> {
  await commitDroneMetadataPatch({
    droneId: input.droneId,
    state: input.state,
    eventType: 'drone.workflow-child.tagged',
    payload: {
      ownerDroneId: input.metadata.ownerDroneId,
      workflowId: input.metadata.workflowId,
      runId: input.metadata.runId,
      invocationId: input.metadata.invocationId,
    },
    transform: (lifecycle) => ({
      ...lifecycle,
      workflowChild: input.metadata,
    }),
  });
}
