export type DroneRuntime = 'container';

export type RequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type WaitOptions = RequestOptions & {
  pollIntervalMs?: number;
};

export type ListDronesInput = {
  group?: string;
  names?: string[];
};

export type RemoveDroneInput = {
  keepVolume?: boolean;
  mode?: 'auto' | 'archive' | 'permanent';
};

export type StreamOptions = RequestOptions & {
  pollIntervalMs?: number;
};

export type ListMessagesInput = RequestOptions & {
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
};

export type SubscribeMessagesInput = StreamOptions & {
  sinceMessageId?: string;
};

export type CreateDroneInput = {
  group?: string;
  runtime?: DroneRuntime;
  cwd?: string;
  repoPath?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};

export type CreateDroneBatchItem = CreateDroneInput & {
  name: string;
};

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageInput =
  | string
  | {
      role?: Extract<MessageRole, 'user' | 'system'>;
      content: string;
      metadata?: Record<string, string>;
    };

export type SendOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type DispatchOptions = SendOptions;

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export type RunResult = {
  id: string;
  status: Exclude<RunStatus, 'queued' | 'running'>;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type ChatMessage = {
  id: string;
  chat: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  runId?: string;
  metadata?: Record<string, string>;
};

export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'status'; status: RunStatus }
  | { type: 'error'; error: string };

export type RunEvent =
  | { type: 'status'; status: RunStatus }
  | { type: 'message'; message: ChatMessage }
  | { type: 'error'; error: string };

export type DroneSummary = {
  id: string;
  name: string;
  group?: string;
  runtime: DroneRuntime;
  createdAt?: string;
};

export type DroneGroupSummary = {
  name: string;
  count: number;
};

export type ChatSummary = {
  name: string;
  messageCount?: number;
  lastMessageAt?: string;
};

export type CreateManyResult = {
  accepted: DroneSummary[];
  rejected: Array<{
    name: string;
    error: string;
  }>;
};

export type DroneRecord = DroneSummary & {
  repoPath?: string;
  cwd?: string;
  metadata?: Record<string, string>;
};

export type RunRecord = {
  id: string;
  droneId: string;
  chatName: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type DroneTransport = {
  createDrone(input: CreateDroneBatchItem, options?: RequestOptions): Promise<DroneRecord>;
  createDrones(inputs: CreateDroneBatchItem[], options?: RequestOptions): Promise<CreateManyResult>;
  getDrone(idOrName: string, options?: RequestOptions): Promise<DroneRecord | null>;
  listDrones(input?: ListDronesInput, options?: RequestOptions): Promise<DroneRecord[]>;
  listGroups(options?: RequestOptions): Promise<DroneGroupSummary[]>;
  renameDrone(idOrName: string, nextName: string, options?: RequestOptions): Promise<DroneRecord>;
  archiveDrone(idOrName: string, options?: RequestOptions): Promise<void>;
  removeDrone(idOrName: string, input?: RemoveDroneInput, options?: RequestOptions): Promise<void>;
  listChats(droneIdOrName: string, options?: RequestOptions): Promise<ChatSummary[]>;
  ensureChat(droneIdOrName: string, chatName: string, options?: RequestOptions): Promise<ChatSummary>;
  removeChat(droneIdOrName: string, chatName: string, options?: RequestOptions): Promise<void>;
  sendMessage(
    droneIdOrName: string,
    chatName: string,
    message: MessageInput,
    options?: SendOptions,
  ): Promise<RunRecord>;
  getRun(
    droneIdOrName: string,
    chatName: string,
    runId: string,
    options?: RequestOptions,
  ): Promise<RunRecord>;
  cancelRun(
    droneIdOrName: string,
    chatName: string,
    runId: string,
    options?: RequestOptions,
  ): Promise<void>;
  listMessages(
    droneIdOrName: string,
    chatName: string,
    input?: ListMessagesInput,
    options?: RequestOptions,
  ): Promise<ChatMessage[]>;
};

export type AIClient = {
  ask(prompt: string, input?: RequestOptions): Promise<string>;
};

export type DroneSDKOptions = {
  transport: DroneTransport;
  defaults?: RequestOptions;
};
