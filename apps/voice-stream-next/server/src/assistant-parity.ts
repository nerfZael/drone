import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
} from '@mariozechner/pi-agent-core';
import {
  fauxAssistantMessage,
  fauxToolCall,
  getModel,
  registerFauxProvider,
  type AssistantMessage as PiAssistantMessage,
  type Model,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
} from '@mariozechner/pi-ai';
import {
  type AssistantApiKeyView,
  type AssistantApprovalRecord,
  type AssistantMessage,
  type AssistantProfile,
  type AssistantQueuedPromptRecord,
  type AssistantRunRecord,
  type AssistantSettingsRecord,
  type AssistantSkillRecord,
  type AssistantThread,
  type AssistantThreadCapabilities,
  type AssistantToolCallRecord,
  type VoiceStreamNextDb,
} from './db.js';
import {
  extensionToolDefinition,
  extensionToolName,
  extensionToolSummary,
  type AssistantExtensionApprovalPolicy,
  type AssistantExtensionToolRoute,
} from './assistant-extensions.js';
import { refreshCodexAccessToken } from './codex-auth.js';
import { fetchContent, searchWeb } from './web-search.js';

export type AssistantProviderId = 'openai' | 'codex';

type BillableCredentialSource =
  | 'user_openai_key'
  | 'platform_openai_key'
  | 'user_exa_key'
  | 'platform_exa_key'
  | 'user_codex_oauth'
  | 'test';

export type AssistantModelOption = {
  provider: AssistantProviderId;
  id: string;
  name: string;
  thinkingLevel: string;
};

export type AssistantToolSummary = {
  name: string;
  label: string;
  category: 'artifacts' | 'skills' | 'speech' | 'prompts' | 'settings' | 'web' | 'extensions';
  description: string;
  approval: AssistantExtensionApprovalPolicy;
};

export type AssistantSnapshot = {
  ok: true;
  userId: string;
  activeThreadId: string | null;
  threads: AssistantThreadView[];
  pendingApprovals: AssistantApprovalView[];
  models: AssistantModelOption[];
  availableTools: AssistantToolSummary[];
  skills: AssistantSkillRecord[];
  assistantSettings: AssistantSettingsRecord;
  assistantProfiles: AssistantProfile[];
  apiKeys: Record<'openai' | 'exa' | 'groq', AssistantApiKeyView>;
  codexConnection: { connected: boolean; accountId: string | null; expiresAt: string | null; updatedAt: string | null };
  runningModels: Record<string, { provider: string; model: string; thinkingLevel: string; runId: string }>;
};

export type AssistantThreadView = AssistantThread & {
  messages: AssistantMessage[];
  runs: AssistantRunRecord[];
  queuedPrompts: AssistantQueuedPromptRecord[];
  toolCalls: AssistantToolCallRecord[];
  artifactsCount: number;
  loadedSkills: AssistantLoadedSkillView[];
};

