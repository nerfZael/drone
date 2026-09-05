import { describe, expect, mock, test } from 'bun:test';
mock.module('expo/fetch', () => ({ fetch: globalThis.fetch }));

mock.module('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length),
  randomUUID: () => '00000000-0000-4000-8000-000000000001',
}));

mock.module('../src/security/device-identity', () => ({
  verifyP256Signature: () => true,
}));

const { MeshSession } = await import('../src/mesh/MeshSession');

describe('MeshSession requests', () => {
  test('adopts a refreshed endpoint without disconnecting the live socket', () => {
    const socket = new MeshSession(
      { deviceId: 'peer-a', endpoint: 'https://old.test', role: 'primary' },
      'network-a',
      {
        id: 'mobile-a',
        name: 'Mobile',
        platform: 'android',
        publicKey: {},
        sign: async () => 'signature',
      },
      {},
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { handle: async () => null },
      { inspectEnvelope: () => 'accept', acceptValidated: () => 'accept' },
    );
    const liveSocket = { close: mock(() => undefined) };
    const internals = socket as unknown as {
      ready: boolean;
      socket: typeof liveSocket;
    };
    internals.ready = true;
    internals.socket = liveSocket;

    socket.updateConnection({
      deviceId: 'peer-a',
      endpoint: 'https://new.test',
      role: 'backup',
    });

    expect(socket.connection).toEqual({
      deviceId: 'peer-a',
      endpoint: 'https://new.test',
      role: 'backup',
    });
    expect(socket.connected).toBe(true);
    expect(liveSocket.close).not.toHaveBeenCalled();
  });

  test('does not send or retain a request aborted while signing', async () => {
    let releaseSigning!: () => void;
    const signingStarted = Promise.withResolvers<void>();
    const signingGate = new Promise<void>((resolve) => {
      releaseSigning = resolve;
    });
    const sent: string[] = [];
    const socket = new MeshSession(
      { deviceId: 'peer-a', endpoint: 'https://peer-a.test', role: 'primary' },
      'network-a',
      {
        id: 'mobile-a',
        name: 'Mobile',
        platform: 'android',
        publicKey: {},
        async sign() {
          signingStarted.resolve();
          await signingGate;
          return 'signature';
        },
      },
      {},
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { handle: async () => null },
      { inspectEnvelope: () => 'accept', acceptValidated: () => 'accept' },
    );
    const internals = socket as unknown as {
      ready: boolean;
      socket: Pick<WebSocket, 'readyState' | 'send'>;
      pending: Map<string, unknown>;
    };
    internals.ready = true;
    internals.socket = {
      readyState: WebSocket.OPEN,
      send(value) {
        sent.push(String(value));
      },
    };
    const controller = new AbortController();

    const request = socket.request(
      'target-a',
      'drone-control',
      'files.list',
      {},
      controller.signal,
    );
    await signingStarted.promise;
    controller.abort();
    releaseSigning();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toEqual([]);
    expect(internals.pending.size).toBe(0);
  });

  test('does not register a request when its socket is replaced while signing', async () => {
    const signingStarted = Promise.withResolvers<void>();
    const signingGate = Promise.withResolvers<void>();
    const oldSent: string[] = [];
    const nextSent: string[] = [];
    const socket = new MeshSession(
      { deviceId: 'peer-a', endpoint: 'https://peer-a.test', role: 'primary' },
      'network-a',
      {
        id: 'mobile-a',
        name: 'Mobile',
        platform: 'android',
        publicKey: {},
        async sign() {
          signingStarted.resolve();
          await signingGate.promise;
          return 'signature';
        },
      },
      {},
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { handle: async () => null },
      { inspectEnvelope: () => 'accept', acceptValidated: () => 'accept' },
    );
    const internals = socket as unknown as {
      ready: boolean;
      socket: Pick<WebSocket, 'readyState' | 'send'>;
      pending: Map<string, unknown>;
    };
    const oldSocket = {
      readyState: WebSocket.OPEN,
      send(value: string) {
        oldSent.push(value);
      },
    };
    internals.ready = true;
    internals.socket = oldSocket;

    const request = socket.request('target-a', 'drone-control', 'files.list', {});
    await signingStarted.promise;
    internals.socket = {
      readyState: WebSocket.OPEN,
      send(value: string) {
        nextSent.push(value);
      },
    };
    signingGate.resolve();

    await expect(request).rejects.toThrow('Mesh connection changed');
    expect(oldSent).toEqual([]);
    expect(nextSent).toEqual([]);
    expect(internals.pending.size).toBe(0);
  });

  test('does not register a request when disconnected while signing', async () => {
    const signingStarted = Promise.withResolvers<void>();
    const signingGate = Promise.withResolvers<void>();
    const sent: string[] = [];
    const socket = new MeshSession(
      { deviceId: 'peer-a', endpoint: 'https://peer-a.test', role: 'primary' },
      'network-a',
      {
        id: 'mobile-a',
        name: 'Mobile',
        platform: 'android',
        publicKey: {},
        async sign() {
          signingStarted.resolve();
          await signingGate.promise;
          return 'signature';
        },
      },
      {},
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { handle: async () => null },
      { inspectEnvelope: () => 'accept', acceptValidated: () => 'accept' },
    );
    const internals = socket as unknown as {
      ready: boolean;
      socket: Pick<WebSocket, 'readyState' | 'send' | 'close'>;
      pending: Map<string, unknown>;
    };
    internals.ready = true;
    internals.socket = {
      readyState: WebSocket.OPEN,
      send(value) {
        sent.push(String(value));
      },
      close() {},
    };

    const request = socket.request('target-a', 'drone-control', 'files.list', {});
    await signingStarted.promise;
    socket.disconnect();
    signingGate.resolve();

    await expect(request).rejects.toThrow('Mesh connection changed');
    expect(sent).toEqual([]);
    expect(internals.pending.size).toBe(0);
  });

  test('rejects one failed command without dropping the event session', async () => {
    const socket = new MeshSession(
      { deviceId: 'peer-a', endpoint: 'https://peer-a.test', role: 'primary' },
      'network-a',
      {
        id: 'mobile-a',
        name: 'Mobile',
        platform: 'android',
        publicKey: {},
        sign: async () => 'signature',
      },
      {},
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { handle: async () => null },
      { inspectEnvelope: () => 'accept', acceptValidated: () => 'accept' },
    );
    const internals = socket as unknown as {
      ready: boolean;
      socket: Pick<WebSocket, 'readyState'> & {
        send(value: string, callback?: (error?: Error) => void): void;
      };
      pending: Map<string, unknown>;
    };
    internals.ready = true;
    internals.socket = {
      readyState: WebSocket.OPEN,
      send(_value, callback) {
        callback?.(new Error('Command POST failed'));
      },
    };

    await expect(socket.request('peer-a', 'drone-control', 'chat.read', {})).rejects.toThrow(
      'Command POST failed',
    );
    expect(socket.connected).toBe(true);
    expect(internals.pending.size).toBe(0);
  });

  test('does not send a stale authentication signature on a replacement socket', async () => {
    const signingStarted = Promise.withResolvers<void>();
    const signingGate = Promise.withResolvers<void>();
    const oldSent: string[] = [];
    const nextSent: string[] = [];
    const socket = new MeshSession(
      { deviceId: 'peer-a', endpoint: 'https://peer-a.test', role: 'primary' },
      'network-a',
      {
        id: 'mobile-a',
        name: 'Mobile',
        platform: 'android',
        publicKey: {},
        async sign() {
          signingStarted.resolve();
          await signingGate.promise;
          return 'signature';
        },
      },
      {},
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { handle: async () => null },
      { inspectEnvelope: () => 'accept', acceptValidated: () => 'accept' },
    );
    const internals = socket as unknown as {
      socket: Pick<WebSocket, 'readyState' | 'send'>;
      handleMessage(
        raw: string,
        resolve: () => void,
        reject: (error: Error) => void,
        timer: ReturnType<typeof setTimeout>,
        sourceSocket: Pick<WebSocket, 'readyState' | 'send'>,
      ): Promise<void>;
    };
    const oldSocket = {
      readyState: WebSocket.OPEN,
      send(value: string) {
        oldSent.push(value);
      },
    };
    const nextSocket = {
      readyState: WebSocket.OPEN,
      send(value: string) {
        nextSent.push(value);
      },
    };
    internals.socket = oldSocket;
    const timer = setTimeout(() => undefined, 1_000);
    const handling = internals.handleMessage(
      JSON.stringify({
        type: 'auth.challenge',
        deviceId: 'peer-a',
        nonce: 'nonce-a',
        signature: 'peer-signature',
      }),
      () => undefined,
      () => undefined,
      timer,
      oldSocket,
    );
    await signingStarted.promise;
    internals.socket = nextSocket;
    signingGate.resolve();
    await handling;
    clearTimeout(timer);

    expect(oldSent).toEqual([]);
    expect(nextSent).toEqual([]);
  });

  test('discards a late HTTP result after cancellation without sending legacy cleanup requests', async () => {
    const sent: string[] = [];
    let httpSignal: AbortSignal | undefined;
    const socket = new MeshSession(
      { deviceId: 'peer-a', endpoint: 'https://peer-a.test', role: 'primary' },
      'network-a',
      {
        id: 'mobile-a',
        name: 'Mobile',
        platform: 'android',
        publicKey: {},
        sign: async () => 'signature',
      },
      {},
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { handle: async () => null },
      { inspectEnvelope: () => 'accept', acceptValidated: () => 'accept' },
    );
    const internals = socket as unknown as {
      ready: boolean;
      socket: Pick<WebSocket, 'readyState'> & {
        send(value: string, callback?: unknown, timing?: unknown, signal?: AbortSignal): void;
      };
      pending: Map<string, unknown>;
      handleMessage(
        raw: string,
        resolve: () => void,
        reject: (error: Error) => void,
        timer: ReturnType<typeof setTimeout>,
      ): Promise<void>;
    };
    internals.ready = true;
    internals.socket = {
      readyState: WebSocket.OPEN,
      send(value, _callback, _timing, signal) {
        sent.push(String(value));
        if (signal) httpSignal = signal;
      },
    };
    const controller = new AbortController();
    const request = socket.request(
      'target-a',
      'drone-control',
      'files.list',
      { droneId: 'drone-a', path: '/work/repo', contentOffset: 0 },
      controller.signal,
    );
    await Promise.resolve();
    const original = JSON.parse(sent[0] ?? '{}');
    expect(httpSignal?.aborted).toBe(false);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(internals.pending.size).toBe(0);
    expect(httpSignal?.aborted).toBe(true);
    expect(socket.connected).toBe(true);

    const connectTimer = setTimeout(() => undefined, 1_000);
    await internals.handleMessage(
      JSON.stringify({
        type: 'capability.response',
        version: 1,
        requestId: original.requestId,
        sourceDeviceId: 'target-a',
        targetDeviceId: 'mobile-a',
        ok: true,
        result: { entries: [] },
      }),
      () => undefined,
      () => undefined,
      connectTimer,
    );
    clearTimeout(connectTimer);
    await Promise.resolve();
    await Promise.resolve();

    expect(internals.pending.size).toBe(0);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1]).type).toBe('capability.cancel');
  });
});
