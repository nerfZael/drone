import type { WorkflowEventBus } from './workflow-events';
import { isWorkflowWriter } from './workflow-permissions';
import type { WorkflowRunnerGateway, WorkflowRunnerTarget } from './workflow-runner';
import type { WorkflowStore } from './workflow-store';
import { readWorkflowJsonPointer, validateWorkflowJsonSchema } from './workflow-validator';
import type {
  WorkflowCondition,
  WorkflowContextRef,
  WorkflowInvocation,
  WorkflowJsonValue,
  WorkflowNode,
  WorkflowRun,
  WorkflowValueRef,
} from './workflow-types';

const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_TEXT_RESULT_CHARS = 128_000;
const MAX_STRUCTURED_RESULT_BYTES = 256 * 1024;
const MAX_CHANGED_FILES = 2_000;
const MAX_AGGREGATE_RESULT_BYTES = 1024 * 1024;

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async use<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.capacity) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

class WorkspaceGate {
  private readers = 0;
  private writer = false;
  private readonly queue: Array<{
    write: boolean;
    resolve: (release: () => void) => void;
  }> = [];

  async acquire(write: boolean): Promise<() => void> {
    return await new Promise((resolve) => {
      this.queue.push({ write, resolve });
      this.drain();
    });
  }

  private drain(): void {
    if (this.writer || this.queue.length === 0) return;
    const first = this.queue[0]!;
    if (first.write) {
      if (this.readers > 0) return;
      this.queue.shift();
      this.writer = true;
      first.resolve(() => {
        this.writer = false;
        this.drain();
      });
      return;
    }
    while (this.queue[0] && !this.queue[0]!.write && !this.writer) {
      const reader = this.queue.shift()!;
      this.readers += 1;
      reader.resolve(() => {
        this.readers -= 1;
        this.drain();
      });
    }
  }
}

type ExecutionContext = {
  run: WorkflowRun;
  signal: AbortSignal;
  deadline: number;
  results: Map<string, WorkflowJsonValue>;
  item?: WorkflowJsonValue;
  itemIndex?: number;
  iterationIndex?: number;
  phaseId: string;
  path: string;
  invocationCount: { value: number };
  semaphore: AsyncSemaphore;
  workspace: WorkspaceGate;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error(String(reason || 'workflow cancelled'));
}

function parseStructuredOutput(text: string): WorkflowJsonValue {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as WorkflowJsonValue;
}

export class WorkflowExecutor {
  constructor(
    private readonly store: WorkflowStore,
    private readonly runnerGateway: WorkflowRunnerGateway,
    private readonly events: WorkflowEventBus,
  ) {}

  async execute(run: WorkflowRun, signal: AbortSignal): Promise<WorkflowJsonValue> {
    const context: Omit<ExecutionContext, 'phaseId' | 'path'> = {
      run,
      signal,
      deadline: Date.now() + run.plan.timeoutMinutes * 60_000,
      results: new Map(),
      invocationCount: { value: 0 },
      semaphore: new AsyncSemaphore(run.plan.maxConcurrency),
      workspace: new WorkspaceGate(),
    };
    let last: WorkflowJsonValue = null;
    for (const phase of run.definitionSnapshot.phases) {
      last = await this.executeNode(phase.run, {
        ...context,
        phaseId: phase.id,
        path: `phase:${phase.id}/${phase.run.id}`,
      });
      context.results.set(phase.id, last);
    }
    if (run.definitionSnapshot.outputFrom) {
      const selected = context.results.get(run.definitionSnapshot.outputFrom);
      if (selected === undefined) {
        throw new Error(
          `workflow outputFrom did not resolve: ${run.definitionSnapshot.outputFrom}`,
        );
      }
      return selected;
    }
    return last;
  }

  private ensureActive(context: ExecutionContext): void {
    if (context.signal.aborted) throw abortError(context.signal);
    if (Date.now() >= context.deadline) throw new Error('workflow execution timed out');
  }

  private resolveRef(
    ref: WorkflowValueRef,
    context: ExecutionContext,
  ): {
    found: boolean;
    value: WorkflowJsonValue | undefined;
  } {
    const source =
      ref.source === 'input'
        ? context.run.input
        : ref.source === 'item'
          ? context.item
          : context.results.get(ref.result);
    return readWorkflowJsonPointer(source, ref.path);
  }

  private conditionMatches(condition: WorkflowCondition, context: ExecutionContext): boolean {
    const resolved = this.resolveRef(condition.value, context);
    if (condition.op === 'exists') return resolved.found;
    if (!resolved.found) throw new Error('workflow condition references a missing value');
    if (condition.op === 'truthy') return Boolean(resolved.value);
    if (!('expected' in condition)) throw new Error('unsupported workflow condition');
    const equal = JSON.stringify(resolved.value) === JSON.stringify(condition.expected);
    return condition.op === 'equals' ? equal : !equal;
  }

