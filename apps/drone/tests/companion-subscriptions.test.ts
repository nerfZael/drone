import { expect, test } from 'bun:test';
import { CompanionRunSession } from '../src/hub/companion/companion-run-session';
import {
  COMPANION_SUBSCRIPTION_TOOL_NAMES,
  DEFAULT_COMPANION_SETTINGS,
  normalizeCompanionSettings,
} from '../src/hub/companion/companion-config';
import type { SessionSubscriptionDelivery } from '../src/hub/subscriptions/resource-subscription-service';

test('subscription tools migrate existing chat-enabled settings and respect explicit disablement', () => {
  const migrated = normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, schemaVersion: 9, enabledTools: ['list_chats'] });
  for (const name of COMPANION_SUBSCRIPTION_TOOL_NAMES) expect(migrated.enabledTools).toContain(name);
  expect(normalizeCompanionSettings({ ...migrated, enabledTools: ['list_chats'] }).enabledTools).toEqual(['list_chats']);
  expect(normalizeCompanionSettings({ ...migrated, schemaVersion: 9, enabledTools: [] }).enabledTools).toEqual([]);
});

test('event delivery resumes an idle session, announces before tools, deduplicates and stops on close', async () => {
  const h = harness();
  await h.session.submit({ prompt: 'watch', messageId: 'user' });
  h.finish[0]('Subscribed');
  await tick();
  const delivery = { prompt: 'event payload', messageId: 'event', deliveryMode: 'queue' as const };
  await h.deliver(delivery);
  await h.deliver(delivery);
  expect(h.runs.map((run) => run.prompt)).toEqual(['watch', 'event payload']);
  expect(h.messages.slice(-2)).toEqual([
    { type: 'subscription', messageId: 'event' },
    { type: 'status', messageId: 'event', status: 'working' },
  ]);
  const browser = h.runs[1].callBrowser('get_app_context', {});
  const call = h.messages.at(-1);
  expect(call.messageId).toBe('event');
  h.session.resolveBrowserTool({ ...call, ok: true, result: { ready: true } });
  expect(await browser).toEqual({ ready: true });
  await h.session.close('closed');
  expect(h.deleted).toEqual(['run']);
  await expect(h.deliver({ ...delivery, messageId: 'late' })).rejects.toThrow('closed');
  h.finish[1]('late reply');
  await tick();
  expect(h.messages.some((m) => m.reply === 'late reply')).toBe(false);
});

test('queue event delivery waits even when the active run supports ASAP', async () => {
  const h = harness();
  await h.session.submit({ prompt: 'work', messageId: 'user' });
  await h.deliver({ prompt: 'queued event', messageId: 'event', deliveryMode: 'queue' });
  expect(h.steered).toEqual([]);
  expect(h.runs).toHaveLength(1);
  expect(h.messages.some((m) => m.type === 'subscription')).toBe(false);
  h.finish[0]('done');
  await tick();
  expect(h.runs[1].prompt).toBe('queued event');
  h.finish[1]('event answer');
  await tick();
  expect(h.messages.at(-1)).toEqual({ type: 'status', messageId: 'event', status: 'completed' });
  await h.session.close('closed');
});

test('ASAP events steer with their event delivery setting and keep in-flight browser results', async () => {
  const h = harness();
  await h.session.submit({ prompt: 'work', messageId: 'user' });
  const browser = h.runs[0].callBrowser('get_app_context', {});
  const call = h.messages.at(-1);
  await h.deliver({ prompt: 'asap event', messageId: 'event', deliveryMode: 'asap' });
  expect(h.steered).toEqual([{ prompt: 'asap event', mode: 'asap' }]);
  expect(h.messages.at(-1)).toEqual({ type: 'subscription', messageId: 'event', afterMessageId: 'user' });
  h.session.resolveBrowserTool({ ...call, ok: true, result: 'context' });
  expect(await browser).toBe('context');
  h.finish[0]('combined answer');
  await tick();
  expect(h.messages.at(-2)).toEqual({ type: 'reply', messageId: 'event', reply: 'combined answer' });
  await h.session.close('closed');
});

