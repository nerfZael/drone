import {
  type AssistantApiKeyView,
  type AssistantApprovalRecord,
  type AssistantMessage,
  type AssistantQueuedPromptRecord,
  type AssistantRunRecord,
  type AssistantSettingsRecord,
  type AssistantThread,
  type AssistantThreadCapabilities,
  type AssistantToolCallRecord,
  type VoiceStreamNextDb,
} from './db.js';
import { refreshCodexAccessToken } from './codex-auth.js';
import { fetchContent, searchWeb } from './web-search.js';

export type AssistantProviderId = 'openai' | 'codex';

export type AssistantModelOption = {
  provider: AssistantProviderId;
  id: string;
  name: string;
  thinkingLevel: string;
};

export type AssistantToolSummary = {
  name: string;
  label: string;
  category: 'artifacts' | 'speech' | 'prompts' | 'settings' | 'web';
  description: string;
  approval: 'never' | 'normal_threads' | 'always';
};

export type AssistantSnapshot = {
  ok: true;
  userId: string;
  activeThreadId: string | null;
  threads: AssistantThreadView[];
  pendingApprovals: AssistantApprovalView[];
  models: AssistantModelOption[];
  availableTools: AssistantToolSummary[];
  assistantSettings: AssistantSettingsRecord;
  apiKeys: Record<'openai' | 'exa', AssistantApiKeyView>;
  codexConnection: { connected: boolean; accountId: string | null; expiresAt: string | null; updatedAt: string | null };
  runningModels: Record<string, { provider: string; model: string; thinkingLevel: string; runId: string }>;
};

export type AssistantThreadView = AssistantThread & {
  messages: AssistantMessage[];
  runs: AssistantRunRecord[];
  queuedPrompts: AssistantQueuedPromptRecord[];
  toolCalls: AssistantToolCallRecord[];
  artifactsCount: number;
};

export type AssistantApprovalView = AssistantApprovalRecord & {
  args: unknown;
};

type PromptEvent =
  | { type: 'snapshot'; snapshot: AssistantSnapshot }
  | { type: 'delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'message'; message: AssistantMessage }
  | { type: 'queued'; queuedPrompt: AssistantQueuedPromptRecord; snapshot: AssistantSnapshot }
  | { type: 'tool_call'; toolCall: AssistantToolCallRecord; modelCallId: string | null; args: unknown }
  | { type: 'tool_result'; toolCall: AssistantToolCallRecord; result: unknown }
  | { type: 'approval_pending'; approval: AssistantApprovalView; snapshot: AssistantSnapshot }
  | { type: 'done'; snapshot: AssistantSnapshot }
  | { type: 'error'; error: string; snapshot?: AssistantSnapshot };

const ASSISTANT_TOOLS: AssistantToolSummary[] = [
  {
    name: 'assistant_artifacts',
    label: 'Assistant artifacts',
    category: 'artifacts',
    description: 'Maintain thread-scoped notes and files.',
    approval: 'never',
  },
  {
    name: 'speak',
    label: 'Speak',
    category: 'speech',
    description: 'Send a short spoken reply to connected voice clients.',
    approval: 'normal_threads',
  },
  {
    name: 'get_system_prompt',
    label: 'Read system prompt',
    category: 'prompts',
    description: 'Read global and thread system prompt state.',
    approval: 'never',
  },
  {
    name: 'update_system_prompt',
    label: 'Update system prompt',
    category: 'prompts',
    description: 'Update the current thread system prompt.',
    approval: 'always',
  },
  {
    name: 'set_thinking_level',
    label: 'Set thinking level',
    category: 'settings',
    description: 'Change this thread reasoning level for future runs.',
    approval: 'never',
  },
  {
    name: 'web_search',
    label: 'Web search',
    category: 'web',
    description: 'Search the web for current information and source URLs.',
    approval: 'never',
  },
  {
    name: 'fetch_content',
    label: 'Fetch content',
    category: 'web',
    description: 'Fetch readable page content from a URL.',
    approval: 'never',
  },
];

const MODEL_OPTIONS: AssistantModelOption[] = [
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Instant', thinkingLevel: 'off' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Low', thinkingLevel: 'low' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 Medium', thinkingLevel: 'medium' },
  { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5 High', thinkingLevel: 'high' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Instant', thinkingLevel: 'off' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Low', thinkingLevel: 'low' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 Medium', thinkingLevel: 'medium' },
  { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5 High', thinkingLevel: 'high' },
  { provider: 'codex', id: 'gpt-5.3-codex-spark', name: 'Codex Spark', thinkingLevel: 'off' },
];

const ARTIFACT_MAX_BYTES = 256 * 1024;
const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const MODEL_TOOL_TEST_ENV = 'VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS';

type ModelToolCall = {
  id: string | null;
  callId: string | null;
  name: string;
  argumentsJson: string;
};

type ModelToolResult = {
  call: ModelToolCall;
  result: unknown;
  toolName: string;
};

type OpenAiStreamResult = {
  text: string;
  thinking: string;
  toolCalls: ModelToolCall[];
};

type CodexStreamResult = OpenAiStreamResult;
type ProviderTimingLogger = (phase: string, details?: Record<string, unknown>, level?: 'info' | 'warn' | 'error') => void;

export function assistantToolSummaries(): AssistantToolSummary[] {
  return ASSISTANT_TOOLS;
}

export function assistantModelOptions(): AssistantModelOption[] {
  return MODEL_OPTIONS;
}

export function sanitizeArtifactPath(raw: unknown): string {
  const value = String(raw ?? '').trim().replace(/\\/g, '/');
  if (!value) throw Object.assign(new Error('artifact path is required'), { statusCode: 400 });
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw Object.assign(new Error('artifact path contains invalid characters'), { statusCode: 400 });
  }
  const normalized = value.split('/').filter(Boolean).join('/');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw Object.assign(new Error('artifact path must stay inside the assistant thread'), { statusCode: 400 });
  }
  return normalized;
}

export function assistantSnapshot(db: VoiceStreamNextDb, userId: string, activeThreadId?: string | null): AssistantSnapshot {
  const threads = db.listThreads(userId);
  const activeThread = activeThreadId && threads.some((thread) => thread.id === activeThreadId)
    ? activeThreadId
    : threads[0]?.id ?? null;
  const runningModels: AssistantSnapshot['runningModels'] = {};
  const threadViews: AssistantThreadView[] = threads.map((thread) => {
    const runs = db.listRuns(userId, thread.id, 8);
    const activeRun = runs.find((run) => run.status === 'running' || run.status === 'waiting_for_approval');
    if (activeRun) {
      runningModels[thread.id] = {
        provider: activeRun.provider,
        model: activeRun.model,
        thinkingLevel: activeRun.thinkingLevel,
        runId: activeRun.id,
      };
    }
    return {
      ...thread,
      messages: db.listMessages(userId, thread.id),
      runs,
      queuedPrompts: db.listQueuedPrompts(userId, thread.id),
      toolCalls: db.listToolCalls(userId, thread.id),
      artifactsCount: db.listArtifacts(userId, thread.id).length,
    };
  });
  return {
    ok: true,
    userId,
    activeThreadId: activeThread,
    threads: threadViews,
    pendingApprovals: db.listApprovals(userId).filter((approval) => approval.status === 'pending').map(approvalView),
    models: MODEL_OPTIONS,
    availableTools: ASSISTANT_TOOLS,
    assistantSettings: db.ensureAssistantSettings(userId),
    apiKeys: db.assistantApiKeysView(userId),
    codexConnection: db.codexConnectionView(userId),
    runningModels,
  };
}