  private async executeNode(
    node: WorkflowNode,
    context: ExecutionContext,
  ): Promise<WorkflowJsonValue> {
    this.ensureActive(context);
    let result: WorkflowJsonValue;
    switch (node.type) {
      case 'call':
        result = await this.executeCall(node, context);
        break;
      case 'sequence': {
        result = null;
        for (const child of node.children) {
          result = await this.executeNode(child, {
            ...context,
            path: `${context.path}/${child.id}`,
          });
        }
        break;
      }
      case 'parallel': {
        const branches = node.children.map((child) => ({
          child,
          results: new Map(context.results),
        }));
        const settled = await Promise.allSettled(
          branches.map(({ child, results }) =>
            this.executeNode(child, {
              ...context,
              results,
              path: `${context.path}/${child.id}`,
            }),
          ),
        );
        for (const branch of branches) {
          for (const [key, value] of branch.results) context.results.set(key, value);
        }
        const failure = settled.find(
          (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
        );
        if (failure) throw failure.reason;
        const values = settled.map(
          (entry) => (entry as PromiseFulfilledResult<WorkflowJsonValue>).value,
        );
        result = Object.fromEntries(
          node.children.map((child, index) => [child.id, values[index]!]),
        );
        break;
      }
      case 'forEach': {
        const resolved = this.resolveRef(node.itemsFrom, context);
        if (!resolved.found || !Array.isArray(resolved.value)) {
          throw new Error(`forEach ${node.id} itemsFrom must resolve to an array`);
        }
        if (node.maxItems !== undefined && resolved.value.length > node.maxItems) {
          throw new Error(`forEach ${node.id} exceeds maxItems ${node.maxItems}`);
        }
        const itemSemaphore = new AsyncSemaphore(
          Math.min(
            node.parallelism ?? context.run.plan.maxConcurrency,
            context.run.plan.maxConcurrency,
          ),
        );
        const itemContexts = resolved.value.map(() => new Map(context.results));
        let fanoutFailure: unknown;
        const settled = await Promise.allSettled(
          resolved.value.map((item, itemIndex) =>
            itemSemaphore.use(async () => {
              if (fanoutFailure) throw fanoutFailure;
              try {
                return await this.executeNode(node.body, {
                  ...context,
                  results: itemContexts[itemIndex]!,
                  item,
                  itemIndex,
                  path: `${context.path}/item:${itemIndex}/${node.body.id}`,
                });
              } catch (error) {
                fanoutFailure = error;
                throw error;
              }
            }),
          ),
        );
        const failure = settled.find(
          (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
        );
        if (failure) throw failure.reason;
        result = settled.map((entry) => (entry as PromiseFulfilledResult<WorkflowJsonValue>).value);
        const baselineKeys = new Set(context.results.keys());
        const producedKeys = new Set(
          itemContexts.flatMap((itemResults) =>
            [...itemResults.keys()].filter((key) => !baselineKeys.has(key)),
          ),
        );
        for (const key of producedKeys) {
          context.results.set(
            key,
            itemContexts.map((itemResults) => itemResults.get(key) ?? null),
          );
        }
        break;
      }
      case 'if': {
        const branch = this.conditionMatches(node.condition, context) ? node.then : node.else;
        result = branch
          ? await this.executeNode(branch, {
              ...context,
              path: `${context.path}/${branch.id}`,
            })
          : null;
        break;
      }
      case 'repeat': {
        let iteration = 0;
        result = null;
        while (true) {
          this.ensureActive(context);
          if (node.maxIterations !== undefined && iteration >= node.maxIterations) {
            throw new Error(`repeat ${node.id} exhausted maxIterations ${node.maxIterations}`);
          }
          result = await this.executeNode(node.body, {
            ...context,
            iterationIndex: iteration,
            path: `${context.path}/iteration:${iteration}/${node.body.id}`,
          });
          iteration += 1;
          if (this.conditionMatches(node.until, context)) break;
        }
        break;
      }
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_AGGREGATE_RESULT_BYTES) {
      throw new Error(
        `workflow result ${context.phaseId}.${node.id} exceeds ${MAX_AGGREGATE_RESULT_BYTES} bytes`,
      );
    }
    context.results.set(`${context.phaseId}.${node.id}`, result);
    return result;
  }

  private buildPrompt(
    instructions: string,
    prompt: string,
    contextRefs: WorkflowContextRef[] | undefined,
    context: ExecutionContext,
  ): string {
    const selected: Record<string, WorkflowJsonValue> = {};
    for (const [index, ref] of (contextRefs ?? []).entries()) {
      const resolved = this.resolveRef(ref, context);
      if (!resolved.found) {
        if (ref.optional) continue;
        throw new Error(`required contextFrom value ${index + 1} is missing`);
      }
      selected[ref.as ?? `context_${index + 1}`] = resolved.value!;
    }
    const selectedJson = JSON.stringify(selected, null, 2);
    if (Buffer.byteLength(selectedJson, 'utf8') > MAX_CONTEXT_BYTES) {
      throw new Error(`selected workflow context exceeds ${MAX_CONTEXT_BYTES} bytes`);
    }
    return [
      instructions.trim(),
      '',
      'Workflow task:',
      prompt.trim(),
      ...(Object.keys(selected).length > 0
        ? ['', 'Selected workflow context (JSON):', selectedJson]
        : []),
    ].join('\n');
  }

  private async executeCall(
    node: Extract<WorkflowNode, { type: 'call' }>,
    context: ExecutionContext,
  ): Promise<WorkflowJsonValue> {
    context.invocationCount.value += 1;
    if (
      context.run.plan.maxInvocations !== undefined &&
      context.invocationCount.value > context.run.plan.maxInvocations
    ) {
      throw new Error(`workflow exceeds maxInvocations ${context.run.plan.maxInvocations}`);
    }
    const agent = context.run.definitionSnapshot.agents[node.agent]!;
    const invocation = await this.store.createInvocation({
      runId: context.run.id,
      droneId: context.run.droneId,
      runtimePath: context.path,
      phaseId: context.phaseId,
      nodeId: node.id,
      callId: node.id,
      iterationIndex: context.iterationIndex ?? null,
      itemIndex: context.itemIndex ?? null,
      agentSnapshot: agent,
      executionDroneId: context.run.droneId,
      childDroneId: null,
      chatId: null,
      lastChatName: null,
      promptRunId: null,
    });
    this.publishInvocation(context.run, invocation);

    return await context.semaphore.use(async () => {
      const releaseWorkspace = await context.workspace.acquire(isWorkflowWriter(agent.permissions));
      let target: WorkflowRunnerTarget | null = null;
      let targetRecorded = false;
      try {
        this.ensureActive(context);
        let current = await this.store.patchInvocation(context.run.droneId, invocation.id, {
          status: 'running',
          startedAt: new Date().toISOString(),
        });
        if (!current) throw new Error('workflow invocation was deleted before its runner started');
        this.publishInvocation(context.run, current);

        target = await this.runnerGateway.createTarget({
          ownerDroneId: context.run.droneId,
          origin: {
            workflowId: context.run.workflowId,
            runId: context.run.id,
            invocationId: invocation.id,
          },
          agent,
          signal: context.signal,
        });
        current = await this.store.patchInvocation(context.run.droneId, invocation.id, {
          executionDroneId: target.executionDroneId,
          childDroneId: target.childDroneId,
          chatId: target.chatId,
          lastChatName: target.chatName,
        });
        if (!current) throw new Error('workflow invocation was deleted while its runner started');
        targetRecorded = true;
        this.publishInvocation(context.run, current);

        const response = await this.runnerGateway.runPrompt({
          target,
          prompt: this.buildPrompt(agent.instructions, node.prompt, node.contextFrom, context),
          signal: context.signal,
        });
        const textResult =
          response.text.length > MAX_TEXT_RESULT_CHARS
            ? `${response.text.slice(0, MAX_TEXT_RESULT_CHARS)}\n[workflow result truncated]`
            : response.text;
        const structured = node.outputSchema ? parseStructuredOutput(response.text) : null;
        if (node.outputSchema) {
          if (Buffer.byteLength(JSON.stringify(structured), 'utf8') > MAX_STRUCTURED_RESULT_BYTES) {
            throw new Error(`structured output exceeds ${MAX_STRUCTURED_RESULT_BYTES} bytes`);
          }
          const errors = validateWorkflowJsonSchema(node.outputSchema, structured!);
          if (errors.length > 0) throw new Error(`invalid structured output: ${errors.join('; ')}`);
        }
        current = await this.store.patchInvocation(context.run.droneId, invocation.id, {
          promptRunId: response.promptRunId,
          status: 'completed',
          finishedAt: new Date().toISOString(),
          textResult,
          structuredResult: structured,
          changedFiles: (response.changedFiles ?? []).slice(0, MAX_CHANGED_FILES),
          usage: response.usage ?? null,
        });
        if (current) this.publishInvocation(context.run, current);
        return structured ?? textResult;
      } catch (error) {
        let reportedError = error;
        if (target && !targetRecorded) {
          try {
            await this.runnerGateway.deleteTarget({ target });
          } catch (cleanupError) {
            reportedError = new Error(
              `${errorMessage(error)}; runner cleanup failed: ${errorMessage(cleanupError)}`,
            );
          }
        }
        const status = context.signal.aborted ? 'cancelled' : 'failed';
        const current = await this.store.patchInvocation(context.run.droneId, invocation.id, {
          status,
          finishedAt: new Date().toISOString(),
          error: errorMessage(reportedError),
        });
        if (current) this.publishInvocation(context.run, current);
        throw reportedError;
      } finally {
        releaseWorkspace();
      }
    });
  }

  private publishInvocation(run: WorkflowRun, invocation: WorkflowInvocation): void {
    this.events.publish({
      type: 'workflow_invocation_changed',
      droneId: run.droneId,
      workflowId: run.workflowId,
      runId: run.id,
      invocationId: invocation.id,
      status: invocation.status,
      at: new Date().toISOString(),
    });
  }
}
