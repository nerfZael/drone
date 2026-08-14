import type {
  ManagedDroneSyncPayload,
  ManagedDroneSyncResult,
} from '../managed-drone-state';

export type DroneClient = {
  baseUrl: string;
  token: string;
};

export type DroneDaemonConnection = {
  hostPort?: number | null;
  token?: string | null;
};

export class DroneDaemonUnavailableError extends Error {
  readonly code = 'daemon_unavailable';

  constructor(message = 'container drone daemon is unavailable') {
    super(message);
    this.name = 'DroneDaemonUnavailableError';
  }
}

export function daemonClientForDrone(drone: DroneDaemonConnection): DroneClient {
  const hostPort = Number(drone?.hostPort);
  const token = String(drone?.token ?? '').trim();
  if (!Number.isFinite(hostPort) || hostPort <= 0 || !token) {
    throw new DroneDaemonUnavailableError();
  }
  return { baseUrl: `http://127.0.0.1:${Math.floor(hostPort)}`, token };
}

export class DroneApiRequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function resolveTimeoutMs(): number {
  const raw = process.env.DRONE_HTTP_TIMEOUT_MS;
  if (!raw) return 5000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

type ResponseHandle = {
  response: Response;
  release: () => void;
};

type RequestOptions = {
  body?: BodyInit;
  contentType?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

async function openResponse(
  client: DroneClient,
  method: string,
  pathname: string,
  options?: RequestOptions,
): Promise<ResponseHandle> {
  if (options?.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error('request aborted');
  }
  const url = new URL(pathname, client.baseUrl).toString();
  const timeoutMs = options?.timeoutMs ?? resolveTimeoutMs();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();
  const abortFromCaller = () => controller.abort(options?.signal?.reason);
  options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const release = () => {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abortFromCaller);
  };
  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${client.token}`,
        ...(options?.contentType ? { 'content-type': options.contentType } : {}),
      },
      body: options?.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // Use the response text below.
      }
      throw new DroneApiRequestError(
        response.status,
        parsed?.error ?? text ?? `${method} ${pathname} failed`,
      );
    }
    return { response, release };
  } catch (err: any) {
    release();
    if (options?.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error('request aborted');
    }
    if (timedOut || err?.name === 'AbortError') {
      throw new Error(`request timeout after ${timeoutMs}ms: ${method} ${pathname}`);
    }
    throw err;
  }
}

async function consumeResponse<T>(
  client: DroneClient,
  method: string,
  pathname: string,
  options: RequestOptions | undefined,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const handle = await openResponse(client, method, pathname, options);
  try {
    return await consume(handle.response);
  } catch (error: any) {
    if (options?.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error('request aborted');
    }
    if (error?.name === 'AbortError') {
      const timeoutMs = options?.timeoutMs ?? resolveTimeoutMs();
      throw new Error(`request timeout after ${timeoutMs}ms: ${method} ${pathname}`);
    }
    throw error;
  } finally {
    handle.release();
  }
}

async function req(
  client: DroneClient,
  method: string,
  pathname: string,
  body?: any,
  options?: { signal?: AbortSignal },
): Promise<any> {
  return await consumeResponse(
    client,
    method,
    pathname,
    {
      ...(body == null ? {} : { body: JSON.stringify(body) }),
      contentType: 'application/json',
      signal: options?.signal,
    },
    async (response) => {
      const text = await response.text();
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    },
  );
}

function workspaceUrl(pathname: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return `${pathname}?${search.toString()}`;
}

export async function workspaceReadFile(
  client: DroneClient,
  filePath: string,
): Promise<{ data: Buffer; size: number; mtimeMs: number | null }> {
  return await consumeResponse(
    client,
    'GET',
    workspaceUrl('/v1/workspace/file', { path: filePath }),
    { timeoutMs: 15_000 },
    async (response) => {
      const data = Buffer.from(await response.arrayBuffer());
      const size = Number(response.headers.get('x-drone-file-size') ?? data.length);
      const rawMtimeMs = response.headers.get('x-drone-file-mtime-ms');
      const mtimeMs = rawMtimeMs == null ? null : Number(rawMtimeMs);
      return {
        data,
        size: Number.isFinite(size) ? Math.max(0, Math.floor(size)) : data.length,
        mtimeMs:
          mtimeMs != null && Number.isFinite(mtimeMs) ? Math.max(0, Math.floor(mtimeMs)) : null,
      };
    },
  );
}

export async function workspaceWriteFile(
  client: DroneClient,
  filePath: string,
  content: Buffer,
): Promise<{ path: string; size: number; mtimeMs: number }> {
  return await consumeResponse(
    client,
    'PUT',
    workspaceUrl('/v1/workspace/file', { path: filePath }),
    {
      body: content as unknown as BodyInit,
      contentType: 'application/octet-stream',
      timeoutMs: 15_000,
    },
    async (response) => (await response.json()) as any,
  );
}

export async function workspaceReadChunk(
  client: DroneClient,
  input: { path: string; offset: number; length: number },
): Promise<Buffer> {
  return await consumeResponse(
    client,
    'GET',
    workspaceUrl('/v1/workspace/chunk', input),
    { timeoutMs: 15_000 },
    async (response) => Buffer.from(await response.arrayBuffer()),
  );
}

export async function workspaceWriteChunk(
  client: DroneClient,
  input: { path: string; offset: number; data: Buffer },
): Promise<{ offset: number }> {
  return await consumeResponse(
    client,
    'PUT',
    workspaceUrl('/v1/workspace/chunk', { path: input.path, offset: input.offset }),
    {
      body: input.data as unknown as BodyInit,
      contentType: 'application/octet-stream',
      timeoutMs: 15_000,
    },
    async (response) => (await response.json()) as any,
  );
}

export async function workspaceExec(
  client: DroneClient,
  input: {
    cmd: string;
    args?: string[];
    cwd?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
  },
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  stdoutBytes?: number;
  stderrBytes?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}> {
  const requestedTimeoutMs = Number(input.timeoutMs ?? 30_000);
  const commandTimeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1, Math.min(10 * 60_000, Math.floor(requestedTimeoutMs)))
    : 30_000;
  const timeoutMs = commandTimeoutMs + 5_000;
  return await consumeResponse(
    client,
    'POST',
    '/v1/workspace/exec',
    {
      body: JSON.stringify(input),
      contentType: 'application/json',
      timeoutMs,
    },
    async (response) => (await response.json()) as any,
  );
}

export async function workspaceGitHashes(
  client: DroneClient,
  input: { repoRoot: string; paths: string[] },
): Promise<{
  hashes: Array<{ path: string; hash: string; lineCount?: number; binary?: boolean }>;
  cacheHits: number;
  hashed: number;
  durationMs: number;
}> {
  return await consumeResponse(
    client,
    'POST',
    '/v1/workspace/git/hashes',
    {
      body: JSON.stringify(input),
      contentType: 'application/json',
      timeoutMs: 35_000,
    },
    async (response) => (await response.json()) as any,
  );
}

export type WorkspaceBatchOperation =
  | { type: 'write'; path: string; content: string }
  | { type: 'move'; fromPath: string; toPath: string }
  | { type: 'delete'; path: string };

export async function workspaceBatch(
  client: DroneClient,
  operations: WorkspaceBatchOperation[],
): Promise<{ applied: number }> {
  return await consumeResponse(
    client,
    'POST',
    '/v1/workspace/batch',
    {
      body: JSON.stringify({ operations }),
      contentType: 'application/json',
      timeoutMs: 30_000,
    },
    async (response) => (await response.json()) as any,
  );
}

export async function managedDroneSync(
  client: DroneClient,
  payload: ManagedDroneSyncPayload,
): Promise<ManagedDroneSyncResult> {
  return await consumeResponse(
    client,
    'PUT',
    '/v1/managed-state',
    {
      body: JSON.stringify(payload),
      contentType: 'application/json',
      timeoutMs: 30_000,
    },
    async (response) => (await response.json()) as any,
  );
}

export async function health(client: DroneClient) {
  return await req(client, 'GET', '/v1/health');
}

export async function status(
  client: DroneClient,
  options?: { timeoutMs?: number; signal?: AbortSignal },
) {
  return await consumeResponse(
    client,
    'GET',
    '/v1/status',
    options,
    async (response) => await response.json(),
  );
}

export async function procStart(
  client: DroneClient,
  payload: { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string>; session?: string; force?: boolean; terminal?: boolean }
) {
  return await req(client, 'POST', '/v1/process/start', payload);
}

export async function procStop(client: DroneClient, payload: { session?: string } = {}) {
  return await req(client, 'POST', '/v1/process/stop', payload);
}

export async function sendInput(client: DroneClient, payload: { text: string; enter?: boolean; session?: string }) {
  return await req(client, 'POST', '/v1/input', payload);
}

export async function sendKeys(client: DroneClient, payload: { keys: string[]; session?: string }) {
  return await req(client, 'POST', '/v1/keys', payload);
}

export async function readOutput(client: DroneClient, payload: { since?: number; max?: number } = {}) {
  const since = payload.since ?? 0;
  const max = payload.max ?? 65536;
  return await req(client, 'GET', `/v1/output?since=${encodeURIComponent(String(since))}&max=${encodeURIComponent(String(max))}`);
}

export async function promptEnqueue(
  client: DroneClient,
  payload: {
    id: string;
    kind?: string;
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    prompt?: string;
    deliveryMode?: 'queue' | 'asap';
  },
  options?: { signal?: AbortSignal },
) {
  return await req(client, 'POST', '/v1/prompts/enqueue', payload, options);
}

export async function codexPromptEnqueue(
  client: DroneClient,
  payload: {
    id: string;
    sessionKey: string;
    launchScript: string;
    prompt: string;
    imagePaths?: string[];
    existingThreadId?: string;
    forkThreadId?: string;
    deliveryMode?: 'queue' | 'asap';
    approvalPolicy?: 'untrusted' | 'on-request' | 'never';
    approvalsReviewer?: 'user' | 'auto_review';
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    model?: string;
    effort?: string;
  },
  options?: { signal?: AbortSignal },
) {
  return await req(client, 'POST', '/v1/codex/enqueue', payload, options);
}

export async function promptGet(client: DroneClient, id: string) {
  return await req(client, 'GET', `/v1/prompts/${encodeURIComponent(id)}`);
}

export async function promptCancel(client: DroneClient, id: string) {
  return await req(client, 'POST', `/v1/prompts/${encodeURIComponent(id)}/cancel`);
}

export async function codexPromptApprovalResolve(
  client: DroneClient,
  input: {
    promptId: string;
    approvalId: string;
    decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
  },
) {
  return await req(
    client,
    'POST',
    `/v1/prompts/${encodeURIComponent(input.promptId)}/approvals/${encodeURIComponent(input.approvalId)}/${input.decision}`,
  );
}

export async function terminalInput(client: DroneClient, payload: { session: string; data: string }) {
  return await req(client, 'POST', '/v1/terminal/input', payload);
}

export async function terminalOutput(
  client: DroneClient,
  payload: { session: string; since?: number; max?: number; view?: 'log' | 'screen'; tail?: number },
) {
  const since = payload.since ?? 0;
  const max = payload.max ?? 65536;
  const view = payload.view === 'screen' ? 'screen' : 'log';
  const tail = payload.tail ?? 200;
  return await req(
    client,
    'GET',
    `/v1/terminal/output?session=${encodeURIComponent(payload.session)}&since=${encodeURIComponent(String(since))}&max=${encodeURIComponent(String(max))}&view=${encodeURIComponent(view)}&tail=${encodeURIComponent(String(tail))}`,
  );
}

export async function terminalPrompt(client: DroneClient, payload: { session: string }) {
  return await req(client, 'GET', `/v1/terminal/prompt?session=${encodeURIComponent(payload.session)}`);
}
