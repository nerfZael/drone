const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, test } = require('node:test');

const { resetHubDatabaseForTests } = require('../../dist/host/hub-database.js');
const { resetDroneRootDirForTests } = require('../../dist/host/paths.js');
const { WorkflowService } = require('../../dist/hub/workflows/workflow-service.js');
const { WorkflowStore } = require('../../dist/hub/workflows/workflow-store.js');

const originalDroneDataDir = process.env.DRONE_DATA_DIR;
const tempRoots = [];
const actor = { kind: 'ui', id: 'test-user' };

function useTemporaryDataDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-workflow-service-'));
  tempRoots.push(root);
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  fs.mkdirSync(process.env.DRONE_DATA_DIR, { recursive: true });
  resetDroneRootDirForTests();
}

function definition() {
  return {
    version: 1,
    agents: {
      worker: {
        runner: { kind: 'drone-chat', agent: { kind: 'builtin', id: 'blip' } },
        permissions: ['workspace:read'],
        instructions: 'Do the work.',
      },
    },
    phases: [
      {
        id: 'work',
        run: {
          id: 'answer',
          type: 'call',
          agent: 'worker',
          prompt: 'Return a result.',
        },
      },
    ],
    outputFrom: 'work.answer',
  };
}

async function waitForTerminal(service, droneId, runId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = service.getRun(droneId, runId);
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('workflow run did not finish');
}

