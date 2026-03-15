import { ValidationError } from './errors';
import type {
  AIClient,
  ChatEvent,
  ChatMessage,
  ChatSummary,
  CreateDroneBatchItem,
  CreateDroneInput,
  CreateManyResult,
  DispatchOptions,
  DroneGroupSummary,
  DroneRecord,
  DroneSDKOptions,
  DroneSummary,
  DroneTransport,
  ListDronesInput,
  ListMessagesInput,
  MessageInput,
  RequestOptions,
  RunEvent,
  RunRecord,
  RunResult,
  RunStatus,
  SendOptions,
  StreamOptions,
  SubscribeMessagesInput,
  WaitOptions,
  RemoveDroneInput,
} from './types';

const DEFAULT_POLL_INTERVAL_MS = 500;

type DroneSDK = {
  drones: DroneCollection;
  groups: GroupCollection;
  broadcast: BroadcastAPI;
  ai?: AIClient;
};

export type DroneCollection = {
  create(name: string, input?: CreateDroneInput): Promise<Drone>;
  createMany(inputs: CreateDroneBatchItem[]): Promise<CreateManyResult>;
  get(idOrName: string): Promise<Drone | null>;
  list(input?: ListDronesInput): Promise<DroneSummary[]>;
};

export type GroupCollection = {
  get(name: string): DroneGroup;
  list(): Promise<DroneGroupSummary[]>;
};

export type DroneGroup = {
  readonly name: string;
  create(name: string, input?: Omit<CreateDroneInput, 'group'>): Promise<Drone>;
  createMany(inputs: Omit<CreateDroneBatchItem, 'group'>[]): Promise<CreateManyResult>;
  list(): Promise<DroneSummary[]>;
};

export type Drone = {
  readonly id: string;
  readonly name: string;
  readonly group?: string;
  readonly runtime: DroneRecord['runtime'];
  refresh(): Promise<Drone>;
  rename(nextName: string): Promise<Drone>;
  archive(input?: RequestOptions): Promise<void>;
  remove(input?: RemoveDroneInput): Promise<void>;
  delete(input?: RemoveDroneInput): Promise<void>;
  chat(name?: string): DroneChat;
  broadcast(chatNames: string[]): ChatBroadcast;
  chats: {
    list(): Promise<ChatSummary[]>;
  };
};

export type DroneChat = {
  readonly drone: Drone;
  readonly name: string;
  ensure(input?: RequestOptions): Promise<DroneChat>;
  remove(input?: RequestOptions): Promise<void>;
  delete(input?: RequestOptions): Promise<void>;
  queue(message: MessageInput): DroneChat;
  clearQueue(): DroneChat;
  queued(): readonly MessageInput[];
  send(message: MessageInput, input?: SendOptions): Promise<Run>;
  dispatch(input?: DispatchOptions): Promise<Run>;
  messages: {
    list(input?: ListMessagesInput): Promise<ChatMessage[]>;
    last(input?: RequestOptions): Promise<ChatMessage | null>;
    subscribe(input?: SubscribeMessagesInput): AsyncIterable<ChatEvent>;
  };
};

export type Run = {
  readonly id: string;
  readonly droneId: string;
  readonly chatName: string;
  status(input?: RequestOptions): Promise<RunStatus>;
  wait(input?: WaitOptions): Promise<RunResult>;
  cancel(input?: RequestOptions): Promise<void>;
  stream(input?: StreamOptions): AsyncIterable<RunEvent>;
  messages(input?: ListMessagesInput): Promise<ChatMessage[]>;
  lastMessage(input?: RequestOptions): Promise<ChatMessage | null>;
  lastMessageText(input?: RequestOptions): Promise<string | null>;
};

export type BroadcastAPI = {
  chats(drone: Drone, chatNames: string[]): ChatBroadcast;
  drones(targets: Array<string | Drone | DroneSummary>): DroneBroadcast;
};

export type DroneBroadcast = {
  chat(name?: string): ChatBroadcast;
};

export type ChatBroadcast = {
  queue(message: MessageInput): ChatBroadcast;
  clearQueue(): ChatBroadcast;
  queued(): readonly MessageInput[];
  send(message: MessageInput, input?: SendOptions): Promise<Run[]>;
  dispatch(input?: DispatchOptions): Promise<Run[]>;
};

