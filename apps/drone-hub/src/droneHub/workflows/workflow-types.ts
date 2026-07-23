export type WorkflowRunnerKind = 'drone-chat' | 'drone';
export type WorkflowBuiltinAgentId = 'blip' | 'codex';

export type WorkflowNode =
  | {
      id: string;
      label?: string;
      type: 'call';
      agent: string;
      prompt: string;
      contextFrom?: unknown[];
      outputSchema?: unknown;
    }
  | { id: string; label?: string; type: 'sequence' | 'parallel'; children: WorkflowNode[] }
  | {
      id: string;
      label?: string;
      type: 'forEach';
      itemsFrom: unknown;
      maxItems?: number;
      parallelism?: number;
      body: WorkflowNode;
    }
  | {
      id: string;
      label?: string;
      type: 'if';
      condition: unknown;
      then: WorkflowNode;
      else?: WorkflowNode;
    }
  | {
      id: string;
      label?: string;
      type: 'repeat';
      maxIterations?: number;
      until: unknown;
      body: WorkflowNode;
    };

export type WorkflowDefinition = {
  version: 1;
  inputSchema?: unknown;
  limits?: {
    maxInvocations?: number;
    maxConcurrency?: number;
    timeoutMinutes?: number;
  };
  agents: Record<
    string,
    {
      runner: {
        kind: WorkflowRunnerKind;
        agent: { kind: 'builtin'; id: WorkflowBuiltinAgentId };
      };
      model?: string;
      permissions: string[];
      instructions: string;
    }
  >;
  phases: Array<{ id: string; label?: string; run: WorkflowNode }>;
  outputFrom?: string;
};

export type DroneWorkflow = {
  id: string;
  droneId: string;
  name: string;
  description: string;
  version: number;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunStatus =
  | 'pending_approval'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'denied';

export type WorkflowRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  revision: number;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  plan: {
    timeoutMinutes: number;
    maxConcurrency: number;
    maxInvocations?: number;
    runnerKinds?: WorkflowRunnerKind[];
    agentIds?: WorkflowBuiltinAgentId[];
    permissions: string[];
    mayWrite: boolean;
    mayExecute: boolean;
    invocationCountEstimate: number | null;
  };
  input: unknown;
  output: unknown;
  error: string | null;
};

export type WorkflowInvocation = {
  id: string;
  ordinal: number;
  runtimePath: string;
  phaseId: string;
  nodeId: string;
  agentSnapshot: {
    runner: {
      kind: WorkflowRunnerKind;
      agent: { kind: 'builtin'; id: WorkflowBuiltinAgentId };
    };
    model?: string;
    permissions: string[];
  };
  executionDroneId: string;
  childDroneId: string | null;
  chatId: string | null;
  lastChatName: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string | null;
  finishedAt: string | null;
  textResult: string | null;
  structuredResult: unknown;
  error: string | null;
};