afterEach(async () => {
  await resetHubDatabaseForTests();
  if (originalDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = originalDroneDataDir;
  resetDroneRootDirForTests();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('workflow service', () => {
  test('approval gates execution and run deletion removes worker chats', async () => {
    useTemporaryDataDir();
    const createdTargets = [];
    const deletedTargets = [];
    const gateway = {
      async createTarget({ ownerDroneId, origin, agent }) {
        const chatId = `chat-${origin.invocationId}`;
        const target = {
          runnerKind: agent.runner.kind,
          executionDroneId: ownerDroneId,
          childDroneId: null,
          chatId,
          chatName: `worker-${createdTargets.length + 1}`,
        };
        createdTargets.push(target);
        return target;
      },
      async runPrompt() {
        return { promptRunId: 'prompt-1', text: 'done' };
      },
      async stopTarget() {},
      async deleteTarget({ target }) {
        deletedTargets.push(target);
      },
    };
    const service = new WorkflowService(WorkflowStore.open(), gateway, {
      defaultTimeoutMinutes: 1,
      executorCapacity: 2,
    });
    await service.initialize();
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Review', definition: definition() },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);
    assert.equal(pending.status, 'pending_approval');
    assert.deepEqual(createdTargets, []);

    await service.approveRun('drone-a', pending.id, actor);
    const completed = await waitForTerminal(service, 'drone-a', pending.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.output, 'done');
    assert.equal(createdTargets.length, 1);
    const page = await service.listInvocations('drone-a', pending.id);
    assert.equal(page.invocations[0].status, 'completed');
    assert.equal(page.invocations[0].executionDroneId, 'drone-a');

    await service.deleteRun('drone-a', pending.id);
    assert.deepEqual(deletedTargets, createdTargets);
    assert.throws(() => service.getRun('drone-a', pending.id), /not found/);
  });

  test('retries invalid structured output once with the validation error and schema', async () => {
    useTemporaryDataDir();
    const prompts = [];
    const gateway = {
      async createTarget({ ownerDroneId, origin, agent }) {
        return {
          runnerKind: agent.runner.kind,
          executionDroneId: ownerDroneId,
          childDroneId: null,
          chatId: `chat-${origin.invocationId}`,
          chatName: 'worker',
        };
      },
      async runPrompt({ prompt }) {
        prompts.push(prompt);
        return prompts.length === 1
          ? { promptRunId: 'prompt-1', text: '{"wrong":"shape"}' }
          : { promptRunId: 'prompt-2', text: '{"answer":"recovered"}' };
      },
      async stopTarget() {},
      async deleteTarget() {},
    };
    const service = new WorkflowService(WorkflowStore.open(), gateway, {
      defaultTimeoutMinutes: 1,
    });
    const input = definition();
    input.phases[0].run.outputSchema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    };
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Structured recovery', definition: input },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);

    await service.approveRun('drone-a', pending.id, actor);
    const completed = await waitForTerminal(service, 'drone-a', pending.id);

    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.output, { answer: 'recovered' });
    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /Required output schema/);
    assert.match(prompts[0], /"answer"/);
    assert.match(prompts[1], /Your previous response could not be accepted/);
    assert.match(prompts[1], /\$\.answer is required/);
    assert.match(prompts[1], /"answer"/);
    const page = await service.listInvocations('drone-a', pending.id);
    assert.equal(page.invocations[0].promptRunId, 'prompt-2');
    assert.deepEqual(page.invocations[0].structuredResult, { answer: 'recovered' });
  });

  test('fails structured output after one correction retry', async () => {
    useTemporaryDataDir();
    let promptCount = 0;
    const gateway = {
      async createTarget({ ownerDroneId, origin, agent }) {
        return {
          runnerKind: agent.runner.kind,
          executionDroneId: ownerDroneId,
          childDroneId: null,
          chatId: `chat-${origin.invocationId}`,
          chatName: 'worker',
        };
      },
      async runPrompt() {
        promptCount += 1;
        return {
          promptRunId: `prompt-${promptCount}`,
          text: promptCount === 1 ? '{"wrong":"shape"}' : '{"still_wrong":"shape"}',
        };
      },
      async stopTarget() {},
      async deleteTarget() {},
    };
    const service = new WorkflowService(WorkflowStore.open(), gateway, {
      defaultTimeoutMinutes: 1,
    });
    const input = definition();
    input.phases[0].run.outputSchema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    };
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Structured failure', definition: input },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);

    await service.approveRun('drone-a', pending.id, actor);
    const failed = await waitForTerminal(service, 'drone-a', pending.id);

    assert.equal(failed.status, 'failed');
    assert.equal(promptCount, 2);
    assert.match(failed.error, /invalid structured output/);
    assert.match(failed.error, /\$\.answer is required/);
    const page = await service.listInvocations('drone-a', pending.id);
    assert.equal(page.invocations[0].status, 'failed');
  });

  test('deleting a run deletes its child drone target', async () => {
    useTemporaryDataDir();
    const deletedTargets = [];
    const gateway = {
      async createTarget({ origin, agent }) {
        return {
          runnerKind: agent.runner.kind,
          executionDroneId: 'child-drone',
          childDroneId: 'child-drone',
          chatId: `chat-${origin.invocationId}`,
          chatName: 'default',
        };
      },
      async runPrompt() {
        return { promptRunId: 'prompt-1', text: 'done' };
      },
      async stopTarget() {
        throw new Error('already stopped');
      },
      async deleteTarget({ target }) {
        deletedTargets.push(target);
      },
    };
    const service = new WorkflowService(WorkflowStore.open(), gateway, {
      defaultTimeoutMinutes: 1,
    });
    const input = definition();
    input.agents.worker.runner.kind = 'drone';
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Child worker', definition: input },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);
    await service.approveRun('drone-a', pending.id, actor);
    await waitForTerminal(service, 'drone-a', pending.id);

    const page = await service.listInvocations('drone-a', pending.id);
    assert.equal(page.invocations[0].childDroneId, 'child-drone');
    assert.equal(page.invocations[0].executionDroneId, 'child-drone');

    await service.deleteRun('drone-a', pending.id);
    assert.equal(deletedTargets.length, 1);
    assert.equal(deletedTargets[0].childDroneId, 'child-drone');
  });

  test('preserves explicit null input and bounds invalid invocation page sizes', async () => {
    useTemporaryDataDir();
    const store = WorkflowStore.open();
    const service = new WorkflowService(store, {});
    const input = definition();
    input.inputSchema = { type: 'null' };
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Nullable input', definition: input },
      actor,
    );

    const pending = await service.requestRun('drone-a', workflow.id, null, actor);

    assert.equal(pending.input, null);
    assert.deepEqual(store.listInvocations('drone-a', pending.id, undefined, Number.NaN), {
      invocations: [],
      nextCursor: null,
    });
  });

  test('cleans up a runner target if its invocation disappears during startup', async () => {
    useTemporaryDataDir();
    const store = WorkflowStore.open();
    const deletedTargets = [];
    let runId = '';
    const gateway = {
      async createTarget({ ownerDroneId, origin, agent }) {
        await store.deleteRun(ownerDroneId, runId);
        return {
          runnerKind: agent.runner.kind,
          executionDroneId: ownerDroneId,
          childDroneId: null,
          chatId: `chat-${origin.invocationId}`,
          chatName: 'orphaned-worker',
        };
      },
      async runPrompt() {
        throw new Error('prompt should not run');
      },
      async stopTarget() {},
      async deleteTarget({ target }) {
        deletedTargets.push(target);
      },
    };
    const service = new WorkflowService(store, gateway, {
      defaultTimeoutMinutes: 1,
    });
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Orphan cleanup', definition: definition() },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);
    runId = pending.id;

    await service.approveRun('drone-a', pending.id, actor);
    for (let attempt = 0; attempt < 100 && deletedTargets.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(deletedTargets.length, 1);
    assert.equal(deletedTargets[0].chatName, 'orphaned-worker');
  });

  test('stops recoverable runner targets when interrupted runs are recovered', async () => {
    useTemporaryDataDir();
    const store = WorkflowStore.open();
    const setupService = new WorkflowService(store, {});
    const workflow = await setupService.createWorkflow(
      'drone-a',
      { name: 'Recovery', definition: definition() },
      actor,
    );
    const pending = await setupService.requestRun('drone-a', workflow.id, {}, actor);
    await store.patchRun('drone-a', pending.id, { status: 'running' });
    const invocation = await store.createInvocation({
      runId: pending.id,
      droneId: 'drone-a',
      runtimePath: 'phase:work/answer',
      phaseId: 'work',
      nodeId: 'answer',
      callId: 'answer',
      iterationIndex: null,
      itemIndex: null,
      agentSnapshot: workflow.definition.agents.worker,
      executionDroneId: 'drone-a',
      childDroneId: null,
      chatId: 'recoverable-chat',
      lastChatName: 'recoverable-worker',
      promptRunId: 'recoverable-prompt',
    });
    await store.patchInvocation('drone-a', invocation.id, { status: 'running' });

    const stoppedTargets = [];
    const recoveringService = new WorkflowService(store, {
      async stopTarget({ target }) {
        stoppedTargets.push(target);
      },
    });
    await recoveringService.initialize();

    assert.equal(recoveringService.getRun('drone-a', pending.id).status, 'failed');
    assert.equal(stoppedTargets.length, 1);
    assert.equal(stoppedTargets[0].chatName, 'recoverable-worker');
  });

  test('cancellation wins if a runner finishes at the same time', async () => {
    useTemporaryDataDir();
    let releasePrompt;
    let promptStarted;
    const promptStartedPromise = new Promise((resolve) => {
      promptStarted = resolve;
    });
    const promptReleasePromise = new Promise((resolve) => {
      releasePrompt = resolve;
    });
    const gateway = {
      async createTarget({ ownerDroneId, origin, agent }) {
        return {
          runnerKind: agent.runner.kind,
          executionDroneId: ownerDroneId,
          childDroneId: null,
          chatId: `chat-${origin.invocationId}`,
          chatName: 'worker',
        };
      },
      async runPrompt() {
        promptStarted();
        await promptReleasePromise;
        return { promptRunId: 'prompt-1', text: 'finished during cancellation' };
      },
      async stopTarget() {},
      async deleteTarget() {},
    };
    const service = new WorkflowService(WorkflowStore.open(), gateway, {
      defaultTimeoutMinutes: 1,
    });
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Cancellation race', definition: definition() },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);
    await service.approveRun('drone-a', pending.id, actor);
    await promptStartedPromise;

    await service.cancelRun('drone-a', pending.id);
    releasePrompt();
    const finished = await waitForTerminal(service, 'drone-a', pending.id);

    assert.equal(finished.status, 'cancelled');
  });

  test('records stable non-duplicated paths for nested calls', async () => {
    useTemporaryDataDir();
    const gateway = {
      async createTarget({ ownerDroneId, origin, agent }) {
        return {
          runnerKind: agent.runner.kind,
          executionDroneId: ownerDroneId,
          childDroneId: null,
          chatId: `chat-${origin.invocationId}`,
          chatName: 'worker',
        };
      },
      async runPrompt() {
        return { promptRunId: 'prompt-1', text: 'done' };
      },
      async stopTarget() {},
      async deleteTarget() {},
    };
    const service = new WorkflowService(WorkflowStore.open(), gateway, {
      defaultTimeoutMinutes: 1,
    });
    const input = definition();
    input.phases[0].run = {
      id: 'steps',
      type: 'sequence',
      children: [
        { id: 'first', type: 'call', agent: 'worker', prompt: 'First' },
        { id: 'second', type: 'call', agent: 'worker', prompt: 'Second' },
      ],
    };
    input.outputFrom = 'work.steps';
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Nested paths', definition: input },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);
    await service.approveRun('drone-a', pending.id, actor);
    await waitForTerminal(service, 'drone-a', pending.id);

    const page = await service.listInvocations('drone-a', pending.id);
    assert.deepEqual(
      page.invocations.map((invocation) => invocation.runtimePath),
      ['phase:work/steps/first', 'phase:work/steps/second'],
    );
  });

  test('rejects stale workflow updates', async () => {
    useTemporaryDataDir();
    const service = new WorkflowService(WorkflowStore.open(), {});
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Review', definition: definition() },
      actor,
    );
    await service.updateWorkflow(
      'drone-a',
      workflow.id,
      { baseVersion: 1, description: 'new' },
      actor,
    );
    await assert.rejects(
      service.updateWorkflow(
        'drone-a',
        workflow.id,
        { baseVersion: 1, description: 'stale' },
        actor,
      ),
      /current version is 2/,
    );
  });
});
