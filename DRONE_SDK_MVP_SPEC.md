# Drone SDK MVP Spec

## Goal

Define a TypeScript SDK for writing programs that create, organize, and operate drones using the existing host-side Drone and Hub model.

The SDK is for application developers, scripts, and automations. It should expose the same core actions available in the UI and host APIs without forcing callers to think in terms of raw HTTP routes or tmux sessions.

## Design Principles

- TypeScript-first and async-first.
- High-level API over Hub/daemon transport details.
- Explicit execution semantics: local queueing, remote dispatch, waiting, cancellation.
- Safe defaults for timeouts, idempotency, and result inspection.
- Resource handles should be cheap to construct and not require network round-trips.
- The SDK should map cleanly to current Drone concepts: drones, groups, chats, prompt queues, terminal sessions, runs.

## MVP Scope

### In

- Create, get, list, rename, and remove drones.
- Archive drones explicitly and remove them with archive-aware behavior.
- Access drones by group and create multiple drones in one call.
- Open multiple chats per drone.
- Broadcast the same message or queued message sequence to multiple chats or drones.
- Queue messages locally on a chat and dispatch them as a run.
- Send a single message immediately to a chat.
- Remove chats explicitly.
- Wait for runs to finish and inspect status and messages.
- Read chat messages and the last message.
- Stream run events and messages.
- Support Hub-backed transport as the default remote control plane.
- Support AbortSignal and per-call timeout overrides.

### Out

- Full low-level terminal API surface.
- File transfer and attachments.
- Rich automation loop APIs.
- Cross-process durable local queueing in the SDK client.
- Full policy/quota administration APIs.
- Provider-specific LLM integration as a required dependency.

## Package Shape

Recommended package layout:

- `drone-sdk`
- `drone-sdk/hub`
- `drone-sdk/testing`
- `drone-sdk/ai` (optional, not part of core MVP)

## Top-Level API

```ts
import { createDroneSDK } from "drone-sdk";
import { hubTransport } from "drone-sdk/hub";

const sdk = createDroneSDK({
  transport: hubTransport({
    baseUrl: "http://127.0.0.1:8787",
    token: process.env.DRONE_TOKEN!,
  }),
});
```

### Factory

```ts
type DroneSDKOptions = {
  transport: DroneTransport;
  defaults?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  };
};

declare function createDroneSDK(options: DroneSDKOptions): DroneSDK;
```

## Core Concepts

### SDK

Entry point for fleet-wide operations.

```ts
type DroneSDK = {
  drones: DroneCollection;
  groups: GroupCollection;
  broadcast: BroadcastAPI;
  ai?: AIClient;
};
```

### Drone Collection

```ts
type DroneCollection = {
  create(name: string, input?: CreateDroneInput): Promise<Drone>;
  createMany(inputs: CreateDroneBatchItem[]): Promise<CreateManyResult>;
  get(idOrName: string): Promise<Drone | null>;
  list(input?: ListDronesInput): Promise<DroneSummary[]>;
};
```

### Group Collection

```ts
type GroupCollection = {
  get(name: string): DroneGroup;
  list(): Promise<DroneGroupSummary[]>;
};
```

### Group Handle

```ts
type DroneGroup = {
  name: string;
  create(name: string, input?: Omit<CreateDroneInput, "group">): Promise<Drone>;
  createMany(inputs: Omit<CreateDroneBatchItem, "group">[]): Promise<CreateManyResult>;
  list(): Promise<DroneSummary[]>;
};
```

### Drone Handle

`Drone` is a durable resource handle. Creating or obtaining a handle does not imply a process is running and should not imply chat creation.

```ts
type Drone = {
  id: string;
  name: string;
  group?: string;
  runtime: DroneRuntime;

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
```

### Chat Handle

`drone.chat(name)` is synchronous. It returns a handle immediately and does not require the chat to already exist remotely.

```ts
type DroneChat = {
  drone: Drone;
  name: string;

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
```

### Run Handle

A `Run` represents one dispatched unit of work for a chat. It is the main object for waiting, status inspection, and streaming.

```ts
type Run = {
  id: string;
  droneId: string;
  chatName: string;

  status(input?: RequestOptions): Promise<RunStatus>;
  wait(input?: WaitOptions): Promise<RunResult>;
  cancel(input?: RequestOptions): Promise<void>;
  stream(input?: StreamOptions): AsyncIterable<RunEvent>;

  messages(input?: ListMessagesInput): Promise<ChatMessage[]>;
  lastMessage(input?: RequestOptions): Promise<ChatMessage | null>;
  lastMessageText(input?: RequestOptions): Promise<string | null>;
};
```

### Broadcast Helpers

Broadcast helpers are part of the current package surface.

```ts
type BroadcastAPI = {
  chats(drone: Drone, chatNames: string[]): ChatBroadcast;
  drones(targets: Array<string | Drone | DroneSummary>): DroneBroadcast;
};

type DroneBroadcast = {
  chat(name?: string): ChatBroadcast;
};

type ChatBroadcast = {
  queue(message: MessageInput): ChatBroadcast;
  clearQueue(): ChatBroadcast;
  queued(): readonly MessageInput[];
  send(message: MessageInput, input?: SendOptions): Promise<Run[]>;
  dispatch(input?: DispatchOptions): Promise<Run[]>;
};
```