test('an ASAP event can steer past an earlier queued event', async () => {
  const h = harness();
  await h.session.submit({ prompt: 'work', messageId: 'user' });
  await h.deliver({ prompt: 'queued', messageId: 'queued-event', deliveryMode: 'queue' });
  await h.deliver({ prompt: 'urgent', messageId: 'urgent-event', deliveryMode: 'asap' });
  expect(h.steered).toEqual([{ prompt: 'urgent', mode: 'asap' }]);
  h.finish[0]('urgent answer');
  await tick();
  expect(h.runs[1].prompt).toBe('queued');
  h.finish[1]('queued answer');
  await tick();
  await h.session.close('closed');
});

test('concurrent retries of one event start only one run', async () => {
  const h = harness();
  const delivery = { prompt: 'event', messageId: 'event', deliveryMode: 'queue' as const };
  try {
    await Promise.all([h.deliver(delivery), h.deliver(delivery)]);
    expect(h.runs).toHaveLength(1);
    h.finish[0]('done');
    await tick();
    expect(h.runs).toHaveLength(1);
    expect(h.messages.filter((message) => message.type === 'subscription')).toHaveLength(1);
  } finally { await h.session.close('closed'); }
});

test('concurrent retries share a failed delivery instead of acknowledging an undelivered event', async () => {
  const announcement = Promise.withResolvers<void>();
  const h = harness((event) => event.type === 'subscription' ? announcement.promise : undefined);
  const input = { prompt: 'event', messageId: 'event', deliveryMode: 'queue' as const };
  const attempts = Promise.allSettled([h.deliver(input), h.deliver(input)]);
  await tick();
  expect(h.messages.filter((message) => message.type === 'subscription')).toHaveLength(1);
  announcement.reject(new Error('Disconnected during announcement'));
  const results = await attempts;
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
  expect(h.runs).toHaveLength(0);
  expect(h.deleted).toEqual(['run']);
});

function harness(emit?: (event: any) => void | Promise<void>) {
  const runs: any[] = [], messages: any[] = [], finish: Array<(reply: string) => void> = [];
  const steered: unknown[] = [], deleted: string[] = [];
  let deliver!: (input: SessionSubscriptionDelivery) => Promise<void>;
  let subscriptionsChanged!: (subscriptions: unknown[]) => void;
  const session = new CompanionRunSession({
    clientRunId: 'run', runtimeRunId: 'run', transport: 'websocket',
    runtime: {
      connectSubscriptions: (_id, callback, changed) => { deliver = callback; subscriptionsChanged = changed!; },
      run: async (input) => { runs.push(input); return new Promise<string>((resolve) => finish.push(resolve)); },
      steer: (_id, prompt, mode) => { steered.push({ prompt, mode }); return true; },
      deleteSession: async (id) => { deleted.push(id); },
    },
    emit: (event) => { messages.push(event); return emit?.(event); },
    isAvailable: () => true, unavailableMessage: 'closed', onClose: () => {},
  });
  return { session, runs, messages, finish, steered, deleted, subscriptionsChanged: (rows: unknown[]) => subscriptionsChanged(rows), deliver: (input: SessionSubscriptionDelivery) => deliver(input) };
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }

test('session pushes changed subscription snapshots and suppresses duplicates and closed-session updates', async () => {
  const h = harness();
  const row = { id: 'watch', status: 'active' };
  h.subscriptionsChanged([]);
  h.subscriptionsChanged([row]);
  h.subscriptionsChanged([row]);
  h.subscriptionsChanged([]);
  await tick();
  expect(h.messages).toEqual([
    { type: 'subscriptions', subscriptions: [] },
    { type: 'subscriptions', subscriptions: [row] },
    { type: 'subscriptions', subscriptions: [] },
  ]);
  await h.session.close('closed');
  h.subscriptionsChanged([row]);
  await tick();
  expect(h.messages).toHaveLength(3);
});