type SDKContext = {
  transport: DroneTransport;
  defaults?: RequestOptions;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error('aborted'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function mergeOptions(base?: RequestOptions, next?: RequestOptions): RequestOptions | undefined {
  if (!base && !next) return undefined;
  return {
    timeoutMs: next?.timeoutMs ?? base?.timeoutMs,
    signal: next?.signal ?? base?.signal,
  };
}

function normalizeChatName(name?: string): string {
  const value = String(name ?? 'default').trim();
  if (!value) return 'default';
  return value;
}

function normalizeMessageInput(message: MessageInput): string {
  if (typeof message === 'string') {
    const value = message.trim();
    if (!value) throw new ValidationError('message content cannot be empty');
    return value;
  }
  const value = String(message.content ?? '').trim();
  if (!value) throw new ValidationError('message content cannot be empty');
  return value;
}

class DroneSDKImpl implements DroneSDK {
  readonly drones: DroneCollection;
  readonly groups: GroupCollection;
  readonly broadcast: BroadcastAPI;
  readonly ai?: AIClient;

  constructor(private readonly ctx: SDKContext, ai?: AIClient) {
    this.ai = ai;
    this.drones = new DroneCollectionImpl(ctx);
    this.groups = new GroupCollectionImpl(ctx);
    this.broadcast = new BroadcastAPIImpl(ctx);
  }
}

class DroneCollectionImpl implements DroneCollection {
  constructor(private readonly ctx: SDKContext) {}

  async create(name: string, input?: CreateDroneInput): Promise<Drone> {
    const record = await this.ctx.transport.createDrone(
      { name, ...(input ?? {}) },
      this.ctx.defaults,
    );
    return new DroneImpl(this.ctx, record);
  }

  async createMany(inputs: CreateDroneBatchItem[]): Promise<CreateManyResult> {
    return await this.ctx.transport.createDrones(inputs, this.ctx.defaults);
  }

  async get(idOrName: string): Promise<Drone | null> {
    const record = await this.ctx.transport.getDrone(idOrName, this.ctx.defaults);
    return record ? new DroneImpl(this.ctx, record) : null;
  }

  async list(input?: ListDronesInput): Promise<DroneSummary[]> {
    return await this.ctx.transport.listDrones(input, this.ctx.defaults);
  }
}

class GroupCollectionImpl implements GroupCollection {
  constructor(private readonly ctx: SDKContext) {}

  get(name: string): DroneGroup {
    return new DroneGroupImpl(this.ctx, name);
  }

  async list(): Promise<DroneGroupSummary[]> {
    return await this.ctx.transport.listGroups(this.ctx.defaults);
  }
}

class DroneGroupImpl implements DroneGroup {
  constructor(private readonly ctx: SDKContext, readonly name: string) {}

  async create(name: string, input?: Omit<CreateDroneInput, 'group'>): Promise<Drone> {
    return await new DroneCollectionImpl(this.ctx).create(name, { ...(input ?? {}), group: this.name });
  }

  async createMany(inputs: Omit<CreateDroneBatchItem, 'group'>[]): Promise<CreateManyResult> {
    const withGroup = inputs.map((item) => ({ ...item, group: this.name }));
    return await this.ctx.transport.createDrones(withGroup, this.ctx.defaults);
  }

  async list(): Promise<DroneSummary[]> {
    return await this.ctx.transport.listDrones({ group: this.name }, this.ctx.defaults);
  }
}

class DroneImpl implements Drone {
  chats: {
    list: () => Promise<ChatSummary[]>;
  };

  constructor(private readonly ctx: SDKContext, private record: DroneRecord) {
    this.chats = {
      list: async () => await this.ctx.transport.listChats(this.id, this.ctx.defaults),
    };
  }

  get id(): string {
    return this.record.id;
  }

  get name(): string {
    return this.record.name;
  }

  get group(): string | undefined {
    return this.record.group;
  }

  get runtime(): DroneRecord['runtime'] {
    return this.record.runtime;
  }

  async refresh(): Promise<Drone> {
    const next = await this.ctx.transport.getDrone(this.id, this.ctx.defaults);
    if (next) this.record = next;
    return this;
  }

  async rename(nextName: string): Promise<Drone> {
    this.record = await this.ctx.transport.renameDrone(this.id, nextName, this.ctx.defaults);
    return this;
  }

  async archive(input?: RequestOptions): Promise<void> {
    await this.ctx.transport.archiveDrone(this.id, mergeOptions(this.ctx.defaults, input));
  }

  async remove(input?: RemoveDroneInput): Promise<void> {
    await this.ctx.transport.removeDrone(this.id, input, this.ctx.defaults);
  }

  async delete(input?: RemoveDroneInput): Promise<void> {
    await this.remove(input);
  }

  chat(name?: string): DroneChat {
    return new DroneChatImpl(this.ctx, this, normalizeChatName(name));
  }

  broadcast(chatNames: string[]): ChatBroadcast {
    return new ChatBroadcastImpl(async () => chatNames.map((name) => this.chat(name)));
  }
}

class DroneChatImpl implements DroneChat {
  private queueState: MessageInput[] = [];

  readonly messages: {
    list: (input?: ListMessagesInput) => Promise<ChatMessage[]>;
    last: (input?: RequestOptions) => Promise<ChatMessage | null>;
    subscribe: (input?: SubscribeMessagesInput) => AsyncIterable<ChatEvent>;
  };

  constructor(private readonly ctx: SDKContext, readonly drone: Drone, readonly name: string) {
    const sdkCtx = this.ctx;
    const targetDrone = this.drone;
    const chatName = this.name;
    this.messages = {
      list: async (input?: ListMessagesInput) => await this.ctx.transport.listMessages(this.drone.id, this.name, input, mergeOptions(this.ctx.defaults, input)),
      last: async (input?: RequestOptions) => {
        const list = await this.ctx.transport.listMessages(
          this.drone.id,
          this.name,
          { limit: 1, order: 'desc' },
          mergeOptions(this.ctx.defaults, input),
        );
        return list[0] ?? null;
      },
      subscribe: async function* subscribe(input?: SubscribeMessagesInput): AsyncIterable<ChatEvent> {
        const seen = new Set<string>();
        let cursor = input?.sinceMessageId;
        while (true) {
          const messages = await sdkCtx.transport.listMessages(
            targetDrone.id,
            chatName,
            { order: 'asc', cursor },
            mergeOptions(sdkCtx.defaults, input),
          );
          for (const message of messages) {
            if (seen.has(message.id)) continue;
            seen.add(message.id);
            cursor = message.id;
            yield { type: 'message', message };
          }
          await sleep(input?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, input?.signal);
        }
      },
    };
  }

  async ensure(input?: RequestOptions): Promise<DroneChat> {
    await this.ctx.transport.ensureChat(this.drone.id, this.name, mergeOptions(this.ctx.defaults, input));
    return this;
  }

  async remove(input?: RequestOptions): Promise<void> {
    await this.ctx.transport.removeChat(this.drone.id, this.name, mergeOptions(this.ctx.defaults, input));
  }

  async delete(input?: RequestOptions): Promise<void> {
    await this.remove(input);
  }

  queue(message: MessageInput): DroneChat {
    normalizeMessageInput(message);
    this.queueState.push(message);
    return this;
  }

  clearQueue(): DroneChat {
    this.queueState = [];
    return this;
  }

  queued(): readonly MessageInput[] {
    return Object.freeze([...this.queueState]);
  }

  async send(message: MessageInput, input?: SendOptions): Promise<Run> {
    const normalized = normalizeMessageInput(message);
    const record = await this.ctx.transport.sendMessage(
      this.drone.id,
      this.name,
      normalized,
      mergeOptions(this.ctx.defaults, input) as SendOptions | undefined,
    );
    return new SingleRunImpl(this.ctx, this.drone.id, this.name, record);
  }

  async dispatch(input?: DispatchOptions): Promise<Run> {
    if (this.queueState.length === 0) throw new ValidationError('cannot dispatch an empty chat queue');
    const messages = [...this.queueState];
    if (messages.length === 1) {
      const single = await this.send(messages[0], input);
      this.queueState = [];
      return single;
    }
    const run = new BatchRunImpl(this.ctx, this.drone.id, this.name, messages, input);
    await run.start();
    this.queueState = [];
    return run;
  }
}

abstract class RunBase implements Run {
  constructor(
    protected readonly ctx: SDKContext,
    readonly droneId: string,
    readonly chatName: string,
    readonly id: string,
  ) {}

  abstract status(input?: RequestOptions): Promise<RunStatus>;
  abstract wait(input?: WaitOptions): Promise<RunResult>;
  abstract cancel(input?: RequestOptions): Promise<void>;

  async *stream(input?: StreamOptions): AsyncIterable<RunEvent> {
    const seen = new Set<string>();
    let priorStatus: RunStatus | null = null;

    while (true) {
      const [status, messages] = await Promise.all([
        this.status(input),
        this.messages({ order: 'asc' }),
      ]);

      if (status !== priorStatus) {
        priorStatus = status;
        yield { type: 'status', status };
      }

      for (const message of messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        yield { type: 'message', message };
      }

      if (status === 'done' || status === 'failed' || status === 'canceled') break;
      await sleep(input?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, input?.signal);
    }
  }

  async messages(input?: ListMessagesInput): Promise<ChatMessage[]> {
    return await this.ctx.transport.listMessages(
      this.droneId,
      this.chatName,
      input,
      mergeOptions(this.ctx.defaults, input),
    );
  }

  async lastMessage(input?: RequestOptions): Promise<ChatMessage | null> {
    const messages = await this.ctx.transport.listMessages(
      this.droneId,
      this.chatName,
      { limit: 1, order: 'desc' },
      mergeOptions(this.ctx.defaults, input),
    );
    return messages[0] ?? null;
  }

  async lastMessageText(input?: RequestOptions): Promise<string | null> {
    const message = await this.lastMessage(input);
    return message?.content ?? null;
  }
}

class SingleRunImpl extends RunBase {
  private record: RunRecord;

  constructor(ctx: SDKContext, droneId: string, chatName: string, record: RunRecord) {
    super(ctx, droneId, chatName, record.id);
    this.record = record;
  }

  async status(input?: RequestOptions): Promise<RunStatus> {
    this.record = await this.ctx.transport.getRun(
      this.droneId,
      this.chatName,
      this.id,
      mergeOptions(this.ctx.defaults, input),
    );
    return this.record.status;
  }

  async wait(input?: WaitOptions): Promise<RunResult> {
    const interval = input?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    while (true) {
      const record = await this.ctx.transport.getRun(
        this.droneId,
        this.chatName,
        this.id,
        mergeOptions(this.ctx.defaults, input),
      );
      this.record = record;
      if (record.status === 'done' || record.status === 'failed' || record.status === 'canceled') {
        return {
          id: record.id,
          status: record.status,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          error: record.error,
        };
      }
      await sleep(interval, input?.signal);
    }
  }

  async cancel(input?: RequestOptions): Promise<void> {
    await this.ctx.transport.cancelRun(
      this.droneId,
      this.chatName,
      this.id,
      mergeOptions(this.ctx.defaults, input),
    );
  }
}

class BatchRunImpl extends RunBase {
  private childRuns: SingleRunImpl[] = [];
  private execution: Promise<RunResult> | null = null;
  private startSignal:
    | {
        promise: Promise<void>;
        resolve: () => void;
        reject: (error: unknown) => void;
      }
    | null = null;
  private currentStatus: RunStatus = 'queued';
  private currentError?: string;
  private startedAt?: string;
  private finishedAt?: string;
  private canceled = false;

  constructor(
    ctx: SDKContext,
    droneId: string,
    chatName: string,
    private readonly messagesToSend: MessageInput[],
    private readonly sendOptions?: SendOptions,
  ) {
    super(ctx, droneId, chatName, `batch:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`);
  }

  async start(): Promise<void> {
    if (this.execution) return;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.startSignal = { promise, resolve, reject };
    this.execution = this.execute();
    await promise;
  }

  private async execute(): Promise<RunResult> {
    this.currentStatus = 'running';
    this.startedAt = new Date().toISOString();
    try {
      for (let index = 0; index < this.messagesToSend.length; index += 1) {
        if (this.canceled) {
          this.currentStatus = 'canceled';
          this.finishedAt = new Date().toISOString();
          return { id: this.id, status: 'canceled', startedAt: this.startedAt, finishedAt: this.finishedAt };
        }
        const content = normalizeMessageInput(this.messagesToSend[index]);
        const record = await this.ctx.transport.sendMessage(
          this.droneId,
          this.chatName,
          content,
          mergeOptions(this.ctx.defaults, this.sendOptions) as SendOptions | undefined,
        );
        const child = new SingleRunImpl(this.ctx, this.droneId, this.chatName, record);
        this.childRuns.push(child);
        if (index === 0) this.startSignal?.resolve();
        const result = await child.wait(this.sendOptions);
        if (result.status === 'failed' || result.status === 'canceled') {
          this.currentStatus = result.status;
          this.currentError = result.error;
          this.finishedAt = result.finishedAt ?? new Date().toISOString();
          return {
            id: this.id,
            status: result.status,
            startedAt: this.startedAt,
            finishedAt: this.finishedAt,
            error: result.error,
          };
        }
      }
      this.currentStatus = 'done';
      this.finishedAt = new Date().toISOString();
      return { id: this.id, status: 'done', startedAt: this.startedAt, finishedAt: this.finishedAt };
    } catch (error) {
      this.currentStatus = 'failed';
      this.currentError = error instanceof Error ? error.message : String(error);
      this.finishedAt = new Date().toISOString();
      if (this.childRuns.length === 0) this.startSignal?.reject(error);
      return {
        id: this.id,
        status: 'failed',
        startedAt: this.startedAt,
        finishedAt: this.finishedAt,
        error: this.currentError,
      };
    }
  }

  async status(input?: RequestOptions): Promise<RunStatus> {
    const lastChild = this.childRuns[this.childRuns.length - 1];
    if (lastChild && (this.currentStatus === 'queued' || this.currentStatus === 'running')) {
      const childStatus = await lastChild.status(input);
      if (childStatus === 'failed' || childStatus === 'canceled') this.currentStatus = childStatus;
    }
    return this.currentStatus;
  }

  async wait(): Promise<RunResult> {
    await this.start();
    return await (this.execution as Promise<RunResult>);
  }

  async cancel(input?: RequestOptions): Promise<void> {
    this.canceled = true;
    const lastChild = this.childRuns[this.childRuns.length - 1];
    if (lastChild) await lastChild.cancel(input);
  }
}

class BroadcastAPIImpl implements BroadcastAPI {
  constructor(private readonly ctx: SDKContext) {}

  chats(drone: Drone, chatNames: string[]): ChatBroadcast {
    return new ChatBroadcastImpl(async () => chatNames.map((name) => drone.chat(name)));
  }

  drones(targets: Array<string | Drone | DroneSummary>): DroneBroadcast {
    return new DroneBroadcastImpl(this.ctx, targets);
  }
}

class DroneBroadcastImpl implements DroneBroadcast {
  constructor(
    private readonly ctx: SDKContext,
    private readonly targets: Array<string | Drone | DroneSummary>,
  ) {}

  chat(name?: string): ChatBroadcast {
    const chatName = normalizeChatName(name);
    return new ChatBroadcastImpl(async () => {
      const resolved = await Promise.all(
        this.targets.map(async (target) => {
          if (typeof target === 'string') return await new DroneCollectionImpl(this.ctx).get(target);
          if ('refresh' in target && typeof target.refresh === 'function') return target as Drone;
          return await new DroneCollectionImpl(this.ctx).get(target.id);
        }),
      );
      return resolved.filter((drone): drone is Drone => Boolean(drone)).map((drone) => drone.chat(chatName));
    });
  }
}

class ChatBroadcastImpl implements ChatBroadcast {
  private queueState: MessageInput[] = [];

  constructor(private readonly resolveChats: () => Promise<DroneChat[]>) {}

  queue(message: MessageInput): ChatBroadcast {
    normalizeMessageInput(message);
    this.queueState.push(message);
    return this;
  }

  clearQueue(): ChatBroadcast {
    this.queueState = [];
    return this;
  }

  queued(): readonly MessageInput[] {
    return Object.freeze([...this.queueState]);
  }

  async send(message: MessageInput, input?: SendOptions): Promise<Run[]> {
    const chats = await this.resolveChats();
    return await Promise.all(chats.map(async (chat) => await chat.send(message, input)));
  }

  async dispatch(input?: DispatchOptions): Promise<Run[]> {
    if (this.queueState.length === 0) throw new ValidationError('cannot dispatch an empty broadcast queue');
    const chats = await this.resolveChats();
    const messages = [...this.queueState];
    this.queueState = [];
    return await Promise.all(
      chats.map(async (chat) => {
        let target = chat.clearQueue();
        for (const message of messages) target = target.queue(message);
        return await target.dispatch(input);
      }),
    );
  }
}

export function createDroneSDK(options: DroneSDKOptions): DroneSDK {
  return new DroneSDKImpl({ transport: options.transport, defaults: options.defaults });
}