## Types

```ts
type DroneRuntime = "container";

type CreateDroneInput = {
  group?: string;
  runtime?: DroneRuntime;
  cwd?: string;
  repoPath?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};

type CreateDroneBatchItem = CreateDroneInput & {
  name: string;
};

type CreateManyResult = {
  accepted: DroneSummary[];
  rejected: Array<{
    name: string;
    error: string;
  }>;
};

type DroneSummary = {
  id: string;
  name: string;
  group?: string;
  runtime: DroneRuntime;
  createdAt?: string;
};

type DroneGroupSummary = {
  name: string;
  count: number;
};

type ChatSummary = {
  name: string;
  messageCount?: number;
  lastMessageAt?: string;
};

type ListDronesInput = {
  group?: string;
  names?: string[];
};

type RemoveDroneInput = {
  keepVolume?: boolean;
  mode?: "auto" | "archive" | "permanent";
};

type MessageInput =
  | string
  | {
      role?: "user" | "system";
      content: string;
      metadata?: Record<string, string>;
    };

type SendOptions = RequestOptions & {
  idempotencyKey?: string;
};

type DispatchOptions = RequestOptions & {
  idempotencyKey?: string;
};

type RequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

type WaitOptions = RequestOptions & {
  pollIntervalMs?: number;
};

type StreamOptions = RequestOptions & {
  pollIntervalMs?: number;
};

type ListMessagesInput = RequestOptions & {
  limit?: number;
  cursor?: string;
  order?: "asc" | "desc";
};

type SubscribeMessagesInput = StreamOptions & {
  sinceMessageId?: string;
};

type RunStatus = "queued" | "running" | "done" | "failed" | "canceled";

type RunResult = {
  id: string;
  status: Exclude<RunStatus, "queued" | "running">;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

type ChatMessage = {
  id: string;
  chat: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  runId?: string;
  metadata?: Record<string, string>;
};

type ChatEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "status"; status: RunStatus }
  | { type: "error"; error: string };

type RunEvent =
  | { type: "status"; status: RunStatus }
  | { type: "message"; message: ChatMessage }
  | { type: "error"; error: string };

type DroneRecord = DroneSummary & {
  repoPath?: string;
  cwd?: string;
  metadata?: Record<string, string>;
};

type RunRecord = {
  id: string;
  droneId: string;
  chatName: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

type CreateManyTransportResult = {
  accepted: DroneRecord[];
  rejected: Array<{
    name: string;
    error: string;
  }>;
};
```

## Execution Semantics

The SDK must make the difference between local builder state and remote execution obvious.

### `drone.chat(name)`

- Returns a chat handle synchronously.
- Does not talk to the network.
- Does not create remote state by itself.

### `chat.ensure()`

- Ensures the remote chat exists when the backing transport distinguishes chat resources explicitly.
- May be a no-op for transports where chats are created on first message.

### `chat.queue(message)`

- Appends a message to an in-memory queue on that chat handle.
- Returns the same chat handle for fluent chaining.
- Does not perform network I/O.

### `chat.send(message)`

- Sends one message immediately.
- Equivalent to creating a single-message run without using the local queue.
- Returns a `Run`.

### `chat.dispatch()`

- Dispatches the currently queued messages as one run.
- Clears the local queue only after the dispatch request succeeds.
- Fails if there are zero queued messages.
- Returns a `Run`.
- In the current implementation, multi-message dispatch is executed client-side as a sequential batch over single-message Hub prompt submissions.

### `run.wait()`

- Resolves when the run reaches `done`, `failed`, or `canceled`.
- Rejects only for client-side transport errors unless `throwOnRunFailure` is added in a later revision.
- Run failure is represented in the returned `RunResult`.

### `drone.remove()`

- `drone.remove()` is archive-aware.
- When `RemoveDroneInput.mode` is omitted or set to `"auto"`, the Hub transport checks `/api/settings/delete-action`.
- If Hub delete mode is `"archive"`, `drone.remove()` archives instead of permanently deleting.
- Call `drone.archive()` for explicit archive or `drone.remove({ mode: "permanent" })` for explicit hard delete.

### Broadcast semantics

- `drone.broadcast([...chatNames]).send(message)` sends the same message to multiple chats on one drone.
- `sdk.broadcast.drones([...targets]).chat(name).send(message)` sends the same message to the same chat across multiple drones.
- Broadcast `dispatch()` applies the current local broadcast queue to each target and returns one `Run` per target.

## Recommended Usage Patterns

### Single chat

```ts
const drone = await sdk.drones.create("drone-1", { runtime: "container" });

const run = await drone
  .chat("default")
  .queue("Hello, do this")
  .queue("What did you do?")
  .dispatch();

await run.wait();

console.log(await run.messages());
console.log(await run.lastMessageText());
```