export async function promptAssistantThread(
  db: VoiceStreamNextDb,
  userId: string,
  threadId: string,
  input: { prompt: string; provider?: string; model?: string; thinkingLevel?: string },
  emit: (event: PromptEvent) => void,
  options: { drainQueue?: boolean } = {},
): Promise<AssistantSnapshot> {
  const thread = db.thread(userId, threadId);
  if (!thread) throw Object.assign(new Error('unknown assistant thread'), { statusCode: 404 });
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
  const activeRun = db.activeRun(userId, threadId);
  let provider = cleanProvider(input.provider ?? thread.provider);
  let model = cleanModel(input.model ?? thread.model, provider);
  const thinkingLevel = cleanThinkingLevel(input.thinkingLevel ?? thread.thinkingLevel);
  if (input.provider === undefined && provider === 'openai' && db.codexConnection(userId)) {
    provider = 'codex';
    model = cleanModel(input.model ?? 'gpt-5.5', provider);
    db.updateThread(userId, threadId, { provider, model, thinkingLevel, error: null });
  }
  if (activeRun) {
    if (thread.promptDeliveryMode !== 'asap') {
      const queuedPrompt = db.enqueuePrompt(userId, threadId, { prompt, provider, model, thinkingLevel });
      const snapshot = assistantSnapshot(db, userId, threadId);
      emit({ type: 'queued', queuedPrompt, snapshot });
      emit({ type: 'done', snapshot });
      return snapshot;
    }
  }
  const userMessage = db.addMessage(userId, threadId, { role: 'user', content: prompt });
  emit({ type: 'message', message: userMessage });
  const run = db.createRun(userId, threadId, { prompt, provider, model, thinkingLevel });
  emit({ type: 'snapshot', snapshot: assistantSnapshot(db, userId, threadId) });

  const command = parseAssistantCommand(prompt);
  if (command) {
    const result = await executeCommand(db, userId, threadId, run, thread, command, emit);
    if (options.drainQueue !== false) {
      await drainQueuedPrompts(db, userId, threadId, emit);
      return assistantSnapshot(db, userId, threadId);
    }
    return result;
  }

  try {
    await runModelDrivenTurn(db, userId, threadId, run, thread, { provider, model, thinkingLevel }, emit);
  } catch (error: any) {
    const message = error?.message ?? String(error);
    failRun(db, userId, threadId, run.id, message);
    const assistantMessage = db.addMessage(userId, threadId, {
      role: 'assistant',
      content: `Assistant run failed: ${message}`,
      isError: true,
    });
    emit({ type: 'message', message: assistantMessage });
    emit({ type: 'error', error: message, snapshot: assistantSnapshot(db, userId, threadId) });
  }

  if (options.drainQueue !== false) await drainQueuedPrompts(db, userId, threadId, emit);
  const snapshot = assistantSnapshot(db, userId, threadId);
  emit({ type: 'done', snapshot });
  return snapshot;
}

async function drainQueuedPrompts(
  db: VoiceStreamNextDb,
  userId: string,
  threadId: string,
  emit: (event: PromptEvent) => void,
  limit = 5,
): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    if (db.activeRun(userId, threadId)) return;
    const next = db.nextQueuedPrompt(userId, threadId);
    if (!next) return;
    const at = new Date().toISOString();
    db.updateQueuedPrompt(userId, next.id, { status: 'running', startedAt: at, error: null });
    try {
      await promptAssistantThread(
        db,
        userId,
        threadId,
        { prompt: next.prompt, provider: next.provider, model: next.model, thinkingLevel: next.thinkingLevel },
        emit,
        { drainQueue: false },
      );
      db.updateQueuedPrompt(userId, next.id, { status: 'completed', completedAt: new Date().toISOString() });
    } catch (error: any) {
      db.updateQueuedPrompt(userId, next.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error?.message ?? String(error),
      });
      throw error;
    }
  }
}

export async function resolveAssistantApproval(
  db: VoiceStreamNextDb,
  userId: string,
  approvalId: string,
  approved: boolean,
  resolvedBy: string,
): Promise<AssistantSnapshot> {
  const pending = db.pendingApproval(userId, approvalId);
  if (!pending) throw Object.assign(new Error('unknown pending approval'), { statusCode: 404 });
  const thread = db.thread(userId, pending.threadId);
  if (!thread) throw Object.assign(new Error('unknown assistant thread'), { statusCode: 404 });
  if (!approved) {
    db.resolveApproval(userId, approvalId, { approved: false, resolvedBy, failureReason: 'Denied by user' });
    db.updateToolCall(userId, pending.toolCallId, { status: 'denied', resultJson: JSON.stringify({ ok: false, denied: true }) });
    db.addMessage(userId, pending.threadId, {
      role: 'toolResult',
      toolName: pending.toolName,
      toolCallId: pending.toolCallId,
      isError: true,
      content: 'Tool call denied by user.',
      contentJson: JSON.stringify({ ok: false, denied: true }),
    });
    if (pending.runId) db.updateRun(userId, pending.runId, { status: 'cancelled', cancelledAt: new Date().toISOString(), error: 'Tool call denied' });
    db.updateThread(userId, pending.threadId, { status: 'idle', error: null });
    await drainQueuedPrompts(db, userId, pending.threadId, () => undefined);
    return assistantSnapshot(db, userId, pending.threadId);
  }

  const args = safeJson(pending.argsJson);
  const result = await executeAssistantTool(db, userId, thread, pending.toolName, args);
  db.resolveApproval(userId, approvalId, { approved: true, resolvedBy, result });
  db.updateToolCall(userId, pending.toolCallId, { status: 'completed', resultJson: JSON.stringify(result) });
  db.addMessage(userId, pending.threadId, {
    role: 'toolResult',
    toolName: pending.toolName,
    toolCallId: pending.toolCallId,
    content: toolResultText(pending.toolName, result),
    contentJson: JSON.stringify(result),
  });
  const continuation = await approvalContinuationText(db, userId, pending, thread, result);
  db.addMessage(userId, pending.threadId, {
    role: 'assistant',
    content: continuation,
    spokenText: thread.voiceEnabled && pending.toolName === 'speak' ? String((result as any).text ?? continuation) : null,
  });
  if (pending.runId) finishRun(db, userId, pending.threadId, pending.runId);
  await drainQueuedPrompts(db, userId, pending.threadId, () => undefined);
  return assistantSnapshot(db, userId, pending.threadId);
}

