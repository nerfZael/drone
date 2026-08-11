import { createBlipSession, createPortableId, type BlipRuntimeEvent } from '@blip/core';
import { mergeWorkspaceTransferProgress } from '@drone/assistant-chat';
import { Type, type AgentTool } from '@mariozechner/pi-agent-core/portable';
import type { Model } from '@mariozechner/pi-ai/agent-core';
import type { LocalCodexAuth } from './codex-auth-format';
import { createCodexMobileStream } from './codex-chat-client';
import type {
  LocalAssistantMessage,
  LocalAssistantPromptImage,
  LocalAssistantThread,
  LocalBlipSessionSnapshot,
} from './local-assistant-types';
import { mobileAssistantSystemPrompt } from './mobile-assistant-prompt';
import {
  MobileSessionRepository,
  type MobileSessionSnapshotWriter,
} from './mobile-session-repository';
import { createOpenAiMobileStream } from './openai-chat-client';
import type { MobileWorkspaceToolRuntime } from './workspace-tools';

function mobileModel(provider: 'openai' | 'codex', modelId: string): Model<any> {
  return {
    id: modelId,
    name: modelId,
    provider: provider === 'codex' ? 'openai-codex' : 'openai',
    api: provider === 'codex' ? 'mobile-openai-codex' : 'mobile-openai',
    baseUrl: provider === 'codex' ? 'https://chatgpt.com' : 'https://api.openai.com',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_000,
  } as Model<any>;
}

function workspaceAgentTools(runtime: MobileWorkspaceToolRuntime): AgentTool<any>[] {
  return runtime.tools.map((tool) => ({
    name: tool.function.name,
    label: tool.function.name,
    description: tool.function.description,
    parameters: Type.Unsafe(tool.function.parameters),
    execute: async (_callId, args, signal, onUpdate) => {
      const result = await runtime.execute({
        name: tool.function.name,
        args: args as Record<string, unknown>,
        signal,
        onOutput: (update) =>
          onUpdate?.({
            content: [{ type: 'text', text: update.text }],
            details: update.details,
          }),
      });
      return {
        content: [{ type: 'text', text: result.text }],
        details: result.details,
      };
    },
  }));
}

function hasVisibleAssistantContent(message: LocalAssistantMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (message.errorMessage) return true;
  if (typeof message.content === 'string') return Boolean(message.content.trim());
  if (!Array.isArray(message.content)) return false;
  return message.content.some(
    (part: any) =>
      (part?.type === 'text' && String(part.text ?? '').trim()) ||
      part?.type === 'image' ||
      part?.type === 'image_url',
  );
}

function hasTerminalAssistantReply(messages: LocalAssistantMessage[]): boolean {
  let lastUserIndex = -1;
  let lastToolResultIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index;
    if (message.role === 'toolResult' && index > lastUserIndex) lastToolResultIndex = index;
  });
  const afterIndex = Math.max(lastUserIndex, lastToolResultIndex);
  return messages.slice(afterIndex + 1).some(hasVisibleAssistantContent);
}