export type AssistantLoadedSkillView = Pick<AssistantSkillRecord, 'id' | 'slug' | 'name'>;

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
    name: 'load_skill',
    label: 'Load skill',
    category: 'skills',
    description: 'Load a saved skill and enable the available tools it names for this thread.',
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
  {
    name: 'create_new_thread',
    label: 'Create new thread',
    category: 'settings',
    description: 'Open a fresh assistant thread. In voice mode, future recordings use the new voice thread by default.',
    approval: 'never',
  },
  {
    name: 'list_execution_targets',
    label: 'List execution targets',
    category: 'settings',
    description: 'List connected devices that can run extension tools, optionally filtered by slot or extension.',
    approval: 'never',
  },
  {
    name: 'set_execution_target',
    label: 'Set execution target',
    category: 'settings',
    description: 'Select the device this thread should use for a named extension execution slot.',
    approval: 'always',
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
const MODEL_TOOL_TEST_ENV = 'VOICE_STREAM_NEXT_TEST_MODEL_TOOL_CALLS';
const USD_MICROS_PER_DOLLAR = 1_000_000;
const MICROCREDITS_PER_DOLLAR = 100_000_000;
const EXA_SEARCH_FALLBACK_COST_DOLLARS = 0.007;
const EXA_FETCH_CONTENT_FALLBACK_COST_DOLLARS = 0.001;

type ModelToolCall = {
  id: string | null;
  callId: string | null;
  name: string;
  argumentsJson: string;
};

type ProviderTimingLogger = (phase: string, details?: Record<string, unknown>, level?: 'info' | 'warn' | 'error') => void;

export type AssistantExternalToolExecution = {
  db: VoiceStreamNextDb;
  userId: string;
  thread: AssistantThread;
  toolName: string;
  args: unknown;
  route: AssistantExtensionToolRoute | null;
  runId?: string | null;
  toolCallId?: string;
};

export type AssistantExternalToolExecutor = (input: AssistantExternalToolExecution) => Promise<unknown>;
export type AssistantExternalToolApprovalEvaluator = (input: Omit<AssistantExternalToolExecution, 'runId' | 'toolCallId'>) => Promise<boolean>;
export type AssistantExecutionTargetProvider = (input: {
  db: VoiceStreamNextDb;
  userId: string;
  thread: AssistantThread;
  slot?: string;
  extensionId?: string;
}) => Promise<{ devices: AssistantExecutionTargetDevice[] }> | { devices: AssistantExecutionTargetDevice[] };

export type AssistantExecutionTargetDevice = {
  deviceId: string;
  deviceType: string;
  displayName: string;
  connected: boolean;
  connectedAt?: string;
  manifests: Array<{ id: string; name: string; toolNames: string[]; slots: string[] }>;
};

let externalToolExecutor: AssistantExternalToolExecutor | null = null;
let externalToolApprovalEvaluator: AssistantExternalToolApprovalEvaluator | null = null;
let executionTargetProvider: AssistantExecutionTargetProvider | null = null;

export function setAssistantExternalToolExecutor(executor: AssistantExternalToolExecutor | null): void {
  externalToolExecutor = executor;
}

export function setAssistantExternalToolApprovalEvaluator(evaluator: AssistantExternalToolApprovalEvaluator | null): void {
  externalToolApprovalEvaluator = evaluator;
}

export function setAssistantExecutionTargetProvider(provider: AssistantExecutionTargetProvider | null): void {
  executionTargetProvider = provider;
}

export function assistantToolSummaries(): AssistantToolSummary[] {
  return ASSISTANT_TOOLS;
}

export function assistantAvailableToolSummaries(db: VoiceStreamNextDb, userId: string): AssistantToolSummary[] {
  const extensionTools = db.listAssistantExtensionManifests(userId).flatMap((record) =>
    record.manifest.tools.map((tool) => extensionToolSummary(record.manifest, tool)),
  );
  return [...ASSISTANT_TOOLS, ...extensionTools];
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
      loadedSkills: db.listThreadSkills(userId, thread.id).map(skillLoadedView),
    };
  });
  return {
    ok: true,
    userId,
    activeThreadId: activeThread,
    threads: threadViews,
    pendingApprovals: db.listApprovals(userId).filter((approval) => approval.status === 'pending').map(approvalView),
    models: MODEL_OPTIONS,
    availableTools: assistantAvailableToolSummaries(db, userId),
    skills: db.listAssistantSkills(userId),
    assistantSettings: db.ensureAssistantSettings(userId),
    assistantProfiles: db.listAssistantProfiles(userId),
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
  const command = parseAssistantCommand(prompt);
  if (command) {
    const userMessage = db.addMessage(userId, threadId, { role: 'user', content: prompt });
    emit({ type: 'message', message: userMessage });
    const run = db.createRun(userId, threadId, { prompt, provider, model, thinkingLevel });
    emit({ type: 'snapshot', snapshot: assistantSnapshot(db, userId, threadId) });
    const result = await executeCommand(db, userId, threadId, run, thread, command, emit);
    if (options.drainQueue !== false) {
      await drainQueuedPrompts(db, userId, threadId, emit);
      return assistantSnapshot(db, userId, threadId);
    }
    return result;
  }

  const userMessage = db.addMessage(userId, threadId, { role: 'user', content: prompt });
  emit({ type: 'message', message: userMessage });
  const run = db.createRun(userId, threadId, { prompt, provider, model, thinkingLevel });
  emit({ type: 'snapshot', snapshot: assistantSnapshot(db, userId, threadId) });

  try {
    await runModelDrivenTurn(db, userId, threadId, run, thread, { provider, model, thinkingLevel }, emit, { continueFromTranscript: true });
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
  const result = await executeApprovedTool(db, userId, thread, pending.toolName, args, {
    runId: pending.runId,
    toolCallId: pending.toolCallId,
  });
  db.resolveApproval(userId, approvalId, { approved: true, resolvedBy, result });
  db.updateToolCall(userId, pending.toolCallId, { status: 'completed', resultJson: JSON.stringify(result) });
  db.addMessage(userId, pending.threadId, {
    role: 'toolResult',
    toolName: pending.toolName,
    toolCallId: pending.toolCallId,
    content: toolResultText(pending.toolName, result),
    contentJson: JSON.stringify(result),
  });
  if (pending.runId && approvalHasModelToolCall(db, userId, pending.threadId, pending.toolCallId)) {
    const run = db.updateRun(userId, pending.runId, { status: 'running', error: null });
    db.updateThread(userId, pending.threadId, { status: 'running', error: null });
    if (run) {
      try {
        const latestThread = db.thread(userId, pending.threadId) ?? thread;
        await runModelDrivenTurn(db, userId, pending.threadId, run, thread, {
          provider: run.provider,
          model: run.model,
          thinkingLevel: run.thinkingLevel,
        }, () => undefined, { continueFromTranscript: true, approvalContinuation: true, thread: latestThread });
      } catch (error: any) {
        const message = error?.message ?? String(error);
        failRun(db, userId, pending.threadId, pending.runId, message);
        db.addMessage(userId, pending.threadId, {
          role: 'assistant',
          content: `Assistant run failed: ${message}`,
          isError: true,
        });
      }
    }
  } else {
    const continuation = approvedAssistantText(pending.toolName, result);
    db.addMessage(userId, pending.threadId, {
      role: 'assistant',
      content: continuation,
      spokenText: thread.voiceEnabled && pending.toolName === 'speak' ? String((result as any).text ?? continuation) : null,
    });
    if (pending.runId) finishRun(db, userId, pending.threadId, pending.runId);
  }
  await drainQueuedPrompts(db, userId, pending.threadId, () => undefined);
  return assistantSnapshot(db, userId, pending.threadId);
}

async function runModelDrivenTurn(
  db: VoiceStreamNextDb,
  userId: string,
  threadId: string,
  run: AssistantRunRecord,
  thread: AssistantThread,
  modelConfig: { provider: string; model: string; thinkingLevel: string },
  emit: (event: PromptEvent) => void,
  options: { continueFromTranscript?: boolean; approvalContinuation?: boolean; thread?: AssistantThread } = {},
): Promise<void> {
  thread = options.thread ?? db.thread(userId, threadId) ?? thread;
  const settings = db.ensureAssistantSettings(userId);
  const persistedSkillToolNames = threadLoadedSkillToolNames(db, userId, thread);
  const enabledTools = responseToolDefinitions(db, userId, thread, { loadedSkillToolNames: persistedSkillToolNames });
  const toolInstruction = toolCatalogInstruction(db, userId, enabledTools);
  const skillInstruction = skillCatalogInstruction(db, userId, thread);
  const profileSystemPrompt = db.resolvedAssistantProfileSystemPrompt(userId, thread.assistantProfileId);
  const instructions = modelInstructions({ settings, thread, profileSystemPrompt, toolInstruction, skillInstruction, allowToolCalls: enabledTools.length > 0 });
  const testCalls = testModelToolCalls();
  const usingTestModel = testCalls.length > 0;
  const openAiCredential = modelConfig.provider === 'openai' && !usingTestModel ? resolveOpenAiCredential(db, userId) : null;

  if (modelConfig.provider === 'openai' && !usingTestModel && !openAiCredential) {
    throw new Error('OpenAI API key is not configured. Add your OpenAI key in assistant settings, connect Codex, or ask an admin to enable platform credits.');
  }
  if (openAiCredential) requireCreditsForPlatformCredential(db, userId, openAiCredential.source, 'OpenAI assistant usage');

  const faux = usingTestModel ? registerFauxProvider({ tokensPerSecond: 0 }) : null;
  if (faux) {
    faux.setResponses(options.approvalContinuation
      ? [testFinalAssistantResponse]
      : [
          fauxAssistantMessage(
            testCalls.map((call) => fauxToolCall(call.name, safeJson(call.argumentsJson) as Record<string, any>, { id: call.callId ?? call.id ?? crypto.randomUUID() })),
            { stopReason: 'toolUse' },
          ),
          testFinalAssistantResponse,
        ]);
  }

  const agentModel = faux?.getModel() ?? resolveAgentModel(modelConfig.provider, modelConfig.model);
  const timing = createProviderTimingLogger(db, userId, threadId, run, {
    provider: modelConfig.provider,
    model: modelConfig.model,
    thinkingLevel: modelConfig.thinkingLevel,
    requestKind: 'agent',
  });
  const modelCredentialSource: BillableCredentialSource = usingTestModel
    ? 'test'
    : modelConfig.provider === 'codex'
      ? 'user_codex_oauth'
      : openAiCredential?.source ?? 'test';
  const context = makeAgentRunContext({ db, userId, threadId, run, thread, emit, modelCredentialSource });
  for (const toolName of persistedSkillToolNames) context.loadedSkillToolNames.add(toolName);
  const agent = new Agent({
    initialState: {
      systemPrompt: instructions,
      model: agentModel,
      thinkingLevel: cleanThinkingLevel(modelConfig.thinkingLevel) as any,
      tools: buildAgentTools(context),
      messages: messagesToAgentMessages(db, userId, threadId, agentModel),
    },
    sessionId: assistantProviderSessionId(userId, threadId),
    transport: modelConfig.provider === 'codex' ? 'sse' : 'auto',
    toolExecution: 'sequential',
    afterToolCall: async ({ toolCall, result, isError, context: loopContext }) => {
      const stopForCredits = context.modelCredentialSource === 'platform_openai_key' && db.creditBalanceMicrocredits(userId) <= 0;
      if (!isError && normalizeModelToolName(toolCall.name) === 'load_skill') {
        loopContext.tools = buildAgentTools(context);
        return stopForCredits ? { terminate: true } : undefined;
      }
      return stopForCredits ? { terminate: true } : undefined;
    },
    getApiKey: async (provider: string) => {
      if (provider === 'openai-codex') return codexAccessToken(db, userId);
      if (provider === 'openai') return openAiCredential?.apiKey;
      return undefined;
    },
    onPayload: async (payload, model) => {
      timing('request_start', {
        api: model.api,
        provider: model.provider,
        payloadChars: JSON.stringify(payload ?? {}).length,
        toolNames: responseToolNames((payload as any)?.tools ?? []),
      });
      return undefined;
    },
    onResponse: async (response) => {
      timing('response_headers', { status: response.status });
    },
  });
  context.refreshAgentTools = () => {
    agent.state.tools = buildAgentTools(context);
  };

  agent.subscribe(async (event) => {
    await persistAgentEvent(context, event);
  });

  try {
    if (options.continueFromTranscript) await agent.continue();
    else await agent.prompt(modelPromptTextFromRun(run));
  } finally {
    faux?.unregister();
  }

  if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);

  if (db.listApprovals(userId, threadId).some((approval) => approval.runId === run.id && approval.status === 'pending')) {
    db.updateThread(userId, threadId, { status: 'waiting_for_approval', error: null });
    db.updateRun(userId, run.id, { status: 'waiting_for_approval', error: null });
    return;
  }
  finishRun(db, userId, threadId, run.id);
}

