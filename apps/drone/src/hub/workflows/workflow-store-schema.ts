import type { HubDatabaseMigration } from '../../host/hub-database';
import type {
  DroneWorkflow,
  WorkflowInvocation,
  WorkflowInvocationStatus,
  WorkflowRun,
  WorkflowRunStatus,
} from './workflow-types';

export type WorkflowRow = {
  id: string;
  drone_id: string;
  name: string;
  description: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
  created_by_json: string;
  updated_by_json: string;
};

export type RunRow = {
  id: string;
  drone_id: string;
  workflow_id: string;
  workflow_version: number;
  workflow_name: string;
  definition_hash: string;
  definition_json: string;
  input_json: string;
  plan_json: string;
  state_json: string;
  status: string;
  revision: number;
  requested_by_json: string;
  approved_by_json: string | null;
  requested_at: string;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  output_json: string | null;
  error: string | null;
};

export type InvocationRow = {
  id: string;
  run_id: string;
  drone_id: string;
  ordinal: number;
  runtime_path: string;
  phase_id: string;
  node_id: string;
  call_id: string;
  iteration_index: number | null;
  item_index: number | null;
  agent_json: string;
  execution_drone_id: string | null;
  child_drone_id: string | null;
  chat_id: string | null;
  last_chat_name: string | null;
  prompt_run_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  text_result: string | null;
  structured_result_json: string | null;
  changed_files_json: string;
  usage_json: string | null;
  error: string | null;
};

export const WORKFLOW_STORE_MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'drone workflows, runs, and invocations',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE drone_workflows (
          id TEXT NOT NULL PRIMARY KEY,
          drone_id TEXT NOT NULL,
          name TEXT NOT NULL COLLATE NOCASE,
          description TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL CHECK (version > 0),
          definition_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by_json TEXT NOT NULL,
          updated_by_json TEXT NOT NULL,
          UNIQUE (drone_id, name)
        );

        CREATE INDEX idx_drone_workflows_drone_updated
          ON drone_workflows (drone_id, updated_at DESC);

        CREATE TABLE drone_workflow_runs (
          id TEXT NOT NULL PRIMARY KEY,
          drone_id TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
          workflow_name TEXT NOT NULL,
          definition_hash TEXT NOT NULL,
          definition_json TEXT NOT NULL,
          input_json TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          state_json TEXT NOT NULL,
          status TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
          requested_by_json TEXT NOT NULL,
          approved_by_json TEXT,
          requested_at TEXT NOT NULL,
          approved_at TEXT,
          started_at TEXT,
          finished_at TEXT,
          updated_at TEXT NOT NULL,
          output_json TEXT,
          error TEXT,
          FOREIGN KEY (workflow_id) REFERENCES drone_workflows(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_drone_workflow_runs_drone_updated
          ON drone_workflow_runs (drone_id, updated_at DESC);
        CREATE INDEX idx_drone_workflow_runs_workflow_updated
          ON drone_workflow_runs (workflow_id, updated_at DESC);

        CREATE TABLE drone_workflow_invocations (
          id TEXT NOT NULL PRIMARY KEY,
          run_id TEXT NOT NULL,
          drone_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          runtime_path TEXT NOT NULL,
          phase_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          call_id TEXT NOT NULL,
          iteration_index INTEGER,
          item_index INTEGER,
          agent_json TEXT NOT NULL,
          chat_id TEXT,
          last_chat_name TEXT,
          prompt_run_id TEXT,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          text_result TEXT,
          structured_result_json TEXT,
          changed_files_json TEXT NOT NULL DEFAULT '[]',
          usage_json TEXT,
          error TEXT,
          UNIQUE (run_id, ordinal),
          FOREIGN KEY (run_id) REFERENCES drone_workflow_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_drone_workflow_invocations_run_ordinal
          ON drone_workflow_invocations (run_id, ordinal);
      `);
    },
  },
  {
    version: 2,
    name: 'workflow invocation runner targets',
    migrate(connection) {
      connection.exec(`
        ALTER TABLE drone_workflow_invocations
          ADD COLUMN execution_drone_id TEXT;
        ALTER TABLE drone_workflow_invocations
          ADD COLUMN child_drone_id TEXT;

        CREATE INDEX idx_drone_workflow_invocations_child_drone
          ON drone_workflow_invocations (child_drone_id)
          WHERE child_drone_id IS NOT NULL;
      `);
    },
  },
];

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function nullableJson<T>(value: string | null): T | null {
  return value == null ? null : parseJson<T>(value);
}

export function workflowFromRow(row: WorkflowRow): DroneWorkflow {
  return {
    id: row.id,
    droneId: row.drone_id,
    name: row.name,
    description: row.description,
    version: row.version,
    definition: parseJson(row.definition_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: parseJson(row.created_by_json),
    updatedBy: parseJson(row.updated_by_json),
  };
}

export function runFromRow(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    droneId: row.drone_id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    workflowName: row.workflow_name,
    definitionHash: row.definition_hash,
    definitionSnapshot: parseJson(row.definition_json),
    input: parseJson(row.input_json),
    plan: parseJson(row.plan_json),
    state: parseJson(row.state_json),
    status: row.status as WorkflowRunStatus,
    revision: row.revision,
    requestedBy: parseJson(row.requested_by_json),
    approvedBy: nullableJson(row.approved_by_json),
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    output: nullableJson(row.output_json),
    error: row.error,
  };
}

export function invocationFromRow(row: InvocationRow): WorkflowInvocation {
  return {
    id: row.id,
    runId: row.run_id,
    droneId: row.drone_id,
    ordinal: row.ordinal,
    runtimePath: row.runtime_path,
    phaseId: row.phase_id,
    nodeId: row.node_id,
    callId: row.call_id,
    iterationIndex: row.iteration_index,
    itemIndex: row.item_index,
    agentSnapshot: parseJson(row.agent_json),
    executionDroneId: row.execution_drone_id || row.drone_id,
    childDroneId: row.child_drone_id,
    chatId: row.chat_id,
    lastChatName: row.last_chat_name,
    promptRunId: row.prompt_run_id,
    status: row.status as WorkflowInvocationStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    textResult: row.text_result,
    structuredResult: nullableJson(row.structured_result_json),
    changedFiles: parseJson(row.changed_files_json),
    usage: nullableJson(row.usage_json),
    error: row.error,
  };
}
