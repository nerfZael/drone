import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChatQuestionRequestService,
  normalizeChatQuestions,
} from '../../src/hub/chat-question-requests';
import { PromptQueueRepository } from '../../src/host/prompt-queue-repository';
import { memoryHubDatabase } from './helpers/memory-hub-database';

const questions = [
  {
    id: 'delivery',
    question: 'How should this be delivered?',
    detailedExplanation: 'This determines the rollout path.',
    importance: 80,
    choices: [
      { id: 'safe', label: 'Safe rollout', recommended: true },
      { id: 'fast', label: 'Immediate rollout' },
    ],
  },
  {
    id: 'follow-up',
    question: 'Should we add a follow-up?',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
  },
];

test('question input preserves order and validates recommendation and importance bounds', () => {
  const normalized = normalizeChatQuestions(questions);
  assert.deepEqual(
    normalized.map((question) => question.id),
    ['delivery', 'follow-up'],
  );
  assert.equal(normalized[1]?.importance, 50);
  assert.equal(normalized[0]?.detailedExplanation, 'This determines the rollout path.');

  assert.throws(
    () =>
      normalizeChatQuestions([
        {
          ...questions[0],
          choices: questions[0]!.choices.map((choice) => ({ ...choice, recommended: true })),
        },
      ]),
    /more than one recommended choice/,
  );
  assert.throws(
    () => normalizeChatQuestions([{ ...questions[0], importance: 101 }]),
    /integer from 1 to 100/,
  );
});

test('submitted answers retain distinct choice, custom, and skipped outcomes', async () => {
  const service = new ChatQuestionRequestService(null);
  try {
    const request = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      questions,
    });
    const waiting = service.waitForResult(request.id);
    const result = await service.submit(request.id, {
      responses: [
        { questionId: 'delivery', outcome: 'custom', text: 'Canary for one day' },
        { questionId: 'follow-up', outcome: 'skipped' },
      ],
      notes: 'Use the normal monitoring dashboard.',
    });

    assert.deepEqual(await waiting, result);
    assert.deepEqual(result, {
      status: 'submitted',
      requestId: request.id,
      responses: [
        { questionId: 'delivery', outcome: 'custom', text: 'Canary for one day' },
        { questionId: 'follow-up', outcome: 'skipped' },
      ],
      notes: 'Use the normal monitoring dashboard.',
    });
    assert.equal(service.get(request.id)?.status, 'submitted');
    assert.deepEqual(service.listForChat('drone-a', 'default'), [service.get(request.id)]);
  } finally {
    service.close();
  }
});

test('chat history includes resolved requests while the pending view remains filtered', async () => {
  const { database, close } = memoryHubDatabase();
  const service = new ChatQuestionRequestService(database);
  try {
    const submitted = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      questions: [questions[0]],
    });
    await service.submit(submitted.id, {
      responses: [{ questionId: 'delivery', outcome: 'choice', choiceId: 'safe' }],
    });
    const pending = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      questions: [questions[1]],
    });

    const restoredService = new ChatQuestionRequestService(database);
    const restored = restoredService.listForChat('drone-a', 'default');
    restoredService.close();
    assert.deepEqual(
      restored.map((request) => request.id),
      [submitted.id, pending.id],
    );
    assert.equal(restored[0]?.result?.status, 'submitted');
    assert.deepEqual(
      restored[0]?.result?.status === 'submitted' ? restored[0].result.responses : null,
      [{ questionId: 'delivery', outcome: 'choice', choiceId: 'safe', label: 'Safe rollout' }],
    );
    assert.deepEqual(
      service.listPending('drone-a', 'default').map((request) => request.id),
      [pending.id],
    );
  } finally {
    service.close();
    close();
  }
});

test('concurrent queue and user resolutions settle a request only once', async () => {
  const service = new ChatQuestionRequestService(null);
  let nativeResolutions = 0;
  service.setNativeResolver(async () => {
    nativeResolutions += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  try {
    const request = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      nativeThreadId: 'chat-a',
      toolCallId: 'call-a',
      questions: [questions[0]],
    });
    const submitted = service.submit(request.id, {
      responses: [{ questionId: 'delivery', outcome: 'choice', choiceId: 'safe' }],
    });
    const skipped = service.skip(request.id, 'queued_message_pending');
    const [first, second] = await Promise.all([submitted, skipped]);

    assert.deepEqual(second, first);
    assert.equal(first.status, 'submitted');
    assert.equal(nativeResolutions, 1);
  } finally {
    service.close();
  }
});

