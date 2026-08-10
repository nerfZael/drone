import crypto from 'node:crypto';

import type { CodexApprovalDecision, CodexPendingApproval } from '@drone/assistant-chat';

import {
  CODEX_APP_SERVER_REQUEST_RESOLVED,
  CodexAppServerConnection,
  translateCodexAppServerNotification,
  type CodexAppServerNotification,
  type CodexAppServerRequest,
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
  pendingApprovals?: CodexPendingApproval[];
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
  | 'pendingApprovals'
  | 'error'
>;

type PendingApprovalCallback = {
  approval: CodexPendingApproval;
  requestId: number | string;
  resolve: (response: any) => void;
};

type ApprovalResolution = {
  decision: CodexApprovalDecision;
  resolvedAt: string;
};

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
  activeItems: Map<string, any>;
  pendingApprovalCallbacks: Map<string, PendingApprovalCallback>;
  approvalResolutions: Map<string, ApprovalResolution>;
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
    if (isTerminal(message.state)) return message;
    const spec = message.codexAppServer;
    const session = this.sessions.get(spec.sessionKey);
    if (!session) {
      return await this.markMessageCanceled(message);
    }

    // A turn/start request can take long enough that waiting behind the session
    // operation would make cancellation appear unresponsive. Record the request
    // immediately; startRun will interrupt the exact turn once it has an id.
    if (session.startingRun?.messageIds.includes(message.id)) {
      session.cancelRequestedMessageIds.add(message.id);
      return await this.markMessageCanceled(message);
    }

    return await this.serialize(session, async () => {
      const current = (await this.options.loadMessage(message.id)) ?? message;
      if (isTerminal(current.state)) return current;

      if (session.queuedMessageIds.includes(message.id)) {
        session.queuedMessageIds = session.queuedMessageIds.filter((id) => id !== message.id);
        return await this.markMessageCanceled(current);
      }

      if (session.startingRun?.messageIds.includes(message.id)) {
        session.cancelRequestedMessageIds.add(message.id);
        return await this.markMessageCanceled(current);
      }

      if (
        !session.activeRun?.messageIds.includes(message.id) ||
        !session.activeTurnId ||
        !session.threadId
      ) {
        return current;
      }

      // Re-checking the target inside the serialized operation prevents a late
      // cancel from interrupting the next queued turn after this one completes.
      const threadId = session.threadId;
      const turnId = session.activeTurnId;
      try {
        await session.connection.call('turn/interrupt', { threadId, turnId });
      } catch {
        return (await this.options.loadMessage(message.id)) ?? current;
      }
      const latest = (await this.options.loadMessage(message.id)) ?? current;
      return isTerminal(latest.state) ? latest : await this.markMessageCanceled(latest);
    });
  }

  async runForMessage(message: TMessage): Promise<CodexPromptRun | null> {
    const runId = String(message.codexAppServer.runId ?? '').trim();
    return runId ? await this.options.loadRun(runId) : null;
  }

  async resolveApproval(
    message: TMessage,
    approvalId: string,
    decision: CodexApprovalDecision,
  ): Promise<CodexPendingApproval> {
    const session = this.sessions.get(message.codexAppServer.sessionKey);
    if (!session) throw new Error('Codex approval is no longer active');
    const normalizedApprovalId = String(approvalId ?? '').trim();
    if (!normalizedApprovalId) throw new Error('missing Codex approval id');

    return await this.serialize(session, async () => {
      const pending = session.pendingApprovalCallbacks.get(normalizedApprovalId);
      if (!pending) throw new Error(`unknown Codex approval: ${normalizedApprovalId}`);
      const run = session.activeRun ?? session.startingRun;
      const runId = String(message.codexAppServer.runId ?? '').trim();
      if (!run || (runId && run.id !== runId)) {
        throw new Error('Codex approval does not belong to this prompt');
      }
      if (!pending.approval.availableDecisions.includes(decision)) {
        throw new Error(`Codex approval does not allow decision: ${decision}`);
      }

      session.pendingApprovalCallbacks.delete(normalizedApprovalId);
      session.approvalResolutions.set(pending.approval.itemId, {
        decision,
        resolvedAt: this.now(),
      });
      await this.persistPendingApprovals(session);
      pending.resolve(codexApprovalResponse(pending.approval.method, pending.approval, decision));
      return pending.approval;
    });
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
      if (isTerminal(run.state)) {
        const terminalRun =
          run.pendingApprovals && run.pendingApprovals.length > 0
            ? { ...run, pendingApprovals: [], updatedAt: this.now() }
            : run;
        const save = async () => {
          if (terminalRun !== run) await this.options.saveRun(terminalRun);
          await this.saveTerminalRunMessages(terminalRun);
        };
        await (alreadyMutating ? save() : this.options.mutate(save));
        return;
      }
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
    for (const session of this.sessions.values()) {
      for (const pending of session.pendingApprovalCallbacks.values()) {
        pending.resolve(codexApprovalResponse(pending.approval.method, pending.approval, 'cancel'));
      }
      session.pendingApprovalCallbacks.clear();
      session.connection.stop();
    }
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
      onRequest: (request) => this.handleServerRequest(session, request),
      onNotification: (notification) => this.handleNotification(session, notification),
      onStderr: async (text) => {
        const run = session.activeRun ?? session.startingRun;
        if (run) await this.options.appendRunStderr(run, text);
      },
      onExit: (error) => {
        if (!this.shuttingDown && this.sessions.get(session.key) === session) {
          return this.serialize(session, () => this.failSession(session, error));
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
      activeItems: new Map(),
      pendingApprovalCallbacks: new Map(),
      approvalResolutions: new Map(),
      lastUsedAt: Date.now(),
      operationTail: Promise.resolve(),
    };
    this.sessions.set(session.key, session);
    return session;
  }

  private async handleServerRequest(
    session: CodexRunSession,
    request: CodexAppServerRequest,
  ): Promise<any> {
    if (request.method === 'currentTime/read') {
      return { currentTimeAt: Math.floor(Date.now() / 1_000) };
    }
    if (!isApprovalRequestMethod(request.method)) {
      throw new Error(`unsupported Codex App Server request: ${request.method}`);
    }
    const method = request.method;

    let resolveResponse!: (response: any) => void;
    const response = new Promise<any>((resolve) => {
      resolveResponse = resolve;
    });
    await this.serialize(session, async () => {
      const run = session.activeRun ?? session.startingRun;
      if (!run) throw new Error('Codex approval arrived without an active prompt');
      const params = request.params ?? {};
      const itemId = String(
        params.itemId ?? params.callId ?? params.approvalId ?? request.id,
      ).trim();
      const startedAtMs = Number(params.startedAtMs);
      const approval: CodexPendingApproval = {
        id: crypto.randomUUID(),
        promptId: run.responseMessageId,
        method,
        kind: approvalKind(method),
        threadId: String(params.threadId ?? params.conversationId ?? session.threadId ?? '').trim(),
        turnId: String(params.turnId ?? session.activeTurnId ?? '').trim(),
        itemId,
        ...(String(params.reason ?? '').trim() ? { reason: String(params.reason).trim() } : {}),
        ...(approvalCommand(params) ? { command: approvalCommand(params) } : {}),
        ...(String(params.cwd ?? '').trim() ? { cwd: String(params.cwd).trim() } : {}),
        ...(String(params.grantRoot ?? '').trim()
          ? { grantRoot: String(params.grantRoot).trim() }
          : {}),
        ...(params.permissions && typeof params.permissions === 'object'
          ? { permissions: params.permissions }
          : params.additionalPermissions && typeof params.additionalPermissions === 'object'
            ? { permissions: params.additionalPermissions }
            : {}),
        ...(session.activeItems.get(itemId)
          ? { item: session.activeItems.get(itemId) }
          : method === 'applyPatchApproval' && params.fileChanges
            ? { item: { id: itemId, type: 'fileChange', changes: params.fileChanges } }
            : {}),
        availableDecisions: approvalDecisions(method, params.availableDecisions),
        createdAt: Number.isFinite(startedAtMs) && startedAtMs >= 0 && startedAtMs <= 8.64e15
          ? new Date(startedAtMs).toISOString()
          : this.now(),
        status: 'pending',
      };
      session.pendingApprovalCallbacks.set(approval.id, {
        approval,
        requestId: request.id,
        resolve: resolveResponse,
      });
      await this.persistPendingApprovals(session);
    });
    return await response;
  }

  private async persistPendingApprovals(session: CodexRunSession): Promise<void> {
    const run = session.activeRun ?? session.startingRun;
    if (!run) return;
    const updatedAt = this.now();
    const updated: CodexPromptRun = {
      ...run,
      updatedAt,
      pendingApprovals: Array.from(session.pendingApprovalCallbacks.values()).map(
        ({ approval }) => approval,
      ),
    };
    await this.options.mutate(async () => {
      await this.options.saveRun(updated);
      const responseMessage = await this.options.loadMessage(updated.responseMessageId);
      if (responseMessage) {
        await this.options.saveMessage({ ...responseMessage, updatedAt });
      }
    });
    if (session.activeRun?.id === updated.id) session.activeRun = updated;
    if (session.startingRun?.id === updated.id) session.startingRun = updated;
  }

  private async clearPendingApprovals(
    session: CodexRunSession,
    matches: (pending: PendingApprovalCallback) => boolean,
    respond = true,
  ): Promise<void> {
    const cleared: PendingApprovalCallback[] = [];
    for (const [id, pending] of session.pendingApprovalCallbacks) {
      if (!matches(pending)) continue;
      session.pendingApprovalCallbacks.delete(id);
      cleared.push(pending);
    }
    if (cleared.length === 0) return;
    await this.persistPendingApprovals(session);
    for (const pending of cleared) {
      pending.resolve(
        respond
          ? codexApprovalResponse(pending.approval.method, pending.approval, 'cancel')
          : CODEX_APP_SERVER_REQUEST_RESOLVED,
      );
    }
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
      const itemId = String(notification.params?.item?.id ?? '').trim();
      let translatedNotification = notification;
      if (notification.method === 'item/started' && itemId) {
        session.activeItems.set(itemId, notification.params.item);
      } else if (notification.method === 'item/completed' && itemId) {
        session.activeItems.delete(itemId);
        const resolution = session.approvalResolutions.get(itemId);
        const item = notification.params?.item;
        if (item && typeof item === 'object') {
          const itemStatus = String(item.status ?? '');
          const denied = itemStatus === 'declined' || resolution?.decision === 'decline';
          const canceled = itemStatus === 'canceled' || resolution?.decision === 'cancel';
          if (denied || canceled || resolution) {
            translatedNotification = {
              ...notification,
              params: {
                ...notification.params,
                item: {
                  ...item,
                  ...(resolution ? { approval_decision: resolution.decision } : {}),
                  ...(denied || canceled
                    ? {
                        denial: {
                          code:
                            resolution?.decision === 'cancel'
                              ? 'canceled_by_user'
                              : resolution
                                ? 'declined_by_user'
                                : 'policy_denied',
                          ...(resolution ? { resolved_at: resolution.resolvedAt } : {}),
                        },
                      }
                    : {}),
                },
              },
            };
          }
        }
        session.approvalResolutions.delete(itemId);
      }
      if (notification.method === 'serverRequest/resolved') {
        const requestId = notification.params?.requestId;
        await this.clearPendingApprovals(
          session,
          (pending) =>
            requestId != null && String(pending.requestId) === String(requestId),
          false,
        );
      }
      const currentRun = session.activeRun ?? session.startingRun;
      const events = translateCodexAppServerNotification(translatedNotification);
      if (currentRun && events.length > 0) {
        const updated = await this.options.mutate(() =>
          this.options.appendRunEvents(currentRun, events),
        );
        if (session.activeRun?.id === updated.id) session.activeRun = updated;
        if (session.startingRun?.id === updated.id) session.startingRun = updated;
      }
      if (notification.method === 'turn/completed') {
        await this.clearPendingApprovals(
          session,
          (pending) => !turnId || pending.approval.turnId === turnId,
        );
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
    if (!message || message.state !== 'queued') {
      await this.startNextRun(session);
      return;
    }
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
    const previousResponseMessageId = run.responseMessageId;
    const updatedRun: CodexPromptRun = {
      ...run,
      messageIds: [...run.messageIds, message.id],
      responseMessageId: message.id,
      updatedAt,
    };
    await this.options.mutate(async () => {
      await this.options.saveRun(updatedRun);
      if (previousResponseMessageId !== message.id) {
        const previousResponse = await this.options.loadMessage(previousResponseMessageId);
        if (previousResponse) {
          await this.options.saveMessage({ ...previousResponse, updatedAt });
        }
      }
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
      await this.saveTerminalRunMessages(completedRun);
    });
    session.activeRun = null;
    session.activeTurnId = null;
    session.approvalResolutions.clear();
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

  private async saveTerminalRunMessages(run: CodexPromptRun): Promise<void> {
    const finishedAt = run.finishedAt ?? this.now();
    for (const id of run.messageIds) {
      const message = await this.options.loadMessage(id);
      if (!message) continue;
      const isResponseMessage = id === run.responseMessageId;
      const state =
        message.state === 'canceled' ? 'canceled' : isResponseMessage ? run.state : 'done';
      await this.options.saveMessage({
        ...message,
        state,
        finishedAt,
        updatedAt: finishedAt,
        exitCode: state === 'done' ? 0 : 1,
        error: state === 'failed' ? run.error : state === 'canceled' ? message.error : undefined,
        codexAppServer: {
          ...message.codexAppServer,
          runId: run.id,
          threadId: run.threadId,
          turnId: run.turnId,
        },
      });
    }
  }

  private async failSession(session: CodexRunSession, error: Error): Promise<void> {
    await this.clearPendingApprovals(session, () => true);
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
      pendingApprovals: [],
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
    ...(run.pendingApprovals ? { pendingApprovals: run.pendingApprovals } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

const APPROVAL_REQUEST_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'execCommandApproval',
  'applyPatchApproval',
] as const;

export type ApprovalRequestMethod = (typeof APPROVAL_REQUEST_METHODS)[number];

function isApprovalRequestMethod(method: string): method is ApprovalRequestMethod {
  return (APPROVAL_REQUEST_METHODS as readonly string[]).includes(method);
}

function approvalKind(method: ApprovalRequestMethod): CodexPendingApproval['kind'] {
  if (method === 'item/permissions/requestApproval') return 'permissions';
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    return 'file_change';
  }
  return 'command_execution';
}

function approvalCommand(params: any): string {
  if (typeof params?.command === 'string') return params.command.trim();
  if (Array.isArray(params?.command)) return params.command.map(String).join(' ').trim();
  return '';
}

function approvalDecisions(
  method: ApprovalRequestMethod,
  raw: unknown,
): CodexApprovalDecision[] {
  const allowed = new Set<CodexApprovalDecision>();
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (
        value === 'accept' ||
        value === 'acceptForSession' ||
        value === 'decline' ||
        value === 'cancel'
      ) {
        allowed.add(value);
      }
    }
  }
  if (allowed.size > 0) return [...allowed];
  if (method === 'item/permissions/requestApproval') {
    return ['accept', 'acceptForSession', 'decline', 'cancel'];
  }
  return ['accept', 'acceptForSession', 'decline', 'cancel'];
}

function grantedPermissions(raw: unknown): any {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const permissions = raw as any;
  return {
    ...(permissions.network ? { network: permissions.network } : {}),
    ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
  };
}

export function codexApprovalResponse(
  method: ApprovalRequestMethod,
  approval: Pick<CodexPendingApproval, 'permissions'>,
  decision: CodexApprovalDecision,
): any {
  if (method === 'item/permissions/requestApproval') {
    const accepted = decision === 'accept' || decision === 'acceptForSession';
    return {
      permissions: accepted ? grantedPermissions(approval.permissions) : {},
      scope: decision === 'acceptForSession' ? 'session' : 'turn',
    };
  }
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  ) {
    return { decision };
  }
  const legacyDecision =
    decision === 'accept'
      ? 'approved'
      : decision === 'acceptForSession'
        ? 'approved_for_session'
        : decision === 'cancel'
          ? 'abort'
          : { denied: { rejection: 'Declined by user.' } };
  return { decision: legacyDecision };
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
