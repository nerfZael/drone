import { describe, expect, test } from 'bun:test';
import { WebSocketServer } from 'ws';

import { createBackgroundLifecycle } from '../src/hub/background-lifecycle';
import { createDroneStatusRuntime } from '../src/hub/drone-status-runtime';
import { hubChangeEvents } from '../src/hub/hub-change-events';
import { startHubHttpTransport } from '../src/hub/hub-http-transport';
import {
  createNativeChatRuntimePort,
  createResourceSubscriptionRuntimePort,
} from '../src/hub/hub-runtime-ports';
import { getSocketListenSupport } from './socket-listen-support';

const describeSocketSuite = getSocketListenSupport().ok ? describe : describe.skip;

describe('hub runtime foundations', () => {
  test('stops resources once in reverse order and continues after failures', async () => {
    const stopped: string[] = [];
    const stopErrors: Array<{ name: string; error: unknown }> = [];
    const lifecycle = createBackgroundLifecycle((name, error) => {
      stopErrors.push({ name, error });
    });
    const expectedError = new Error('expected stop failure');

    lifecycle.register('first', async () => {
      stopped.push('first');
    });
    lifecycle.register('second', async () => {
      stopped.push('second');
      throw expectedError;
    });

    await lifecycle.stop();
    await lifecycle.stop();

    expect(stopped).toEqual(['second', 'first']);
    expect(stopErrors).toEqual([{ name: 'second', error: expectedError }]);
  });

  test('owns status polling and cache state for one runtime', async () => {
    let changedSource = '';
    let resolveChanged: () => void = () => {};
    const changed = new Promise<void>((resolve) => {
      resolveChanged = resolve;
    });
    const entry = {
      id: 'drone-one',
      runtime: 'container',
      name: 'drone-one',
      containerPort: 7777,
      token: 'token',
    };
    const runtime = createDroneStatusRuntime({
      loadModel: async () => ({ drones: { 'drone-one': entry } }),
      log: () => {},
      makeClient: () => ({}),
      normalizeDroneId: (value) => String(value ?? ''),
      normalizeRuntime: (value) => String(value ?? ''),
      onChanged: (source) => {
        changedSource = source;
        resolveChanged();
      },
      readStatus: async () => ({ ready: true }),
      resolveHostPort: async () => 17_777,
    });

    runtime.start();
    await Promise.race([
      changed,
      Bun.sleep(1_000).then(() => {
        throw new Error('status refresh timed out');
      }),
    ]);
    const cached = runtime.cachedForEntry(entry);
    await runtime.stop();

    expect(changedSource).toBe('startup');
    expect(cached).toMatchObject({
      hostPort: 17_777,
      statusOk: true,
      status: { ready: true },
      statusError: null,
    });
  });

  test('isolates native chat bindings and safely releases stale bindings', async () => {
    const port = createNativeChatRuntimePort();
    expect(await port.isBusy('chat')).toBe(false);
    await expect(port.prompt({})).rejects.toThrow('native chat runtime is not ready');

    const releaseFirst = port.bind(nativeRuntime('first'));
    expect(await port.isBusy('chat')).toBe(true);
    expect(await port.latestAssistantText('chat')).toBe('first');
    expect(() => port.bind(nativeRuntime('duplicate'))).toThrow(
      'native chat runtime is already bound',
    );

    releaseFirst();
    const releaseSecond = port.bind(nativeRuntime('second'));
    releaseFirst();
    expect(await port.latestAssistantText('chat')).toBe('second');
    releaseSecond();
    expect(await port.latestAssistantText('chat')).toBe('');
  });

  test('uses no-op subscription behavior until a runtime is bound', async () => {
    const calls: string[] = [];
    const port = createResourceSubscriptionRuntimePort();
    await port.resumeForChat('before-bind');

    const release = port.bind({
      pauseForDrone: async (droneId) => calls.push(`pause:${droneId}`),
      resumeForChat: async (chatId) => calls.push(`chat:${chatId}`),
      resumeForDrone: async (droneId) => calls.push(`drone:${droneId}`),
    });
    await port.pauseForDrone('one', []);
    await port.resumeForChat('chat-one');
    await port.resumeForDrone('one', []);
    release();
    await port.resumeForChat('after-release');

    expect(calls).toEqual(['pause:one', 'chat:chat-one', 'drone:one']);
  });

  test('delivers change events only while subscribed', () => {
    const events: string[] = [];
    const unsubscribeRegistry = hubChangeEvents.onRegistryWrite(() => events.push('registry'));
    const unsubscribeSummary = hubChangeEvents.onSummaryChange(() => events.push('summary'));
    const unsubscribeChat = hubChangeEvents.onChatWrite(({ droneId, chatName }) => {
      events.push(`chat:${droneId}:${chatName}`);
    });

    hubChangeEvents.emitRegistryWrite();
    hubChangeEvents.emitSummaryChange();
    hubChangeEvents.emitChatWrite('drone-one', 'main');
    unsubscribeRegistry();
    unsubscribeSummary();
    unsubscribeChat();
    hubChangeEvents.emitRegistryWrite();
    hubChangeEvents.emitSummaryChange();
    hubChangeEvents.emitChatWrite('drone-two', 'main');

    expect(events).toEqual(['registry', 'summary', 'chat:drone-one:main']);
  });
});

describeSocketSuite('hub HTTP transport', () => {
  test('serves requests and closes repeatedly without leaking errors', async () => {
    const webSocketServer = new WebSocketServer({ noServer: true });
    const transport = await startHubHttpTransport({
      host: '127.0.0.1',
      port: 0,
      requestListener: (_request, response) => {
        response.statusCode = 204;
        response.end();
      },
      upgradeListener: () => {},
      webSocketServer,
    });

    const response = await fetch(`http://${transport.host}:${transport.port}`);
    expect(response.status).toBe(204);
    transport.stopAccepting();
    await transport.close();
    await transport.close();
  });
});

function nativeRuntime(label: string) {
  return {
    cloneSession: async () => {},
    copyConfiguration: async () => {},
    deleteSessions: async () => {},
    error: async () => '',
    isBusy: async () => true,
    latestAssistantText: async () => label,
    prompt: async () => {},
    stop: async () => {},
  };
}
