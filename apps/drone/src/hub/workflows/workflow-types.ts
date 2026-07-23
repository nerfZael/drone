export type WorkflowJsonPrimitive = string | number | boolean | null;
export type WorkflowJsonValue =
  | WorkflowJsonPrimitive
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue };

export type WorkflowPermission = 'workspace:read' | 'workspace:write' | 'process:execute';
export type WorkflowRunnerKind = 'drone-chat' | 'drone';
export type WorkflowBuiltinAgentId = 'blip' | 'codex';

export type WorkflowJsonSchema =
  | {
      type: 'object';
      description?: string;
      properties: Record<string, WorkflowJsonSchema>;
      required?: string[];
      additionalProperties: false;
    }
  | {
      type: 'array';
      description?: string;
      items: WorkflowJsonSchema;
      maxItems?: number;
    }
  | {
      type: 'string';
      description?: string;
      enum?: string[];
    }
  | {
      type: 'number' | 'integer';
      description?: string;
      minimum?: number;
      maximum?: number;
    }
  | {
      type: 'boolean' | 'null';
      description?: string;
    };

export type WorkflowValueRef =
  | { source: 'input'; path?: string }
  | { source: 'result'; result: string; path?: string }
  | { source: 'item'; path?: string };

export type WorkflowContextRef = WorkflowValueRef & {
  as?: string;
  optional?: boolean;
};

export type WorkflowCondition =
  | {
      op: 'equals' | 'notEquals';
      value: WorkflowValueRef;
      expected: WorkflowJsonValue;
    }
  | {
      op: 'exists' | 'truthy';
      value: WorkflowValueRef;
    };

export type WorkflowNodeMetadata = {
  id: string;
  label?: string;
};

export type WorkflowCallNode = WorkflowNodeMetadata & {
  type: 'call';
  agent: string;
  prompt: string;
  contextFrom?: WorkflowContextRef[];
  outputSchema?: WorkflowJsonSchema;
};

export type WorkflowSequenceNode = WorkflowNodeMetadata & {
  type: 'sequence';
  children: WorkflowNode[];
};

export type WorkflowParallelNode = WorkflowNodeMetadata & {
  type: 'parallel';
  children: WorkflowNode[];
};

export type WorkflowForEachNode = WorkflowNodeMetadata & {
  type: 'forEach';
  itemsFrom: WorkflowValueRef;
  maxItems?: number;
  parallelism?: number;
  body: WorkflowNode;
};

export type WorkflowIfNode = WorkflowNodeMetadata & {
  type: 'if';
  condition: WorkflowCondition;
  then: WorkflowNode;
  else?: WorkflowNode;
};

export type WorkflowRepeatNode = WorkflowNodeMetadata & {
  type: 'repeat';
  maxIterations?: number;
  until: WorkflowCondition;
  body: WorkflowNode;
};

export type WorkflowNode =
  | WorkflowCallNode
  | WorkflowSequenceNode
  | WorkflowParallelNode
  | WorkflowForEachNode
  | WorkflowIfNode
  | WorkflowRepeatNode;

export type WorkflowAgent = {
  runner: {
    kind: WorkflowRunnerKind;
    agent: {
      kind: 'builtin';
      id: WorkflowBuiltinAgentId;
    };
  };
  model?: string;
  permissions: WorkflowPermission[];
  instructions: string;
};

export type WorkflowDefinition = {
  version: 1;
  inputSchema?: WorkflowJsonSchema;
  limits?: {
    maxInvocations?: number;
    maxConcurrency?: number;
    timeoutMinutes?: number;
  };
  agents: Record<string, WorkflowAgent>;
  phases: Array<{
    id: string;
    label?: string;
    run: WorkflowNode;
  }>;
  outputFrom?: string;
};

export type WorkflowActor = {
  kind: 'mcp' | 'ui' | 'system';
  id: string;
  name?: string;
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
  createdBy: WorkflowActor;
  updatedBy: WorkflowActor;
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
  droneId: string;
  workflowId: string;
  workflowVersion: number;
  workflowName: string;
  definitionHash: string;
  definitionSnapshot: WorkflowDefinition;
  input: WorkflowJsonValue;
  plan: WorkflowRunPlan;
  state: Record<string, WorkflowJsonValue>;
  status: WorkflowRunStatus;
  revision: number;
  requestedBy: WorkflowActor;
  approvedBy: WorkflowActor | null;
  requestedAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  output: WorkflowJsonValue | null;
  error: string | null;
};

export type WorkflowRunPlan = {
  timeoutMinutes: number;
  maxConcurrency: number;
  maxInvocations?: number;
  runnerKinds: WorkflowRunnerKind[];
  agentIds: WorkflowBuiltinAgentId[];
  permissions: WorkflowPermission[];
  mayWrite: boolean;
  mayExecute: boolean;
  invocationCountEstimate: number | null;
};

export type WorkflowInvocationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type WorkflowInvocation = {
  id: string;
  runId: string;
  droneId: string;
  ordinal: number;
  runtimePath: string;
  phaseId: string;
  nodeId: string;
  callId: string;
  iterationIndex: number | null;
  itemIndex: number | null;
  agentSnapshot: WorkflowAgent;
  executionDroneId: string;
  childDroneId: string | null;
  chatId: string | null;
  lastChatName: string | null;
  promptRunId: string | null;
  status: WorkflowInvocationStatus;
  startedAt: string | null;
  finishedAt: string | null;
  textResult: string | null;
  structuredResult: WorkflowJsonValue | null;
  changedFiles: string[];
  usage: WorkflowJsonValue | null;
  error: string | null;
};

export type WorkflowInvocationPage = {
  invocations: WorkflowInvocation[];
  nextCursor: string | null;
};

export type WorkflowDefinitionIssue = {
  path: string;
  code: string;
  message: string;
};

export type WorkflowEvent =
  | {
      type: 'workflow_definition_changed';
      droneId: string;
      workflowId: string;
      reason: 'created' | 'updated' | 'deleted';
      at: string;
    }
  | {
      type: 'workflow_run_changed';
      droneId: string;
      workflowId: string;
      runId: string;
      status: WorkflowRunStatus;
      revision: number;
      at: string;
    }
  | {
      type: 'workflow_invocation_changed';
      droneId: string;
      workflowId: string;
      runId: string;
      invocationId: string;
      status: WorkflowInvocationStatus;
      at: string;
    };
