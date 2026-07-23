import crypto from 'node:crypto';

import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  requireHubDatabase,
  type HubDatabase,
} from '../../host/hub-database';
import type {
  DroneWorkflow,
  WorkflowActor,
  WorkflowDefinition,
  WorkflowInvocation,
  WorkflowInvocationPage,
  WorkflowJsonValue,
  WorkflowRun,
  WorkflowRunPlan,
  WorkflowRunStatus,
} from './workflow-types';
import {
  invocationFromRow,
  runFromRow,
  WORKFLOW_STORE_MIGRATIONS,
  workflowFromRow,
  type InvocationRow,
  type RunRow,
  type WorkflowRow,
} from './workflow-store-schema';

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function json<T>(value: T): string {
  return JSON.stringify(value);
}

export class WorkflowStore {
  static open(database: HubDatabase = requireHubDatabase()): WorkflowStore {
    database.read((connection) =>
      applyHubDatabaseMigrations(connection, WORKFLOW_STORE_MIGRATIONS, 'workflows'),
    );
    return new WorkflowStore(database);
  }

  private constructor(private readonly database: HubDatabase) {}

  listWorkflows(droneId: string): DroneWorkflow[] {
    return this.database.read((connection) =>
      (
        connection
          .prepare('SELECT * FROM drone_workflows WHERE drone_id = ? ORDER BY updated_at DESC')
          .all(droneId) as WorkflowRow[]
      ).map(workflowFromRow),
    );
  }

