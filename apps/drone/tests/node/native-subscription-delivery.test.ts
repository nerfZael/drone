import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HubAssistantService } from '../../src/hub/assistant';
import { createNativePromptSubmitter } from '../../src/hub/native-prompt-submission';
import { getPromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { resetHubDatabaseForTests } from '../../src/host/hub-database';

test('prequeued subscription ASAP prompts steer native runs exactly once; queued prompts wait', async () => {
  const previousDataDir = process.env.DRONE_DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-subscription-delivery-'));
  process.env.DRONE_DATA_DIR = dataDir;
  try {
    const service = new HubAssistantService({ listDrones: async () => [] } as ConstructorParameters<
      typeof HubAssistantService
    >[0]);
    const { chatId } = await service.ensureNativeThread({
      id: 'native',
      droneId: 'drone-a',
      chatName: 'default',
    });
    const queue = getPromptQueueRepository()!;
    for (const deliveryMode of ['queue', 'asap'] as const) {
      await queue.enqueue({
        droneId: 'drone-a',
        chatName: 'default',
        submissionSource: 'subscription',
        prompt: {
          id: deliveryMode,
          at: new Date().toISOString(),
          prompt: `Event delivered ${deliveryMode}`,
          deliveryMode,
          state: 'queued',
        },
      });
    }
    const steered: unknown[] = [];
    let drains = 0;
    const completed = new Promise<void>((resolve, reject) => {
      const originalComplete = service.completeQueuedPrompt.bind(service);
      service.completeQueuedPrompt = async (...args) => {
        try {
          const result = await originalComplete(...args);
          resolve();
          return result;
        } catch (error) {
          reject(error);
          throw error;
        }
      };
    });
    const submit = createNativePromptSubmitter({
      assistantService: service,
      blipAssistantHost: {
        isThreadRunning: () => true,
        promptThread: async (_threadId, prompt, _onEvent, deliveryMode) => {
          steered.push({ prompt, deliveryMode });
        },
      },
      notifyNativePromptQueueChanged: async () => {},
      startAssistantPromptDrain: () => {
        drains += 1;
        return { promise: Promise.resolve() };
      },
      hubLog: () => {},
    });
    await submit({
      threadId: chatId,
      promptId: 'queue',
      prompt: 'Event delivered queue',
      deliveryMode: 'queue',
    });
    assert.equal(drains, 1);
    assert.deepEqual(steered, []);
    const request = {
      threadId: chatId,
      promptId: 'asap',
      prompt: 'Event delivered asap',
      deliveryMode: 'asap' as const,
    };
    await Promise.all([submit(request), submit(request)]);
    await completed;
    assert.deepEqual(steered, [{ prompt: 'Event delivered asap', deliveryMode: 'asap' }]);
    assert.equal(
      queue.get({ droneId: 'drone-a', chatName: 'default', promptId: 'asap' })?.state,
      'sent',
    );
    assert.equal(
      queue.get({ droneId: 'drone-a', chatName: 'default', promptId: 'queue' })?.state,
      'queued',
    );
    await submit(request);
    assert.equal(steered.length, 1);
  } finally {
    await resetHubDatabaseForTests();
    if (previousDataDir === undefined) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('native human submissions join waiting events and drain with the latest complete bundle', async () => {
  const previousDataDir = process.env.DRONE_DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-event-bundle-'));
  process.env.DRONE_DATA_DIR = dataDir;
  try {
    const service = new HubAssistantService({ listDrones: async () => [] } as ConstructorParameters<
      typeof HubAssistantService
    >[0]);
    const { chatId } = await service.ensureNativeThread({
      id: 'native-bundle',
      droneId: 'drone-a',
      chatName: 'default',
    });
    const queue = getPromptQueueRepository()!;
    const enqueueEvent = (id: string) =>
      queue.enqueue({
        droneId: 'drone-a',
        chatName: 'default',
        submissionSource: 'subscription',
        prompt: {
          id,
          at: new Date().toISOString(),
          prompt: 'event',
          state: 'queued',
          eventBundle: {
            events: [
              {
                deliveryId: id,
                provider: 'github',
                resourceType: 'pull_request',
                resourceId: id,
                eventType: 'pull_request.merged',
                summary: id,
              },
            ],
          },
        },
      });
    await enqueueEvent('e1');
    const first = await service.enqueueThreadPromptWithResult(chatId, {
      id: 'u1',
      prompt: 'Review both changes.',
      submissionSource: 'human',
      promptImages: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
    });
    assert.equal(first.prompt.id, 'e1');
    await service.enqueueThreadPromptWithResult(chatId, {
      id: 'u2',
      prompt: 'Then update the docs.',
      submissionSource: 'human',
    });
    await enqueueEvent('e2');
    const claimed = await service.claimNextQueuedPrompt(chatId);
    assert.equal(claimed!.id, 'e1');
    assert.match(claimed!.prompt, /Review both changes/);
    assert.match(claimed!.prompt, /<resource_id>e2<\/resource_id>/);
    assert.equal(claimed!.promptImages[0]!.data, 'abc');
    await service.completeQueuedPrompt(chatId, 'u1');
    assert.equal((await service.claimNextQueuedPrompt(chatId))!.id, 'u2');
  } finally {
    await resetHubDatabaseForTests();
    if (previousDataDir === undefined) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
