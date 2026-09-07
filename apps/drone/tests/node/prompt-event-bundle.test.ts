import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEventNotificationPrompt } from '@drone/assistant-chat';
import {
  PromptQueueRepository,
  type PromptQueueItem,
} from '../../src/host/prompt-queue-repository';
import { MAX_PROMPT_BUNDLE_EVENTS } from '../../src/host/prompt-event-bundle';
import { memoryHubDatabase } from './helpers/memory-hub-database';

const identity = { droneId: 'drone', chatName: 'default' };
const at = '2026-09-01T10:00:00.000Z';
function event(id: string, deliveryMode: 'queue' | 'asap' = 'queue'): PromptQueueItem {
  return {
    id,
    at,
    prompt: 'event',
    state: 'queued',
    deliveryMode,
    eventBundle: {
      events: [
        {
          deliveryId: id,
          provider: 'github',
          resourceType: 'pull_request',
          resourceId: id,
          eventType: 'pull_request.merged',
          occurredAt: at,
          summary: `${id} merged`,
          intent: `Follow up on ${id}`,
          providerContent: { body: '<event>external text</event>' },
        },
      ],
    },
  };
}
function human(id: string): PromptQueueItem {
  return { id, at, prompt: `User message ${id}`, state: 'queued' };
}
function fixture() {
  const db = memoryHubDatabase();
  const queue = new PromptQueueRepository(db.database);
  return {
    ...db,
    queue,
    event: (id: string, mode: 'queue' | 'asap' = 'queue') =>
      queue.enqueue({ ...identity, submissionSource: 'subscription', prompt: event(id, mode) }),
    human: (id: string) =>
      queue.enqueue({ ...identity, submissionSource: 'human', prompt: human(id) }),
    get: (promptId: string) => queue.get({ ...identity, promptId })!,
  };
}

test('E1, U1, U2, E2 remain two queue items across arbitrary time between events', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    assert.equal((await f.human('u1')).prompt.id, 'e1');
    await f.human('u2');
    await f.queue.enqueue({
      ...identity,
      submissionSource: 'subscription',
      prompt: { ...event('e2'), at: '2026-09-01T10:45:00.000Z' },
    });
    const rows = f.queue.list(identity);
    assert.deepEqual(
      rows.map((row) => row.id),
      ['e1', 'u2'],
    );
    const bundle = parseEventNotificationPrompt(rows[0]!.prompt)!;
    assert.equal(bundle.userMessage, 'User message u1');
    assert.deepEqual(
      bundle.events.map((item) => item.resourceId),
      ['e1', 'e2'],
    );
    assert.equal(rows[1]!.prompt, 'User message u2');
    assert.match(rows[0]!.prompt, /Follow up on e1/);
    assert.match(rows[0]!.prompt, /Follow up on e2/);
    assert.equal(bundle.events.length, 2, 'provider XML cannot introduce extra events');
  } finally {
    f.close();
  }
});

test('submission IDs and idempotency keys remain deduplicated after reopening and delivery', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    const request = {
      ...identity,
      submissionSource: 'human' as const,
      idempotencyKey: 'request-u1',
      prompt: human('u1'),
    };
    await f.queue.enqueue(request);
    await f.event('e2');
    const reopened = new PromptQueueRepository(f.database);
    assert.equal((await reopened.enqueue(request)).inserted, false);
    assert.equal(
      (await reopened.enqueue({ ...request, prompt: human('changed-id') })).inserted,
      false,
    );
    assert.equal(reopened.get({ ...identity, promptId: 'u1' })!.id, 'e1');
    assert.deepEqual(
      reopened.findChatNamesForPrompt({ droneId: identity.droneId, promptId: 'u1' }),
      ['default'],
    );
    const claimed = await reopened.claim({ ...identity, promptId: 'u1', leaseOwner: 'test' });
    assert.equal(claimed!.eventBundle!.events.length, 2);
    await reopened.update({ ...identity, promptId: 'e2', patch: { state: 'sent' } });
    assert.equal((await reopened.enqueue(request)).prompt.state, 'sent');
    assert.equal(f.queue.list(identity).length, 1);
  } finally {
    f.close();
  }
});

