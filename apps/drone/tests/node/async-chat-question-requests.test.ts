import { ChatTranscriptRepository } from '../../src/hub/transcript-store';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ChatQuestionRequestService } from '../../src/hub/chat-question-requests';
import { getHubDatabase } from '../../src/host/hub-database';
import { ResourceSubscriptionService } from '../../src/hub/subscriptions/resource-subscription-service';
import {
  getPromptQueueRepository,
  PromptQueueRepository,
} from '../../src/host/prompt-queue-repository';
import { ResourceSubscriptionRepository } from '../../src/hub/subscriptions/resource-subscription-repository';
import { renderSubscriptionPrompt } from '../../src/hub/subscriptions/resource-subscription-service';
import { DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS } from '../../src/hub/subscriptions/resource-subscription-types';
import { writeResourceSubscriptionSettings } from '../../src/hub/subscriptions/resource-subscription-settings';
import { memoryHubDatabase } from './helpers/memory-hub-database';

const previousDataDir = process.env.DRONE_DATA_DIR;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-questions-'));
process.env.DRONE_DATA_DIR = dataDir;
after(() => {
  if (previousDataDir === undefined) delete process.env.DRONE_DATA_DIR;
  else process.env.DRONE_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const input = {
  droneId: 'drone-a',
  chatName: 'default',
  chatId: 'chat-a',
  nativeThreadId: 'chat-a',
  toolCallId: 'call-a',
  questions: [
    {
      id: 'scope',
      question: 'Which scope?',
      choices: [
        { id: 'small', label: 'Small', recommended: true },
        { id: 'large', label: 'Large' },
      ],
    },
  ],
};
const answers = {
  responses: [{ questionId: 'scope', outcome: 'choice', choiceId: 'large' }],
  notes: 'Include docs.',
};

test('questions return a subscription and remain answerable across queued work, stops, and restart', async () => {
  const { database, close } = memoryHubDatabase();
  let questions = new ChatQuestionRequestService(database);
  try {
    const queue = new PromptQueueRepository(database);
    await queue.enqueue({
      droneId: input.droneId,
      chatName: input.chatName,
      submissionSource: 'human',
      prompt: {
        id: 'queued-a',
        at: new Date().toISOString(),
        prompt: 'Keep working.',
        state: 'queued',
      },
    });
    const asked = await questions.askAsync(input);
    assert.equal(asked.status, 'pending');
    assert.equal(asked.subscription.status, 'active');
    assert.equal(asked.subscription.resourceType, 'question_request');
    assert.equal(questions.get(asked.requestId)?.subscriptionId, asked.subscription.id);
    assert.deepEqual(await questions.askAsync(input), asked);
    const second = await questions.askAsync({ ...input, toolCallId: 'call-b' });
    assert.notEqual(second.requestId, asked.requestId);
    await queue.enqueue({
      droneId: input.droneId,
      chatName: input.chatName,
      submissionSource: 'human',
      prompt: {
        id: 'queued-b',
        at: new Date().toISOString(),
        prompt: 'Another message.',
        state: 'queued',
      },
    });
    await questions.skipPendingForChat(input.droneId, input.chatName, 'chat_stopped');
    await questions.reconcileQueuedRequests();
    assert.equal(questions.listPending(input.droneId, input.chatName).length, 2);
    assert.equal(questions.listForChat(input.droneId, input.chatName, 1).length, 2);
    questions.close();
    questions = new ChatQuestionRequestService(database);
    // No native suspension resolver is registered after restart.
    const [result, duplicate] = await Promise.all([
      questions.submit(asked.requestId, answers),
      questions.submit(asked.requestId, answers),
    ]);
    assert.deepEqual(duplicate, result);
    const subscriptions = new ResourceSubscriptionRepository(database);
    assert.equal(subscriptions.get(asked.subscription.id, input.chatId)?.status, 'completed');
    assert.equal(subscriptions.get(second.subscription.id, input.chatId)?.status, 'active');
    const batch = await subscriptions.claimBatch({
      ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
      batchWindowMs: 0,
    });
    assert.ok(batch);
    assert.equal(batch.items.length, 1);
    assert.equal(batch.subscriber.chatId, input.chatId);
    assert.deepEqual(batch.items[0]?.event.providerContent.result, result);
    const prompt = renderSubscriptionPrompt(batch);
    assert.match(prompt, /question_request.resolved/);
    assert.match(prompt, /Include docs\./);
    assert.match(prompt, /Large/);
    assert.equal((await questions.askAsync(input)).subscription.status, 'completed');
    assert.equal(
      await subscriptions.claimBatch({
        ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
        batchWindowMs: 0,
      }),
      null,
    );
  } finally {
    questions.close();
    close();
  }
});

test('explicit skip publishes one event, while failed answer publication rolls back the submission', async () => {
  const { database, close } = memoryHubDatabase();
  const questions = new ChatQuestionRequestService(database);
  try {
    const asked = await questions.askAsync(input);
    database.read((connection) =>
      connection.exec(`CREATE TRIGGER reject_question_event BEFORE INSERT ON resource_events
      BEGIN SELECT RAISE(ABORT, 'event rejected'); END;`),
    );
    await assert.rejects(questions.submit(asked.requestId, answers), /event rejected/);
    assert.equal(questions.get(asked.requestId)?.status, 'pending');
    database.read((connection) => connection.exec('DROP TRIGGER reject_question_event'));
    await assert.rejects(
      questions.skip(asked.requestId, 'chat_stopped'),
      /only be skipped by the user/,
    );
    const result = await questions.skip(asked.requestId, 'user_skipped', 'Use your judgment.');
    assert.equal(result.status, 'skipped');
    assert.deepEqual(await questions.skip(asked.requestId, 'user_skipped'), result);
    const counts = database.read((connection) =>
      connection.prepare('SELECT COUNT(*) AS count FROM subscription_deliveries').get(),
    ) as { count: number };
    assert.equal(counts.count, 1);
  } finally {
    questions.close();
    close();
  }
});

test('subscription limits and insert failures cannot leave orphan question forms or subscriptions', async () => {
  const { database, close } = memoryHubDatabase();
  const questions = new ChatQuestionRequestService(database);
  try {
    await writeResourceSubscriptionSettings({ maxActiveSubscriptionsPerConversation: 1 });
    await questions.askAsync(input);
    await assert.rejects(
      questions.askAsync({ ...input, toolCallId: 'call-b' }),
      /active subscription limit/,
    );
    assert.equal(questions.listPending(input.droneId, input.chatName).length, 1);
    await writeResourceSubscriptionSettings(DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS);
    database.read((connection) =>
      connection.exec(`CREATE TRIGGER reject_question BEFORE INSERT ON chat_question_requests
      BEGIN SELECT RAISE(ABORT, 'question rejected'); END;`),
    );
    await assert.rejects(
      questions.askAsync({ ...input, toolCallId: 'call-b' }),
      /question rejected/,
    );
    assert.equal(new ResourceSubscriptionRepository(database).list(input.chatId).length, 1);
  } finally {
    await writeResourceSubscriptionSettings(DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS);
    questions.close();
    close();
  }
});

test('answer events use the normal prompt queue and preserve subscriptions when a chat is restored', async () => {
  const database = getHubDatabase()!;
  const queue = getPromptQueueRepository()!;
  const questions = new ChatQuestionRequestService(database);
  const subscriptions = new ResourceSubscriptionRepository(database);
  const wakes: string[] = [];
  const errors: string[] = [];
  const settings = {
    ...DEFAULT_RESOURCE_SUBSCRIPTION_SETTINGS,
    batchWindowMs: 0,
    eventDeliveryModes: { 'question_request.resolved': 'asap' as const },
  };
  database.read((connection) =>
    connection.exec(`CREATE TABLE canonical_chats (
    drone_id TEXT NOT NULL, chat_name TEXT NOT NULL, metadata_json TEXT NOT NULL
  ); INSERT INTO canonical_chats VALUES ('drone-a', 'default', '{"id":"chat-a"}');`),
  );
  const service = new ResourceSubscriptionService({
    repository: subscriptions,
    readChatStatus: async () => ({ idle: true, reason: 'finished', latest: null }),
    wakePromptQueue: (droneId, chatName) => wakes.push(`${droneId}/${chatName}`),
    readSettings: async () => settings,
    log: (level, message) => {
      if (level === 'warn') errors.push(message);
    },
  });
  try {
    const asked = await questions.askAsync(input);
    await service.pauseForDrone(input.droneId, [input.chatId]);
    await service.resumeForDrone(input.droneId, [input.chatId]);
    assert.equal(service.get(asked.subscription.id, input.chatId)?.status, 'active');
    await questions.submit(asked.requestId, answers);
    await service.tick();
    const pending = queue.listPending(input);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.deliveryMode, 'asap');
    assert.match(pending[0]!.prompt, /question_request.resolved/);
    assert.match(pending[0]!.prompt, /Include docs/);
    assert.deepEqual(wakes, ['drone-a/default']);
    assert.deepEqual(errors, []);
    await service.tick();
    assert.equal(queue.listPending(input).length, 1);
  } finally {
    await service.stop();
    questions.close();
  }
});

test('independent question service instances return the same durable winning answer', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const first = new ChatQuestionRequestService(database);
    const second = new ChatQuestionRequestService(database);
    const request = await first.askAsync(input);
    const write = database.writeTransaction.bind(database);
    database.writeTransaction = async (label, operation) => {
      if (label === 'resolve chat question request') await Promise.resolve();
      return await write(label, operation);
    };
    const results = await Promise.all([
      first.submit(request.requestId, answers),
      second.skip(request.requestId, 'user_skipped'),
    ]);
    assert.deepEqual(results[0], results[1]);
    const events = database.read((connection) =>
      connection.prepare('SELECT provider_content_json FROM resource_events').all(),
    ) as Array<{ provider_content_json: string }>;
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0]!.provider_content_json).result, results[0]);
  } finally {
    close();
  }
});