type AgentRunContext = {
  db: VoiceStreamNextDb;
  userId: string;
  threadId: string;
  run: AssistantRunRecord;
  thread: AssistantThread;
  emit: (event: PromptEvent) => void;
  modelCredentialSource: BillableCredentialSource;
  toolCallsByModelId: Map<string, AssistantToolCallRecord>;
  approvalPendingModelIds: Set<string>;
  persistedToolResultModelIds: Set<string>;
  loadedSkillToolNames: Set<string>;
  refreshAgentTools?: () => void;
};

function makeAgentRunContext(
  input: Omit<AgentRunContext, 'toolCallsByModelId' | 'approvalPendingModelIds' | 'persistedToolResultModelIds' | 'loadedSkillToolNames' | 'refreshAgentTools'>,
): AgentRunContext {
  return {
    ...input,
    toolCallsByModelId: new Map(),
    approvalPendingModelIds: new Set(),
    persistedToolResultModelIds: new Set(),
    loadedSkillToolNames: new Set(),
  };
}

export function assistantProviderSessionId(userId: string, threadId: string): string {
  const userPart = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'user';
  const threadPart = threadId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'thread';
  return `vsn-${userPart}-${threadPart}-${shortStableHash(`${userId}:${threadId}`)}`;
}

function shortStableHash(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

function resolveAgentModel(provider: string, modelId: string): Model<any> {
  const piProvider = provider === 'codex' ? 'openai-codex' : provider;
  const model = getModel(piProvider as any, modelId as any) ?? getModel(piProvider as any, 'gpt-5.5' as any);
  if (!model) throw new Error(`Unknown assistant model: ${provider}/${modelId}`);
  return model;
}

function modelPromptTextFromRun(run: AssistantRunRecord): string {
  return String(run.prompt ?? '').trim();
}

function testFinalAssistantResponse(context: any): PiAssistantMessage {
  const messages = Array.isArray(context?.messages) ? context.messages as AgentMessage[] : [];
  const results = messages
    .filter((message: AgentMessage): message is ToolResultMessage => message.role === 'toolResult')
    .slice(-8)
    .map((message: ToolResultMessage) => message.content.filter((part): part is TextContent => part.type === 'text').map((part: TextContent) => part.text).join('\n').trim())
    .filter(Boolean);
  return fauxAssistantMessage(results.join('\n') || 'Done.');
}

function messagesToAgentMessages(db: VoiceStreamNextDb, userId: string, threadId: string, model: Model<any>): AgentMessage[] {
  const messages = db.listMessages(userId, threadId);
  return messages.flatMap((message): AgentMessage[] => {
    if (message.role === 'user') {
      return [{
        role: 'user',
        content: [{ type: 'text', text: message.content }],
        timestamp: Date.parse(message.createdAt) || Date.now(),
      }];
    }
    if (message.role === 'assistant') {
      const content = assistantMessageContentFromDb(message);
      if (content.length === 0) return [];
      return [{
        role: 'assistant',
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: emptyUsage(),
        stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
        timestamp: Date.parse(message.createdAt) || Date.now(),
      }];
    }
    if (message.role === 'toolResult') {
      const modelToolCallId = modelToolCallIdForLocalToolCall(db, userId, threadId, message.toolCallId ?? '') ?? message.toolCallId ?? '';
      if (!modelToolCallId) return [];
      return [{
        role: 'toolResult',
        toolCallId: modelToolCallId,
        toolName: message.toolName ?? 'tool',
        content: [{ type: 'text', text: message.content }],
        details: safeJson(message.contentJson),
        isError: message.isError,
        timestamp: Date.parse(message.createdAt) || Date.now(),
      }];
    }
    return [];
  });
}

function assistantMessageContentFromDb(message: AssistantMessage): PiAssistantMessage['content'] {
  const parsed = safeJson(message.contentJson);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((part): PiAssistantMessage['content'] => {
      if (!part || typeof part !== 'object') return [];
      const type = String((part as any).type ?? '');
      if (type === 'text') return [{ type: 'text', text: String((part as any).text ?? '') }];
      if (type === 'thinking') return [{ type: 'thinking', thinking: String((part as any).thinking ?? '') }];
      if (type === 'modelToolCall' || type === 'toolCall') {
        return [{
          type: 'toolCall',
          id: String((part as any).modelCallId ?? (part as any).id ?? ''),
          name: String((part as any).name ?? ''),
          arguments: ((part as any).arguments && typeof (part as any).arguments === 'object') ? (part as any).arguments : {},
        }];
      }
      return [];
    });
  }
  return message.content ? [{ type: 'text', text: message.content }] : [];
}

function modelToolCallIdForLocalToolCall(db: VoiceStreamNextDb, userId: string, threadId: string, localToolCallId: string): string | null {
  if (!localToolCallId) return null;
  for (const message of db.listMessages(userId, threadId)) {
    if (message.role !== 'assistant') continue;
    const parsed = safeJson(message.contentJson);
    if (!Array.isArray(parsed)) continue;
    for (const part of parsed) {
      if (!part || typeof part !== 'object') continue;
      const value = part as any;
      if ((value.type === 'modelToolCall' || value.type === 'toolCall') && String(value.id ?? '') === localToolCallId) {
        return String(value.modelCallId ?? value.id ?? '');
      }
    }
  }
  return null;
}

