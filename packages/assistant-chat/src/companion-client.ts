import {
  reduceCompanionToolActivity,
  type CompanionBrowserToolName,
  type CompanionBrowserToolRequest,
  type CompanionClientTelemetry,
  type CompanionServerMessage,
  type CompanionStatus,
  type CompanionToolActivity,
} from './companion.js';

export type CompanionClientState = {
  status: CompanionStatus;
  error: string;
  reply: string;
  transcript: string;
  startedAt: number | null;
  endedAt: number | null;
  activity: CompanionToolActivity[];
};

export type CompanionClientConnectionTelemetry = Pick<
  CompanionClientTelemetry,
  'connectionMs' | 'connectionReused'
>;

export type CompanionClientTransport = {
  open(input: {
    runId: string;
    onMessage(message: CompanionServerMessage): void;
    onDisconnect(message: string): void;
  }): Promise<CompanionClientConnectionTelemetry | undefined>;
  sendPrompt(input: {
    runId: string;
    messageId: string;
    prompt: string;
    telemetry?: CompanionClientTelemetry;
  }): Promise<void> | void;
  sendToolResult(input: {
    runId: string;
    generation: number;
    callId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }): Promise<void> | void;
  cancel(runId: string): Promise<void> | void;
  close(): Promise<void> | void;
};