test('renaming a chat preserves access to its pending asynchronous questions', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const chats = new ChatTranscriptRepository(database);
    await chats.upsertChat({
      droneId: input.droneId,
      chatName: 'review',
      chatEntry: { id: input.chatId },
    });
    const questions = new ChatQuestionRequestService(database);
    const request = await questions.askAsync({ ...input, chatName: 'review' });
    await chats.renameChat({
      droneId: input.droneId,
      chatName: 'review',
      newChatName: 'review-renamed',
    });
    assert.equal(questions.listPending(input.droneId, 'review').length, 0);
    assert.equal(questions.listPending(input.droneId, 'review-renamed')[0]!.id, request.requestId);
    assert.equal((await questions.submit(request.requestId, answers)).status, 'submitted');
  } finally {
    close();
  }
});

test('deleting and recreating a named chat does not expose its old question forms', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const chats = new ChatTranscriptRepository(database);
    await chats.upsertChat({
      droneId: input.droneId,
      chatName: 'review',
      chatEntry: { id: input.chatId },
    });
    const questions = new ChatQuestionRequestService(database);
    await questions.askAsync({ ...input, chatName: 'review' });
    await chats.deleteActiveChat({ droneId: input.droneId, chatName: 'review' });
    await chats.upsertChat({
      droneId: input.droneId,
      chatName: 'review',
      chatEntry: { id: 'different-chat' },
    });
    assert.equal(questions.listPending(input.droneId, 'review').length, 0);
  } finally {
    close();
  }
});

