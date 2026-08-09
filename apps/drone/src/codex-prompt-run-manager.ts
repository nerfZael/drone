import {
  CodexAppServerConnection,
  translateCodexAppServerNotification,
  type CodexAppServerNotification,
} from './codex-app-server';

export type CodexPromptState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export type CodexPromptSpec = {
  sessionKey: string;
  launchScript: string;
  prompt: string;
  imagePaths?: string[];
  existingThreadId?: string;
  threadId?: string;
  turnId?: string;
  runId?: string;
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
  approvalsReviewer?: 'user' | 'auto_review';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  model?: string;
  effort?: string;
};

export type CodexPromptMessage = {
  id: string;
  state: CodexPromptState;
  deliveryMode?: 'queue' | 'asap';
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  codexAppServer: CodexPromptSpec;
};

export type CodexPromptRun = {
  id: string;
  sessionKey: string;
  state: CodexPromptState;
  messageIds: string[];
  responseMessageId: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
  threadId?: string;
  turnId?: string;
  stdoutPath: string;
  stderrPath: string;
  transcript?: unknown;
  stdout?: string;
  stderr?: string;
  stdoutBytes?: number;
  stderrBytes?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  error?: string;
};

export type CodexPromptRunSummary = Pick<
  CodexPromptRun,
  | 'id'
  | 'state'
  | 'messageIds'
  | 'responseMessageId'
  | 'createdAt'
  | 'updatedAt'
  | 'startedAt'
  | 'finishedAt'
  | 'threadId'
  | 'turnId'
  | 'error'
>;

type CodexPromptRunManagerOptions<TMessage extends CodexPromptMessage> = {
  loadMessage(id: string): Promise<TMessage | null>;
  saveMessage(message: TMessage): Promise<void>;
  createRun(message: TMessage, startedAt: string): Promise<CodexPromptRun>;
  loadRun(id: string): Promise<CodexPromptRun | null>;
  saveRun(run: CodexPromptRun): Promise<void>;
  appendRunEvents(run: CodexPromptRun, events: unknown[]): Promise<CodexPromptRun>;
  appendRunStderr(run: CodexPromptRun, text: string): Promise<void>;
  mutate<T>(operation: () => Promise<T>): Promise<T>;
  now?: () => string;
};

type CodexRunSession = {
  key: string;
  connection: CodexAppServerConnection;
  threadId: string | null;
  threadReady: boolean;
  activeTurnId: string | null;
  activeRun: CodexPromptRun | null;
  startingRun: CodexPromptRun | null;
  queuedMessageIds: string[];
  cancelRequestedMessageIds: Set<string>;
  lastUsedAt: number;
  operationTail: Promise<void>;
};

export class CodexPromptRunManager<TMessage extends CodexPromptMessage> {
  private readonly options: CodexPromptRunManagerOptions<TMessage>;
  private readonly sessions = new Map<string, CodexRunSession>();
  private shuttingDown = false;

  constructor(options: CodexPromptRunManagerOptions<TMessage>) {
    this.options = options;
  }

  async enqueue(message: TMessage): Promise<'started' | 'steered' | 'queued'> {
    const spec = message.codexAppServer;
    const session = this.sessions.get(spec.sessionKey) ?? this.createSession(spec);
    return await this.serialize(session, async () => {
      session.lastUsedAt = Date.now();
      if (message.deliveryMode === 'asap' && (await this.steerActiveRun(session, message.id))) {
        return 'steered' as const;
      }
      if (session.activeRun || session.startingRun) {
        if (!session.queuedMessageIds.includes(message.id)) {
          session.queuedMessageIds.push(message.id);
        }
        return 'queued' as const;
      }
      await this.startRun(session, message.id);
      return 'started' as const;
    });
  }

  async cancel(message: TMessage): Promise<TMessage> {
    const spec = message.codexAppServer;
    const session = this.sessions.get(spec.sessionKey);
    if (!session || message.state === 'queued') {
      if (session) {
        session.queuedMessageIds = session.queuedMessageIds.filter((id) => id !== message.id);
      }
      return await this.markMessageCanceled(message);
    }
    if (session.startingRun?.messageIds.includes(message.id)) {
      session.cancelRequestedMessageIds.add(message.id);
      return await this.markMessageCanceled(message);
    }
    if (
      session.activeRun?.messageIds.includes(message.id) &&
      session.activeTurnId &&
      session.threadId
    ) {
      const canceled = await this.markMessageCanceled(message);
      await this.serialize(session, async () => {
        await session.connection.call('turn/interrupt', {
          threadId: session.threadId,
          turnId: session.activeTurnId,
        });
      }).catch(() => undefined);
      return (await this.options.loadMessage(message.id)) ?? canceled;
    }
    return (await this.options.loadMessage(message.id)) ?? message;
  }

