import crypto from 'node:crypto';

import { WorkflowEventBus } from './workflow-events';
import { WorkflowExecutor } from './workflow-executor';
import { type WorkflowRunnerGateway, workflowRunnerTargetFromInvocation } from './workflow-runner';
import { WorkflowStore } from './workflow-store';
import {
  workflowCreateInputSchema,
  workflowUpdateInputSchema,
  workflowJsonValueSchema,
} from './workflow-schema';
import { parseWorkflowDefinition, validateWorkflowJsonSchema } from './workflow-validator';
import type {
  DroneWorkflow,
  WorkflowActor,
  WorkflowDefinition,
  WorkflowInvocation,
  WorkflowInvocationPage,
  WorkflowJsonValue,
  WorkflowPermission,
  WorkflowRun,
  WorkflowRunPlan,
} from './workflow-types';

const ACTIVE_STATUSES = new Set(['pending_approval', 'queued', 'running', 'cancelling']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'denied']);
const MAX_RUN_INPUT_BYTES = 256 * 1024;

function errorWithStatus(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function requireUpdatedRun(run: WorkflowRun | null): WorkflowRun {
  if (!run) throw errorWithStatus('workflow run not found', 404);
  return run;
}

function hashDefinition(definition: WorkflowDefinition): string {
  return crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function collectPermissions(definition: WorkflowDefinition): WorkflowPermission[] {
  const values = new Set<WorkflowPermission>();
  for (const agent of Object.values(definition.agents)) {
    for (const permission of agent.permissions) values.add(permission);
  }
  return ['workspace:read', 'workspace:write', 'process:execute'].filter((permission) =>
    values.has(permission as WorkflowPermission),
  ) as WorkflowPermission[];
}

function estimateInvocations(definition: WorkflowDefinition): number | null {
  const estimateNode = (node: WorkflowDefinition['phases'][number]['run']): number | null => {
    switch (node.type) {
      case 'call':
        return 1;
      case 'sequence':
      case 'parallel': {
        let total = 0;
        for (const child of node.children) {
          const count = estimateNode(child);
          if (count === null) return null;
          total += count;
        }
        return total;
      }
      case 'if': {
        const thenCount = estimateNode(node.then);
        const elseCount = node.else ? estimateNode(node.else) : 0;
        return thenCount === null || elseCount === null ? null : Math.max(thenCount, elseCount);
      }
      case 'forEach': {
        const body = estimateNode(node.body);
        return body !== null && node.maxItems !== undefined ? body * node.maxItems : null;
      }
      case 'repeat': {
        const body = estimateNode(node.body);
        return body !== null && node.maxIterations !== undefined ? body * node.maxIterations : null;
      }
    }
  };
  let total = 0;
  for (const phase of definition.phases) {
    const count = estimateNode(phase.run);
    if (count === null) return null;
    total += count;
  }
  return total;
}

export class WorkflowService {
  readonly events = new WorkflowEventBus();
  private readonly executor: WorkflowExecutor;
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly activeRunTasks = new Map<string, Promise<void>>();
  private readonly defaultTimeoutMinutes: number;
  private readonly executorCapacity: number;
  private readonly droneExists: (droneId: string) => Promise<boolean>;
  private stopped = false;

  constructor(
    readonly store: WorkflowStore,
    private readonly runnerGateway: WorkflowRunnerGateway,
    options?: {
      defaultTimeoutMinutes?: number;
      executorCapacity?: number;
      droneExists?: (droneId: string) => Promise<boolean>;
    },
  ) {
    this.defaultTimeoutMinutes =
      options?.defaultTimeoutMinutes ??
      positiveInteger(process.env.DRONE_HUB_WORKFLOW_TIMEOUT_MINUTES, 30);
    this.executorCapacity =
      options?.executorCapacity ?? positiveInteger(process.env.DRONE_HUB_WORKFLOW_CONCURRENCY, 4);
    this.droneExists = options?.droneExists ?? (async () => true);
    this.executor = new WorkflowExecutor(store, runnerGateway, this.events);
  }

  async initialize(): Promise<void> {
    const interruptedTargets = this.store
      .listActiveInvocations()
      .map(workflowRunnerTargetFromInvocation)
      .filter((target) => target !== null);
    await this.store.recoverInterruptedRuns();
    await Promise.allSettled(
      interruptedTargets.map((target) => this.runnerGateway.stopTarget({ target })),
    );
  }

  listWorkflows(droneId: string): DroneWorkflow[] {
    return this.store.listWorkflows(droneId);
  }

  getWorkflow(droneId: string, workflowId: string): DroneWorkflow {
    const workflow = this.store.getWorkflow(droneId, workflowId);
    if (!workflow) throw errorWithStatus('workflow not found', 404);
    return workflow;
  }

  async createWorkflow(
    droneId: string,
    raw: unknown,
    actor: WorkflowActor,
  ): Promise<DroneWorkflow> {
    if (!(await this.droneExists(droneId))) {
      throw errorWithStatus(`unknown or unavailable drone: ${droneId}`, 404);
    }
    const input = workflowCreateInputSchema.parse(raw);
    const workflow = await this.store.createWorkflow({
      droneId,
      name: input.name,
      description: input.description ?? '',
      definition: parseWorkflowDefinition(input.definition),
      actor,
    });
    this.publishDefinition(workflow, 'created');
    return workflow;
  }

  async updateWorkflow(
    droneId: string,
    workflowId: string,
    raw: unknown,
    actor: WorkflowActor,
  ): Promise<DroneWorkflow> {
    const input = workflowUpdateInputSchema.parse(raw);
    const workflow = await this.store.updateWorkflow({
      droneId,
      workflowId,
      baseVersion: input.baseVersion,
      name: input.name,
      description: input.description,
      definition: input.definition ? parseWorkflowDefinition(input.definition) : undefined,
      actor,
    });
    if (!workflow) throw errorWithStatus('workflow not found', 404);
    this.publishDefinition(workflow, 'updated');
    return workflow;
  }

  async deleteWorkflow(droneId: string, workflowId: string): Promise<void> {
    const workflow = this.getWorkflow(droneId, workflowId);
    if (this.store.listRuns(droneId, workflowId).some((run) => ACTIVE_STATUSES.has(run.status))) {
      throw errorWithStatus('workflow cannot be deleted while it has a pending or active run', 409);
    }
    await this.deleteInvocationTargets(this.store.listWorkflowInvocations(droneId, workflowId));
    if (!(await this.store.deleteWorkflow(droneId, workflowId))) {
      throw errorWithStatus('workflow not found', 404);
    }
    this.publishDefinition(workflow, 'deleted');
  }

  listRuns(droneId: string, workflowId?: string): WorkflowRun[] {
    return this.store.listRuns(droneId, workflowId);
  }

  getRun(droneId: string, runId: string): WorkflowRun {
    const run = this.store.getRun(droneId, runId);
    if (!run) throw errorWithStatus('workflow run not found', 404);
    return run;
  }

  async requestRun(
    droneId: string,
    workflowId: string,
    rawInput: unknown,
    actor: WorkflowActor,
  ): Promise<WorkflowRun> {
    this.assertAcceptingRuns();
    const workflow = this.getWorkflow(droneId, workflowId);
    const parsedInput = workflowJsonValueSchema.safeParse(rawInput === undefined ? {} : rawInput);
    if (!parsedInput.success) throw errorWithStatus('workflow input must be valid JSON', 400);
    const input = parsedInput.data as WorkflowJsonValue;
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_RUN_INPUT_BYTES) {
      throw errorWithStatus(`workflow input exceeds ${MAX_RUN_INPUT_BYTES} bytes`, 413);
    }
    if (workflow.definition.inputSchema) {
      const errors = validateWorkflowJsonSchema(workflow.definition.inputSchema, input);
      if (errors.length > 0)
        throw errorWithStatus(`invalid workflow input: ${errors.join('; ')}`, 400);
    }
    const permissions = collectPermissions(workflow.definition);
    const workflowAgents = Object.values(workflow.definition.agents);
    const plan: WorkflowRunPlan = {
      timeoutMinutes: workflow.definition.limits?.timeoutMinutes ?? this.defaultTimeoutMinutes,
      maxConcurrency: Math.min(
        workflow.definition.limits?.maxConcurrency ?? this.executorCapacity,
        this.executorCapacity,
      ),
      ...(workflow.definition.limits?.maxInvocations === undefined
        ? {}
        : { maxInvocations: workflow.definition.limits.maxInvocations }),
      runnerKinds: [...new Set(workflowAgents.map((agent) => agent.runner.kind))],
      agentIds: [...new Set(workflowAgents.map((agent) => agent.runner.agent.id))],
      permissions,
      mayWrite: permissions.includes('workspace:write'),
      mayExecute: permissions.includes('process:execute'),
      invocationCountEstimate: estimateInvocations(workflow.definition),
    };
    const run = await this.store.createRun({
      workflow,
      input,
      plan,
      actor,
      definitionHash: hashDefinition(workflow.definition),
    });
    this.publishRun(run);
    return run;
  }

  async approveRun(droneId: string, runId: string, actor: WorkflowActor): Promise<WorkflowRun> {
    this.assertAcceptingRuns();
    const current = this.getRun(droneId, runId);
    if (current.status !== 'pending_approval') {
      throw errorWithStatus('only a pending workflow run can be approved', 409);
    }
    const at = new Date().toISOString();
    const run = requireUpdatedRun(
      await this.store.patchRun(droneId, runId, {
        expectedStatuses: ['pending_approval'],
        status: 'queued',
        approvedBy: actor,
        approvedAt: at,
      }),
    );
    this.publishRun(run);
    if (this.stopped) {
      const cancelled = requireUpdatedRun(
        await this.store.patchRun(droneId, runId, {
          expectedStatuses: ['queued'],
          status: 'cancelled',
          error: 'DroneHub is shutting down',
          finishedAt: new Date().toISOString(),
        }),
      );
      this.publishRun(cancelled);
      this.assertAcceptingRuns();
    }
    this.launchRun(run);
    return run;
  }

  async denyRun(droneId: string, runId: string, actor: WorkflowActor): Promise<WorkflowRun> {
    const current = this.getRun(droneId, runId);
    if (current.status !== 'pending_approval') {
      throw errorWithStatus('only a pending workflow run can be denied', 409);
    }
    const at = new Date().toISOString();
    const run = requireUpdatedRun(
      await this.store.patchRun(droneId, runId, {
        expectedStatuses: ['pending_approval'],
        status: 'denied',
        approvedBy: actor,
        approvedAt: at,
        finishedAt: at,
      }),
    );
    this.publishRun(run);
    return run;
  }

  async cancelRun(droneId: string, runId: string): Promise<WorkflowRun> {
    const current = this.getRun(droneId, runId);
    if (!['queued', 'running', 'cancelling'].includes(current.status)) {
      throw errorWithStatus('workflow run is not active', 409);
    }
    const run = requireUpdatedRun(
      await this.store.patchRun(droneId, runId, {
        expectedStatuses: ['queued', 'running', 'cancelling'],
        status: 'cancelling',
      }),
    );
    this.publishRun(run);
    this.activeRuns.get(runId)?.abort(new Error('workflow cancelled by user'));
    return run;
  }

  async deleteRun(droneId: string, runId: string): Promise<void> {
    const run = this.getRun(droneId, runId);
    if (!TERMINAL_STATUSES.has(run.status)) {
      throw errorWithStatus('only a finished workflow run can be deleted', 409);
    }
    await this.deleteInvocationTargets(this.store.listRunInvocations(droneId, runId));
    if (!(await this.store.deleteRun(droneId, runId))) {
      throw errorWithStatus('workflow run not found', 404);
    }
    this.events.publish({
      type: 'workflow_run_changed',
      droneId,
      workflowId: run.workflowId,
      runId,
      status: run.status,
      revision: run.revision + 1,
      at: new Date().toISOString(),
    });
  }

  async listInvocations(
    droneId: string,
    runId: string,
    cursor?: string,
    limit?: number,
  ): Promise<WorkflowInvocationPage> {
    this.getRun(droneId, runId);
    const page = this.store.listInvocations(droneId, runId, cursor, limit);
    if (!this.runnerGateway.resolveTarget) return page;
    await Promise.all(
      page.invocations.map(async (invocation) => {
        const target = workflowRunnerTargetFromInvocation(invocation);
        if (!target) return;
        const resolved = await this.runnerGateway.resolveTarget!({ target });
        if (!resolved) return;
        invocation.executionDroneId = resolved.executionDroneId;
        invocation.childDroneId = resolved.childDroneId;
        invocation.lastChatName = resolved.chatName;
      }),
    );
    return page;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const controller of this.activeRuns.values()) {
      controller.abort(new Error('DroneHub is shutting down'));
    }
    await Promise.allSettled(this.activeRunTasks.values());
  }

  private assertAcceptingRuns(): void {
    if (this.stopped) throw errorWithStatus('workflow service is shutting down', 503);
  }

  private launchRun(run: WorkflowRun): void {
    const task = this.startRun(run).finally(() => {
      if (this.activeRunTasks.get(run.id) === task) this.activeRunTasks.delete(run.id);
    });
    this.activeRunTasks.set(run.id, task);
    void task;
  }

  private async startRun(run: WorkflowRun): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(run.id, controller);
    const timeout = setTimeout(
      () => controller.abort(new Error('workflow execution timed out')),
      run.plan.timeoutMinutes * 60_000,
    );
    (timeout as any).unref?.();
    try {
      const running = await this.store.patchRun(run.droneId, run.id, {
        expectedStatuses: ['queued'],
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      if (!running) return;
      this.publishRun(running);
      const output = await this.executor.execute(running, controller.signal);
      const completed = await this.store.patchRun(run.droneId, run.id, {
        expectedStatuses: ['running'],
        status: 'completed',
        output,
        finishedAt: new Date().toISOString(),
      });
      if (completed) this.publishRun(completed);
    } catch (error) {
      const cancelled =
        controller.signal.aborted &&
        controller.signal.reason instanceof Error &&
        controller.signal.reason.message === 'workflow cancelled by user';
      const failed = await this.store.patchRun(run.droneId, run.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      if (failed) this.publishRun(failed);
    } finally {
      clearTimeout(timeout);
      this.activeRuns.delete(run.id);
    }
  }

  private async deleteInvocationTargets(invocations: WorkflowInvocation[]): Promise<void> {
    const failures: string[] = [];
    const seen = new Set<string>();
    for (const invocation of invocations) {
      const target = workflowRunnerTargetFromInvocation(invocation);
      if (!target) continue;
      const key = target.childDroneId
        ? `drone:${target.childDroneId}`
        : `chat:${target.executionDroneId}:${target.chatId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.runnerGateway.stopTarget({ target }).catch(() => {});
      try {
        await this.runnerGateway.deleteTarget({ target });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length > 0) {
      throw errorWithStatus(
        `could not delete workflow runner resources: ${failures.join('; ')}`,
        409,
      );
    }
  }

  private publishDefinition(
    workflow: DroneWorkflow,
    reason: 'created' | 'updated' | 'deleted',
  ): void {
    this.events.publish({
      type: 'workflow_definition_changed',
      droneId: workflow.droneId,
      workflowId: workflow.id,
      reason,
      at: new Date().toISOString(),
    });
  }

  private publishRun(run: WorkflowRun): void {
    this.events.publish({
      type: 'workflow_run_changed',
      droneId: run.droneId,
      workflowId: run.workflowId,
      runId: run.id,
      status: run.status,
      revision: run.revision,
      at: new Date().toISOString(),
    });
  }
}