test('a renamed chat connection creates questions at the current location and old names stay isolated', async () => {
  const { database, close } = memoryHubDatabase();
  try {
    const chats = new ChatTranscriptRepository(database);
    await chats.upsertChat({
      droneId: input.droneId,
      chatName: 'review',
      chatEntry: { id: input.chatId },
    });
    const questions = new ChatQuestionRequestService(database);
    const first = await questions.askAsync({ ...input, chatName: 'review' });
    // Restore/rename can change the canonical location before every derived label is refreshed.
    database.read((connection) =>
      connection
        .prepare("UPDATE canonical_chats SET chat_name = 'restored' WHERE chat_name = 'review'")
        .run(),
    );
    await chats.upsertChat({
      droneId: input.droneId,
      chatName: 'review',
      chatEntry: { id: 'different-chat' },
    });
    const second = await questions.askAsync({
      ...input,
      chatName: 'review',
      toolCallId: 'new-call',
    });
    assert.equal(questions.listPending(input.droneId, 'review').length, 0);
    assert.equal(questions.listPending(input.droneId, 'restored').length, 2);
    assert.equal(questions.getForChat(first.requestId, input.droneId, 'review'), null);
    assert.equal(
      questions.getForChat(second.requestId, input.droneId, 'restored')!.chatName,
      'restored',
    );
  } finally {
    close();
  }
});