async function approvalContinuationText(
  db: VoiceStreamNextDb,
  userId: string,
  approval: AssistantApprovalRecord,
  thread: AssistantThread,
  result: unknown,
): Promise<string> {
  const fallback = approvedAssistantText(approval.toolName, result);
  const run = approval.runId ? db.listRuns(userId, approval.threadId, 20).find((item) => item.id === approval.runId) : null;
  const provider = run?.provider ?? thread.provider;
  const apiKey = provider === 'openai' ? db.assistantApiKey(userId, 'openai') : null;
  if (provider !== 'openai' || !apiKey) return fallback;

  try {
    const settings = db.ensureAssistantSettings(userId);
    const messages = db.listMessages(userId, approval.threadId);
    const instructions = [
      thread.voiceEnabled ? settings.voiceSystemPrompt : settings.normalSystemPrompt,
      thread.systemPrompt ? `Thread system prompt:\n${thread.systemPrompt}` : '',
    ].filter(Boolean).join('\n\n');
    const inputText = renderConversation(messages);
    const followup = renderToolFollowup(inputText, [{
      call: {
        id: approval.toolCallId,
        callId: approval.toolCallId,
        name: approval.toolName,
        argumentsJson: approval.argsJson || '{}',
      },
      result,
      toolName: approval.toolName,
    }]);
    const final = await streamOpenAiResponse({
      model: run?.model ?? thread.model,
      thinkingLevel: run?.thinkingLevel ?? thread.thinkingLevel,
      instructions,
      input: followup,
      tools: [],
      emit: () => undefined,
      apiKey,
    });
    return final.text.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function runModelDrivenTurn(
  db: VoiceStreamNextDb,
  userId: string,
  threadId: string,
  run: AssistantRunRecord,
  thread: AssistantThread,
  modelConfig: { provider: string; model: string; thinkingLevel: string },
  emit: (event: PromptEvent) => void,
): Promise<void> {
  const settings = db.ensureAssistantSettings(userId);
  const messages = db.listMessages(userId, threadId);
  const enabledTools = responseToolDefinitions(thread);
  const instructions = [
    thread.voiceEnabled ? settings.voiceSystemPrompt : settings.normalSystemPrompt,
    thread.systemPrompt ? `Thread system prompt:\n${thread.systemPrompt}` : '',
    enabledTools.length > 0
      ? 'You may call the provided assistant tools when they help. Prefer tools for artifacts, spoken replies, web searches, fetched URL content, prompt reads/updates, and thread settings instead of describing those actions. Use web_search for current information, documentation, news, prices, or facts that may have changed. Use fetch_content when the user gives a direct URL to read, inspect, summarize, or analyze. Cite source URLs in the final answer.'
      : '',
  ].filter(Boolean).join('\n\n');
  const inputText = renderConversation(messages);
  const testCalls = testModelToolCalls();

  if (testCalls.length > 0) {
    const completed = await executeModelToolCalls(db, userId, threadId, run, thread, testCalls, emit);
    if (!completed) return;
    const finalText = completed.map((item) => approvedAssistantText(item.toolName, item.result)).join('\n') || 'Done.';
    const assistantMessage = db.addMessage(userId, threadId, {
      role: 'assistant',
      content: finalText,
      contentJson: assistantContentJson(finalText, ''),
      spokenText: null,
    });
    emit({ type: 'message', message: assistantMessage });
    finishRun(db, userId, threadId, run.id);
    return;
  }

  const openAiKey = modelConfig.provider === 'openai' ? db.assistantApiKey(userId, 'openai') : null;
  if (modelConfig.provider === 'openai' && !openAiKey) throw new Error('OpenAI API key is not configured. Add your OpenAI key in assistant settings or connect Codex.');

  if (modelConfig.provider === 'openai') {
    const initialTiming = createProviderTimingLogger(db, userId, threadId, run, {
      provider: 'openai',
      model: modelConfig.model,
      thinkingLevel: modelConfig.thinkingLevel,
      requestKind: 'initial',
    });
    const first = await streamOpenAiResponse({
      model: modelConfig.model,
      thinkingLevel: modelConfig.thinkingLevel,
      instructions,
      input: inputText,
      tools: enabledTools,
      emit,
      logTiming: initialTiming,
      apiKey: openAiKey ?? '',
    });
    if (first.toolCalls.length > 0) {
      const completed = await executeModelToolCalls(db, userId, threadId, run, thread, first.toolCalls, emit);
      if (!completed) return;
      const followup = renderToolFollowup(inputText, completed);
      const followupTiming = createProviderTimingLogger(db, userId, threadId, run, {
        provider: 'openai',
        model: modelConfig.model,
        thinkingLevel: modelConfig.thinkingLevel,
        requestKind: 'followup',
      });
      const final = await streamOpenAiResponse({
        model: modelConfig.model,
        thinkingLevel: modelConfig.thinkingLevel,
        instructions,
        input: followup,
        tools: [],
        emit,
        logTiming: followupTiming,
        apiKey: openAiKey ?? '',
      });
      const finalText = final.text.trim() || completed.map((item) => approvedAssistantText(item.toolName, item.result)).join('\n') || 'Done.';
      const assistantMessage = db.addMessage(userId, threadId, {
        role: 'assistant',
        content: finalText,
        contentJson: assistantContentJson(finalText, final.thinking),
        spokenText: null,
      });
      emit({ type: 'message', message: assistantMessage });
      finishRun(db, userId, threadId, run.id);
      return;
    }
    const replyText = first.text.trim();
    if (replyText) {
      const assistantMessage = db.addMessage(userId, threadId, {
        role: 'assistant',
        content: replyText,
        contentJson: assistantContentJson(replyText, first.thinking),
        spokenText: null,
      });
      emit({ type: 'message', message: assistantMessage });
      finishRun(db, userId, threadId, run.id);
      return;
    }
    throw new Error('OpenAI completed without text or tool calls.');
  }

  if (modelConfig.provider === 'codex') {
    const initialTiming = createProviderTimingLogger(db, userId, threadId, run, {
      provider: 'codex',
      model: modelConfig.model,
      thinkingLevel: modelConfig.thinkingLevel,
      requestKind: 'initial',
    });
    const first = await streamCodexResponse(db, userId, {
      model: modelConfig.model,
      thinkingLevel: modelConfig.thinkingLevel,
      instructions,
      input: inputText,
      tools: enabledTools,
      emit,
      logTiming: initialTiming,
    });
    if (first.toolCalls.length > 0) {
      const completed = await executeModelToolCalls(db, userId, threadId, run, thread, first.toolCalls, emit);
      if (!completed) return;
      const followup = renderToolFollowup(inputText, completed);
      const followupTiming = createProviderTimingLogger(db, userId, threadId, run, {
        provider: 'codex',
        model: modelConfig.model,
        thinkingLevel: modelConfig.thinkingLevel,
        requestKind: 'followup',
      });
      const final = await streamCodexResponse(db, userId, {
        model: modelConfig.model,
        thinkingLevel: modelConfig.thinkingLevel,
        instructions,
        input: followup,
        tools: [],
        emit,
        logTiming: followupTiming,
      });
      const finalText = final.text.trim() || completed.map((item) => approvedAssistantText(item.toolName, item.result)).join('\n') || 'Done.';
      const assistantMessage = db.addMessage(userId, threadId, {
        role: 'assistant',
        content: finalText,
        contentJson: assistantContentJson(finalText, final.thinking),
        spokenText: null,
      });
      emit({ type: 'message', message: assistantMessage });
      finishRun(db, userId, threadId, run.id);
      return;
    }
    const replyText = first.text.trim();
    if (replyText) {
      const assistantMessage = db.addMessage(userId, threadId, {
        role: 'assistant',
        content: replyText,
        contentJson: assistantContentJson(replyText, first.thinking),
        spokenText: null,
      });
      emit({ type: 'message', message: assistantMessage });
      finishRun(db, userId, threadId, run.id);
      return;
    }
    throw new Error('Codex completed without text or tool calls.');
  }

  throw new Error(`Unsupported assistant provider: ${modelConfig.provider}`);
}

function createProviderTimingLogger(
  db: VoiceStreamNextDb,
  userId: string,
  threadId: string,
  run: AssistantRunRecord,
  meta: { provider: string; model: string; thinkingLevel: string; requestKind: string },
): ProviderTimingLogger {
  const startedAt = Date.now();
  let previousAt = startedAt;
  return (phase, details = {}, level = 'info') => {
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const sincePreviousMs = now - previousAt;
    previousAt = now;
    db.addLog(userId, {
      source: 'server',
      level,
      message: `Assistant provider ${phase}`,
      detailsJson: JSON.stringify({
        ...meta,
        threadId,
        runId: run.id,
        elapsedMs,
        sincePreviousMs,
        ...details,
      }),
    });
  };
}

function providerErrorMessage(error: any): string {
  const message = String(error?.message ?? error ?? '').trim();
  return message || 'assistant provider request failed';
}

async function streamCodexResponse(
  db: VoiceStreamNextDb,
  userId: string,
  input: {
    model: string;
    thinkingLevel: string;
    instructions: string;
    input: string;
    tools: unknown[];
    emit: (event: PromptEvent) => void;
    logTiming?: ProviderTimingLogger;
  },
): Promise<CodexStreamResult> {
  input.logTiming?.('request_start', {
    transport: 'sse',
    inputChars: input.input.length,
    instructionsChars: input.instructions.length,
    toolCount: input.tools.length,
  });
  const apiKey = await codexAccessToken(db, userId);
  const ai = await import('@mariozechner/pi-ai');
  const model = ai.getModel('openai-codex' as any, input.model as any) || ai.getModel('openai-codex' as any, 'gpt-5.5' as any);
  if (!model) throw new Error(`Unknown Codex model: ${input.model}`);

  const context = {
    systemPrompt: input.instructions,
    messages: [{ role: 'user', content: input.input, timestamp: Date.now() }],
    tools: codexToolDefinitions(input.tools),
  };
  const stream = ai.streamSimple(model, context as any, {
    apiKey,
    reasoning: codexReasoning(input.thinkingLevel),
    transport: 'sse',
    sessionId: `vsn-${userId}`,
  } as any);
  let text = '';
  let thinking = '';
  const toolCalls: ModelToolCall[] = [];
  let finalMessage: any = null;
  let firstEventLogged = false;
  let firstTextLogged = false;
  let firstThinkingLogged = false;
  const logFirstEvent = (eventType: string) => {
    if (firstEventLogged) return;
    firstEventLogged = true;
    input.logTiming?.('first_stream_event', { eventType });
  };
  for await (const event of stream as AsyncIterable<any>) {
    logFirstEvent(String(event?.type ?? 'unknown'));
    if (event.type === 'text_delta') {
      const delta = String(event.delta ?? '');
      text += delta;
      if (delta && !firstTextLogged) {
        firstTextLogged = true;
        input.logTiming?.('first_text_delta', { chars: delta.length });
      }
      if (delta) input.emit({ type: 'delta', delta });
    } else if (event.type === 'thinking_delta' || event.type === 'reasoning_delta') {
      const delta = String(event.delta ?? event.thinking ?? event.reasoning ?? '');
      thinking += delta;
      if (delta && !firstThinkingLogged) {
        firstThinkingLogged = true;
        input.logTiming?.('first_thinking_delta', { chars: delta.length });
      }
      if (delta) input.emit({ type: 'thinking_delta', delta });
    } else if (event.type === 'toolcall_end' && event.toolCall) {
      toolCalls.push({
        id: event.toolCall.id == null ? null : String(event.toolCall.id),
        callId: event.toolCall.id == null ? null : String(event.toolCall.id),
        name: String(event.toolCall.name ?? ''),
        argumentsJson: JSON.stringify(event.toolCall.arguments ?? {}),
      });
      input.logTiming?.('tool_call_received', { toolName: String(event.toolCall.name ?? '') });
    } else if (event.type === 'done') {
      finalMessage = event.message;
    } else if (event.type === 'error') {
      finalMessage = event.error;
      input.logTiming?.('provider_error', { error: String(event.error?.errorMessage ?? 'Codex request failed') }, 'error');
      throw new Error(String(event.error?.errorMessage ?? 'Codex request failed'));
    }
  }
  if (finalMessage?.stopReason === 'error') {
    input.logTiming?.('provider_error', { error: String(finalMessage.errorMessage ?? 'Codex request failed') }, 'error');
    throw new Error(String(finalMessage.errorMessage ?? 'Codex request failed'));
  }
  if (!text) text = textFromPiAssistantMessage(finalMessage);
  if (!thinking) thinking = thinkingFromPiAssistantMessage(finalMessage);
  input.logTiming?.('request_done', {
    textChars: text.length,
    thinkingChars: thinking.length,
    toolCallCount: toolCalls.length,
    stopReason: String(finalMessage?.stopReason ?? ''),
  });
  return {
    text,
    thinking,
    toolCalls: toolCalls.filter((call) => call.name),
  };
}

async function codexAccessToken(db: VoiceStreamNextDb, userId: string): Promise<string> {
  const connection = db.codexConnection(userId);
  if (!connection) {
    throw new Error('Codex is not connected. Connect Codex in assistant settings before using Codex models.');
  }
  if (Date.parse(connection.expiresAt) > Date.now() + 60_000) return connection.accessToken;
  const refreshed = await refreshCodexAccessToken(connection.refreshToken);
  const updated = db.upsertCodexConnection(userId, refreshed);
  return updated.accessToken;
}

function codexToolDefinitions(tools: unknown[]): unknown[] {
  return tools.map((tool) => {
    const value = tool as any;
    return {
      name: String(value?.name ?? ''),
      description: String(value?.description ?? ''),
      parameters: value?.parameters ?? { type: 'object', properties: {}, required: [] },
    };
  }).filter((tool: any) => tool.name);
}

function codexReasoning(thinkingLevel: string): string | undefined {
  const level = cleanThinkingLevel(thinkingLevel);
  return level === 'off' ? undefined : level;
}

function textFromPiAssistantMessage(message: any): string {
  if (!message?.content || !Array.isArray(message.content)) return '';
  return message.content
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('')
    .trim();
}

function thinkingFromPiAssistantMessage(message: any): string {
  if (!message?.content || !Array.isArray(message.content)) return '';
  return message.content
    .filter((part: any) => part?.type === 'thinking' && typeof part.thinking === 'string')
    .map((part: any) => part.thinking)
    .join('')
    .trim();
}

async function executeModelToolCalls(
  db: VoiceStreamNextDb,
  userId: string,
  threadId: string,
  run: AssistantRunRecord,
  thread: AssistantThread,
  calls: ModelToolCall[],
  emit: (event: PromptEvent) => void,
): Promise<ModelToolResult[] | null> {
  const completed: ModelToolResult[] = [];
  for (const call of calls) {
    const toolName = normalizeModelToolName(call.name);
    ensureToolEnabled(thread, toolName);
    ensureCapability(thread, toolName);
    const args = safeJson(call.argumentsJson);
    const needsApproval = approvalRequiredFor(thread, toolName);
    const toolCall = db.createToolCall(userId, threadId, {
      runId: run.id,
      toolName,
      args,
      approvalRequired: needsApproval,
    });
    emit({ type: 'tool_call', toolCall, modelCallId: call.callId ?? call.id, args });
    const requestMessage = db.addMessage(userId, threadId, {
      role: 'assistant',
      content: `Requested ${toolLabel(toolName)}.`,
      contentJson: JSON.stringify([{ type: 'modelToolCall', id: toolCall.id, modelCallId: call.callId ?? call.id, name: toolName, arguments: args }]),
    });
    emit({ type: 'message', message: requestMessage });

    if (needsApproval) {
      const approval = db.createApproval(userId, threadId, {
        runId: run.id,
        toolCallId: toolCall.id,
        toolName,
        label: toolLabel(toolName),
        args,
      });
      const snapshot = assistantSnapshot(db, userId, threadId);
      emit({ type: 'approval_pending', approval: approvalView(approval), snapshot });
      return null;
    }

    const result = await executeAssistantTool(db, userId, thread, toolName, args);
    const updatedToolCall = db.updateToolCall(userId, toolCall.id, { status: 'completed', resultJson: JSON.stringify(result) }) ?? toolCall;
    emit({ type: 'tool_result', toolCall: updatedToolCall, result });
    const toolResult = db.addMessage(userId, threadId, {
      role: 'toolResult',
      toolName,
      toolCallId: toolCall.id,
      content: toolResultText(toolName, result),
      contentJson: JSON.stringify(result),
    });
    emit({ type: 'message', message: toolResult });
    completed.push({ call, result, toolName });
  }
  return completed;
}

async function streamOpenAiResponse(input: {
  model: string;
  thinkingLevel: string;
  instructions: string;
  input: string;
  tools: unknown[];
  emit: (event: PromptEvent) => void;
  apiKey: string;
  logTiming?: ProviderTimingLogger;
}): Promise<OpenAiStreamResult> {
  const body: Record<string, unknown> = {
    model: input.model,
    instructions: input.instructions,
    input: input.input,
    stream: true,
    parallel_tool_calls: false,
  };
  if (input.tools.length > 0) {
    body.tools = input.tools;
    body.tool_choice = 'auto';
  }
  const reasoning = reasoningFor(input.thinkingLevel);
  if (reasoning) body.reasoning = reasoning;

  input.logTiming?.('request_start', {
    transport: 'sse',
    inputChars: input.input.length,
    instructionsChars: input.instructions.length,
    toolCount: input.tools.length,
  });
  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  input.logTiming?.('response_headers', { status: response.status, ok: response.ok });
  if (!response.ok) {
    const text = await response.text();
    input.logTiming?.('provider_error', { status: response.status, error: providerError(text, `OpenAI response failed: ${response.status}`) }, 'error');
    throw new Error(providerError(text, `OpenAI response failed: ${response.status}`));
  }
  if (!response.body) throw new Error('OpenAI response did not include a stream body');

  const toolCallsByKey = new Map<string, ModelToolCall>();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let text = '';
  let thinking = '';
  let firstTextLogged = false;
  let firstThinkingLogged = false;

  const handleEvent = (event: any) => {
    const type = String(event?.type ?? '');
    if (type === 'response.output_text.delta' || type === 'response.text.delta') {
      const delta = String(event.delta ?? '');
      if (delta) {
        text += delta;
        if (!firstTextLogged) {
          firstTextLogged = true;
          input.logTiming?.('first_text_delta', { eventType: type, chars: delta.length });
        }
        input.emit({ type: 'delta', delta });
      }
      return;
    }
    if (type.includes('reasoning') && type.includes('delta')) {
      const delta = String(event.delta ?? event.text ?? event.summary_text ?? '');
      if (delta) {
        thinking += delta;
        if (!firstThinkingLogged) {
          firstThinkingLogged = true;
          input.logTiming?.('first_thinking_delta', { eventType: type, chars: delta.length });
        }
        input.emit({ type: 'thinking_delta', delta });
      }
      return;
    }
    if (type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const call = modelToolCallFromItem(event.item);
      toolCallsByKey.set(toolCallKey(event.item, event.output_index), call);
      return;
    }
    if (type === 'response.function_call_arguments.delta') {
      const key = toolCallKey({ id: event.item_id }, event.output_index);
      const existing = toolCallsByKey.get(key) ?? {
        id: event.item_id == null ? null : String(event.item_id),
        callId: null,
        name: '',
        argumentsJson: '',
      };
      existing.argumentsJson += String(event.delta ?? '');
      toolCallsByKey.set(key, existing);
      return;
    }
    if (type === 'response.function_call_arguments.done' && event.item) {
      const call = modelToolCallFromItem(event.item);
      toolCallsByKey.set(toolCallKey(event.item, event.output_index), call);
      input.logTiming?.('tool_call_received', { toolName: call.name });
      return;
    }
    if (type === 'response.completed' && event.response) {
      if (!text) text = String(event.response.output_text ?? '');
      for (const item of event.response.output ?? []) {
        if (item?.type === 'function_call') {
          toolCallsByKey.set(toolCallKey(item, null), modelToolCallFromItem(item));
        }
      }
    }
    if (type === 'error') {
      input.logTiming?.('provider_error', { error: providerError(JSON.stringify(event), 'OpenAI streaming error') }, 'error');
      throw new Error(providerError(JSON.stringify(event), 'OpenAI streaming error'));
    }
  };

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let splitIndex = buffer.indexOf('\n\n');
    while (splitIndex >= 0) {
      const block = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      const data = sseData(block);
      if (data && data !== '[DONE]') handleEvent(JSON.parse(data));
      splitIndex = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  const data = sseData(buffer);
  if (data && data !== '[DONE]') handleEvent(JSON.parse(data));

  input.logTiming?.('request_done', {
    textChars: text.length,
    thinkingChars: thinking.length,
    toolCallCount: [...toolCallsByKey.values()].filter((call) => call.name).length,
  });
  return {
    text,
    thinking,
    toolCalls: [...toolCallsByKey.values()].filter((call) => call.name),
  };
}

function assistantContentJson(text: string, thinking: string): string | null {
  const parts: Array<Record<string, string>> = [];
  const cleanThinking = thinking.trim();
  const cleanText = text.trim();
  if (cleanThinking) parts.push({ type: 'thinking', thinking: cleanThinking });
  if (cleanText) parts.push({ type: 'text', text: cleanText });
  return parts.length > 0 ? JSON.stringify(parts) : null;
}

function responseToolDefinitions(thread: AssistantThread): unknown[] {
  const definitions: unknown[] = [];
  for (const toolName of thread.enabledTools) {
    if (toolName === 'assistant_artifacts' && thread.capabilities.artifacts) {
      definitions.push({
        type: 'function',
        name: 'assistant_artifacts',
        description: 'List, create, append, patch, read, or delete thread-scoped assistant artifacts. Use this when the user asks to save, maintain, or inspect a note/file.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'write', 'append', 'patch', 'read', 'delete'] },
            path: { type: 'string', description: 'Relative artifact path such as notes/plan.md. Use an empty string to list all artifacts.' },
            content: { type: 'string', description: 'Content for write/append. Use an empty string for list/read/delete/patch.' },
            oldText: { type: 'string', description: 'Exact text to replace for patch. Use an empty string for other actions.' },
            newText: { type: 'string', description: 'Replacement text for patch. Use an empty string for other actions.' },
            baseRevision: { type: 'string', description: 'Optional revision from a previous read before patching. Use an empty string to skip.' },
          },
          required: ['action', 'path', 'content', 'oldText', 'newText', 'baseRevision'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'speak' && thread.capabilities.speech) {
      definitions.push({
        type: 'function',
        name: 'speak',
        description: 'Prepare a short spoken reply for connected voice clients. Use only when the user asks for something to be spoken or the thread is voice-enabled.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Short text to speak.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'get_system_prompt') {
      definitions.push({
        type: 'function',
        name: 'get_system_prompt',
        description: 'Read the current global and thread system prompt state.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'update_system_prompt') {
      definitions.push({
        type: 'function',
        name: 'update_system_prompt',
        description: 'Request an update to the current thread system prompt. This requires user approval before it is applied. Use prompt for full replacement or oldText/newText for an exact patch.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Replacement thread system prompt. Use an empty string when patching.' },
            oldText: { type: 'string', description: 'Exact existing text to replace. Use an empty string for full replacement.' },
            newText: { type: 'string', description: 'Replacement text for oldText. Use an empty string for full replacement.' },
          },
          required: ['prompt', 'oldText', 'newText'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'set_thinking_level') {
      definitions.push({
        type: 'function',
        name: 'set_thinking_level',
        description: 'Change this thread reasoning level for future assistant runs.',
        parameters: {
          type: 'object',
          properties: {
            thinkingLevel: { type: 'string', enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
          },
          required: ['thinkingLevel'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'web_search' && thread.capabilities.externalCalls) {
      definitions.push({
        type: 'function',
        name: 'web_search',
        description: 'Search the web for current information. Use for docs, news, prices, schedules, or facts that may have changed. Return answers with source URLs.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query.' },
            numResults: { type: 'number', description: 'Number of results to return. Defaults to 5, max 10.' },
            recencyFilter: { type: 'string', enum: ['', 'day', 'week', 'month', 'year'], description: 'Optional recency filter. Use empty string for no filter.' },
            domainFilter: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional domains to include, such as docs.example.com. Prefix with - to exclude a domain.',
            },
          },
          required: ['query', 'numResults', 'recencyFilter', 'domainFilter'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'fetch_content' && thread.capabilities.externalCalls) {
      definitions.push({
        type: 'function',
        name: 'fetch_content',
        description: 'Fetch readable content from a direct http or https URL. Use when the user gives a URL to read, inspect, summarize, or analyze.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The http or https URL to fetch.' },
            maxCharacters: { type: 'number', description: 'Maximum content characters to return. Defaults to 12000, max 30000.' },
            livecrawl: {
              type: 'string',
              enum: ['', 'never', 'fallback', 'preferred', 'always'],
              description: 'Optional Exa livecrawl mode. Use empty string for fallback.',
            },
          },
          required: ['url', 'maxCharacters', 'livecrawl'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
  }
  return definitions;
}

function renderConversation(messages: AssistantMessage[]): string {
  return messages.map((message) => {
    const label = message.role === 'toolResult' ? `TOOL ${message.toolName ?? 'tool'}` : message.role.toUpperCase();
    return `${label}: ${message.content}`;
  }).join('\n\n');
}

function renderToolFollowup(inputText: string, results: ModelToolResult[]): string {
  const toolText = results.map((item) => {
    const callId = item.call.callId ?? item.call.id ?? item.toolName;
    return [
      `FUNCTION CALL: ${item.toolName}`,
      `CALL ID: ${callId}`,
      `ARGUMENTS: ${item.call.argumentsJson || '{}'}`,
      `OUTPUT: ${JSON.stringify(item.result)}`,
    ].join('\n');
  }).join('\n\n');
  return `${inputText}\n\nThe assistant requested tools and the application executed them.\n\n${toolText}\n\nUse the tool outputs to answer the user concisely.`;
}

function testModelToolCalls(): ModelToolCall[] {
  const raw = process.env[MODEL_TOOL_TEST_ENV]?.trim();
  if (!raw) return [];
  const parsed = safeJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item, index) => {
    const value = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const args = value.argumentsJson ?? value.arguments ?? {};
    return {
      id: value.id == null ? `test_call_${index}` : String(value.id),
      callId: value.callId == null ? `test_call_${index}` : String(value.callId),
      name: String(value.name ?? ''),
      argumentsJson: typeof args === 'string' ? args : JSON.stringify(args),
    };
  }).filter((call) => call.name);
}

function normalizeModelToolName(raw: string): string {
  const name = raw.trim();
  if (name === 'artifact_write' || name === 'artifact_read' || name === 'artifact_delete') return 'assistant_artifacts';
  return name;
}

function reasoningFor(thinkingLevel: string): { effort: string } | null {
  const level = cleanThinkingLevel(thinkingLevel);
  if (level === 'off') return null;
  return { effort: level };
}

function providerError(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message ?? parsed?.message ?? fallback;
  } catch {
    return raw.trim() || fallback;
  }
}

function modelToolCallFromItem(item: any): ModelToolCall {
  return {
    id: item?.id == null ? null : String(item.id),
    callId: item?.call_id == null ? item?.id == null ? null : String(item.id) : String(item.call_id),
    name: String(item?.name ?? ''),
    argumentsJson: String(item?.arguments ?? ''),
  };
}

function toolCallKey(item: any, outputIndex: unknown): string {
  return String(item?.id ?? item?.call_id ?? outputIndex ?? crypto.randomUUID());
}

function sseData(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
}

function approvalView(approval: AssistantApprovalRecord): AssistantApprovalView {
  return { ...approval, args: safeJson(approval.argsJson) };
}

function cleanProvider(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'codex' ? 'codex' : 'openai';
}

function cleanModel(raw: unknown, provider: string): string {
  const value = String(raw ?? '').trim();
  if (provider === 'codex') return value || 'gpt-5.5';
  return value || 'gpt-5.5';
}

function cleanThinkingLevel(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value) ? value : 'off';
}

type ParsedCommand =
  | { kind: 'artifact_write'; path: string; content: string; append: boolean }
  | { kind: 'artifact_read'; path: string }
  | { kind: 'artifact_delete'; path: string }
  | { kind: 'speak'; text: string }
  | { kind: 'system_prompt'; prompt: string }
  | { kind: 'thinking'; level: string };

function parseAssistantCommand(prompt: string): ParsedCommand | null {
  const trimmed = prompt.trim();
  const lines = trimmed.split(/\r?\n/);
  const first = lines[0]?.trim() ?? '';
  const rest = lines.slice(1).join('\n').trim();
  const [command, ...parts] = first.split(/\s+/);
  if (command === '/artifact') {
    const action = parts[0] ?? '';
    const artifactPath = parts.slice(1).join(' ');
    if (action === 'write' || action === 'append') return { kind: 'artifact_write', path: artifactPath, content: rest, append: action === 'append' };
    if (action === 'read') return { kind: 'artifact_read', path: artifactPath };
    if (action === 'delete') return { kind: 'artifact_delete', path: artifactPath };
  }
  if (command === '/speak') return { kind: 'speak', text: `${parts.join(' ')}${rest ? `\n${rest}` : ''}`.trim() };
  if (command === '/system-prompt') return { kind: 'system_prompt', prompt: `${parts.join(' ')}${rest ? `\n${rest}` : ''}`.trim() };
  if (command === '/thinking') return { kind: 'thinking', level: parts[0] ?? '' };
  return null;
}

async function executeCommand(
  db: VoiceStreamNextDb,
  userId: string,
  threadId: string,
  run: AssistantRunRecord,
  thread: AssistantThread,
  command: ParsedCommand,
  emit: (event: PromptEvent) => void,
): Promise<AssistantSnapshot> {
  const toolName = toolNameForCommand(command);
  ensureToolEnabled(thread, toolName);
  ensureCapability(thread, toolName);
  const args = argsForCommand(command);
  const needsApproval = approvalRequiredFor(thread, toolName);
  const toolCall = db.createToolCall(userId, threadId, {
    runId: run.id,
    toolName,
    args,
    approvalRequired: needsApproval,
  });
  db.addMessage(userId, threadId, {
    role: 'assistant',
    content: `Requested ${toolLabel(toolName)}.`,
    contentJson: JSON.stringify([{ type: 'toolCall', id: toolCall.id, name: toolName, arguments: args }]),
  });

  if (needsApproval) {
    const approval = db.createApproval(userId, threadId, {
      runId: run.id,
      toolCallId: toolCall.id,
      toolName,
      label: toolLabel(toolName),
      args,
    });
    const snapshot = assistantSnapshot(db, userId, threadId);
    emit({ type: 'approval_pending', approval: approvalView(approval), snapshot });
    return snapshot;
  }

  try {
    const result = await executeAssistantTool(db, userId, thread, toolName, args);
    const updatedToolCall = db.updateToolCall(userId, toolCall.id, { status: 'completed', resultJson: JSON.stringify(result) }) ?? toolCall;
    emit({ type: 'tool_result', toolCall: updatedToolCall, result });
    const toolResult = db.addMessage(userId, threadId, {
      role: 'toolResult',
      toolName,
      toolCallId: toolCall.id,
      content: toolResultText(toolName, result),
      contentJson: JSON.stringify(result),
    });
    emit({ type: 'message', message: toolResult });
    const assistantMessage = db.addMessage(userId, threadId, {
      role: 'assistant',
      content: approvedAssistantText(toolName, result),
      spokenText: thread.voiceEnabled && toolName === 'speak' ? String((result as any).text ?? '') : null,
    });
    emit({ type: 'message', message: assistantMessage });
    finishRun(db, userId, threadId, run.id);
  } catch (error: any) {
    db.updateToolCall(userId, toolCall.id, { status: 'failed', resultJson: JSON.stringify({ ok: false, error: error?.message ?? String(error) }) });
    failRun(db, userId, threadId, run.id, error?.message ?? String(error));
    emit({ type: 'error', error: error?.message ?? String(error), snapshot: assistantSnapshot(db, userId, threadId) });
  }

  const snapshot = assistantSnapshot(db, userId, threadId);
  emit({ type: 'done', snapshot });
  return snapshot;
}

function toolNameForCommand(command: ParsedCommand): string {
  if (command.kind.startsWith('artifact_')) return 'assistant_artifacts';
  if (command.kind === 'speak') return 'speak';
  if (command.kind === 'system_prompt') return 'update_system_prompt';
  return 'set_thinking_level';
}

function argsForCommand(command: ParsedCommand): unknown {
  if (command.kind === 'artifact_write') return { action: command.append ? 'append' : 'write', path: command.path, content: command.content };
  if (command.kind === 'artifact_read') return { action: 'read', path: command.path };
  if (command.kind === 'artifact_delete') return { action: 'delete', path: command.path };
  if (command.kind === 'speak') return { text: command.text };
  if (command.kind === 'system_prompt') return { prompt: command.prompt };
  if (command.kind === 'thinking') return { thinkingLevel: command.level };
  return {};
}

async function executeAssistantTool(db: VoiceStreamNextDb, userId: string, thread: AssistantThread, toolName: string, args: unknown): Promise<unknown> {
  const parsed = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  if (toolName === 'assistant_artifacts') return executeArtifactTool(db, userId, thread.id, parsed);
  if (toolName === 'speak') {
    const text = String(parsed.text ?? '').trim();
    if (!text) throw Object.assign(new Error('speak text is required'), { statusCode: 400 });
    return { ok: true, text, delivered: false, queuedForVoiceClient: thread.voiceEnabled };
  }
  if (toolName === 'update_system_prompt') {
    const prompt = String(parsed.prompt ?? '').trim();
    const oldText = String(parsed.oldText ?? '');
    const newText = String(parsed.newText ?? '');
    const nextPrompt = prompt || patchText(thread.systemPrompt ?? '', oldText, newText, 'system prompt');
    if (!nextPrompt.trim()) throw Object.assign(new Error('system prompt is required'), { statusCode: 400 });
    const updated = db.updateThread(userId, thread.id, { systemPrompt: nextPrompt });
    return { ok: true, prompt: updated?.systemPrompt ?? nextPrompt, patched: !prompt };
  }
  if (toolName === 'get_system_prompt') {
    const settings = db.ensureAssistantSettings(userId);
    return {
      ok: true,
      threadPrompt: thread.systemPrompt,
      globalPrompt: thread.voiceEnabled ? settings.voiceSystemPrompt : settings.normalSystemPrompt,
      source: thread.systemPrompt ? 'thread' : 'global',
    };
  }
  if (toolName === 'set_thinking_level') {
    const thinkingLevel = cleanThinkingLevel(parsed.thinkingLevel);
    const updated = db.updateThread(userId, thread.id, { thinkingLevel });
    return { ok: true, thinkingLevel: updated?.thinkingLevel ?? thinkingLevel };
  }
  if (toolName === 'web_search') {
    const apiKey = db.assistantApiKey(userId, 'exa') ?? '';
    return await searchWeb({
      query: String(parsed.query ?? ''),
      numResults: parsed.numResults == null || parsed.numResults === '' ? undefined : Number(parsed.numResults),
      recencyFilter: cleanRecencyFilter(parsed.recencyFilter),
      domainFilter: Array.isArray(parsed.domainFilter) ? parsed.domainFilter.map((item) => String(item ?? '')) : [],
    }, apiKey);
  }
  if (toolName === 'fetch_content') {
    const apiKey = db.assistantApiKey(userId, 'exa') ?? '';
    return await fetchContent({
      url: String(parsed.url ?? ''),
      maxCharacters: parsed.maxCharacters == null || parsed.maxCharacters === '' ? undefined : Number(parsed.maxCharacters),
      livecrawl: cleanLivecrawl(parsed.livecrawl),
    }, apiKey);
  }
  throw Object.assign(new Error(`unknown assistant tool: ${toolName}`), { statusCode: 400 });
}

function executeArtifactTool(db: VoiceStreamNextDb, userId: string, threadId: string, args: Record<string, unknown>): unknown {
  const action = String(args.action ?? 'read').trim();
  if (action === 'list') {
    const rawPrefix = String(args.path ?? '').trim();
    const prefix = rawPrefix ? sanitizeArtifactPath(rawPrefix).replace(/\/?$/, '/') : '';
    const artifacts = db.listArtifacts(userId, threadId)
      .filter((artifact) => !prefix || artifact.path === prefix.slice(0, -1) || artifact.path.startsWith(prefix))
      .map((artifact) => ({
        id: artifact.id,
        path: artifact.path,
        size: artifact.size,
        revision: artifact.revision,
        updatedAt: artifact.updatedAt,
      }));
    return { ok: true, artifacts, count: artifacts.length };
  }
  const artifactPath = sanitizeArtifactPath(args.path);
  if (action === 'read') {
    const artifact = db.readArtifact(userId, threadId, artifactPath);
    if (!artifact) throw Object.assign(new Error(`unknown artifact: ${artifactPath}`), { statusCode: 404 });
    return { ok: true, artifact };
  }
  if (action === 'delete') {
    return { ok: true, path: artifactPath, deleted: db.deleteArtifact(userId, threadId, artifactPath) };
  }
  const content = String(args.content ?? '');
  const currentArtifact = action === 'append' || action === 'patch' ? db.readArtifact(userId, threadId, artifactPath) : null;
  if (action === 'patch') {
    if (!currentArtifact) throw Object.assign(new Error(`unknown artifact: ${artifactPath}`), { statusCode: 404 });
    const baseRevision = String(args.baseRevision ?? '').trim();
    if (baseRevision && baseRevision !== currentArtifact.revision) {
      throw Object.assign(new Error(`artifact revision changed: ${artifactPath}`), { statusCode: 409 });
    }
  }
  const nextContent = action === 'append'
    ? `${currentArtifact?.content ?? ''}${content}`
    : action === 'patch'
      ? patchText(currentArtifact?.content ?? '', String(args.oldText ?? ''), String(args.newText ?? ''), artifactPath)
      : content;
  if (Buffer.byteLength(nextContent, 'utf8') > ARTIFACT_MAX_BYTES) {
    throw Object.assign(new Error('artifact content is too large'), { statusCode: 413 });
  }
  return { ok: true, artifact: db.upsertArtifact(userId, threadId, { path: artifactPath, content: nextContent }) };
}

function patchText(current: string, oldText: string, newText: string, label: string): string {
  if (!oldText) throw Object.assign(new Error(`${label} patch oldText is required`), { statusCode: 400 });
  const index = current.indexOf(oldText);
  if (index < 0) throw Object.assign(new Error(`${label} patch oldText was not found`), { statusCode: 409 });
  return `${current.slice(0, index)}${newText}${current.slice(index + oldText.length)}`;
}

function ensureToolEnabled(thread: AssistantThread, toolName: string): void {
  if (thread.enabledTools.includes(toolName)) return;
  throw Object.assign(new Error(`${toolLabel(toolName)} is disabled for this thread`), { statusCode: 403 });
}

function ensureCapability(thread: AssistantThread, toolName: string): void {
  const caps: AssistantThreadCapabilities = thread.capabilities;
  if (toolName === 'assistant_artifacts' && !caps.artifacts) throw Object.assign(new Error('artifact capability is disabled'), { statusCode: 403 });
  if (toolName === 'speak' && !caps.speech) throw Object.assign(new Error('speech capability is disabled'), { statusCode: 403 });
  if ((toolName === 'web_search' || toolName === 'fetch_content') && !caps.externalCalls) throw Object.assign(new Error('external call capability is disabled'), { statusCode: 403 });
}

function approvalRequiredFor(thread: AssistantThread, toolName: string): boolean {
  if (thread.autoApprove) return false;
  if (!thread.capabilities.approvals) return false;
  const summary = ASSISTANT_TOOLS.find((tool) => tool.name === toolName);
  if (summary?.approval === 'always') return true;
  if (summary?.approval === 'normal_threads') return !thread.voiceEnabled;
  return false;
}

function finishRun(db: VoiceStreamNextDb, userId: string, threadId: string, runId: string): void {
  db.updateRun(userId, runId, { status: 'idle', completedAt: new Date().toISOString(), error: null });
  db.updateThread(userId, threadId, { status: 'idle', error: null });
}

function failRun(db: VoiceStreamNextDb, userId: string, threadId: string, runId: string, error: string): void {
  db.updateRun(userId, runId, { status: 'error', completedAt: new Date().toISOString(), error });
  db.updateThread(userId, threadId, { status: 'error', error });
}

function safeJson(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toolLabel(toolName: string): string {
  return ASSISTANT_TOOLS.find((tool) => tool.name === toolName)?.label ?? toolName.replace(/_/g, ' ');
}

function toolResultText(toolName: string, result: unknown): string {
  if (toolName === 'assistant_artifacts') {
    const artifact = (result as any)?.artifact;
    if (Array.isArray((result as any)?.artifacts)) return `${(result as any).count ?? (result as any).artifacts.length} assistant artifact file(s).`;
    if (artifact?.path) return `Artifact updated: ${artifact.path}`;
    if ((result as any)?.deleted) return `Artifact deleted: ${(result as any).path}`;
    return 'Artifact tool completed.';
  }
  if (toolName === 'speak') return `Spoken reply prepared: ${String((result as any)?.text ?? '').slice(0, 120)}`;
  if (toolName === 'web_search') return String((result as any)?.answer ?? 'Web search completed.');
  if (toolName === 'fetch_content') return String((result as any)?.answer ?? 'Content fetch completed.');
  if (toolName === 'update_system_prompt') return 'Thread system prompt updated.';
  if (toolName === 'set_thinking_level') return `Thinking level set to ${(result as any)?.thinkingLevel ?? 'off'}.`;
  return 'Tool completed.';
}

function approvedAssistantText(toolName: string, result: unknown): string {
  if (toolName === 'speak') return String((result as any)?.text ?? 'Spoken reply prepared.');
  return toolResultText(toolName, result);
}

function cleanRecencyFilter(raw: unknown): 'day' | 'week' | 'month' | 'year' | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'day' || value === 'week' || value === 'month' || value === 'year' ? value : undefined;
}

function cleanLivecrawl(raw: unknown): 'never' | 'fallback' | 'preferred' | 'always' | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'never' || value === 'fallback' || value === 'preferred' || value === 'always' ? value : undefined;
}