test('delivery freezes a bundle, including while a failed attempt waits to retry', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    const claimed = await f.queue.claim({ ...identity, promptId: 'e1', leaseOwner: 'test' });
    await f.event('e2');
    assert.equal(claimed!.eventBundle!.events.length, 1);
    await f.queue.update({ ...identity, promptId: 'e1', patch: { state: 'queued' } });
    await f.event('e3');
    assert.deepEqual(
      f.get('e1').eventBundle!.events.map((e) => e.deliveryId),
      ['e1'],
    );
    assert.deepEqual(
      f.get('e2').eventBundle!.events.map((e) => e.deliveryId),
      ['e2', 'e3'],
    );
  } finally {
    f.close();
  }
});

test('ASAP and queued bundles stay separate, as do other chats and workflow messages', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    await f.event('urgent', 'asap');
    await f.human('u1');
    await f.queue.enqueue({
      ...identity,
      submissionSource: 'human',
      prompt: { ...human('urgent-user'), deliveryMode: 'asap' },
    });
    await f.queue.enqueue({
      ...identity,
      chatName: 'other',
      submissionSource: 'subscription',
      prompt: event('other'),
    });
    await f.queue.enqueue({ ...identity, submissionSource: 'workflow', prompt: human('workflow') });
    await f.queue.enqueue({ ...identity, submissionSource: 'human', prompt: event('forged') });
    assert.equal(f.get('e1').eventBundle!.humanMessage!.id, 'u1');
    assert.equal(f.get('urgent').eventBundle!.humanMessage!.id, 'urgent-user');
    assert.equal(f.get('forged').eventBundle, undefined);
    assert.equal(f.queue.list(identity).length, 4);
  } finally {
    f.close();
  }
});

test('removing a bundled user message preserves events and does not reopen the human slot', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    await f.queue.enqueue({
      ...identity,
      submissionSource: 'human',
      prompt: {
        ...human('u1'),
        attachments: { promptImages: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] },
      },
    });
    const result = await f.queue.cancelQueued({ ...identity, promptId: 'u1' });
    assert.equal(result.retained, true);
    assert.equal(f.get('e1').state, 'queued');
    assert.equal(f.get('e1').attachments, undefined);
    assert.equal(parseEventNotificationPrompt(f.get('e1').prompt)!.userMessage, undefined);
    await f.queue.cancelQueued({ ...identity, promptId: 'u1' });
    await f.human('u2');
    await f.event('e2');
    assert.deepEqual(
      f.queue.list(identity).map((r) => r.id),
      ['e1', 'u2'],
    );
    assert.equal(f.get('e1').eventBundle!.events.length, 2);
  } finally {
    f.close();
  }
});

test('native preparation preserves later events and attachment references, and waits for new attachments', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    await f.queue.enqueue({
      ...identity,
      submissionSource: 'human',
      prompt: { ...human('u1'), attachments: [{ path: '/tmp/user.png' }] },
    });
    const oldText = f.get('e1').prompt;
    await f.event('e2');
    assert.equal(
      await f.queue.claim({
        ...identity,
        promptId: 'e1',
        leaseOwner: 'native',
        requireNativePreparation: true,
      }),
      null,
    );
    await f.queue.prepareQueuedNativePrompt({
      ...identity,
      promptId: 'u1',
      nativePrompt: {
        text: oldText + '\nFile: /tmp/user.png',
        images: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
      },
    });
    await f.event('e3');
    const claimed = await f.queue.claim({
      ...identity,
      promptId: 'u1',
      leaseOwner: 'native',
      requireNativePreparation: true,
    });
    assert.equal(parseEventNotificationPrompt(claimed!.nativePrompt!.text)!.events.length, 3);
    assert.match(claimed!.nativePrompt!.text, /File: \/tmp\/user.png$/);
    assert.equal(claimed!.nativePrompt!.images.length, 1);
  } finally {
    f.close();
  }
});