  getWorkflow(droneId: string, workflowId: string): DroneWorkflow | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM drone_workflows WHERE drone_id = ? AND id = ?')
        .get(droneId, workflowId) as WorkflowRow | undefined;
      return row ? workflowFromRow(row) : null;
    });
  }

  async createWorkflow(input: {
    droneId: string;
    name: string;
    description: string;
    definition: WorkflowDefinition;
    actor: WorkflowActor;
  }): Promise<DroneWorkflow> {
    const workflowId = id('wf');
    const at = new Date().toISOString();
    await this.database.writeTransaction('create drone workflow', (connection) => {
      connection
        .prepare(
          `INSERT INTO drone_workflows (
            id, drone_id, name, description, version, definition_json,
            created_at, updated_at, created_by_json, updated_by_json
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          workflowId,
          input.droneId,
          input.name,
          input.description,
          json(input.definition),
          at,
          at,
          json(input.actor),
          json(input.actor),
        );
    });
    return this.getWorkflow(input.droneId, workflowId)!;
  }

  async updateWorkflow(input: {
    droneId: string;
    workflowId: string;
    baseVersion: number;
    name?: string;
    description?: string;
    definition?: WorkflowDefinition;
    actor: WorkflowActor;
  }): Promise<DroneWorkflow | null> {
    const at = new Date().toISOString();
    const changed = await this.database.writeTransaction('update drone workflow', (connection) => {
      const current = connection
        .prepare('SELECT * FROM drone_workflows WHERE drone_id = ? AND id = ?')
        .get(input.droneId, input.workflowId) as WorkflowRow | undefined;
      if (!current) return false;
      if (current.version !== input.baseVersion) {
        const error = new Error(
          `workflow changed since version ${input.baseVersion}; current version is ${current.version}`,
        ) as Error & { statusCode?: number };
        error.statusCode = 409;
        throw error;
      }
      connection
        .prepare(
          `UPDATE drone_workflows SET
              name = ?, description = ?, definition_json = ?, version = version + 1,
              updated_at = ?, updated_by_json = ?
            WHERE drone_id = ? AND id = ?`,
        )
        .run(
          input.name ?? current.name,
          input.description ?? current.description,
          input.definition ? json(input.definition) : current.definition_json,
          at,
          json(input.actor),
          input.droneId,
          input.workflowId,
        );
      return true;
    });
    return changed ? this.getWorkflow(input.droneId, input.workflowId) : null;
  }

  async deleteWorkflow(droneId: string, workflowId: string): Promise<boolean> {
    return await this.database.writeTransaction('delete drone workflow', (connection) => {
      return (
        connection
          .prepare('DELETE FROM drone_workflows WHERE drone_id = ? AND id = ?')
          .run(droneId, workflowId).changes > 0
      );
    });
  }

  listRuns(droneId: string, workflowId?: string): WorkflowRun[] {
    return this.database.read((connection) => {
      const rows = workflowId
        ? (connection
            .prepare(
              'SELECT * FROM drone_workflow_runs WHERE drone_id = ? AND workflow_id = ? ORDER BY requested_at DESC',
            )
            .all(droneId, workflowId) as RunRow[])
        : (connection
            .prepare(
              'SELECT * FROM drone_workflow_runs WHERE drone_id = ? ORDER BY requested_at DESC',
            )
            .all(droneId) as RunRow[]);
      return rows.map(runFromRow);
    });
  }

  getRun(droneId: string, runId: string): WorkflowRun | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM drone_workflow_runs WHERE drone_id = ? AND id = ?')
        .get(droneId, runId) as RunRow | undefined;
      return row ? runFromRow(row) : null;
    });
  }

  async createRun(input: {
    workflow: DroneWorkflow;
    input: WorkflowJsonValue;
    plan: WorkflowRunPlan;
    actor: WorkflowActor;
    definitionHash: string;
  }): Promise<WorkflowRun> {
    const runId = id('wfr');
    const at = new Date().toISOString();
    await this.database.writeTransaction('create drone workflow run', (connection) => {
      connection
        .prepare(
          `INSERT INTO drone_workflow_runs (
            id, drone_id, workflow_id, workflow_version, workflow_name,
            definition_hash, definition_json, input_json, plan_json, state_json,
            status, revision, requested_by_json, requested_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'pending_approval', 1, ?, ?, ?)`,
        )
        .run(
          runId,
          input.workflow.droneId,
          input.workflow.id,
          input.workflow.version,
          input.workflow.name,
          input.definitionHash,
          json(input.workflow.definition),
          json(input.input),
          json(input.plan),
          json(input.actor),
          at,
          at,
        );
    });
    return this.getRun(input.workflow.droneId, runId)!;
  }

  async patchRun(
    droneId: string,
    runId: string,
    patch: {
      expectedStatuses?: WorkflowRunStatus[];
      status?: WorkflowRunStatus;
      state?: Record<string, WorkflowJsonValue>;
      approvedBy?: WorkflowActor | null;
      approvedAt?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
      output?: WorkflowJsonValue | null;
      error?: string | null;
    },
  ): Promise<WorkflowRun | null> {
    const at = new Date().toISOString();
    const changed = await this.database.writeTransaction(
      'update drone workflow run',
      (connection) => {
        const current = connection
          .prepare('SELECT * FROM drone_workflow_runs WHERE drone_id = ? AND id = ?')
          .get(droneId, runId) as RunRow | undefined;
        if (!current) return false;
        if (
          patch.expectedStatuses &&
          !patch.expectedStatuses.includes(current.status as WorkflowRunStatus)
        ) {
          const error = new Error(
            `workflow run is ${current.status}; expected ${patch.expectedStatuses.join(' or ')}`,
          ) as Error & { statusCode?: number };
          error.statusCode = 409;
          throw error;
        }
        connection
          .prepare(
            `UPDATE drone_workflow_runs SET
            status = ?, state_json = ?, approved_by_json = ?, approved_at = ?,
            started_at = ?, finished_at = ?, output_json = ?, error = ?,
            revision = revision + 1, updated_at = ?
          WHERE drone_id = ? AND id = ?`,
          )
          .run(
            patch.status ?? current.status,
            patch.state ? json(patch.state) : current.state_json,
            patch.approvedBy === undefined
              ? current.approved_by_json
              : patch.approvedBy === null
                ? null
                : json(patch.approvedBy),
            patch.approvedAt === undefined ? current.approved_at : patch.approvedAt,
            patch.startedAt === undefined ? current.started_at : patch.startedAt,
            patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
            patch.output === undefined
              ? current.output_json
              : patch.output === null
                ? null
                : json(patch.output),
            patch.error === undefined ? current.error : patch.error,
            at,
            droneId,
            runId,
          );
        return true;
      },
    );
    return changed ? this.getRun(droneId, runId) : null;
  }

  async deleteRun(droneId: string, runId: string): Promise<boolean> {
    return await this.database.writeTransaction('delete drone workflow run', (connection) => {
      return (
        connection
          .prepare('DELETE FROM drone_workflow_runs WHERE drone_id = ? AND id = ?')
          .run(droneId, runId).changes > 0
      );
    });
  }

  listRunInvocations(droneId: string, runId: string): WorkflowInvocation[] {
    return this.database.read((connection) =>
      (
        connection
          .prepare(
            `SELECT * FROM drone_workflow_invocations
             WHERE drone_id = ? AND run_id = ?
             ORDER BY ordinal`,
          )
          .all(droneId, runId) as InvocationRow[]
      ).map(invocationFromRow),
    );
  }

  listWorkflowInvocations(droneId: string, workflowId: string): WorkflowInvocation[] {
    return this.database.read((connection) =>
      (
        connection
          .prepare(
            `SELECT invocation.*
             FROM drone_workflow_invocations invocation
             JOIN drone_workflow_runs run ON run.id = invocation.run_id
             WHERE invocation.drone_id = ? AND run.workflow_id = ?
             ORDER BY run.requested_at, invocation.ordinal`,
          )
          .all(droneId, workflowId) as InvocationRow[]
      ).map(invocationFromRow),
    );
  }

  listActiveInvocations(): WorkflowInvocation[] {
    return this.database.read((connection) =>
      (
        connection
          .prepare(
            `SELECT * FROM drone_workflow_invocations
             WHERE status IN ('queued', 'running')
             ORDER BY run_id, ordinal`,
          )
          .all() as InvocationRow[]
      ).map(invocationFromRow),
    );
  }

  async createInvocation(
    input: Omit<
      WorkflowInvocation,
      | 'id'
      | 'ordinal'
      | 'status'
      | 'startedAt'
      | 'finishedAt'
      | 'textResult'
      | 'structuredResult'
      | 'changedFiles'
      | 'usage'
      | 'error'
    >,
  ): Promise<WorkflowInvocation> {
    const invocationId = id('wfi');
    await this.database.writeTransaction('create workflow invocation', (connection) => {
      const ordinalRow = connection
        .prepare(
          'SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM drone_workflow_invocations WHERE run_id = ?',
        )
        .get(input.runId) as { ordinal: number };
      connection
        .prepare(
          `INSERT INTO drone_workflow_invocations (
            id, run_id, drone_id, ordinal, runtime_path, phase_id, node_id, call_id,
            iteration_index, item_index, agent_json, execution_drone_id, child_drone_id,
            chat_id, last_chat_name, prompt_run_id, status, changed_files_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', '[]')`,
        )
        .run(
          invocationId,
          input.runId,
          input.droneId,
          ordinalRow.ordinal,
          input.runtimePath,
          input.phaseId,
          input.nodeId,
          input.callId,
          input.iterationIndex,
          input.itemIndex,
          json(input.agentSnapshot),
          input.executionDroneId,
          input.childDroneId,
          input.chatId,
          input.lastChatName,
          input.promptRunId,
        );
    });
    return this.getInvocation(input.droneId, invocationId)!;
  }

  getInvocation(droneId: string, invocationId: string): WorkflowInvocation | null {
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM drone_workflow_invocations WHERE drone_id = ? AND id = ?')
        .get(droneId, invocationId) as InvocationRow | undefined;
      return row ? invocationFromRow(row) : null;
    });
  }

  async patchInvocation(
    droneId: string,
    invocationId: string,
    patch: Partial<
      Pick<
        WorkflowInvocation,
        | 'executionDroneId'
        | 'childDroneId'
        | 'chatId'
        | 'lastChatName'
        | 'promptRunId'
        | 'status'
        | 'startedAt'
        | 'finishedAt'
        | 'textResult'
        | 'structuredResult'
        | 'changedFiles'
        | 'usage'
        | 'error'
      >
    >,
  ): Promise<WorkflowInvocation | null> {
    const changed = await this.database.writeTransaction(
      'update workflow invocation',
      (connection) => {
        const current = connection
          .prepare('SELECT * FROM drone_workflow_invocations WHERE drone_id = ? AND id = ?')
          .get(droneId, invocationId) as InvocationRow | undefined;
        if (!current) return false;
        const serializeNullable = (
          value: WorkflowJsonValue | null | undefined,
          currentValue: string | null,
        ) => (value === undefined ? currentValue : value === null ? null : json(value));
        connection
          .prepare(
            `UPDATE drone_workflow_invocations SET
              execution_drone_id = ?, child_drone_id = ?,
              chat_id = ?, last_chat_name = ?, prompt_run_id = ?, status = ?,
              started_at = ?, finished_at = ?, text_result = ?,
              structured_result_json = ?, changed_files_json = ?, usage_json = ?, error = ?
            WHERE drone_id = ? AND id = ?`,
          )
          .run(
            patch.executionDroneId === undefined
              ? current.execution_drone_id
              : patch.executionDroneId,
            patch.childDroneId === undefined ? current.child_drone_id : patch.childDroneId,
            patch.chatId === undefined ? current.chat_id : patch.chatId,
            patch.lastChatName === undefined ? current.last_chat_name : patch.lastChatName,
            patch.promptRunId === undefined ? current.prompt_run_id : patch.promptRunId,
            patch.status ?? current.status,
            patch.startedAt === undefined ? current.started_at : patch.startedAt,
            patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
            patch.textResult === undefined ? current.text_result : patch.textResult,
            serializeNullable(patch.structuredResult, current.structured_result_json),
            patch.changedFiles ? json(patch.changedFiles) : current.changed_files_json,
            serializeNullable(patch.usage, current.usage_json),
            patch.error === undefined ? current.error : patch.error,
            droneId,
            invocationId,
          );
        return true;
      },
    );
    return changed ? this.getInvocation(droneId, invocationId) : null;
  }

  listInvocations(
    droneId: string,
    runId: string,
    cursor?: string,
    limit = 100,
  ): WorkflowInvocationPage {
    const normalizedLimit = Number.isSafeInteger(limit) ? limit : 100;
    const boundedLimit = Math.max(1, Math.min(250, normalizedLimit));
    return this.database.read((connection) => {
      const after = cursor ? Number.parseInt(cursor, 10) : 0;
      const rows = connection
        .prepare(
          `SELECT * FROM drone_workflow_invocations
           WHERE drone_id = ? AND run_id = ? AND ordinal > ?
           ORDER BY ordinal LIMIT ?`,
        )
        .all(
          droneId,
          runId,
          Number.isSafeInteger(after) ? after : 0,
          boundedLimit + 1,
        ) as InvocationRow[];
      const hasMore = rows.length > boundedLimit;
      const visible = rows.slice(0, boundedLimit).map(invocationFromRow);
      return {
        invocations: visible,
        nextCursor: hasMore ? String(visible[visible.length - 1]!.ordinal) : null,
      };
    });
  }

  async recoverInterruptedRuns(): Promise<number> {
    const at = new Date().toISOString();
    return await this.database.writeTransaction(
      'recover interrupted workflow runs',
      (connection) => {
        const active = connection
          .prepare(
            `SELECT id FROM drone_workflow_runs
           WHERE status IN ('queued', 'running', 'cancelling')`,
          )
          .all() as Array<{ id: string }>;
        if (active.length === 0) return 0;
        connection
          .prepare(
            `UPDATE drone_workflow_runs SET
            status = 'failed', error = 'DroneHub restarted while the workflow was running',
            finished_at = ?, updated_at = ?, revision = revision + 1
           WHERE status IN ('queued', 'running', 'cancelling')`,
          )
          .run(at, at);
        connection
          .prepare(
            `UPDATE drone_workflow_invocations SET
            status = 'failed', error = 'DroneHub restarted while the workflow invocation was running',
            finished_at = ?
           WHERE status IN ('queued', 'running')`,
          )
          .run(at);
        return active.length;
      },
    );
  }
}

/**
 * Lifecycle integration kept here so drone deletion does not need to know the
 * workflow schema. It is a no-op for profiles that have never initialized the
 * workflow store.
 */
export async function deleteDroneWorkflowRecords(droneId: string): Promise<number> {
  const database = getHubDatabase();
  if (!database) return 0;
  const available = database.read((connection) =>
    Boolean(
      connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'drone_workflows'")
        .get(),
    ),
  );
  if (!available) return 0;
  return await database.writeTransaction('delete drone workflow records', (connection) => {
    return connection.prepare('DELETE FROM drone_workflows WHERE drone_id = ?').run(droneId)
      .changes;
  });
}
