export const MESH_BACKGROUND_GRACE_MS = 4_000;
const MESH_CLOSE_RECONNECT_DELAY_MS = 300;

export type MeshDeviceConnectionState = 'connected' | 'reconnecting' | 'suspended' | 'offline';

export type MeshAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export type ManagedMeshSession = {
  readonly connection: { deviceId: string };
  readonly connected: boolean;
  connect(): Promise<void>;
  disconnect(): void;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type MeshConnectionManagerOptions = {
  backgroundGraceMs?: number;
  reconnectDelayMs?: number;
  onChange(): void;
  onConnectionError(deviceId: string, error: Error | null): void;
  schedule?(callback: () => void, delayMs: number): TimerHandle;
  cancelScheduled?(handle: TimerHandle): void;
};

export class MeshConnectionManager<Socket extends ManagedMeshSession> {
  private socketsValue: Socket[] = [];
  private readonly states = new Map<string, MeshDeviceConnectionState>();
  private lifecycle: 'active' | 'grace' | 'suspended' = 'active';
  private appState: MeshAppState = 'active';
  private backgroundActivityRequired = false;
  private suspendTimer: TimerHandle | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private readonly backgroundGraceMs: number;
  private readonly reconnectDelayMs: number;
  private readonly onChange: () => void;
  private readonly onConnectionError: (deviceId: string, error: Error | null) => void;
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancelScheduled: (handle: TimerHandle) => void;

  constructor(options: MeshConnectionManagerOptions) {
    this.backgroundGraceMs = options.backgroundGraceMs ?? MESH_BACKGROUND_GRACE_MS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? MESH_CLOSE_RECONNECT_DELAY_MS;
    this.onChange = options.onChange;
    this.onConnectionError = options.onConnectionError;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelScheduled = options.cancelScheduled ?? ((handle) => clearTimeout(handle));
  }

  get sockets(): readonly Socket[] {
    return this.socketsValue;
  }

  get connectedDeviceIds(): string[] {
    return this.socketsValue
      .filter((socket) => socket.connected)
      .map((socket) => socket.connection.deviceId);
  }

  get connectionStatesByDevice(): Record<string, MeshDeviceConnectionState> {
    return Object.fromEntries(this.states);
  }

  isCurrentSet(sockets: readonly Socket[]): boolean {
    return this.socketsValue === sockets;
  }

  replaceSockets(nextSockets: Socket[]): void {
    this.cancelReconnect();
    const previous = this.socketsValue;
    const retained = new Set<Socket>(nextSockets);
    const previousStates = new Map(this.states);
    this.socketsValue = [];
    for (const socket of previous) {
      if (!retained.has(socket)) socket.disconnect();
    }
    this.states.clear();
    this.socketsValue = nextSockets;
    const initialState: MeshDeviceConnectionState =
      this.lifecycle === 'suspended' ? 'suspended' : 'reconnecting';
    for (const socket of nextSockets) {
      const wasRetained = previous.includes(socket);
      this.states.set(
        socket.connection.deviceId,
        socket.connected
          ? 'connected'
          : wasRetained
            ? (previousStates.get(socket.connection.deviceId) ?? initialState)
            : initialState,
      );
      if (!wasRetained) this.onConnectionError(socket.connection.deviceId, null);
    }
    this.onChange();
  }

  async connectAll(): Promise<PromiseSettledResult<void>[]> {
    if (this.lifecycle !== 'active') return [];
    return await Promise.allSettled(
      this.socketsValue.map((socket) => this.connectSocket(socket, true)),
    );
  }

  async ensureConnected(announce = false): Promise<void> {
    if (this.lifecycle !== 'active') return;
    const disconnected = this.socketsValue.filter((socket) => !socket.connected);
    await Promise.allSettled(disconnected.map((socket) => this.connectSocket(socket, announce)));
  }

  async ensureAnyConnected(announce = true): Promise<boolean> {
    if (this.lifecycle !== 'active') return false;
    if (this.socketsValue.some((socket) => socket.connected)) return true;
    const disconnected = this.socketsValue.filter((socket) => !socket.connected);
    if (disconnected.length === 0) return false;
    return await new Promise<boolean>((resolve) => {
      let remaining = disconnected.length;
      let settled = false;
      for (const socket of disconnected) {
        void this.connectSocket(socket, announce)
          .catch(() => undefined)
          .finally(() => {
            if (!settled && socket.connected) {
              settled = true;
              resolve(true);
            }
            remaining -= 1;
            if (!settled && remaining === 0) resolve(false);
          });
      }
    });
  }

  async ensureDeviceConnected(deviceId: string, announce = true): Promise<boolean> {
    if (this.lifecycle !== 'active') return false;
    const socket = this.socketsValue.find(
      (candidate) => candidate.connection.deviceId === deviceId,
    );
    if (!socket) return false;
    await Promise.allSettled([this.connectSocket(socket, announce)]);
    return socket.connected;
  }

  handleSocketState(socket: Socket): void {
    if (!this.socketsValue.includes(socket)) return;
    const deviceId = socket.connection.deviceId;
    if (socket.connected) {
      this.setState(deviceId, 'connected');
      this.onConnectionError(deviceId, null);
      return;
    }
    if (this.lifecycle === 'suspended') {
      this.setState(deviceId, 'suspended');
      return;
    }
    if (this.states.get(deviceId) === 'connected') {
      this.setState(deviceId, 'reconnecting');
      if (this.lifecycle === 'active') this.scheduleReconnect();
    }
  }

  handleAppState(state: MeshAppState): void {
    if (state === 'unknown') return;
    this.appState = state;
    if (state === 'active') {
      this.activate();
      return;
    }
    if (this.backgroundActivityRequired) {
      this.activate();
      return;
    }
    this.scheduleSuspend();
  }

  setBackgroundActivityRequired(required: boolean): void {
    if (this.backgroundActivityRequired === required) return;
    this.backgroundActivityRequired = required;
    if (required) {
      this.activate();
      return;
    }
    if (this.appState !== 'active' && this.appState !== 'unknown') this.scheduleSuspend();
  }

  private activate(): void {
    this.cancelSuspend();
    const wasSuspended = this.lifecycle === 'suspended';
    this.lifecycle = 'active';
    if (wasSuspended) {
      for (const socket of this.socketsValue) {
        if (!socket.connected) this.states.set(socket.connection.deviceId, 'reconnecting');
      }
      this.onChange();
    }
    void this.ensureConnected(wasSuspended);
  }

  private scheduleSuspend(): void {
    if (this.lifecycle !== 'active') return;
    this.lifecycle = 'grace';
    this.suspendTimer = this.schedule(() => {
      this.suspendTimer = null;
      if (this.lifecycle !== 'grace') return;
      this.lifecycle = 'suspended';
      this.cancelReconnect();
      for (const socket of this.socketsValue) {
        this.states.set(socket.connection.deviceId, 'suspended');
        socket.disconnect();
      }
      this.onChange();
    }, this.backgroundGraceMs);
  }

  routeFor(targetDeviceId: string): Socket | null {
    return (
      this.socketsValue.find(
        (socket) => socket.connected && socket.connection.deviceId === targetDeviceId,
      ) ??
      this.socketsValue.find((socket) => socket.connected) ??
      null
    );
  }

  clear(notify = true): void {
    this.cancelSuspend();
    this.cancelReconnect();
    const previous = this.socketsValue;
    this.socketsValue = [];
    this.states.clear();
    for (const socket of previous) socket.disconnect();
    if (notify) this.onChange();
  }

  private async connectSocket(socket: Socket, announce: boolean): Promise<void> {
    if (!this.socketsValue.includes(socket) || this.lifecycle !== 'active' || socket.connected)
      return;
    const deviceId = socket.connection.deviceId;
    if (announce || this.states.get(deviceId) !== 'offline') {
      this.setState(deviceId, 'reconnecting');
      if (announce) this.onConnectionError(deviceId, null);
    }
    try {
      await socket.connect();
      if (!this.socketsValue.includes(socket)) return;
      this.setState(deviceId, 'connected');
      this.onConnectionError(deviceId, null);
    } catch (error) {
      if (!this.socketsValue.includes(socket) || this.lifecycle !== 'active') return;
      const nextError = error instanceof Error ? error : new Error(String(error));
      this.setState(deviceId, 'offline');
      this.onConnectionError(deviceId, nextError);
      throw nextError;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      void this.ensureConnected(true);
    }, this.reconnectDelayMs);
  }

  private setState(deviceId: string, state: MeshDeviceConnectionState): void {
    if (this.states.get(deviceId) === state) return;
    this.states.set(deviceId, state);
    this.onChange();
  }

  private cancelSuspend(): void {
    if (!this.suspendTimer) return;
    this.cancelScheduled(this.suspendTimer);
    this.suspendTimer = null;
    if (this.lifecycle === 'grace') this.lifecycle = 'active';
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    this.cancelScheduled(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
