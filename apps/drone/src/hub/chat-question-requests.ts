import crypto from 'node:crypto';

import type {
  ChatQuestion,
  ChatQuestionRequest,
  ChatQuestionRequestResult,
  ChatQuestionResponse,
} from '@drone/assistant-chat';

import {
  applyHubDatabaseMigrations,
  getHubDatabase,
  type HubDatabase,
  type HubDatabaseConnection,
  type HubDatabaseMigration,
} from '../host/hub-database';
import { subscribePromptQueued } from '../host/prompt-queue-repository';

const MAX_QUESTIONS = 99;
const MAX_CHOICES = 12;
const MAX_REQUEST_BYTES = 64 * 1024;

const MIGRATIONS: readonly HubDatabaseMigration[] = [
  {
    version: 1,
    name: 'durable chat question requests',
    migrate(connection) {
      connection.exec(`
        CREATE TABLE chat_question_requests (
          id TEXT NOT NULL PRIMARY KEY,
          drone_id TEXT NOT NULL,
          chat_name TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          native_thread_id TEXT,
          tool_call_id TEXT,
          tool_name TEXT NOT NULL,
          questions_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'skipped')),
          result_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX idx_chat_question_requests_native_call
          ON chat_question_requests (native_thread_id, tool_call_id)
          WHERE native_thread_id IS NOT NULL AND tool_call_id IS NOT NULL;

        CREATE UNIQUE INDEX idx_chat_question_requests_one_pending
          ON chat_question_requests (drone_id, chat_name)
          WHERE status = 'pending';

        CREATE INDEX idx_chat_question_requests_chat_updated
          ON chat_question_requests (drone_id, chat_name, updated_at DESC);
      `);
    },
  },
];

type Row = {
  id: string;
  drone_id: string;
  chat_name: string;
  chat_id: string;
  native_thread_id: string | null;
  tool_call_id: string | null;
  tool_name: string;
  questions_json: string;
  status: ChatQuestionRequest['status'];
  result_json: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateChatQuestionRequestInput = {
  droneId: string;
  chatName: string;
  chatId: string;
  nativeThreadId?: string;
  toolCallId?: string;
  toolName?: string;
  questions: unknown;
};

export type ResolveChatQuestionRequestInput = {
  responses: unknown;
  notes?: unknown;
};

export type NativeQuestionResultResolver = (
  request: ChatQuestionRequest,
  result: ChatQuestionRequestResult,
) => Promise<void>;

export type ChatQuestionRequestResolvedListener = (event: {
  request: ChatQuestionRequest;
  result: ChatQuestionRequestResult;
}) => void;

function text(value: unknown, max: number, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > max) throw new Error(`${label} is too long (max ${max} characters)`);
  return normalized;
}

function optionalText(value: unknown, max: number, label: string): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  if (normalized.length > max) throw new Error(`${label} is too long (max ${max} characters)`);
  return normalized;
}

