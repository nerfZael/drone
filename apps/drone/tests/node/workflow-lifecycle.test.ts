import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkflowService } from '../../src/hub/workflows/workflow-service';
import type { WorkflowRunnerGateway } from '../../src/hub/workflows/workflow-runner';
import { WorkflowStore } from '../../src/hub/workflows/workflow-store';
import { memoryHubDatabase } from './helpers/memory-hub-database';

const actor = { kind: 'ui' as const, id: 'test-user' };

function workflowDefinition() {
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

test('workflow shutdown aborts active execution and rejects new runs', async () => {
  const { database, close } = memoryHubDatabase();
  let markPromptStarted!: () => void;
  const promptStarted = new Promise<void>((resolve) => {
    markPromptStarted = resolve;
  });
  const gateway: WorkflowRunnerGateway = {
    async createTarget({ ownerDroneId, origin, agent }) {
      return {
        runnerKind: agent.runner.kind,
        executionDroneId: ownerDroneId,
        childDroneId: null,
        chatId: `chat-${origin.invocationId}`,
        chatName: 'worker',
      };
    },
    async runPrompt({ signal }) {
      markPromptStarted();
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      throw new Error('unreachable');
    },
    async stopTarget() {},
    async deleteTarget() {},
  };

  try {
    const service = new WorkflowService(WorkflowStore.open(database), gateway, {
      defaultTimeoutMinutes: 1,
    });
    const workflow = await service.createWorkflow(
      'drone-a',
      { name: 'Shutdown', definition: workflowDefinition() },
      actor,
    );
    const pending = await service.requestRun('drone-a', workflow.id, {}, actor);
    const pendingAtShutdown = await service.requestRun('drone-a', workflow.id, {}, actor);
    await service.approveRun('drone-a', pending.id, actor);
    await promptStarted;

    await service.stop();

    const failed = service.getRun('drone-a', pending.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error ?? '', /shutting down/);
    await assert.rejects(
      service.requestRun('drone-a', workflow.id, {}, actor),
      (error: unknown) =>
        (error as { statusCode?: number }).statusCode === 503 &&
        /shutting down/.test((error as Error).message),
    );
    await assert.rejects(
      service.approveRun('drone-a', pendingAtShutdown.id, actor),
      (error: unknown) =>
        (error as { statusCode?: number }).statusCode === 503 &&
        /shutting down/.test((error as Error).message),
    );
  } finally {
    close();
  }
});