export type CompanionBrowserToolExecutor = (
  tool: CompanionBrowserToolName,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export type CompanionBrowserWorkspace = {
  getAppContext(): Promise<unknown> | unknown;
  readActiveComposer(): Promise<unknown> | unknown;
  applyComposer(
    targetId: string,
    baseRevision: string,
    content: string,
  ): Promise<unknown> | unknown;
  readOpenFile(): Promise<unknown> | unknown;
  applyEditor(targetId: string, baseRevision: string, content: string): Promise<unknown> | unknown;
  openDroneChat(args: Record<string, unknown>): Promise<unknown> | unknown;
  highlightDrones(args: Record<string, unknown>): Promise<unknown> | unknown;
};

type ActiveSession = {
  runId: string;
  generation: number;
  transport: CompanionClientTransport;
  executeTool: CompanionBrowserToolExecutor;
  ready: Promise<CompanionClientConnectionTelemetry | undefined>;
  sentMessages: number;
};

const INITIAL_STATE: CompanionClientState = {
  status: 'idle',
  error: '',
  reply: '',
  transcript: '',
  startedAt: null,
  endedAt: null,
  activity: [],
};

export class CompanionClientController {
  private state = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private activeSession: ActiveSession | null = null;

  constructor(
    private readonly options: {
      createId(): string;
      now?(): number;
    },
  ) {}

  readonly getSnapshot = (): CompanionClientState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getToken(): number {
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return this.generation === token;
  }

  hasSession(): boolean {
    return this.activeSession !== null;
  }

  reportVoiceError(message: string): void {
    if (!message.trim()) return;
    this.update({
      error: message,
      ...(!this.activeSession ? { status: 'error' as const, endedAt: this.now() } : {}),
    });
  }

  fail(message: string): void {
    this.update({ status: 'error', error: message, endedAt: this.now() });
  }

  resetIfNoSession(): void {
    if (!this.activeSession) this.replace(INITIAL_STATE);
  }

  async submitPrompt(input: {
    prompt: string;
    telemetry?: CompanionClientTelemetry;
    messageId?: string;
    createTransport(): CompanionClientTransport;
    executeTool: CompanionBrowserToolExecutor;
  }): Promise<void> {
    const prompt = input.prompt.trim();
    if (!prompt) return;

    const session = this.activeSession ?? this.createSession(input);
    session.executeTool = input.executeTool;
    const messageId = input.messageId || this.options.createId();
    this.update({
      status: 'working',
      error: '',
      transcript: prompt,
      startedAt: this.state.startedAt ?? this.now(),
      endedAt: null,
    });

    try {
      const connection = await session.ready;
      if (!this.isActive(session)) return;
      const telemetry = connection
        ? {
            ...input.telemetry,
            version: 1 as const,
            ...(session.sentMessages === 0
              ? connection
              : { connectionMs: 0, connectionReused: true }),
          }
        : input.telemetry;
      session.sentMessages += 1;
      await session.transport.sendPrompt({
        runId: session.runId,
        messageId,
        prompt,
        telemetry,
      });
    } catch (error) {
      this.handleDisconnect(
        session,
        error instanceof Error ? error.message : String(error || 'Companion could not start.'),
      );
    }
  }

  async close(): Promise<void> {
    this.generation += 1;
    const session = this.activeSession;
    this.activeSession = null;
    if (session) {
      try {
        await session.transport.cancel(session.runId);
      } catch {
        // Closing remains best-effort when the transport has already disconnected.
      }
      await closeTransport(session.transport);
    }
    this.replace(INITIAL_STATE);
  }

  async cancel(): Promise<void> {
    this.generation += 1;
    const session = this.activeSession;
    this.activeSession = null;
    if (session) {
      try {
        await session.transport.cancel(session.runId);
      } catch {
        // Cancellation remains best-effort when the transport has disconnected.
      }
      await closeTransport(session.transport);
    }
    this.update({ status: 'cancelled', endedAt: this.now() });
  }

  private createSession(input: {
    createTransport(): CompanionClientTransport;
    executeTool: CompanionBrowserToolExecutor;
  }): ActiveSession {
    const transport = input.createTransport();
    const session: ActiveSession = {
      runId: this.options.createId(),
      generation: ++this.generation,
      transport,
      executeTool: input.executeTool,
      ready: Promise.resolve(undefined),
      sentMessages: 0,
    };
    this.activeSession = session;
    session.ready = Promise.resolve().then(() =>
      transport.open({
        runId: session.runId,
        onMessage: (message) => this.handleMessage(session, message),
        onDisconnect: (message) => this.handleDisconnect(session, message),
      }),
    );
    return session;
  }

  private handleMessage(session: ActiveSession, message: CompanionServerMessage): void {
    if (!this.isActive(session) || (message.runId && message.runId !== session.runId)) return;
    if (message.type === 'tool_call') {
      void this.executeTool(session, message);
    } else if (message.type === 'activity') {
      this.update({ activity: reduceCompanionToolActivity(this.state.activity, message.event) });
    } else if (message.type === 'reply') {
      this.update({ reply: String(message.reply ?? '') });
    } else if (message.type === 'status' && message.status === 'completed') {
      this.update({ status: 'completed', endedAt: this.now() });
    } else if (message.type === 'status' && message.status === 'cancelled') {
      this.finishSession(session, 'cancelled');
    } else if (message.type === 'error') {
      this.finishSession(session, 'error', String(message.error ?? 'Companion failed.'), true);
    }
  }

  private async executeTool(session: ActiveSession, request: CompanionBrowserToolRequest) {
    try {
      const result = await session.executeTool(request.tool, request.args ?? {});
      await this.sendToolResult(session, request, { ok: true, result });
    } catch (error) {
      await this.sendToolResult(session, request, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendToolResult(
    session: ActiveSession,
    request: CompanionBrowserToolRequest,
    result: { ok: boolean; result?: unknown; error?: string },
  ) {
    if (!this.isActive(session)) return;
    try {
      await session.transport.sendToolResult({
        runId: session.runId,
        generation: Number(request.generation),
        callId: request.callId,
        ...result,
      });
    } catch {
      // A failed tool response is superseded by transport disconnect handling.
    }
  }

  private handleDisconnect(session: ActiveSession, message: string): void {
    if (!this.isActive(session)) return;
    this.activeSession = null;
    void closeTransport(session.transport);
    if (this.state.status === 'completed' || this.state.status === 'idle') return;
    this.update({ status: 'error', error: message, endedAt: this.now() });
  }

  private finishSession(
    session: ActiveSession,
    status: 'cancelled' | 'error',
    error = '',
    cancel = false,
  ): void {
    if (!this.isActive(session)) return;
    this.activeSession = null;
    this.update({ status, error, endedAt: this.now() });
    if (cancel) {
      void Promise.resolve(session.transport.cancel(session.runId))
        .catch(() => undefined)
        .finally(() => closeTransport(session.transport));
    } else {
      void closeTransport(session.transport);
    }
  }

  private isActive(session: ActiveSession): boolean {
    return this.activeSession === session && this.isCurrent(session.generation);
  }

  private update(next: Partial<CompanionClientState>): void {
    this.replace({ ...this.state, ...next });
  }

  private replace(next: CompanionClientState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export async function executeCompanionBrowserTool(
  workspace: CompanionBrowserWorkspace,
  tool: CompanionBrowserToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (tool === 'get_app_context') return await workspace.getAppContext();
  if (tool === 'read_active_composer') return await workspace.readActiveComposer();
  if (tool === 'apply_composer_patch') {
    return await workspace.applyComposer(
      String(args.targetId ?? ''),
      String(args.baseRevision ?? ''),
      String(args.content ?? ''),
    );
  }
  if (tool === 'read_open_file') return await workspace.readOpenFile();
  if (tool === 'apply_editor_patch') {
    return await workspace.applyEditor(
      String(args.targetId ?? ''),
      String(args.baseRevision ?? ''),
      String(args.content ?? ''),
    );
  }
  if (tool === 'open_drone_chat') return await workspace.openDroneChat(args);
  if (tool === 'highlight_drones') return await workspace.highlightDrones(args);
  throw new Error(`Unsupported Companion browser tool: ${tool}`);
}

async function closeTransport(transport: CompanionClientTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    // The transport may already be closed after a terminal event.
  }
}