### Multiple chats in one drone

```ts
const planner = drone.chat("planner");
const coder = drone.chat("coder");
const reviewer = drone.chat("reviewer");

const initialRuns = await Promise.all([
  planner.queue("Task 1").queue("Task 2").queue("Task 3").dispatch(),
  coder.queue("Task 1").queue("Task 2").queue("Task 3").dispatch(),
  reviewer.queue("Task 1").queue("Task 2").queue("Task 3").dispatch(),
]);

await Promise.all(initialRuns.map((run) => run.wait()));

const followups = await Promise.all([
  planner.send("Summarize your previous work."),
  coder.send("Summarize your previous work."),
  reviewer.send("Summarize your previous work."),
]);

await Promise.all(followups.map((run) => run.wait()));
```

### Broadcast to multiple chats

```ts
const runs = await drone.broadcast(["planner", "coder", "reviewer"]).send("Summarize your current status.");
await Promise.all(runs.map((run) => run.wait()));
```

### Broadcast to multiple drones

```ts
const drones = await exp.list();

const runs = await sdk.broadcast
  .drones(drones)
  .chat("default")
  .send("Pull latest and report status.");

await Promise.all(runs.map((run) => run.wait()));
```

### Group-oriented create

```ts
const exp = sdk.groups.get("experimental");

const created = await exp.createMany([
  { name: "drone-a", runtime: "container" },
  { name: "drone-b", runtime: "container" },
  { name: "drone-c", runtime: "container" },
]);
```

### Chat and drone removal

```ts
await drone.chat("planner").remove();
await drone.remove();

// Force permanent delete even if Hub delete mode is archive.
await drone.remove({ mode: "permanent" });

// Explicit archive.
await drone.archive();
```

## Error Handling

The SDK should distinguish these error classes:

- `DroneSDKError`: base error.
- `TransportError`: network or protocol error.
- `TimeoutError`: request timeout.
- `ValidationError`: invalid input before request.
- `NotFoundError`: resource does not exist.
- `ConflictError`: idempotency or state conflict.

Run failure should not automatically be a thrown exception from `run.wait()`. It should be visible in `RunResult.status` and `RunResult.error`.

## Transport Contract

The SDK core depends on a transport interface rather than raw fetch calls.

```ts
type DroneTransport = {
  createDrone(input: CreateDroneBatchItem, options?: RequestOptions): Promise<DroneRecord>;
  createDrones(input: CreateDroneBatchItem[], options?: RequestOptions): Promise<CreateManyTransportResult>;
  getDrone(idOrName: string, options?: RequestOptions): Promise<DroneRecord | null>;
  listDrones(input?: ListDronesInput, options?: RequestOptions): Promise<DroneRecord[]>;
  listGroups(options?: RequestOptions): Promise<DroneGroupSummary[]>;
  renameDrone(idOrName: string, nextName: string, options?: RequestOptions): Promise<DroneRecord>;
  archiveDrone(idOrName: string, options?: RequestOptions): Promise<void>;
  removeDrone(idOrName: string, input?: RemoveDroneInput, options?: RequestOptions): Promise<void>;

  listChats(droneId: string, options?: RequestOptions): Promise<ChatSummary[]>;
  ensureChat(droneId: string, chatName: string, options?: RequestOptions): Promise<ChatSummary>;
  removeChat(droneId: string, chatName: string, options?: RequestOptions): Promise<void>;

  sendMessage(droneId: string, chatName: string, message: MessageInput, options?: SendOptions): Promise<RunRecord>;
  getRun(droneId: string, chatName: string, runId: string, options?: RequestOptions): Promise<RunRecord>;
  cancelRun(droneId: string, chatName: string, runId: string, options?: RequestOptions): Promise<void>;
  listMessages(droneId: string, chatName: string, input?: ListMessagesInput, options?: RequestOptions): Promise<ChatMessage[]>;
};
```

The only required production transport for MVP is `hubTransport`.

## Mapping to Current System

The MVP SDK should align with current repo behavior:

- Drone creation and lookup are host-side concerns.
- Groups are host-side metadata.
- Chats map to Hub-managed chat state.
- Dispatched chat work maps to existing prompt queue and status concepts.
- Message inspection maps to Hub transcript or message history endpoints.
- Drone removal maps to Hub delete-action settings and may archive instead of hard-delete.

The SDK should not expose tmux or daemon details in its primary surface, even if the transport uses them internally.

## Optional AI Module

The SDK may expose an optional `ai` client if model access is already configured in the Hub.

```ts
type AIClient = {
  ask(prompt: string, input?: RequestOptions): Promise<string>;
};
```

This module is optional and must not block use of the core drone APIs.

## MVP Non-Goals and Deferred Decisions

These should be deferred until the first working SDK exists:

- Whether `run.wait()` should optionally throw on run failure.
- Whether chats need explicit remote creation for every transport.
- Cross-drone transactions or workflow composition primitives.
- Durable offline queue persistence in the client.
- Full terminal/session surface in the public SDK.
