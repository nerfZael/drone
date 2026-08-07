import { describe, expect, test } from 'bun:test';
import { MeshConnectionManager, type ManagedMeshSocket } from '../src/mesh/MeshConnectionManager';

class FakeSocket implements ManagedMeshSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  private readonly outcomes: Array<boolean | Promise<boolean>>;

  constructor(
    readonly connection: { deviceId: string },
    outcomes: Array<boolean | Promise<boolean>> = [true],
  ) {
    this.outcomes = [...outcomes];
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    const succeeds = await (this.outcomes.shift() ?? true);
    if (!succeeds) throw new Error('unreachable');
    this.connected = true;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  closeFromPeer(): void {
    this.connected = false;
  }
}

function createHarness() {
  const scheduled: Array<{ callback(): void; cancelled: boolean }> = [];
  const connectionErrors: Array<{ deviceId: string; error: Error | null }> = [];
  const manager = new MeshConnectionManager<FakeSocket>({
    backgroundGraceMs: 4_000,
    reconnectDelayMs: 300,
    onChange: () => undefined,
    onConnectionError: (deviceId, error) => connectionErrors.push({ deviceId, error }),
    schedule: (callback) => {
      const task = { callback, cancelled: false };
      scheduled.push(task);
      return task as unknown as ReturnType<typeof setTimeout>;
    },
    cancelScheduled: (handle) => {
      (handle as unknown as { cancelled: boolean }).cancelled = true;
    },
  });
  const runNext = () => {
    const task = scheduled.find((candidate) => !candidate.cancelled);
    if (!task) throw new Error('No scheduled task');
    task.cancelled = true;
    task.callback();
  };
  return { connectionErrors, manager, runNext };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('mesh connection manager', () => {
  test('keeps healthy sockets through a transient Android background activity', async () => {
    const { manager } = createHarness();
    const socket = new FakeSocket({ deviceId: 'desktop' });
    manager.replaceSockets([socket]);
    await manager.connectAll();

    manager.handleAppState('background');
    manager.handleAppState('active');
    await flushPromises();

    expect(socket.connectCalls).toBe(1);
    expect(socket.disconnectCalls).toBe(0);
    expect(manager.connectionStatesByDevice.desktop).toBe('connected');
  });

  test('does not interpret an unknown startup app state as backgrounding', async () => {
    const { manager } = createHarness();
    const socket = new FakeSocket({ deviceId: 'desktop' });
    manager.replaceSockets([socket]);
    await manager.connectAll();

    manager.handleAppState('unknown');

    expect(socket.disconnectCalls).toBe(0);
    expect(manager.connectionStatesByDevice.desktop).toBe('connected');
  });

  test('suspends once after sustained backgrounding and reconnects on return', async () => {
    const { manager, runNext } = createHarness();
    const socket = new FakeSocket({ deviceId: 'desktop' }, [true, true]);
    manager.replaceSockets([socket]);
    await manager.connectAll();

    manager.handleAppState('background');
    runNext();
    expect(socket.disconnectCalls).toBe(1);
    expect(manager.connectionStatesByDevice.desktop).toBe('suspended');

    manager.handleAppState('active');
    await flushPromises();
    expect(socket.connectCalls).toBe(2);
    expect(socket.disconnectCalls).toBe(1);
    expect(manager.connectionStatesByDevice.desktop).toBe('connected');
  });

  test('keeps transport connected for lock-screen voice and suspends after it ends', async () => {
    const { manager, runNext } = createHarness();
    const socket = new FakeSocket({ deviceId: 'desktop' });
    manager.replaceSockets([socket]);
    await manager.connectAll();

    manager.setBackgroundActivityRequired(true);
    manager.handleAppState('background');
    expect(socket.disconnectCalls).toBe(0);
    expect(manager.connectionStatesByDevice.desktop).toBe('connected');

    manager.setBackgroundActivityRequired(false);
    runNext();
    expect(socket.disconnectCalls).toBe(1);
    expect(manager.connectionStatesByDevice.desktop).toBe('suspended');
  });

  test('reports reconnecting before a genuine socket failure settles offline', async () => {
    const { manager, runNext } = createHarness();
    const socket = new FakeSocket({ deviceId: 'desktop' }, [true, false]);
    manager.replaceSockets([socket]);
    await manager.connectAll();

    socket.closeFromPeer();
    manager.handleSocketState(socket);
    expect(manager.connectionStatesByDevice.desktop).toBe('reconnecting');

    runNext();
    await flushPromises();
    expect(socket.connectCalls).toBe(2);
    expect(manager.connectionStatesByDevice.desktop).toBe('offline');
  });

  test('clears a stale route error when an announced reconnect starts', async () => {
    const { connectionErrors, manager } = createHarness();
    const socket = new FakeSocket({ deviceId: 'desktop' }, [false, true]);
    manager.replaceSockets([socket]);
    await manager.connectAll();
    expect(connectionErrors.at(-1)?.error?.message).toBe('unreachable');

    const reconnect = manager.ensureConnected(true);
    expect(manager.connectionStatesByDevice.desktop).toBe('reconnecting');
    expect(connectionErrors.at(-1)).toEqual({ deviceId: 'desktop', error: null });
    await reconnect;
    expect(manager.connectionStatesByDevice.desktop).toBe('connected');
  });

  test('retries only the requested device when another route is also offline', async () => {
    const { manager } = createHarness();
    const requested = new FakeSocket({ deviceId: 'requested' }, [false, true]);
    const other = new FakeSocket({ deviceId: 'other' }, [false, true]);
    manager.replaceSockets([requested, other]);
    await manager.connectAll();

    expect(await manager.ensureDeviceConnected('requested')).toBe(true);
    expect(requested.connectCalls).toBe(2);
    expect(other.connectCalls).toBe(1);
  });

  test('makes refresh recovery available as soon as any route reconnects', async () => {
    const { manager } = createHarness();
    let releaseSlow!: (value: boolean) => void;
    const slowResult = new Promise<boolean>((resolve) => {
      releaseSlow = resolve;
    });
    const fast = new FakeSocket({ deviceId: 'fast' }, [true]);
    const slow = new FakeSocket({ deviceId: 'slow' }, [slowResult]);
    manager.replaceSockets([fast, slow]);

    expect(await manager.ensureAnyConnected()).toBe(true);
    expect(fast.connected).toBe(true);
    expect(slow.connected).toBe(false);
    releaseSlow(false);
    await flushPromises();
  });

  test('routes directly when possible and otherwise uses a connected relay', async () => {
    const { manager } = createHarness();
    const first = new FakeSocket({ deviceId: 'first' });
    const second = new FakeSocket({ deviceId: 'second' });
    manager.replaceSockets([first, second]);
    await manager.connectAll();

    expect(manager.routeFor('second')).toBe(second);
    expect(manager.routeFor('indirect')).toBe(first);
  });
});
