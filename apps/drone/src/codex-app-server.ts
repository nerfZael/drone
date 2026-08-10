import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

type JsonRpcId = number | string;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type CodexAppServerNotification = {
  method: string;
  params: any;
};

export type CodexAppServerRequest = CodexAppServerNotification & {
  id: JsonRpcId;
};

export const CODEX_APP_SERVER_REQUEST_RESOLVED = Symbol('codex-app-server-request-resolved');

export type CodexAppServerConnectionOptions = {
  launchScript: string;
  cwd?: string;
  onRequest?: (request: CodexAppServerRequest) => any | Promise<any>;
  onNotification?: (notification: CodexAppServerNotification) => void | Promise<void>;
  onStderr?: (text: string) => void | Promise<void>;
  onExit?: (error: Error) => void | Promise<void>;
};

function errorMessage(raw: any): string {
  if (typeof raw?.message === 'string' && raw.message.trim()) return raw.message.trim();
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw ?? 'Codex App Server request failed');
  }
}

function builtInServerRequestResponse(method: string): any {
  if (method === 'currentTime/read') {
    return { currentTimeAt: Math.floor(Date.now() / 1_000) };
  }
  throw new Error(`unsupported Codex App Server request: ${method}`);
}

export class CodexAppServerConnection {
  private readonly options: CodexAppServerConnectionOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private exited = false;
  private readyPromise: Promise<void> | null = null;

  constructor(options: CodexAppServerConnectionOptions) {
    this.options = options;
  }

  get running(): boolean {
    return Boolean(this.child && !this.exited);
  }

  async ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.start();
    return await this.readyPromise;
  }

  private async start(): Promise<void> {
    const launchScript = String(this.options.launchScript ?? '').trim();
    if (!launchScript) throw new Error('missing Codex App Server launch script');
    const child = spawn('bash', ['-lc', launchScript], {
      ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => {
      this.runCallback(() => this.options.onStderr?.(String(chunk ?? '')));
    });
    child.once('error', (error) => this.handleExit(error));
    child.once('exit', (code, signal) => {
      this.handleExit(
        new Error(
          `Codex App Server exited${typeof code === 'number' ? ` with code ${code}` : ''}${
            signal ? ` (${signal})` : ''
          }`,
        ),
      );
    });

    try {
      await this.request('initialize', {
        clientInfo: { name: 'drone-hub', title: 'Drone Hub', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      });
      this.notify('initialized', {});
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    }
  }

  private handleExit(error: Error): void {
    if (this.exited) return;
    this.exited = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
    this.runCallback(() => this.options.onExit?.(error));
  }

  private reportCallbackError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    try {
      void Promise.resolve(
        this.options.onStderr?.(`Codex App Server callback failed: ${message}\n`),
      ).catch(() => undefined);
    } catch {
      // A diagnostic callback must never crash the JSON-RPC transport.
    }
  }

  private runCallback(run: () => void | Promise<void> | undefined): void {
    try {
      void Promise.resolve(run()).catch((error) => this.reportCallbackError(error));
    } catch (error) {
      this.reportCallbackError(error);
    }
  }

  private handleLine(lineRaw: string): void {
    const line = String(lineRaw ?? '').trim();
    if (!line) return;
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      this.runCallback(() =>
        this.options.onStderr?.(`Invalid Codex App Server JSON: ${line}\n`),
      );
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(errorMessage(message.error)));
      else request.resolve(message.result);
      return;
    }
    const method = typeof message.method === 'string' ? message.method : '';
    if (!method) return;
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.runCallback(async () => {
        try {
          const result = this.options.onRequest
            ? await this.options.onRequest({ id: message.id, method, params: message.params })
            : builtInServerRequestResponse(method);
          if (result === CODEX_APP_SERVER_REQUEST_RESOLVED) return;
          this.write({ id: message.id, result });
        } catch (error: any) {
          const errorText = error?.message ?? String(error);
          this.write({
            id: message.id,
            error: {
              code: /unsupported Codex App Server request/i.test(String(errorText))
                ? -32601
                : -32603,
              message: errorText,
            },
          });
        }
      });
      return;
    }
    this.runCallback(() =>
      this.options.onNotification?.({ method, params: message.params }),
    );
  }

  private write(message: any): void {
    if (!this.child || this.exited || !this.child.stdin.writable) {
      throw new Error('Codex App Server is not running');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method: string, params: any): void {
    this.write({ method, params });
  }

  async request(method: string, params: any): Promise<any> {
    const id = this.nextRequestId++;
    const result = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, 30_000);
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
    });
    try {
      this.write({ id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) clearTimeout(pending.timeout);
      this.pending.delete(id);
      throw error;
    }
    return await result;
  }

  async call(method: string, params: any): Promise<any> {
    await this.ready();
    return await this.request(method, params);
  }

  stop(): void {
    if (!this.child || this.exited) return;
    this.child.kill('SIGTERM');
  }
}