  async runForMessage(message: TMessage): Promise<CodexPromptRun | null> {
    const runId = String(message.codexAppServer.runId ?? '').trim();
    return runId ? await this.options.loadRun(runId) : null;
  }

  ownsMessage(message: TMessage): boolean {
    const session = this.sessions.get(message.codexAppServer.sessionKey);
    if (!session) return false;
    return Boolean(
      session.queuedMessageIds.includes(message.id) ||
      session.startingRun?.messageIds.includes(message.id) ||
      session.activeRun?.messageIds.includes(message.id),
    );
  }

  async failInterrupted(message: TMessage, reason: string, alreadyMutating = false): Promise<void> {
    const run = await this.runForMessage(message);
    if (run) {
      await this.failRunAndMessages(run, new Error(reason), alreadyMutating);
      return;
    }
    const finishedAt = this.now();
    const save = () =>
      this.options.saveMessage({
        ...message,
        state: 'failed',
        finishedAt,
        updatedAt: finishedAt,
        exitCode: 1,
        error: reason,
      });
    await (alreadyMutating ? save() : this.options.mutate(save));
  }

  sweepIdle(maxIdleMillis: number): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (
        now - session.lastUsedAt < maxIdleMillis ||
        session.activeRun ||
        session.startingRun ||
        session.queuedMessageIds.length > 0
      ) {
        continue;
      }
      this.sessions.delete(key);
      session.connection.stop();
    }
  }

  stop(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const session of this.sessions.values()) session.connection.stop();
    this.sessions.clear();
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private serialize<T>(session: CodexRunSession, operation: () => Promise<T>): Promise<T> {
    const result = session.operationTail.then(operation, operation);
    session.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private createSession(spec: CodexPromptSpec): CodexRunSession {
    let session!: CodexRunSession;
    const connection = new CodexAppServerConnection({
      launchScript: spec.launchScript,
      onNotification: (notification) => this.handleNotification(session, notification),
      onStderr: async (text) => {
        const run = session.activeRun ?? session.startingRun;
        if (run) await this.options.appendRunStderr(run, text);
      },
      onExit: (error) => {
        if (!this.shuttingDown && this.sessions.get(session.key) === session) {
          return this.failSession(session, error);
        }
      },
    });
    session = {
      key: spec.sessionKey,
      connection,
      threadId: spec.threadId ?? spec.existingThreadId ?? null,
      threadReady: false,
      activeTurnId: null,
      activeRun: null,
      startingRun: null,
      queuedMessageIds: [],
      cancelRequestedMessageIds: new Set(),
      lastUsedAt: Date.now(),
      operationTail: Promise.resolve(),
    };
    this.sessions.set(session.key, session);
    return session;
  }

  private async handleNotification(
    session: CodexRunSession,
    notification: CodexAppServerNotification,
  ): Promise<void> {
    await this.serialize(session, async () => {
      session.lastUsedAt = Date.now();
      const threadId = String(
        notification.params?.threadId ?? notification.params?.thread?.id ?? '',
      ).trim();
      if (threadId) session.threadId = threadId;
      const turnId = String(
        notification.params?.turnId ?? notification.params?.turn?.id ?? '',
      ).trim();
      if (notification.method === 'turn/started' && turnId) session.activeTurnId = turnId;
      const currentRun = session.activeRun ?? session.startingRun;
      const events = translateCodexAppServerNotification(notification);
      if (currentRun && events.length > 0) {
        const updated = await this.options.mutate(() =>
          this.options.appendRunEvents(currentRun, events),
        );
        if (session.activeRun?.id === updated.id) session.activeRun = updated;
        if (session.startingRun?.id === updated.id) session.startingRun = updated;
      }
      if (notification.method === 'turn/completed') {
        await this.completeTurn(session, notification);
      }
    });
  }

  private async ensureThread(session: CodexRunSession, spec: CodexPromptSpec): Promise<string> {
    if (session.threadId && session.threadReady) return session.threadId;
    if (session.threadId) {
      try {
        const resumed = await session.connection.call('thread/resume', {
          threadId: session.threadId,
          cwd: undefined,
          approvalPolicy: spec.approvalPolicy,
          approvalsReviewer: spec.approvalsReviewer,
          sandbox: spec.sandbox,
          model: spec.model,
        });
        session.threadId = String(resumed?.thread?.id ?? session.threadId);
        session.threadReady = true;
        return session.threadId;
      } catch (error) {
        if (!isMissingThreadError(error)) throw error;
        session.threadId = null;
        session.threadReady = false;
      }
    }
    const started = await session.connection.call('thread/start', {
      cwd: undefined,
      approvalPolicy: spec.approvalPolicy,
      approvalsReviewer: spec.approvalsReviewer,
      sandbox: spec.sandbox,
      model: spec.model,
    });
    const threadId = String(started?.thread?.id ?? '').trim();
    if (!threadId) throw new Error('Codex App Server did not return a thread id');
    session.threadId = threadId;
    session.threadReady = true;
    return threadId;
  }

  private async startRun(session: CodexRunSession, messageId: string): Promise<void> {
    const message = await this.options.loadMessage(messageId);
    if (!message) return;
    const startedAt = this.now();
    let run = await this.options.mutate(async () => {
      const created = await this.options.createRun(message, startedAt);
      await this.options.saveRun(created);
      await this.options.saveMessage({
        ...message,
        state: 'running',
        startedAt,
        updatedAt: startedAt,
        codexAppServer: { ...message.codexAppServer, runId: created.id },
      });
      return created;
    });
    session.startingRun = run;
    try {
      const threadId = await this.ensureThread(session, message.codexAppServer);
      run = await this.options.mutate(() =>
        this.options.appendRunEvents(run, [{ type: 'thread.started', thread_id: threadId }]),
      );
      const response = await session.connection.call('turn/start', {
        threadId,
        input: promptInput(message.codexAppServer),
        clientUserMessageId: message.id,
        ...(message.codexAppServer.model ? { model: message.codexAppServer.model } : {}),
        ...(message.codexAppServer.effort ? { effort: message.codexAppServer.effort } : {}),
        ...(message.codexAppServer.approvalPolicy
          ? { approvalPolicy: message.codexAppServer.approvalPolicy }
          : {}),
        ...(message.codexAppServer.approvalsReviewer
          ? { approvalsReviewer: message.codexAppServer.approvalsReviewer }
          : {}),
      });
      const turnId = String(response?.turn?.id ?? session.activeTurnId ?? '').trim();
      if (!turnId) throw new Error('Codex App Server did not return a turn id');
      session.activeTurnId = turnId;
      run = { ...run, threadId, turnId, updatedAt: this.now() };
      await this.options.mutate(async () => {
        await this.options.saveRun(run);
        const current = await this.options.loadMessage(message.id);
        if (!current) return;
        await this.options.saveMessage({
          ...current,
          updatedAt: this.now(),
          codexAppServer: { ...current.codexAppServer, runId: run.id, threadId, turnId },
        });
      });
      session.activeRun = run;
      session.startingRun = null;
      if (session.cancelRequestedMessageIds.delete(message.id)) {
        await session.connection
          .call('turn/interrupt', { threadId, turnId })
          .catch(() => undefined);
      }
    } catch (error) {
      session.startingRun = null;
      session.cancelRequestedMessageIds.delete(message.id);
      await this.failRunAndMessages(run, asError(error));
      await this.startNextRun(session);
    }
  }

  private async steerActiveRun(session: CodexRunSession, messageId: string): Promise<boolean> {
    const run = session.activeRun;
    if (!run || !session.activeTurnId || !session.threadId) return false;
    const message = await this.options.loadMessage(messageId);
    if (!message) return false;
    try {
      await session.connection.call('turn/steer', {
        threadId: session.threadId,
        expectedTurnId: session.activeTurnId,
        input: promptInput(message.codexAppServer),
        clientUserMessageId: message.id,
      });
    } catch {
      return false;
    }
    const updatedAt = this.now();
    const updatedRun: CodexPromptRun = {
      ...run,
      messageIds: [...run.messageIds, message.id],
      responseMessageId: message.id,
      updatedAt,
    };
    await this.options.mutate(async () => {
      await this.options.saveRun(updatedRun);
      await this.options.saveMessage({
        ...message,
        state: 'running',
        startedAt: updatedAt,
        updatedAt,
        codexAppServer: {
          ...message.codexAppServer,
          runId: run.id,
          threadId: session.threadId!,
          turnId: session.activeTurnId!,
        },
      });
    });
    session.activeRun = updatedRun;
    return true;
  }

  private async completeTurn(
    session: CodexRunSession,
    notification: CodexAppServerNotification,
  ): Promise<void> {
    const run = session.activeRun;
    if (!run) return;
    const turn = notification.params?.turn ?? {};
    const notificationTurnId = String(turn?.id ?? '').trim();
    if (session.activeTurnId && notificationTurnId && notificationTurnId !== session.activeTurnId) {
      return;
    }
    const status = String(turn?.status ?? 'completed');
    const finishedAt = this.now();
    const runState = terminalState(status);
    const completedRun: CodexPromptRun = {
      ...run,
      state: runState,
      finishedAt,
      updatedAt: finishedAt,
      threadId: session.threadId ?? run.threadId,
      turnId: notificationTurnId || session.activeTurnId || run.turnId,
      ...(runState === 'failed' ? { error: errorMessage(turn?.error ?? 'Codex turn failed') } : {}),
    };
    await this.options.mutate(async () => {
      await this.options.saveRun(completedRun);
      for (const id of completedRun.messageIds) {
        const message = await this.options.loadMessage(id);
        if (!message) continue;
        const isResponseMessage = id === completedRun.responseMessageId;
        const state =
          message.state === 'canceled' ? 'canceled' : isResponseMessage ? runState : 'done';
        await this.options.saveMessage({
          ...message,
          state,
          finishedAt,
          updatedAt: finishedAt,
          exitCode: state === 'done' ? 0 : 1,
          ...(state === 'failed' ? { error: completedRun.error } : {}),
          codexAppServer: {
            ...message.codexAppServer,
            runId: completedRun.id,
            threadId: completedRun.threadId,
            turnId: completedRun.turnId,
          },
        });
      }
    });
    session.activeRun = null;
    session.activeTurnId = null;
    session.lastUsedAt = Date.now();
    await this.startNextRun(session);
  }

  private async startNextRun(session: CodexRunSession): Promise<void> {
    const nextId = session.queuedMessageIds.shift();
    if (nextId) await this.startRun(session, nextId);
  }

  private async markMessageCanceled(message: TMessage): Promise<TMessage> {
    const finishedAt = this.now();
    const canceled = {
      ...message,
      state: 'canceled' as const,
      finishedAt,
      updatedAt: finishedAt,
      error: 'stopped by user',
    };
    await this.options.mutate(() => this.options.saveMessage(canceled));
    return canceled;
  }

  private async failSession(session: CodexRunSession, error: Error): Promise<void> {
    const runs = [session.activeRun, session.startingRun].filter((run): run is CodexPromptRun =>
      Boolean(run),
    );
    for (const run of runs) await this.failRunAndMessages(run, error);
    const finishedAt = this.now();
    await this.options.mutate(async () => {
      for (const id of session.queuedMessageIds) {
        const message = await this.options.loadMessage(id);
        if (!message || isTerminal(message.state)) continue;
        await this.options.saveMessage({
          ...message,
          state: 'failed',
          finishedAt,
          updatedAt: finishedAt,
          exitCode: 1,
          error: error.message,
        });
      }
    });
    session.activeRun = null;
    session.startingRun = null;
    session.queuedMessageIds = [];
    session.activeTurnId = null;
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
  }

  private async failRunAndMessages(
    run: CodexPromptRun,
    error: Error,
    alreadyMutating = false,
  ): Promise<void> {
    const finishedAt = this.now();
    const failedRun: CodexPromptRun = {
      ...run,
      state: 'failed',
      finishedAt,
      updatedAt: finishedAt,
      error: error.message,
    };
    const save = async () => {
      await this.options.saveRun(failedRun);
      for (const id of run.messageIds) {
        const message = await this.options.loadMessage(id);
        if (!message || isTerminal(message.state)) continue;
        await this.options.saveMessage({
          ...message,
          state: 'failed',
          finishedAt,
          updatedAt: finishedAt,
          exitCode: 1,
          error: error.message,
        });
      }
    };
    await (alreadyMutating ? save() : this.options.mutate(save));
  }
}