function approvalHasModelToolCall(db: VoiceStreamNextDb, userId: string, threadId: string, localToolCallId: string): boolean {
  if (!localToolCallId) return false;
  for (const message of db.listMessages(userId, threadId)) {
    if (message.role !== 'assistant') continue;
    const parsed = safeJson(message.contentJson);
    if (!Array.isArray(parsed)) continue;
    if (parsed.some((part) => part && typeof part === 'object' && (part as any).type === 'modelToolCall' && String((part as any).id ?? '') === localToolCallId)) {
      return true;
    }
  }
  return false;
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function buildAgentTools(context: AgentRunContext): AgentTool<any>[] {
  return responseToolDefinitions(context.db, context.userId, context.thread, {
    loadedSkillToolNames: context.loadedSkillToolNames,
  }).map((definition: any) => {
    const name = String(definition?.name ?? '');
    return {
      name,
      label: toolLabel(name, context.db, context.userId),
      description: String(definition?.description ?? `${name} tool`),
      parameters: definition?.parameters ?? { type: 'object', properties: {}, required: [], additionalProperties: false },
      prepareArguments: (args: unknown) => prepareAgentToolArguments(name, args),
      executionMode: 'sequential',
      execute: async (toolCallId: string, params: any) => executeAgentTool(context, toolCallId, name, params),
    };
  });
}

function prepareAgentToolArguments(toolName: string, args: unknown): Record<string, any> {
  const value = args && typeof args === 'object' ? { ...(args as Record<string, any>) } : {};
  if (toolName === 'assistant_artifacts') {
    return {
      action: String(value.action ?? 'read'),
      path: String(value.path ?? ''),
      content: String(value.content ?? ''),
      oldText: String(value.oldText ?? ''),
      newText: String(value.newText ?? ''),
      baseRevision: String(value.baseRevision ?? ''),
    };
  }
  if (toolName === 'update_system_prompt') {
    return {
      prompt: String(value.prompt ?? ''),
      oldText: String(value.oldText ?? ''),
      newText: String(value.newText ?? ''),
    };
  }
  if (toolName === 'set_thinking_level') return { thinkingLevel: String(value.thinkingLevel ?? value.level ?? 'off') };
  if (toolName === 'load_skill') return { skill: String(value.skill ?? value.name ?? value.slug ?? '') };
  if (toolName === 'web_search') {
    return {
      query: String(value.query ?? ''),
      numResults: value.numResults == null || value.numResults === '' ? 5 : Number(value.numResults),
      recencyFilter: String(value.recencyFilter ?? ''),
      domainFilter: Array.isArray(value.domainFilter) ? value.domainFilter : [],
    };
  }
  if (toolName === 'fetch_content') {
    return {
      url: String(value.url ?? ''),
      maxCharacters: value.maxCharacters == null || value.maxCharacters === '' ? 12000 : Number(value.maxCharacters),
      livecrawl: String(value.livecrawl ?? ''),
    };
  }
  if (toolName === 'speak') return { text: String(value.text ?? '') };
  if (toolName === 'create_new_thread') return { title: String(value.title ?? '') };
  return value;
}

async function executeAgentTool(
  context: AgentRunContext,
  modelToolCallId: string,
  toolName: string,
  params: unknown,
): Promise<AgentToolResult<any>> {
  const toolCall = context.toolCallsByModelId.get(modelToolCallId) ?? await createAgentToolCallRecord(context, {
    id: modelToolCallId,
    name: toolName,
    arguments: params && typeof params === 'object' ? params as Record<string, any> : {},
  });

  if (context.approvalPendingModelIds.has(modelToolCallId) || toolCall.status === 'waiting_for_approval') {
    return {
      content: [{ type: 'text', text: `${toolLabel(toolName, context.db, context.userId)} is waiting for approval.` }],
      details: { approvalPending: true, localToolCallId: toolCall.id },
      terminate: true,
    };
  }

  try {
    const latestThread = context.db.thread(context.userId, context.threadId) ?? context.thread;
    const result = await executeApprovedTool(context.db, context.userId, latestThread, toolName, params, {
      runId: context.run.id,
      toolCallId: toolCall.id,
    });
    if (toolName === 'load_skill') {
      const skillToolNames = Array.isArray((result as any)?.toolNames) ? (result as any).toolNames.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : [];
      for (const skillToolName of skillToolNames) context.loadedSkillToolNames.add(skillToolName);
      context.refreshAgentTools?.();
    }
    context.db.updateToolCall(context.userId, toolCall.id, { status: 'completed', resultJson: JSON.stringify(result) });
    return {
      content: [{ type: 'text', text: modelVisibleToolResultText(toolName, result) }],
      details: { localToolCallId: toolCall.id, result },
      terminate: context.approvalPendingModelIds.size > 0,
    };
  } catch (error: any) {
    const failure = { ok: false, error: error?.message ?? String(error) };
    context.db.updateToolCall(context.userId, toolCall.id, { status: 'failed', resultJson: JSON.stringify(failure) });
    throw error;
  }
}

async function createAgentToolCallRecord(context: AgentRunContext, call: Pick<ToolCall, 'id' | 'name' | 'arguments'>): Promise<AssistantToolCallRecord> {
  const toolName = normalizeModelToolName(call.name);
  ensureToolEnabled(context.thread, toolName, context.loadedSkillToolNames);
  ensureCapability(context.thread, toolName);
  const args = call.arguments ?? {};
  const needsApproval = await approvalRequiredFor(context.db, context.userId, context.thread, toolName, args);
  const toolCall = context.db.createToolCall(context.userId, context.threadId, {
    runId: context.run.id,
    toolName,
    args,
    approvalRequired: needsApproval,
  });
  context.toolCallsByModelId.set(call.id, toolCall);
  context.emit({ type: 'tool_call', toolCall, modelCallId: call.id, args });

  if (needsApproval) {
    context.approvalPendingModelIds.add(call.id);
    const approval = context.db.createApproval(context.userId, context.threadId, {
      runId: context.run.id,
      toolCallId: toolCall.id,
      toolName,
      label: toolLabel(toolName, context.db, context.userId),
      args,
    });
    context.emit({ type: 'approval_pending', approval: approvalView(approval), snapshot: assistantSnapshot(context.db, context.userId, context.threadId) });
  }

  return toolCall;
}

async function persistAgentEvent(context: AgentRunContext, event: AgentEvent): Promise<void> {
  if (event.type === 'message_update') {
    const messageEvent = event.assistantMessageEvent as any;
    if (messageEvent.type === 'text_delta' && messageEvent.delta) context.emit({ type: 'delta', delta: String(messageEvent.delta) });
    if (messageEvent.type === 'thinking_delta' && messageEvent.delta) context.emit({ type: 'thinking_delta', delta: String(messageEvent.delta) });
    return;
  }

  if (event.type !== 'message_end') return;
  const message = event.message;
  if (message.role === 'user') {
    const dbMessage = context.db.addMessage(context.userId, context.threadId, {
      role: 'user',
      content: textFromAgentUserMessage(message),
    });
    context.emit({ type: 'message', message: dbMessage });
    return;
  }

  if (message.role === 'assistant') {
    const toolCalls = message.content.filter((part): part is ToolCall => part.type === 'toolCall');
    for (const call of toolCalls) {
      if (!context.toolCallsByModelId.has(call.id)) await createAgentToolCallRecord(context, call);
    }
    const contentJson = assistantContentJsonFromAgentMessage(message, context);
    const text = textFromAgentAssistantMessage(message) ||
      (message.errorMessage ? String(message.errorMessage) : '') ||
      (toolCalls.length > 0 ? `Requested ${toolCalls.map((call) => toolLabel(call.name, context.db, context.userId)).join(', ')}.` : '');
    const dbMessage = context.db.addMessage(context.userId, context.threadId, {
      role: 'assistant',
      content: text,
      contentJson,
      isError: Boolean(message.errorMessage),
      spokenText: context.thread.voiceEnabled ? text : null,
    });
    recordAssistantModelUsage(context, message);
    context.emit({ type: 'message', message: dbMessage });
    return;
  }

  if (message.role === 'toolResult') {
    if ((message.details as any)?.approvalPending) return;
    if (context.persistedToolResultModelIds.has(message.toolCallId)) return;
    context.persistedToolResultModelIds.add(message.toolCallId);
    const toolCall = context.toolCallsByModelId.get(message.toolCallId);
    const result = (message.details as any)?.result ?? message.details ?? {};
    const content = message.content.filter((part): part is TextContent => part.type === 'text').map((part) => part.text).join('\n');
    const dbMessage = context.db.addMessage(context.userId, context.threadId, {
      role: 'toolResult',
      toolName: message.toolName,
      toolCallId: toolCall?.id ?? message.toolCallId,
      isError: message.isError,
      content,
      contentJson: JSON.stringify(result),
    });
    context.emit({ type: 'message', message: dbMessage });
    if (toolCall) {
      const updatedToolCall = context.db.updateToolCall(context.userId, toolCall.id, {
        status: message.isError ? 'failed' : 'completed',
        resultJson: JSON.stringify(result),
      }) ?? toolCall;
      context.emit({ type: 'tool_result', toolCall: updatedToolCall, result });
    }
  }
}

function textFromAgentUserMessage(message: Extract<AgentMessage, { role: 'user' }>): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.filter((part): part is TextContent => part.type === 'text').map((part) => part.text).join('\n');
}

