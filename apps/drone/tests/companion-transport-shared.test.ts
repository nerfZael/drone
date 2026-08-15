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