export function normalizeChatQuestions(raw: unknown): ChatQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('questions must not be empty');
  if (raw.length > MAX_QUESTIONS)
    throw new Error(`questions exceeds the maximum of ${MAX_QUESTIONS}`);
  const questionIds = new Set<string>();
  const questions = raw.map((item: any, questionIndex) => {
    const id = text(item?.id, 120, `questions[${questionIndex}].id`);
    if (questionIds.has(id)) throw new Error(`duplicate question id: ${id}`);
    questionIds.add(id);
    const choicesRaw = item?.choices;
    if (!Array.isArray(choicesRaw) || choicesRaw.length < 2) {
      throw new Error(`questions[${questionIndex}].choices must contain at least two choices`);
    }
    if (choicesRaw.length > MAX_CHOICES) {
      throw new Error(`questions[${questionIndex}].choices exceeds the maximum of ${MAX_CHOICES}`);
    }
    const choiceIds = new Set<string>();
    let recommendedCount = 0;
    const choices = choicesRaw.map((choice: any, choiceIndex: number) => {
      const choiceId = text(
        choice?.id,
        120,
        `questions[${questionIndex}].choices[${choiceIndex}].id`,
      );
      if (choiceIds.has(choiceId)) throw new Error(`duplicate choice id in ${id}: ${choiceId}`);
      choiceIds.add(choiceId);
      const recommended = choice?.recommended === true;
      if (recommended) recommendedCount += 1;
      return {
        id: choiceId,
        label: text(
          choice?.label,
          240,
          `questions[${questionIndex}].choices[${choiceIndex}].label`,
        ),
        ...(optionalText(
          choice?.description,
          1_000,
          `questions[${questionIndex}].choices[${choiceIndex}].description`,
        )
          ? {
              description: optionalText(
                choice.description,
                1_000,
                `questions[${questionIndex}].choices[${choiceIndex}].description`,
              ),
            }
          : {}),
        ...(recommended ? { recommended: true } : {}),
      };
    });
    if (recommendedCount > 1)
      throw new Error(`question ${id} has more than one recommended choice`);
    const importanceRaw = item?.importance == null ? 50 : Number(item.importance);
    if (!Number.isInteger(importanceRaw) || importanceRaw < 1 || importanceRaw > 100) {
      throw new Error(`questions[${questionIndex}].importance must be an integer from 1 to 100`);
    }
    const detailedExplanation = optionalText(
      item?.detailedExplanation,
      4_000,
      `questions[${questionIndex}].detailedExplanation`,
    );
    return {
      id,
      question: text(item?.question, 1_000, `questions[${questionIndex}].question`),
      ...(detailedExplanation ? { detailedExplanation } : {}),
      importance: importanceRaw,
      choices,
    };
  });
  if (Buffer.byteLength(JSON.stringify(questions)) > MAX_REQUEST_BYTES) {
    throw new Error(`question request is too large (max ${MAX_REQUEST_BYTES} bytes)`);
  }
  return questions;
}