export function codexPromptRunSummary(run: CodexPromptRun): CodexPromptRunSummary {
  return {
    id: run.id,
    state: run.state,
    messageIds: run.messageIds,
    responseMessageId: run.responseMessageId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.threadId ? { threadId: run.threadId } : {}),
    ...(run.turnId ? { turnId: run.turnId } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function promptInput(spec: CodexPromptSpec) {
  return [
    { type: 'text', text: spec.prompt },
    ...(spec.imagePaths ?? []).map((imagePath) => ({ type: 'localImage', path: imagePath })),
  ];
}

function terminalState(status: string): CodexPromptState {
  if (status === 'completed') return 'done';
  if (status === 'interrupted') return 'canceled';
  return 'failed';
}

function isTerminal(state: CodexPromptState): boolean {
  return state === 'done' || state === 'failed' || state === 'canceled';
}

function errorMessage(raw: unknown): string {
  if (typeof (raw as { message?: unknown })?.message === 'string') {
    const message = String((raw as { message: string }).message).trim();
    if (message) return message;
  }
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw ?? 'failed');
  }
}

function asError(raw: unknown): Error {
  return raw instanceof Error ? raw : new Error(errorMessage(raw));
}

function isMissingThreadError(raw: unknown): boolean {
  return /(?:thread|rollout).*(?:not found|does not exist|missing|unknown)|(?:not found|missing).*(?:thread|rollout)/i.test(
    errorMessage(raw),
  );
}
