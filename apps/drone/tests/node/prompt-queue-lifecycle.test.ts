import assert from 'node:assert/strict';
import test from 'node:test';

import { PromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { memoryHubDatabase } from './helpers/memory-hub-database';

test('shutdown claim release requeues without consuming a delivery attempt', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const queue = new PromptQueueRepository(database);
    const at = '2026-08-10T12:00:00.000Z';
    await queue.enqueue({
      droneId: 'drone-a',
      chatName: 'default',
      prompt: {
        id: 'prompt-a',
        at,
        prompt: 'Continue the task',
        state: 'queued',
        updatedAt: at,
      },
    });
    const claimed = await queue.claim({
      droneId: 'drone-a',
      chatName: 'default',
      promptId: 'prompt-a',
      leaseOwner: 'hub:test',
      now: at,
    });
    assert.equal(claimed?.attemptCount, 1);

    assert.equal(
      await queue.releaseClaim({
        droneId: 'drone-a',
        chatName: 'default',
        promptId: 'prompt-a',
        leaseOwner: 'hub:other-process',
        error: 'Incorrect owner must not release this claim.',
        now: '2026-08-10T12:00:00.500Z',
      }),
      false,
    );
    assert.equal(
      queue.get({ droneId: 'drone-a', chatName: 'default', promptId: 'prompt-a' })?.state,
      'sending',
    );

    assert.equal(
      await queue.releaseClaim({
        droneId: 'drone-a',
        chatName: 'default',
        promptId: 'prompt-a',
        leaseOwner: 'hub:test',
        error: 'Prompt delivery paused during shutdown.',
        now: '2026-08-10T12:00:01.000Z',
      }),
      true,
    );

    const released = queue.get({
      droneId: 'drone-a',
      chatName: 'default',
      promptId: 'prompt-a',
    });
    assert.equal(released?.state, 'queued');
    assert.equal(released?.attemptCount, 0);
    assert.equal(released?.leaseOwner, undefined);
    assert.match(released?.lastError ?? '', /paused during shutdown/);
  } finally {
    close();
  }
});