function textFromAgentAssistantMessage(message: PiAssistantMessage): string {
  return message.content.filter((part): part is TextContent => part.type === 'text').map((part) => part.text).join('\n').trim();
}

function assistantContentJsonFromAgentMessage(message: PiAssistantMessage, context: AgentRunContext): string | null {
  const parts = message.content.flatMap((part): Record<string, unknown>[] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.type === 'thinking') return [{ type: 'thinking', thinking: part.thinking }];
    const toolCall = context.toolCallsByModelId.get(part.id);
    return [{
      type: 'modelToolCall',
      id: toolCall?.id ?? part.id,
      modelCallId: part.id,
      name: normalizeModelToolName(part.name),
      arguments: part.arguments,
    }];
  });
  return parts.length > 0 ? JSON.stringify(parts) : null;
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

function responseToolNames(tools: unknown[]): string[] {
  return tools.map((tool: any) => String(tool?.name ?? '').trim()).filter(Boolean);
}

function threadLoadedSkillToolNames(db: VoiceStreamNextDb, userId: string, thread: AssistantThread): string[] {
  const requestedToolNames = [...new Set(db.listThreadSkills(userId, thread.id).flatMap((skill) => skill.toolNames))];
  return availableSkillToolNames(db, userId, thread, requestedToolNames);
}

function availableSkillToolNames(
  db: VoiceStreamNextDb,
  userId: string,
  thread: AssistantThread,
  requestedToolNames: string[],
): string[] {
  const requested = new Set(requestedToolNames);
  const available = new Set(responseToolNames(responseToolDefinitions(db, userId, thread, { loadedSkillToolNames: requestedToolNames })));
  return [...requested].filter((toolName) => available.has(toolName));
}

function toolCatalogInstruction(db: VoiceStreamNextDb, userId: string, tools: unknown[]): string {
  const names = new Set(responseToolNames(tools));
  if (names.size === 0) return '';
  const summaries = assistantAvailableToolSummaries(db, userId).filter((tool) => names.has(tool.name));
  if (summaries.length === 0) return '';
  const lines = summaries.map((tool) => `- ${tool.label} (${tool.name}): ${tool.description}`);
  return ['Available assistant tools this turn:', ...lines].join('\n');
}

function skillCatalogInstruction(db: VoiceStreamNextDb, userId: string, thread: AssistantThread): string {
  if (!thread.enabledTools.includes('load_skill')) return '';
  const skills = db.listAssistantSkills(userId).filter((skill) => !skill.disableModelInvocation);
  if (skills.length === 0) return '';
  return [
    'Available skills:',
    ...skills.map((skill) => {
      const tools = skill.toolNames.length > 0 ? ` Tools enabled after load: ${skill.toolNames.join(', ')}.` : '';
      return `- ${skill.name} (${skill.slug}): ${skill.description}${tools}`;
    }),
    'Use the load_skill tool before following a skill. Do not invent skill content.',
  ].join('\n');
}