test('native requests remain pending when their suspended runtime cannot be resumed', async () => {
  const service = new ChatQuestionRequestService(null);
  try {
    const request = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      nativeThreadId: 'chat-a',
      toolCallId: 'call-a',
      questions: [questions[0]],
    });

    await assert.rejects(
      service.skip(request.id, 'user_skipped'),
      /native question resolver is unavailable/,
    );
    assert.equal(service.get(request.id)?.status, 'pending');
  } finally {
    service.close();
  }
});

test('canceling an ask cleans up its pending request', async () => {
  const service = new ChatQuestionRequestService(null);
  const controller = new AbortController();
  try {
    const asking = service.ask(
      {
        droneId: 'drone-a',
        chatName: 'default',
        chatId: 'chat-a',
        questions: [questions[0]],
      },
      controller.signal,
    );
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await assert.rejects(asking, { name: 'AbortError' });
    assert.equal(service.listPending('drone-a', 'default').length, 0);
  } finally {
    service.close();
  }
});

test('resolution listeners observe the durable terminal request', async () => {
  const service = new ChatQuestionRequestService(null);
  const observed: Array<{ status: string; resultStatus: string }> = [];
  const unsubscribe = service.subscribeResolved(({ request, result }) => {
    observed.push({ status: request.status, resultStatus: result.status });
  });
  try {
    const request = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      questions: [questions[0]],
    });
    await service.skip(request.id, 'user_skipped');
    assert.deepEqual(observed, [{ status: 'skipped', resultStatus: 'skipped' }]);
  } finally {
    unsubscribe();
    service.close();
  }
});

test('startup reconciliation skips pending questions when a message was queued while offline', async () => {
  const { database, close } = memoryHubDatabase();
  const queue = new PromptQueueRepository(database);
  const firstService = new ChatQuestionRequestService(database);
  const request = await firstService.create({
    droneId: 'drone-a',
    chatName: 'default',
    chatId: 'chat-a',
    nativeThreadId: 'chat-a',
    toolCallId: 'call-a',
    questions: [questions[0]],
  });
  firstService.close();
  await queue.enqueue({
    droneId: 'drone-a',
    chatName: 'default',
    submissionSource: 'workflow',
    prompt: {
      id: 'offline-message',
      at: new Date().toISOString(),
      prompt: 'Continue after reconnecting.',
      state: 'queued',
    },
  });

  const restoredService = new ChatQuestionRequestService(database);
  let nativeResolutions = 0;
  restoredService.setNativeResolver(async () => {
    nativeResolutions += 1;
  });
  try {
    await restoredService.reconcileQueuedRequests();
    assert.deepEqual(restoredService.get(request.id)?.result, {
      status: 'skipped',
      requestId: request.id,
      reason: 'queued_message_pending',
    });
    assert.equal(nativeResolutions, 1);
  } finally {
    restoredService.close();
    close();
  }
});

test('a queued message from any source skips only questions for the same chat', async () => {
  const { database, close } = memoryHubDatabase();
  const queue = new PromptQueueRepository(database);
  const service = new ChatQuestionRequestService(database);
  try {
    const request = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      questions: [questions[0]],
    });

    await queue.enqueue({
      droneId: 'drone-a',
      chatName: 'other',
      submissionSource: 'system',
      prompt: {
        id: 'other-message',
        at: new Date().toISOString(),
        prompt: 'This is for another chat.',
        state: 'queued',
      },
    });
    assert.equal(service.get(request.id)?.status, 'pending');

    await queue.enqueue({
      droneId: 'drone-a',
      chatName: 'default',
      submissionSource: 'workflow',
      prompt: {
        id: 'queued-message',
        at: new Date().toISOString(),
        prompt: 'Continue with this queued context.',
        state: 'queued',
      },
    });
    assert.deepEqual(service.get(request.id)?.result, {
      status: 'skipped',
      requestId: request.id,
      reason: 'queued_message_pending',
    });

    const createdAfterQueue = await service.create({
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      questions: [questions[0]],
    });
    assert.equal(createdAfterQueue.status, 'skipped');
    assert.equal(createdAfterQueue.result?.status, 'skipped');
    if (createdAfterQueue.result?.status === 'skipped') {
      assert.equal(createdAfterQueue.result.reason, 'queued_message_pending');
    }
  } finally {
    service.close();
    close();
  }
});