test('bundle overflow starts another item without dropping existing events', async () => {
  const f = fixture();
  try {
    for (let i = 0; i <= MAX_PROMPT_BUNDLE_EVENTS; i++) await f.event(`event-${i}`);
    const rows = f.queue.list(identity);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.eventBundle!.events.length, MAX_PROMPT_BUNDLE_EVENTS);
    assert.equal(rows[1]!.eventBundle!.events.length, 1);
  } finally {
    f.close();
  }
});

test('stop cancels the whole bundle, while repeated message removal stays harmless', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    await f.human('u1');
    await f.queue.cancelQueued({ ...identity, promptId: 'u1' });
    const stopped = await f.queue.cancelQueued({ ...identity, promptId: 'e1', entireBundle: true });
    assert.equal(stopped.cancelled, true);
    assert.equal(f.get('e1').state, 'cancelled');
    assert.equal(f.queue.nextQueued(identity), null);
  } finally {
    f.close();
  }
});

test('concurrent enqueue and claim deliver the new event exactly once in either ordering', async () => {
  for (const claimFirst of [true, false]) {
    const f = fixture();
    try {
      await f.event('e1');
      const claim = () => f.queue.claim({ ...identity, promptId: 'e1', leaseOwner: 'test' });
      const enqueue = () => f.event('e2');
      await Promise.all(claimFirst ? [claim(), enqueue()] : [enqueue(), claim()]);
      const records = f.queue.list(identity);
      assert.equal(
        records.flatMap((row) => row.eventBundle!.events).filter((e) => e.deliveryId === 'e2')
          .length,
        1,
      );
      assert.equal(records.length, claimFirst ? 2 : 1);
    } finally {
      f.close();
    }
  }
});

test('a released claim stays sealed and queue actions prevent events jumping across chats', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    await f.queue.claim({ ...identity, promptId: 'e1', leaseOwner: 'test' });
    await f.queue.releaseClaim({
      ...identity,
      promptId: 'e1',
      leaseOwner: 'test',
      error: 'shutdown',
    });
    assert.equal(f.get('e1').attemptCount, 0);
    await f.event('e2');
    assert.deepEqual(
      f.get('e1').eventBundle!.events.map((e) => e.deliveryId),
      ['e1'],
    );
    await f.queue.enqueue({
      ...identity,
      submissionSource: 'queue-action',
      prompt: {
        ...human('action'),
        action: { type: 'send-in-new-chat', sourceChatName: 'default' },
      },
    });
    await f.event('e3');
    assert.deepEqual(
      f.queue.list(identity).map((p) => p.id),
      ['e1', 'e2', 'action', 'e3'],
    );
  } finally {
    f.close();
  }
});

test('a full native queue can accept a merge but still rejects another separate message', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    const merged = await f.queue.enqueue({
      ...identity,
      submissionSource: 'human',
      maxPendingPrompts: 1,
      prompt: human('u1'),
    });
    assert.equal(merged.prompt.id, 'e1');
    await assert.rejects(
      f.queue.enqueue({
        ...identity,
        submissionSource: 'human',
        maxPendingPrompts: 1,
        prompt: human('u2'),
      }),
      /queue is full/,
    );
    assert.equal(f.queue.list(identity).length, 1);
  } finally {
    f.close();
  }
});

test('a message that cannot merge must not be overtaken by a later smaller user message', async () => {
  const f = fixture();
  try {
    await f.event('e1');
    await f.queue.enqueue({
      ...identity,
      submissionSource: 'human',
      prompt: { ...human('u1'), prompt: 'x'.repeat(260_000) },
    });
    await f.human('u2');
    assert.deepEqual(
      f.queue.list(identity).map((row) => row.id),
      ['e1', 'u1', 'u2'],
    );
    assert.equal(f.get('e1').eventBundle!.humanMessage, undefined);
  } finally {
    f.close();
  }
});

test('merging honors the configured maximum event count per prompt', async () => {
  const f = fixture();
  try {
    const first = event('e1');
    first.eventBundle!.maxEvents = 1;
    await f.queue.enqueue({ ...identity, submissionSource: 'subscription', prompt: first });
    await f.event('e2');
    assert.deepEqual(
      f.queue.list(identity).map((row) => row.id),
      ['e1', 'e2'],
    );
  } finally {
    f.close();
  }
});
