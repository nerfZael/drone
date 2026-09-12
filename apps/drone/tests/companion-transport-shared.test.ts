import { describe, expect, test } from 'bun:test';

import {
  boundedCompanionActivityEvent,
  CompanionBrowserToolBroker,
} from '../src/hub/companion/companion-transport-shared';

describe('Companion browser tool broker', () => {
  test('settles only the matching call generation', async () => {
    let dispatched: any;
    const broker = new CompanionBrowserToolBroker({
      available: () => true,
      unavailableMessage: 'disconnected',
      dispatch: (call) => {
        dispatched = call;
      },
    });
    const result = broker.request('get_app_context', {}, 4);

    expect(broker.resolve({ callId: dispatched.callId, generation: 3, ok: true })).toBe(false);
    expect(
      broker.resolve({
        callId: dispatched.callId,
        generation: 4,
        ok: true,
        result: { pane: 'chat' },
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({ pane: 'chat' });
  });

  test('cleans up aborted, rejected, and unavailable calls', async () => {
    const calls: any[] = [];
    const broker = new CompanionBrowserToolBroker({
      available: () => true,
      unavailableMessage: 'disconnected',
      dispatch: (call) => calls.push(call),
    });
    const controller = new AbortController();
    const aborted = broker.request('read_open_file', {}, 1, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow('browser tool cancelled');

    const rejected = broker.request('read_active_composer', {}, 2);
    broker.rejectAll('run closed');
    await expect(rejected).rejects.toThrow('run closed');

    const unavailable = new CompanionBrowserToolBroker({
      available: () => false,
      unavailableMessage: 'phone disconnected',
      dispatch: () => undefined,
    });
    await expect(unavailable.request('get_app_context', {}, 1)).rejects.toThrow(
      'phone disconnected',
    );
    expect(calls).toHaveLength(2);
  });

  test('times out a browser tool that never returns a result', async () => {
    const broker = new CompanionBrowserToolBroker({
      available: () => true,
      unavailableMessage: 'disconnected',
      timeoutMs: 5,
      dispatch: () => undefined,
    });
    await expect(broker.request('read_open_file', {}, 1)).rejects.toThrow(
      'browser tool timed out: read_open_file',
    );
  });

  test('waits for a slow proposal apply instead of losing its actual result', async () => {
    let call: any;
    const broker = new CompanionBrowserToolBroker({
      available: () => true, unavailableMessage: 'disconnected', timeoutMs: 5,
      dispatch: (value) => { call = value; },
    });
    let settled = false;
    const pending = broker.request('apply_companion_proposal_patch', {}, 1);
    void pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    const result = { applied: true, execution: { ok: false, operations: [{ status: 'failed' }] } };
    expect(broker.resolve({ ...call, ok: true, result })).toBe(true);
    await expect(pending).resolves.toEqual(result);
  });

  test('a pending proposal apply still settles on Stop or disconnect', async () => {
    const broker = new CompanionBrowserToolBroker({
      available: () => true, unavailableMessage: 'disconnected', dispatch: () => {},
    });
    const controller = new AbortController();
    const stopped = broker.request('apply_companion_proposal_patch', {}, 1, controller.signal);
    controller.abort();
    await expect(stopped).rejects.toThrow('cancelled');
    const disconnected = broker.request('apply_companion_proposal_patch', {}, 2);
    broker.rejectAll('disconnected');
    await expect(disconnected).rejects.toThrow('disconnected');
  });

  test('bounds visible tool activity and hides unrelated runtime events', () => {
    expect(boundedCompanionActivityEvent({ type: 'assistant_delta' })).toBeNull();
    const bounded = boundedCompanionActivityEvent({
      type: 'tool_call_completed',
      result: 'x'.repeat(21_000),
    });
    expect(String(bounded.result)).toContain('value truncated');
    expect(String(bounded.result).length).toBeLessThan(21_000);
  });
});


test('compaction activity exposes only status and valid estimated sizes', () => {
  const privateFields = { summary: 'private summary', fallbackReason: 'private provider error', metrics: { secret: true } };
  expect(boundedCompanionActivityEvent({ type: 'compaction_started', reason: 'private', ...privateFields }))
    .toEqual({ type: 'compaction_started' });
  expect(boundedCompanionActivityEvent({ type: 'compaction_skipped', reason: 'private', ...privateFields }))
    .toEqual({ type: 'compaction_skipped' });
  expect(boundedCompanionActivityEvent({ type: 'compaction_completed', tokensBefore: 5000, tokensAfter: 1000, fallbackUsed: true, ...privateFields }))
    .toEqual({ type: 'compaction_completed', tokensBefore: 5000, tokensAfter: 1000, fallbackUsed: true });
  expect(boundedCompanionActivityEvent({ type: 'compaction_failed', reason: 'cancelled', ...privateFields }))
    .toEqual({ type: 'compaction_failed', reason: 'cancelled' });
  const invalid = boundedCompanionActivityEvent({ type: 'compaction_completed', tokensBefore: Infinity, tokensAfter: -1 });
  expect(invalid.tokensBefore).toBeUndefined();
  expect(invalid.tokensAfter).toBeUndefined();
});
