import type { WorkflowAgent, WorkflowJsonValue } from './workflow-types';

export type WorkflowChatOrigin = {
  workflowId: string;
  runId: string;
  invocationId: string;
};

export type WorkflowRunnerTarget = {
  runnerKind: WorkflowAgent['runner']['kind'];
  executionDroneId: string;
  childDroneId: string | null;
  chatId: string;
  chatName: string;
};

export type WorkflowPromptResult = {
  promptRunId: string;
  text: string;
  changedFiles?: string[];
  usage?: WorkflowJsonValue | null;
};

/**
 * The executor depends on this small boundary rather than DroneHub's chat
 * implementation. That keeps workflow state and control flow independently
 * testable and makes another runner possible without changing the store.
 */
export interface WorkflowRunnerGateway {
  createTarget(input: {
    ownerDroneId: string;
    origin: WorkflowChatOrigin;
    agent: WorkflowAgent;
    signal: AbortSignal;
  }): Promise<WorkflowRunnerTarget>;
  runPrompt(input: {
    target: WorkflowRunnerTarget;
    prompt: string;
    signal: AbortSignal;
  }): Promise<WorkflowPromptResult>;
  stopTarget(input: { target: WorkflowRunnerTarget }): Promise<void>;
  deleteTarget(input: { target: WorkflowRunnerTarget }): Promise<void>;
  resolveTarget?(input: { target: WorkflowRunnerTarget }): Promise<WorkflowRunnerTarget | null>;
}

export function workflowRunnerTargetFromInvocation(input: {
  agentSnapshot: WorkflowAgent;
  droneId: string;
  executionDroneId: string;
  childDroneId: string | null;
  chatId: string | null;
  lastChatName: string | null;
}): WorkflowRunnerTarget | null {
  if (!input.chatId) return null;
  return {
    runnerKind: input.agentSnapshot.runner.kind,
    executionDroneId: input.executionDroneId || input.droneId,
    childDroneId: input.childDroneId,
    chatId: input.chatId,
    chatName: input.lastChatName || 'default',
  };
}