function snakeCaseItemType(type: string): string {
  const known: Record<string, string> = {
    agentMessage: 'agent_message',
    commandExecution: 'command_execution',
    fileChange: 'file_change',
    mcpToolCall: 'mcp_tool_call',
    dynamicToolCall: 'dynamic_tool_call',
    webSearch: 'web_search',
    userMessage: 'user_message',
    // App Server uses a distinct item for a proposed plan response. The
    // durable Codex parser treats it as assistant text, matching `codex exec`.
    plan: 'agent_message',
  };
  return known[type] ?? type.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`);
}

export function normalizeCodexAppServerItem(raw: any): any {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const item = { ...raw, type: snakeCaseItemType(String(raw.type ?? '')) };
  if (raw.aggregatedOutput !== undefined) item.aggregated_output = raw.aggregatedOutput;
  if (raw.exitCode !== undefined) item.exit_code = raw.exitCode;
  if (raw.durationMs !== undefined) item.duration_ms = raw.durationMs;
  if (item.type === 'reasoning') {
    if (Array.isArray(raw.summary)) item.summary = raw.summary.join('\n');
    if (Array.isArray(raw.content)) item.content = raw.content.join('\n');
  }
  return item;
}

export function translateCodexAppServerNotification(
  notification: CodexAppServerNotification,
): any[] {
  const method = String(notification?.method ?? '');
  const params = notification?.params ?? {};
  if (method === 'thread/started') {
    const threadId = String(params?.thread?.id ?? params?.threadId ?? '').trim();
    return threadId ? [{ type: 'thread.started', thread_id: threadId }] : [];
  }
  if (method === 'turn/started') {
    return [{ type: 'turn.started', turn_id: String(params?.turn?.id ?? params?.turnId ?? '') }];
  }
  if (method === 'item/started' || method === 'item/completed') {
    return [
      {
        type: method === 'item/started' ? 'item.started' : 'item.completed',
        item: normalizeCodexAppServerItem(params?.item),
      },
    ];
  }
  if (method === 'item/agentMessage/delta') {
    return [
      {
        type: 'response.output_text.delta',
        item_id: String(params?.itemId ?? ''),
        delta: String(params?.delta ?? ''),
      },
    ];
  }
  if (method === 'item/plan/delta') {
    return [
      {
        type: 'response.output_text.delta',
        item_id: String(params?.itemId ?? ''),
        delta: String(params?.delta ?? ''),
      },
    ];
  }
  if (method === 'turn/plan/updated') {
    return [
      {
        type: 'item.updated',
        item: {
          id: `turn-plan-${String(params?.turnId ?? '')}`,
          type: 'todo_list',
          items: Array.isArray(params?.plan) ? params.plan : [],
          ...(typeof params?.explanation === 'string'
            ? { explanation: params.explanation }
            : {}),
        },
      },
    ];
  }
  if (method === 'turn/completed') {
    const turn = params?.turn ?? {};
    const status = String(turn?.status ?? 'completed');
    const completedItems = Array.isArray(turn?.items)
      ? turn.items.map((item: any) => ({
          type: 'item.completed',
          item: normalizeCodexAppServerItem(item),
        }))
      : [];
    if (status === 'failed') {
      const denialCode = codexDenialCode(turn?.error);
      return [
        ...completedItems,
        {
          type: 'error',
          message: errorMessage(turn?.error ?? 'Codex turn failed'),
          ...(denialCode ? { denial_code: denialCode } : {}),
        },
      ];
    }
    return [
      ...completedItems,
      {
        type: 'turn.completed',
        turn_id: String(turn?.id ?? ''),
        status,
        ...(turn?.error ? { error: turn.error } : {}),
      },
    ];
  }
  if (method === 'error') {
    const error = params?.error ?? params;
    const denialCode = codexDenialCode(error);
    return [
      {
        type: 'error',
        message: errorMessage(error),
        ...(denialCode ? { denial_code: denialCode } : {}),
      },
    ];
  }
  return [];
}

function codexDenialCode(raw: any): 'sandbox_denied' | 'policy_denied' | 'approval_unavailable' | null {
  const info = raw?.codexErrorInfo;
  if (info === 'sandboxError') return 'sandbox_denied';
  if (info === 'cyberPolicy') return 'policy_denied';
  const message = errorMessage(raw);
  if (/approval.*(?:unavailable|not available|unsupported)|no approval handler/i.test(message)) {
    return 'approval_unavailable';
  }
  return null;
}