function responseToolDefinitions(
  db: VoiceStreamNextDb,
  userId: string,
  thread: AssistantThread,
  options: { loadedSkillToolNames?: Iterable<string> } = {},
): unknown[] {
  const definitions: unknown[] = [];
  const toolNames = [
    ...thread.enabledTools,
    ...Array.from(options.loadedSkillToolNames ?? []),
  ];
  for (const toolName of [...new Set(toolNames)]) {
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
    if (toolName === 'load_skill') {
      definitions.push({
        type: 'function',
        name: 'load_skill',
        description: 'Load one saved skill by name or slug. The tool returns the full skill instructions and enables the available tool names listed by that skill for this thread.',
        parameters: {
          type: 'object',
          properties: {
            skill: { type: 'string', description: 'The skill name or slug to load.' },
          },
          required: ['skill'],
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
    if (toolName === 'create_new_thread') {
      definitions.push({
        type: 'function',
        name: 'create_new_thread',
        description: 'Open a fresh assistant thread. Only use this after the user explicitly asks to start, open, create, clear, reset, or switch to a new assistant thread or session. In voice mode, the new voice thread becomes the default target for future voice recordings.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Optional title for the new thread. Use an empty string unless the user gave a title.' },
          },
          required: ['title'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'list_execution_targets') {
      definitions.push({
        type: 'function',
        name: 'list_execution_targets',
        description: 'List devices that can run extension tools for this thread. Use before choosing a workspace or device execution target.',
        parameters: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Optional execution slot, such as workspace. Use an empty string for all slots.' },
            extensionId: { type: 'string', description: 'Optional extension id, such as workspace. Use an empty string for all extensions.' },
          },
          required: ['slot', 'extensionId'],
          additionalProperties: false,
        },
        strict: true,
      });
    }
    if (toolName === 'set_execution_target') {
      definitions.push({
        type: 'function',
        name: 'set_execution_target',
        description: 'Select the device this thread should use for extension tools in a named slot. Use only after the user asks to work on a device or after listing targets.',
        parameters: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Execution slot to set, such as workspace.' },
            extensionId: { type: 'string', description: 'Extension id the target is for, such as workspace. Use an empty string if not extension-specific.' },
            deviceId: { type: 'string', description: 'Device id returned by list_execution_targets.' },
          },
          required: ['slot', 'extensionId', 'deviceId'],
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
      continue;
    }
    if (!isBuiltInTool(toolName)) {
      const route = db.assistantExtensionToolRoute(userId, toolName);
      const manifestTool = db.assistantExtensionToolManifest(userId, toolName);
      if (!route?.enabled || !manifestTool) continue;
      definitions.push(extensionToolDefinition(manifestTool.manifest, manifestTool.tool));
    }
  }
  return definitions;
}

function modelInstructions(input: {
  settings: AssistantSettingsRecord;
  thread: AssistantThread;
  profileSystemPrompt?: string | null;
  toolInstruction?: string;
  skillInstruction?: string;
  allowToolCalls: boolean;
}): string {
  const basePrompt = input.thread.voiceEnabled ? input.settings.voiceSystemPrompt : input.settings.normalSystemPrompt;
  return [
    input.profileSystemPrompt || basePrompt,
    input.thread.systemPrompt ? `Thread system prompt:\n${input.thread.systemPrompt}` : '',
    input.skillInstruction,
    input.allowToolCalls ? input.toolInstruction : '',
    input.allowToolCalls
      ? 'You may call the provided assistant tools when they help. Prefer tools for artifacts, spoken replies, web searches, fetched URL content, prompt reads/updates, and thread settings instead of describing those actions. Use web_search for current information, documentation, news, prices, or facts that may have changed. Use fetch_content when the user gives a direct URL to read, inspect, summarize, or analyze. Cite source URLs in the final answer. Never write XML, JSON, or pseudo function-call syntax in normal assistant text; use the API tool call channel for tool calls.'
      : 'No assistant tools are available in this follow-up response. Use the already executed tool outputs to answer the user concisely, and do not write XML, JSON, or pseudo function-call syntax for tool calls.',
  ].filter(Boolean).join('\n\n');
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

function isBuiltInTool(toolName: string): boolean {
  return ASSISTANT_TOOLS.some((tool) => tool.name === toolName);
}

function approvalView(approval: AssistantApprovalRecord): AssistantApprovalView {
  return { ...approval, args: safeJson(approval.argsJson) };
}

function skillLoadedView(skill: AssistantSkillRecord): AssistantLoadedSkillView {
  return { id: skill.id, slug: skill.slug, name: skill.name };
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

function platformOpenAiApiKey(): string {
  return process.env.VOICE_STREAM_NEXT_PLATFORM_OPENAI_API_KEY?.trim() || '';
}

function platformExaApiKey(): string {
  return process.env.VOICE_STREAM_NEXT_PLATFORM_EXA_API_KEY?.trim() || '';
}

function creditMarkupMultiplier(): number {
  const value = Number(process.env.VOICE_STREAM_NEXT_CREDIT_MARKUP ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function dollarsToVendorMicros(dollars: number): number {
  return Math.max(0, Math.round((Number.isFinite(dollars) ? dollars : 0) * USD_MICROS_PER_DOLLAR));
}

function dollarsToChargedMicrocredits(dollars: number): number {
  return Math.max(0, Math.round((Number.isFinite(dollars) ? dollars : 0) * MICROCREDITS_PER_DOLLAR * creditMarkupMultiplier()));
}

function resolveOpenAiCredential(db: VoiceStreamNextDb, userId: string): { apiKey: string; source: BillableCredentialSource } | null {
  const userKey = db.assistantApiKey(userId, 'openai');
  if (userKey) return { apiKey: userKey, source: 'user_openai_key' };
  const platformKey = platformOpenAiApiKey();
  if (platformKey) return { apiKey: platformKey, source: 'platform_openai_key' };
  return null;
}

function resolveExaCredential(db: VoiceStreamNextDb, userId: string): { apiKey: string; source: BillableCredentialSource } | null {
  const userKey = db.assistantApiKey(userId, 'exa');
  if (userKey) return { apiKey: userKey, source: 'user_exa_key' };
  const platformKey = platformExaApiKey();
  if (platformKey) return { apiKey: platformKey, source: 'platform_exa_key' };
  return null;
}

function requireCreditsForPlatformCredential(db: VoiceStreamNextDb, userId: string, source: BillableCredentialSource, label: string): void {
  if (!source.startsWith('platform_')) return;
  db.requirePositiveCreditBalance(userId, label);
}

function recordAssistantModelUsage(context: AgentRunContext, message: PiAssistantMessage): void {
  if (context.modelCredentialSource !== 'platform_openai_key') return;
  const costDollars = Number(message.usage?.cost?.total ?? 0);
  const vendorCostMicros = dollarsToVendorMicros(costDollars);
  const chargedMicrocredits = dollarsToChargedMicrocredits(costDollars);
  context.db.recordBillableUsage({
    userId: context.userId,
    threadId: context.threadId,
    runId: context.run.id,
    service: 'openai',
    provider: 'openai',
    credentialSource: context.modelCredentialSource,
    model: message.responseModel ?? message.model ?? context.run.model,
    operation: 'assistant_turn',
    inputTokens: message.usage?.input ?? 0,
    outputTokens: message.usage?.output ?? 0,
    cacheReadTokens: message.usage?.cacheRead ?? 0,
    cacheWriteTokens: message.usage?.cacheWrite ?? 0,
    vendorCostMicros,
    chargedMicrocredits,
    status: message.errorMessage ? 'failed' : 'succeeded',
    metadata: {
      responseId: message.responseId ?? null,
      stopReason: message.stopReason,
      requestedModel: context.run.model,
      thinkingLevel: context.run.thinkingLevel,
    },
  });
}

function recordExaUsage(
  db: VoiceStreamNextDb,
  userId: string,
  thread: AssistantThread,
  toolName: 'web_search' | 'fetch_content',
  credentialSource: BillableCredentialSource,
  result: any,
  context: { runId?: string | null; toolCallId?: string } = {},
): void {
  if (credentialSource !== 'platform_exa_key') return;
  const fallbackCostDollars = toolName === 'web_search' ? EXA_SEARCH_FALLBACK_COST_DOLLARS : EXA_FETCH_CONTENT_FALLBACK_COST_DOLLARS;
  const costDollars = Number.isFinite(Number(result?.costDollars)) ? Number(result.costDollars) : fallbackCostDollars;
  db.recordBillableUsage({
    userId,
    threadId: thread.id,
    runId: context.runId ?? null,
    toolCallId: context.toolCallId ?? null,
    service: 'exa',
    provider: 'exa',
    credentialSource,
    operation: toolName,
    unitCount: toolName === 'web_search' ? 1 : 1,
    vendorCostMicros: dollarsToVendorMicros(costDollars),
    chargedMicrocredits: dollarsToChargedMicrocredits(costDollars),
    status: 'succeeded',
    metadata: toolName === 'web_search'
      ? { query: result?.query ?? null, resultCount: Array.isArray(result?.results) ? result.results.length : 0, elapsedMs: result?.elapsedMs ?? null }
      : { url: result?.url ?? null, elapsedMs: result?.elapsedMs ?? null },
  });
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
  const needsApproval = await approvalRequiredFor(db, userId, thread, toolName, args);
  const toolCall = db.createToolCall(userId, threadId, {
    runId: run.id,
    toolName,
    args,
    approvalRequired: needsApproval,
  });
  db.addMessage(userId, threadId, {
    role: 'assistant',
    content: `Requested ${toolLabel(toolName, db, userId)}.`,
    contentJson: JSON.stringify([{ type: 'toolCall', id: toolCall.id, name: toolName, arguments: args }]),
  });

  if (needsApproval) {
    const approval = db.createApproval(userId, threadId, {
      runId: run.id,
      toolCallId: toolCall.id,
      toolName,
      label: toolLabel(toolName, db, userId),
      args,
    });
    const snapshot = assistantSnapshot(db, userId, threadId);
    emit({ type: 'approval_pending', approval: approvalView(approval), snapshot });
    return snapshot;
  }

  try {
    const result = await executeApprovedTool(db, userId, thread, toolName, args, {
      runId: run.id,
      toolCallId: toolCall.id,
    });
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

async function executeApprovedTool(
  db: VoiceStreamNextDb,
  userId: string,
  thread: AssistantThread,
  toolName: string,
  args: unknown,
  context: { runId?: string | null; toolCallId?: string } = {},
): Promise<unknown> {
  const parsed = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  if (toolName === 'assistant_artifacts') return executeArtifactTool(db, userId, thread.id, parsed);
  if (toolName === 'load_skill') {
    const skillName = String(parsed.skill ?? parsed.name ?? parsed.slug ?? '').trim();
    if (!skillName) throw Object.assign(new Error('skill name is required'), { statusCode: 400 });
    const skill = db.assistantSkillByName(userId, skillName);
    if (!skill) throw Object.assign(new Error(`unknown skill: ${skillName}`), { statusCode: 404 });
    const enabledToolNames = availableSkillToolNames(db, userId, thread, skill.toolNames);
    const enabledToolNameSet = new Set(enabledToolNames);
    const unavailableToolNames = skill.toolNames.filter((item) => !enabledToolNameSet.has(item));
    db.loadThreadSkill(userId, thread.id, skill.id);
    return {
      ok: true,
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      toolNames: enabledToolNames,
      requestedToolNames: skill.toolNames,
      unavailableToolNames,
      content: formatLoadedSkillContent(skill, enabledToolNames, unavailableToolNames),
    };
  }
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
    const profilePrompt = db.resolvedAssistantProfileSystemPrompt(userId, thread.assistantProfileId);
    return {
      ok: true,
      threadPrompt: thread.systemPrompt,
      profilePrompt,
      globalPrompt: thread.voiceEnabled ? settings.voiceSystemPrompt : settings.normalSystemPrompt,
      source: thread.systemPrompt ? 'thread' : profilePrompt ? 'profile' : 'global',
    };
  }
  if (toolName === 'set_thinking_level') {
    const thinkingLevel = cleanThinkingLevel(parsed.thinkingLevel);
    const updated = db.updateThread(userId, thread.id, { thinkingLevel });
    return { ok: true, thinkingLevel: updated?.thinkingLevel ?? thinkingLevel };
  }
  if (toolName === 'create_new_thread') {
    const title = String(parsed.title ?? '').trim() || 'New thread';
    const created = db.createThread(userId, {
      title,
      source: 'voice',
      assistantProfileId: thread.assistantProfileId,
      voiceEnabled: true,
      provider: thread.provider,
      model: thread.model,
      thinkingLevel: thread.thinkingLevel,
      promptDeliveryMode: thread.promptDeliveryMode,
    });
    return {
      ok: true,
      previousThreadId: thread.id,
      threadId: created.id,
      thread: created,
      voiceDefaultForRecordings: created.voiceEnabled,
    };
  }
  if (toolName === 'list_execution_targets') {
    return listExecutionTargets(db, userId, thread, {
      slot: String(parsed.slot ?? '').trim(),
      extensionId: String(parsed.extensionId ?? '').trim(),
    });
  }
  if (toolName === 'set_execution_target') {
    return setExecutionTarget(db, userId, thread, {
      slot: String(parsed.slot ?? '').trim(),
      extensionId: String(parsed.extensionId ?? '').trim(),
      deviceId: String(parsed.deviceId ?? '').trim(),
    });
  }
  if (toolName === 'web_search') {
    const credential = resolveExaCredential(db, userId);
    if (!credential) throw Object.assign(new Error('Exa API key is not configured. Add your Exa key in assistant settings or ask an admin to enable platform credits.'), { statusCode: 400 });
    requireCreditsForPlatformCredential(db, userId, credential.source, 'Exa web search');
    const result = await searchWeb({
      query: String(parsed.query ?? ''),
      numResults: parsed.numResults == null || parsed.numResults === '' ? undefined : Number(parsed.numResults),
      recencyFilter: cleanRecencyFilter(parsed.recencyFilter),
      domainFilter: Array.isArray(parsed.domainFilter) ? parsed.domainFilter.map((item) => String(item ?? '')) : [],
    }, credential.apiKey);
    recordExaUsage(db, userId, thread, 'web_search', credential.source, result, context);
    return result;
  }
  if (toolName === 'fetch_content') {
    const credential = resolveExaCredential(db, userId);
    if (!credential) throw Object.assign(new Error('Exa API key is not configured. Add your Exa key in assistant settings or ask an admin to enable platform credits.'), { statusCode: 400 });
    requireCreditsForPlatformCredential(db, userId, credential.source, 'Exa content fetch');
    const result = await fetchContent({
      url: String(parsed.url ?? ''),
      maxCharacters: parsed.maxCharacters == null || parsed.maxCharacters === '' ? undefined : Number(parsed.maxCharacters),
      livecrawl: cleanLivecrawl(parsed.livecrawl),
    }, credential.apiKey);
    recordExaUsage(db, userId, thread, 'fetch_content', credential.source, result, context);
    return result;
  }
  const manifestTool = db.assistantExtensionToolManifest(userId, toolName);
  if (manifestTool) {
    const route = assistantExtensionRouteForThread(db, userId, thread, toolName);
    if (!route?.enabled) throw Object.assign(new Error(`${toolLabel(toolName, db, userId)} is not configured`), { statusCode: 403 });
    if (!externalToolExecutor) throw Object.assign(new Error('assistant extension executor is not configured'), { statusCode: 500 });
    return externalToolExecutor({
      db,
      userId,
      thread,
      toolName,
      args,
      route,
      runId: context.runId,
      toolCallId: context.toolCallId,
    });
  }
  throw Object.assign(new Error(`unknown assistant tool: ${toolName}`), { statusCode: 400 });
}

async function listExecutionTargets(
  db: VoiceStreamNextDb,
  userId: string,
  thread: AssistantThread,
  input: { slot?: string; extensionId?: string },
): Promise<unknown> {
  const slot = cleanExecutionSlot(input.slot);
  const extensionId = cleanExtensionId(input.extensionId);
  const activeTargets = db.listAssistantThreadExecutionTargets(userId, thread.id);
  const provided = executionTargetProvider
    ? await executionTargetProvider({ db, userId, thread, slot, extensionId })
    : fallbackExecutionTargets(db, userId);
  const devices = provided.devices
    .map((device) => ({
      ...device,
      manifests: device.manifests
        .filter((manifest) => !extensionId || manifest.id === extensionId)
        .map((manifest) => ({
          ...manifest,
          toolNames: manifest.toolNames.filter((toolName) => toolMatchesSlot(db, userId, toolName, slot)),
          slots: slot ? manifest.slots.filter((item) => item === slot) : manifest.slots,
        }))
        .filter((manifest) => manifest.toolNames.length > 0 || manifest.slots.length > 0),
    }))
    .filter((device) => device.manifests.length > 0);
  return {
    ok: true,
    slot,
    extensionId,
    activeTargets,
    devices,
  };
}

async function setExecutionTarget(
  db: VoiceStreamNextDb,
  userId: string,
  thread: AssistantThread,
  input: { slot: string; extensionId?: string; deviceId: string },
): unknown {
  const slot = cleanExecutionSlot(input.slot);
  if (!slot) throw Object.assign(new Error('execution target slot is required'), { statusCode: 400 });
  const extensionId = cleanExtensionId(input.extensionId);
  const deviceId = String(input.deviceId ?? '').trim();
  if (!deviceId) throw Object.assign(new Error('target device id is required'), { statusCode: 400 });
  const device = db.deviceForUser(userId, deviceId);
  if (!device) throw Object.assign(new Error('unknown target device'), { statusCode: 404 });
  const matchingTools = db.listAssistantExtensionManifests(userId)
    .filter((record) => !extensionId || record.extensionId === extensionId)
    .flatMap((record) => record.manifest.tools
      .filter((tool) => tool.targetSlot === slot && tool.supportedTargets.includes('device'))
      .map((tool) => extensionToolName(record.extensionId, tool.name)));
  if (extensionId && matchingTools.length === 0) {
    throw Object.assign(new Error(`extension ${extensionId} does not expose tools for ${slot}`), { statusCode: 400 });
  }
  if (executionTargetProvider) {
    const provided = await executionTargetProvider({ db, userId, thread, slot, extensionId });
    const connectedTarget = provided.devices.find((item) =>
      item.deviceId === device.id &&
      item.connected &&
      item.manifests.some((manifest) =>
        (!extensionId || manifest.id === extensionId) &&
        (manifest.slots.includes(slot) || manifest.toolNames.some((toolName) => matchingTools.includes(toolName))),
      ),
    );
    if (!connectedTarget) {
      throw Object.assign(new Error(`${device.displayName} is not connected for ${slot}`), { statusCode: 409 });
    }
  }
  const target = db.upsertAssistantThreadExecutionTarget(userId, thread.id, {
    slot,
    targetKind: 'device',
    targetDeviceId: device.id,
  });
  return {
    ok: true,
    target,
    device: {
      id: device.id,
      displayName: device.displayName,
      deviceType: device.deviceType,
    },
    extensionId,
    toolNames: matchingTools,
  };
}

function fallbackExecutionTargets(db: VoiceStreamNextDb, userId: string): { devices: AssistantExecutionTargetDevice[] } {
  const manifests = db.listAssistantExtensionManifests(userId).map((record) => ({
    id: record.extensionId,
    name: record.name,
    toolNames: record.manifest.tools.map((tool) => extensionToolName(record.extensionId, tool.name)),
    slots: [...new Set(record.manifest.tools.map((tool) => tool.targetSlot).filter(Boolean) as string[])],
  }));
  return {
    devices: db.listDevices(userId).map((device) => ({
      deviceId: device.id,
      deviceType: device.deviceType,
      displayName: device.displayName,
      connected: false,
      manifests,
    })),
  };
}

function assistantExtensionRouteForThread(
  db: VoiceStreamNextDb,
  userId: string,
  thread: AssistantThread,
  toolName: string,
): AssistantExtensionToolRoute | null {
  const route = db.assistantExtensionToolRoute(userId, toolName);
  const manifestTool = db.assistantExtensionToolManifest(userId, toolName);
  const slot = manifestTool?.tool.targetSlot;
  if (!route || !slot) return route;
  const target = db.assistantThreadExecutionTarget(userId, thread.id, slot);
  if (!target) return route;
  if (!manifestTool.tool.supportedTargets.includes(target.targetKind)) return route;
  return {
    ...route,
    targetKind: target.targetKind,
    targetDeviceId: target.targetKind === 'device' ? target.targetDeviceId : null,
    updatedAt: target.updatedAt,
  };
}

function toolMatchesSlot(db: VoiceStreamNextDb, userId: string, toolName: string, slot: string): boolean {
  if (!slot) return true;
  const manifestTool = db.assistantExtensionToolManifest(userId, toolName);
  return manifestTool?.tool.targetSlot === slot;
}

function cleanExecutionSlot(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function cleanExtensionId(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
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

function formatLoadedSkillContent(skill: AssistantSkillRecord, enabledToolNames = skill.toolNames, unavailableToolNames: string[] = []): string {
  return [
    `# ${skill.name}`,
    '',
    `Description: ${skill.description}`,
    enabledToolNames.length > 0 ? `Enabled tools for this thread: ${enabledToolNames.join(', ')}` : 'Enabled tools for this thread: none',
    unavailableToolNames.length > 0 ? `Unavailable tool names ignored: ${unavailableToolNames.join(', ')}` : '',
    '',
    String(skill.markdownBody ?? '').trim(),
  ].filter((part) => part !== '').join('\n');
}

function patchText(current: string, oldText: string, newText: string, label: string): string {
  if (!oldText) throw Object.assign(new Error(`${label} patch oldText is required`), { statusCode: 400 });
  const index = current.indexOf(oldText);
  if (index < 0) throw Object.assign(new Error(`${label} patch oldText was not found`), { statusCode: 409 });
  return `${current.slice(0, index)}${newText}${current.slice(index + oldText.length)}`;
}

function ensureToolEnabled(thread: AssistantThread, toolName: string, loadedSkillToolNames: ReadonlySet<string> = new Set()): void {
  if (thread.enabledTools.includes(toolName) || loadedSkillToolNames.has(toolName)) return;
  throw Object.assign(new Error(`${toolLabel(toolName)} is disabled for this thread`), { statusCode: 403 });
}

function ensureCapability(thread: AssistantThread, toolName: string): void {
  const caps: AssistantThreadCapabilities = thread.capabilities;
  if (toolName === 'assistant_artifacts' && !caps.artifacts) throw Object.assign(new Error('artifact capability is disabled'), { statusCode: 403 });
  if (toolName === 'speak' && !caps.speech) throw Object.assign(new Error('speech capability is disabled'), { statusCode: 403 });
  if ((toolName === 'web_search' || toolName === 'fetch_content') && !caps.externalCalls) throw Object.assign(new Error('external call capability is disabled'), { statusCode: 403 });
}

async function approvalRequiredFor(db: VoiceStreamNextDb, userId: string, thread: AssistantThread, toolName: string, args: unknown): Promise<boolean> {
  if (thread.autoApprove) return false;
  if (!thread.capabilities.approvals) return false;
  const summary = ASSISTANT_TOOLS.find((tool) => tool.name === toolName);
  const extension = summary ? null : db.assistantExtensionToolManifest(userId, toolName);
  const approval = summary?.approval ?? (extension ? extension.tool.approval ?? 'always' : 'never');
  if (approval === 'always') return true;
  if (approval === 'normal_threads') return !thread.voiceEnabled;
  if (approval === 'dynamic') {
    const route = assistantExtensionRouteForThread(db, userId, thread, toolName);
    if (!route?.enabled || !externalToolApprovalEvaluator) return true;
    try {
      return await externalToolApprovalEvaluator({ db, userId, thread, toolName, args, route });
    } catch {
      return true;
    }
  }
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

function toolLabel(toolName: string, db?: VoiceStreamNextDb, userId?: string): string {
  const builtIn = ASSISTANT_TOOLS.find((tool) => tool.name === toolName);
  if (builtIn) return builtIn.label;
  if (db && userId) {
    const manifestTool = db.assistantExtensionToolManifest(userId, toolName);
    if (manifestTool) return extensionToolSummary(manifestTool.manifest, manifestTool.tool).label;
  }
  return toolName.replace(/_/g, ' ');
}

function toolResultText(toolName: string, result: unknown): string {
  if (toolName === 'assistant_artifacts') {
    const artifact = (result as any)?.artifact;
    if (Array.isArray((result as any)?.artifacts)) return `${(result as any).count ?? (result as any).artifacts.length} assistant artifact file(s).`;
    if (artifact?.path) return `Artifact updated: ${artifact.path}`;
    if ((result as any)?.deleted) return `Artifact deleted: ${(result as any).path}`;
    return 'Artifact tool completed.';
  }
  if (toolName === 'load_skill') {
    const tools = Array.isArray((result as any)?.toolNames) ? (result as any).toolNames : [];
    return `Loaded skill: ${(result as any)?.name ?? 'skill'}${tools.length > 0 ? ` (${tools.length} tool${tools.length === 1 ? '' : 's'} enabled)` : ''}.`;
  }
  if (toolName === 'speak') return `Spoken reply prepared: ${String((result as any)?.text ?? '').slice(0, 120)}`;
  if (toolName === 'web_search') return String((result as any)?.answer ?? 'Web search completed.');
  if (toolName === 'fetch_content') return String((result as any)?.answer ?? 'Content fetch completed.');
  if (toolName === 'update_system_prompt') return 'Thread system prompt updated.';
  if (toolName === 'set_thinking_level') return `Thinking level set to ${(result as any)?.thinkingLevel ?? 'off'}.`;
  if (toolName === 'create_new_thread') {
    const thread = (result as any)?.thread;
    return `Created a new thread: ${thread?.title ?? 'New thread'}. Future voice recordings will use it by default.`;
  }
  return 'Tool completed.';
}

function modelVisibleToolResultText(toolName: string, result: unknown): string {
  const json = safeStringify(result);
  if (!json) return toolResultText(toolName, result);
  return `${toolResultText(toolName, result)}\n\nResult JSON:\n${json}`;
}

function approvedAssistantText(toolName: string, result: unknown): string {
  if (toolName === 'speak') return String((result as any)?.text ?? 'Spoken reply prepared.');
  return toolResultText(toolName, result);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function cleanRecencyFilter(raw: unknown): 'day' | 'week' | 'month' | 'year' | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'day' || value === 'week' || value === 'month' || value === 'year' ? value : undefined;
}

function cleanLivecrawl(raw: unknown): 'never' | 'fallback' | 'preferred' | 'always' | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'never' || value === 'fallback' || value === 'preferred' || value === 'always' ? value : undefined;
}