export async function runMobileBlip(input: {
  provider: 'openai' | 'codex';
  apiKey: string | null;
  codexAuth: LocalCodexAuth | null;
  prompt: string;
  promptImages?: LocalAssistantPromptImage[];
  thread: LocalAssistantThread;
  history: LocalAssistantMessage[];
  workspaceRuntime: MobileWorkspaceToolRuntime;
  signal: AbortSignal;
  onMessages(messages: LocalAssistantMessage[]): Promise<void>;
  onStreamingMessages(messages: LocalAssistantMessage[]): Promise<void> | void;
  sessionSnapshot?: LocalBlipSessionSnapshot | null;
  onSessionSnapshot?: MobileSessionSnapshotWriter;
  onDeleteSession?(): Promise<void>;
  requestExecuteApproval?(input: {
    toolName: 'bash';
    args: any;
    signal?: AbortSignal;
  }): Promise<boolean>;
}): Promise<LocalAssistantMessage[]> {
  const providerId = input.provider === 'codex' ? 'openai-codex' : 'openai';
  const repository = new MobileSessionRepository(
    input.thread,
    input.history,
    providerId,
    input.onMessages,
    input.sessionSnapshot,
    input.onSessionSnapshot,
    input.onDeleteSession,
  );
  const model = mobileModel(input.provider, input.thread.model);
  if (input.provider === 'codex' && !input.codexAuth) throw new Error('Codex login is unavailable');
  if (input.provider === 'openai' && !input.apiKey)
    throw new Error('OpenAI API key is unavailable');
  const streamFn =
    input.provider === 'codex'
      ? createCodexMobileStream(input.codexAuth!, input.thread.id)
      : createOpenAiMobileStream(input.apiKey!);
  let streamedText = '';
  let finishedError = '';
  let previewId = `preview_${createPortableId()}`;
  const toolProgressDetails = new Map<string, unknown>();
  const eventSink = async (event: BlipRuntimeEvent) => {
    if (event.type === 'turn_started') {
      streamedText = '';
      previewId = `preview_${createPortableId()}`;
    } else if (event.type === 'assistant_delta') {
      streamedText += event.text;
      await input.onStreamingMessages([
        ...repository.localMessages(),
        {
          id: previewId,
          createdAt: new Date().toISOString(),
          role: 'assistant',
          content: [{ type: 'text', text: streamedText.slice(-48_000) }],
        },
      ]);
    } else if (event.type === 'tool_call_progress') {
      const details = mergeWorkspaceTransferProgress(
        toolProgressDetails.get(event.callId),
        event.details,
      );
      toolProgressDetails.set(event.callId, details);
      await input.onStreamingMessages([
        ...repository.localMessages(),
        {
          id: `preview_${event.callId}`,
          createdAt: new Date().toISOString(),
          role: 'toolResult',
          toolCallId: event.callId,
          toolName: event.tool,
          content: event.message,
          details,
        },
      ]);
    } else if (event.type === 'tool_call_completed' || event.type === 'tool_call_failed') {
      toolProgressDetails.delete(event.callId);
    } else if (event.type === 'session_finished') {
      toolProgressDetails.clear();
      finishedError = event.status === 'error' ? String(event.error ?? 'Assistant run failed') : '';
    }
  };
  const readOnlyDeniedTools = new Set([
    'write_file',
    'delete_file',
    'create_directory',
    'delete_directory',
    'move_path',
    'apply_patch',
    'transfer_files',
  ]);
  const agentPermissionMode = input.thread.agentPermissionMode ?? 'execute';
  const handle = await createBlipSession({
    workspaceRoot: 'mobile-mesh',
    model,
    permissionMode:
      agentPermissionMode === 'read'
        ? 'read-only'
        : agentPermissionMode === 'execute'
          ? 'full-access'
          : 'workspace-write',
    toolProfile:
      agentPermissionMode === 'read'
        ? 'read-only'
        : agentPermissionMode === 'execute'
          ? 'local-trusted-write'
          : 'no-shell-workspace-write',
    sessionRepository: repository,
    sessionId: repository.state.id,
    reasoning: input.thread.thinkingLevel,
    tools: workspaceAgentTools(input.workspaceRuntime).filter((tool) => {
      if (agentPermissionMode !== 'execute' && tool.name === 'bash') return false;
      if (agentPermissionMode !== 'read') return true;
      return !readOnlyDeniedTools.has(tool.name);
    }),
    permissionPreflight: async (request) => {
      if (request.tool !== 'bash') return { status: 'allow' };
      const toolArgs = (request.args ?? {}) as Record<string, unknown>;
      const approvalArgs = input.workspaceRuntime.resolveExecutionApproval(toolArgs);
      // Freeze the resolved target before asking so a concurrent set_target call cannot
      // substitute a different workspace after the user approves.
      toolArgs.target = approvalArgs.resolved.targetId;
      const approved = input.requestExecuteApproval
        ? await input.requestExecuteApproval({
            toolName: 'bash',
            args: approvalArgs,
            signal: request.signal,
          })
        : false;
      return approved
        ? { status: 'allow' }
        : { status: 'deny', reason: 'User denied bash execution.' };
    },
    streamFn,
    promptProvider: () => mobileAssistantSystemPrompt(input.thread),
    eventSink,
    compactionSettings: {
      auto: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
      keepRecentTurns: 2,
    },
  });
  const abort = () => handle.abort();
  input.signal.addEventListener('abort', abort, { once: true });
  if (input.signal.aborted) handle.abort();
  try {
    await handle.prompt({ text: input.prompt, images: input.promptImages ?? [] });
    if (input.signal.aborted)
      throw Object.assign(new Error('Assistant run stopped'), { name: 'AbortError' });
    if (finishedError) throw new Error(finishedError);
    const messages = repository.localMessages();
    if (!hasTerminalAssistantReply(messages)) {
      throw new Error(
        'The assistant finished without a final response. Any completed tool results were kept; send another message to continue.',
      );
    }
    return messages;
  } finally {
    input.signal.removeEventListener('abort', abort);
    handle.close();
    await repository.flush();
  }
}
