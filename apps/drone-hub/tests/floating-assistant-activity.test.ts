import { beforeAll, describe, expect, mock, test } from 'bun:test';

type FloatingAssistantActivityHelpers = typeof import('../src/droneHub/assistant/FloatingAssistantDock');

let helpers: FloatingAssistantActivityHelpers;

mock.module(new URL('../src/droneHub/assistant/AssistantDock.tsx', import.meta.url).pathname, () => ({
  AssistantDock: () => null,
}));

beforeAll(async () => {
  helpers = await import('../src/droneHub/assistant/FloatingAssistantDock');
});

describe('floating assistant minimized activity scheduling', () => {
  test('uses a longer idle polling interval when no activity is visible', () => {
    expect(
      helpers.minimizedAssistantActivityPollingIntervalMs({
        activeCount: 0,
        documentHidden: false,
        eventsConnected: false,
      }),
    ).toBe(15_000);
  });

  test('keeps visible active polling responsive without an event stream', () => {
    expect(
      helpers.minimizedAssistantActivityPollingIntervalMs({
        activeCount: 2,
        documentHidden: false,
        eventsConnected: false,
      }),
    ).toBe(1_000);
  });

  test('pauses hidden idle polling and slows hidden active polling', () => {
    expect(
      helpers.minimizedAssistantActivityPollingIntervalMs({
        activeCount: 0,
        documentHidden: true,
        eventsConnected: false,
      }),
    ).toBeNull();

    expect(
      helpers.minimizedAssistantActivityPollingIntervalMs({
        activeCount: 1,
        documentHidden: true,
        eventsConnected: false,
      }),
    ).toBe(30_000);
  });

  test('does not poll while the event stream is connected', () => {
    expect(
      helpers.minimizedAssistantActivityPollingIntervalMs({
        activeCount: 1,
        documentHidden: false,
        eventsConnected: true,
      }),
    ).toBeNull();
  });
});

describe('floating assistant minimized event stream gating', () => {
  test('waits to connect until assistant activity is enabled or active work is known', () => {
    expect(
      helpers.shouldConnectMinimizedAssistantEvents({
        activeCount: 0,
        activityEnabled: false,
        documentHidden: false,
        enabled: true,
        eventSourceAvailable: true,
      }),
    ).toBe(false);

    expect(
      helpers.shouldConnectMinimizedAssistantEvents({
        activeCount: 0,
        activityEnabled: true,
        documentHidden: false,
        enabled: true,
        eventSourceAvailable: true,
      }),
    ).toBe(true);

    expect(
      helpers.shouldConnectMinimizedAssistantEvents({
        activeCount: 1,
        activityEnabled: false,
        documentHidden: false,
        enabled: true,
        eventSourceAvailable: true,
      }),
    ).toBe(true);
  });

  test('does not connect while disabled, hidden, or without EventSource support', () => {
    expect(
      helpers.shouldConnectMinimizedAssistantEvents({
        activeCount: 1,
        activityEnabled: true,
        documentHidden: false,
        enabled: false,
        eventSourceAvailable: true,
      }),
    ).toBe(false);

    expect(
      helpers.shouldConnectMinimizedAssistantEvents({
        activeCount: 1,
        activityEnabled: true,
        documentHidden: true,
        enabled: true,
        eventSourceAvailable: true,
      }),
    ).toBe(false);

    expect(
      helpers.shouldConnectMinimizedAssistantEvents({
        activeCount: 1,
        activityEnabled: true,
        documentHidden: false,
        enabled: true,
        eventSourceAvailable: false,
      }),
    ).toBe(false);
  });
});