function requestFromRow(row: Row): ChatQuestionRequest {
  const result = row.result_json
    ? (JSON.parse(row.result_json) as ChatQuestionRequestResult)
    : undefined;
  return {
    id: row.id,
    droneId: row.drone_id,
    chatName: row.chat_name,
    chatId: row.chat_id,
    ...(row.native_thread_id ? { nativeThreadId: row.native_thread_id } : {}),
    ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
    toolName: row.tool_name,
    questions: JSON.parse(row.questions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    ...(result ? { result } : {}),
  };
}

function normalizeResponses(request: ChatQuestionRequest, raw: unknown): ChatQuestionResponse[] {
  if (!Array.isArray(raw)) throw new Error('responses must be an array');
  const questions = new Map(request.questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  const responses = raw.map((item: any, index) => {
    const questionId = text(item?.questionId, 120, `responses[${index}].questionId`);
    const question = questions.get(questionId);
    if (!question) throw new Error(`unknown question id: ${questionId}`);
    if (seen.has(questionId)) throw new Error(`duplicate response for question: ${questionId}`);
    seen.add(questionId);
    if (item?.outcome === 'skipped') return { questionId, outcome: 'skipped' as const };
    if (item?.outcome === 'custom') {
      return {
        questionId,
        outcome: 'custom' as const,
        text: text(item?.text, 4_000, `responses[${index}].text`),
      };
    }
    if (item?.outcome === 'choice') {
      const choiceId = text(item?.choiceId, 120, `responses[${index}].choiceId`);
      const choice = question.choices.find((candidate) => candidate.id === choiceId);
      if (!choice) throw new Error(`unknown choice ${choiceId} for question ${questionId}`);
      return { questionId, outcome: 'choice' as const, choiceId, label: choice.label };
    }
    throw new Error(`responses[${index}].outcome must be choice, custom, or skipped`);
  });
  const missing = request.questions.filter((question) => !seen.has(question.id));
  if (missing.length > 0) {
    throw new Error(`missing responses for: ${missing.map((question) => question.id).join(', ')}`);
  }
  return responses;
}

export class ChatQuestionRequestService {
  private readonly memory = new Map<string, ChatQuestionRequest>();
  private readonly waiters = new Map<string, Set<(result: ChatQuestionRequestResult) => void>>();
  private readonly finishing = new Map<string, Promise<ChatQuestionRequestResult>>();
  private readonly resolvedListeners = new Set<ChatQuestionRequestResolvedListener>();
  private nativeResolver: NativeQuestionResultResolver | null = null;
  private readonly unsubscribePromptQueued: () => void;

  constructor(private readonly database: HubDatabase | null = getHubDatabase()) {
    if (database) {
      database.read((connection) =>
        applyHubDatabaseMigrations(connection, MIGRATIONS, 'chat-question-requests'),
      );
    }
    this.unsubscribePromptQueued = subscribePromptQueued(async ({ droneId, chatName }) => {
      try {
        await this.skipPendingForChat(droneId, chatName, 'queued_message_pending');
      } catch {
        // A native suspension can briefly be unavailable while its runtime is being restored.
        // Retry once outside the queue transaction; setNativeResolver also reconciles at startup.
        queueMicrotask(() => {
          void this.skipPendingForChat(droneId, chatName, 'queued_message_pending').catch(() => {});
        });
      }
    });
  }

  close(): void {
    this.unsubscribePromptQueued();
    this.resolvedListeners.clear();
  }

  setNativeResolver(resolver: NativeQuestionResultResolver): void {
    this.nativeResolver = resolver;
  }

  subscribeResolved(listener: ChatQuestionRequestResolvedListener): () => void {
    this.resolvedListeners.add(listener);
    return () => this.resolvedListeners.delete(listener);
  }

  async create(input: CreateChatQuestionRequestInput): Promise<ChatQuestionRequest> {
    const droneId = text(input.droneId, 200, 'droneId');
    const chatName = text(input.chatName, 200, 'chatName');
    const chatId = text(input.chatId, 200, 'chatId');
    const nativeThreadId = optionalText(input.nativeThreadId, 200, 'nativeThreadId');
    const toolCallId = optionalText(input.toolCallId, 240, 'toolCallId');
    const toolName = optionalText(input.toolName, 160, 'toolName') ?? 'ask_questions';
    const questions = normalizeChatQuestions(input.questions);
    const now = new Date().toISOString();
    const id = `questions_${crypto.randomUUID()}`;

    if (!this.database) {
      const existing = [...this.memory.values()].find((request) =>
        nativeThreadId && toolCallId
          ? request.nativeThreadId === nativeThreadId && request.toolCallId === toolCallId
          : request.droneId === droneId &&
            request.chatName === chatName &&
            request.status === 'pending',
      );
      if (existing) return existing;
      const request: ChatQuestionRequest = {
        id,
        droneId,
        chatName,
        chatId,
        ...(nativeThreadId ? { nativeThreadId } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        toolName,
        questions,
        createdAt: now,
        updatedAt: now,
        status: 'pending',
      };
      this.memory.set(id, request);
      return request;
    }

    return await this.database.writeTransaction('create chat question request', (connection) => {
      const existing = this.findExisting(connection, {
        droneId,
        chatName,
        nativeThreadId,
        toolCallId,
      });
      if (existing) return existing;
      const promptQueueExists = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prompts'")
        .get();
      const queued = promptQueueExists
        ? connection
            .prepare(
              `SELECT 1 FROM prompts
               WHERE drone_id = ? AND chat_name = ? AND state = 'queued'
               LIMIT 1`,
            )
            .get(droneId, chatName)
        : null;
      const status = queued ? 'skipped' : 'pending';
      const result: ChatQuestionRequestResult | undefined = queued
        ? { status: 'skipped', requestId: id, reason: 'queued_message_pending' }
        : undefined;
      connection
        .prepare(
          `INSERT INTO chat_question_requests (
             id, drone_id, chat_name, chat_id, native_thread_id, tool_call_id,
             tool_name, questions_json, status, result_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          droneId,
          chatName,
          chatId,
          nativeThreadId ?? null,
          toolCallId ?? null,
          toolName,
          JSON.stringify(questions),
          status,
          result ? JSON.stringify(result) : null,
          now,
          now,
        );
      return requestFromRow(
        connection.prepare('SELECT * FROM chat_question_requests WHERE id = ?').get(id) as Row,
      );
    });
  }

  async ask(
    input: CreateChatQuestionRequestInput,
    signal?: AbortSignal,
  ): Promise<ChatQuestionRequestResult> {
    const request = await this.create(input);
    if (request.result) return request.result;
    try {
      return await this.wait(request.id, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        // MCP cancellation means there is no longer a live caller to receive an answer.
        // Resolve the durable request as skipped so it cannot strand the chat UI.
        await this.skip(request.id, 'chat_stopped').catch(() => {});
      }
      throw error;
    }
  }

  listPending(droneId: string, chatName: string): ChatQuestionRequest[] {
    if (!this.database) {
      return [...this.memory.values()].filter(
        (request) =>
          request.droneId === droneId &&
          request.chatName === chatName &&
          request.status === 'pending',
      );
    }
    return this.database.read((connection) =>
      (
        connection
          .prepare(
            `SELECT * FROM chat_question_requests
             WHERE drone_id = ? AND chat_name = ? AND status = 'pending'
             ORDER BY created_at`,
          )
          .all(droneId, chatName) as Row[]
      ).map(requestFromRow),
    );
  }

  async submit(
    requestId: string,
    input: ResolveChatQuestionRequestInput,
  ): Promise<ChatQuestionRequestResult> {
    const request = this.get(requestId);
    if (!request) throw new Error(`unknown question request: ${requestId}`);
    if (request.result) return request.result;
    const result: ChatQuestionRequestResult = {
      status: 'submitted',
      requestId,
      responses: normalizeResponses(request, input.responses),
      ...(optionalText(input.notes, 8_000, 'notes')
        ? { notes: optionalText(input.notes, 8_000, 'notes') }
        : {}),
    };
    return await this.finish(request, result);
  }

  async skip(
    requestId: string,
    reason: Extract<ChatQuestionRequestResult, { status: 'skipped' }>['reason'],
    notes?: unknown,
  ): Promise<ChatQuestionRequestResult> {
    const request = this.get(requestId);
    if (!request) throw new Error(`unknown question request: ${requestId}`);
    if (request.result) return request.result;
    const normalizedNotes = optionalText(notes, 8_000, 'notes');
    return await this.finish(request, {
      status: 'skipped',
      requestId,
      reason,
      ...(normalizedNotes ? { notes: normalizedNotes } : {}),
    });
  }

  async skipPendingForChat(
    droneId: string,
    chatName: string,
    reason: Extract<ChatQuestionRequestResult, { status: 'skipped' }>['reason'],
  ): Promise<ChatQuestionRequestResult[]> {
    const results: ChatQuestionRequestResult[] = [];
    for (const request of this.listPending(droneId, chatName)) {
      results.push(await this.skip(request.id, reason));
    }
    return results;
  }

  async reconcileQueuedRequests(): Promise<void> {
    if (!this.database) return;
    const requests = this.database.read((connection) => {
      const promptQueueExists = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prompts'")
        .get();
      if (!promptQueueExists) return [];
      return (
        connection
          .prepare(
            `SELECT requests.* FROM chat_question_requests AS requests
             WHERE requests.status = 'pending'
               AND EXISTS (
                 SELECT 1 FROM prompts
                 WHERE prompts.drone_id = requests.drone_id
                   AND prompts.chat_name = requests.chat_name
                   AND prompts.state = 'queued'
               )
             ORDER BY requests.created_at`,
          )
          .all() as Row[]
      ).map(requestFromRow);
    });
    for (const request of requests) {
      await this.skip(request.id, 'queued_message_pending');
    }
  }

  get(requestId: string): ChatQuestionRequest | null {
    if (!this.database) return this.memory.get(requestId) ?? null;
    return this.database.read((connection) => {
      const row = connection
        .prepare('SELECT * FROM chat_question_requests WHERE id = ?')
        .get(requestId) as Row | undefined;
      return row ? requestFromRow(row) : null;
    });
  }

  async waitForResult(requestId: string, signal?: AbortSignal): Promise<ChatQuestionRequestResult> {
    return await this.wait(requestId, signal);
  }

  private findExisting(
    connection: HubDatabaseConnection,
    input: {
      droneId: string;
      chatName: string;
      nativeThreadId?: string;
      toolCallId?: string;
    },
  ): ChatQuestionRequest | null {
    const row =
      input.nativeThreadId && input.toolCallId
        ? (connection
            .prepare(
              `SELECT * FROM chat_question_requests
             WHERE native_thread_id = ? AND tool_call_id = ?`,
            )
            .get(input.nativeThreadId, input.toolCallId) as Row | undefined)
        : (connection
            .prepare(
              `SELECT * FROM chat_question_requests
             WHERE drone_id = ? AND chat_name = ? AND status = 'pending'
             ORDER BY created_at LIMIT 1`,
            )
            .get(input.droneId, input.chatName) as Row | undefined);
    return row ? requestFromRow(row) : null;
  }

  private async finish(
    request: ChatQuestionRequest,
    result: ChatQuestionRequestResult,
  ): Promise<ChatQuestionRequestResult> {
    const active = this.finishing.get(request.id);
    if (active) return await active;
    const operation = this.finishOnce(request, result);
    this.finishing.set(request.id, operation);
    try {
      return await operation;
    } finally {
      if (this.finishing.get(request.id) === operation) this.finishing.delete(request.id);
    }
  }

  private async finishOnce(
    request: ChatQuestionRequest,
    result: ChatQuestionRequestResult,
  ): Promise<ChatQuestionRequestResult> {
    if (request.nativeThreadId) {
      if (!this.nativeResolver) {
        throw new Error('native question resolver is unavailable');
      }
      await this.nativeResolver(request, result);
    }
    const now = new Date().toISOString();
    if (!this.database) {
      this.memory.set(request.id, {
        ...request,
        status: result.status === 'submitted' ? 'submitted' : 'skipped',
        result,
        updatedAt: now,
      });
    } else {
      await this.database.writeTransaction('resolve chat question request', (connection) => {
        connection
          .prepare(
            `UPDATE chat_question_requests
             SET status = ?, result_json = ?, updated_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(
            result.status === 'submitted' ? 'submitted' : 'skipped',
            JSON.stringify(result),
            now,
            request.id,
          );
      });
    }
    for (const resolve of this.waiters.get(request.id) ?? []) resolve(result);
    this.waiters.delete(request.id);
    const resolvedRequest = this.get(request.id) ?? {
      ...request,
      status: result.status === 'submitted' ? ('submitted' as const) : ('skipped' as const),
      result,
      updatedAt: now,
    };
    for (const listener of this.resolvedListeners) {
      try {
        listener({ request: resolvedRequest, result });
      } catch {
        // A stale UI notification listener must not make durable resolution fail.
      }
    }
    return result;
  }

  private async wait(requestId: string, signal?: AbortSignal): Promise<ChatQuestionRequestResult> {
    const current = this.get(requestId);
    if (!current) throw new Error(`unknown question request: ${requestId}`);
    if (current.result) return current.result;
    return await new Promise<ChatQuestionRequestResult>((resolve, reject) => {
      const listeners = this.waiters.get(requestId) ?? new Set();
      let settled = false;
      const cleanup = () => {
        listeners.delete(onResult);
        if (listeners.size === 0) this.waiters.delete(requestId);
        signal?.removeEventListener('abort', onAbort);
      };
      const onResult = (result: ChatQuestionRequestResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(Object.assign(new Error('question request was aborted'), { name: 'AbortError' }));
      };
      listeners.add(onResult);
      this.waiters.set(requestId, listeners);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      // Re-read after listener registration so a concurrent resolver cannot be missed.
      const registered = this.get(requestId);
      if (!registered) {
        cleanup();
        reject(new Error(`unknown question request: ${requestId}`));
      } else if (registered.result) {
        onResult(registered.result);
      }
    });
  }
}

let cached: ChatQuestionRequestService | null = null;

export function getChatQuestionRequestService(): ChatQuestionRequestService {
  if (!cached) cached = new ChatQuestionRequestService();
  return cached;
}

export function resetChatQuestionRequestServiceForTests(): void {
  cached?.close();
  cached = null;
}
