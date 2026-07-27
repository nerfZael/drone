/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
  type AssistantMessage,
  type Context,
  estimateContextTokens,
  EventStream,
  isContextOverflow,
  streamSimple,
  type ToolResultMessage,
  validateToolArguments,
} from '@mariozechner/pi-ai/agent-core';
import {
  type AgentContext,
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  type AgentTool,
  type AgentToolCall,
  type AgentToolResult,
  type AgentToolSuspension,
  type AgentToolSuspendedCall,
  type StreamFn,
} from './types.js';
import { agentToolErrorResult, executeAgentTool } from './tool-execution.js';

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
  const stream = createAgentStream();

  void runAgentLoop(
    prompts,
    context,
    config,
    async (event) => {
      stream.push(event);
    },
    signal,
    streamFn,
  ).then((messages) => {
    stream.end(messages);
  });

  return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error('Cannot continue: no messages in context');
  }

  if (context.messages[context.messages.length - 1].role === 'assistant') {
    throw new Error('Cannot continue from message role: assistant');
  }

  const stream = createAgentStream();

  void runAgentLoopContinue(
    context,
    config,
    async (event) => {
      stream.push(event);
    },
    signal,
    streamFn,
  ).then((messages) => {
    stream.end(messages);
  });

  return stream;
}

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: 'agent_start' });
  await emit({ type: 'turn_start' });
  for (const prompt of prompts) {
    await emit({ type: 'message_start', message: prompt });
    await emit({ type: 'message_end', message: prompt });
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error('Cannot continue: no messages in context');
  }

  if (context.messages[context.messages.length - 1].role === 'assistant') {
    throw new Error('Cannot continue from message role: assistant');
  }

  const newMessages: AgentMessage[] = [];
  const currentContext: AgentContext = { ...context };

  await emit({ type: 'agent_start' });
  await emit({ type: 'turn_start' });

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === 'agent_end',
    (event: AgentEvent) => (event.type === 'agent_end' ? event.messages : []),
  );
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let firstTurn = true;
  // Check for steering messages at start (user may have typed while waiting)
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  // Outer loop: continues when queued follow-up messages arrive after agent would stop
  while (true) {
    let hasMoreToolCalls = true;

    // Inner loop: process tool calls and steering messages
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!firstTurn) {
        await emit({ type: 'turn_start' });
      } else {
        firstTurn = false;
      }

      // Process pending messages (inject before next assistant response)
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: 'message_start', message });
          await emit({ type: 'message_end', message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // Stream assistant response
      const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
      newMessages.push(message);

      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        await emit({ type: 'turn_end', message, toolResults: [] });
        await emit({ type: 'agent_end', messages: newMessages });
        return;
      }

      // Check for tool calls
      const toolCalls = message.content.filter((c) => c.type === 'toolCall');

      const toolResults: ToolResultMessage[] = [];
      let suspendedToolCall: AgentToolSuspendedCall | undefined;
      hasMoreToolCalls = false;
      if (toolCalls.length > 0) {
        const executedToolBatch = await executeToolCalls(
          currentContext,
          message,
          config,
          signal,
          emit,
        );
        toolResults.push(...executedToolBatch.messages);
        suspendedToolCall = executedToolBatch.suspendedToolCall;
        hasMoreToolCalls = !executedToolBatch.terminate;

        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      await emit({ type: 'turn_end', message, toolResults, suspendedToolCall });

      if (suspendedToolCall) {
        await emit({ type: 'agent_end', messages: newMessages, suspendedToolCall });
        return;
      }

      if (
        await config.shouldStopAfterTurn?.({
          message,
          toolResults,
          context: currentContext,
          newMessages,
        })
      ) {
        await emit({ type: 'agent_end', messages: newMessages });
        return;
      }

      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    // Agent would stop here. Check for follow-up messages.
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      // Set as pending so inner loop processes them
      pendingMessages = followUpMessages;
      continue;
    }

    // No more messages, exit
    break;
  }

  await emit({ type: 'agent_end', messages: newMessages });
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<AssistantMessage> {
  const streamFunction = streamFn || streamSimple;
  let attempt = 0;
  let reason: 'preflight' | 'overflow' = 'preflight';

  while (true) {
    let requestMessages = context.messages;
    const estimate = async (messages: AgentMessage[] = requestMessages) => {
      let transformed = messages;
      if (config.transformContext) {
        transformed = await config.transformContext(transformed, signal);
      }
      return estimateContextTokens(config.model, {
        systemPrompt: context.systemPrompt,
        messages: await config.convertToLlm(transformed),
        tools: context.tools,
      });
    };
    const prepared = await config.beforeModelCall?.(
      {
        context: {
          ...context,
          messages: [...context.messages],
          tools: context.tools?.slice(),
        },
        reason,
        attempt,
        estimate,
      },
      signal,
    );
    if (prepared?.messages) {
      requestMessages = [...prepared.messages];
      if (prepared.replaceContext) {
        context.messages = [...requestMessages];
        await emit({
          type: 'context_replaced',
          messages: [...requestMessages],
          reason: prepared.reason,
        });
      }
    }

    let transformedMessages = requestMessages;
    if (config.transformContext) {
      transformedMessages = await config.transformContext(transformedMessages, signal);
    }
    const llmContext: Context = {
      systemPrompt: context.systemPrompt,
      messages: await config.convertToLlm(transformedMessages),
      tools: context.tools,
    };
    const resolvedApiKey =
      (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) ||
      config.apiKey;
    const response = await streamFunction(config.model, llmContext, {
      ...config,
      apiKey: resolvedApiKey,
      signal,
    });

    let partialMessage: AssistantMessage | null = null;
    let addedPartial = false;
    let finalMessage: AssistantMessage | undefined;

    for await (const event of response) {
      switch (event.type) {
        case 'start':
          partialMessage = event.partial;
          context.messages.push(partialMessage);
          addedPartial = true;
          await emit({ type: 'message_start', message: { ...partialMessage } });
          break;

        case 'text_start':
        case 'text_delta':
        case 'text_end':
        case 'thinking_start':
        case 'thinking_delta':
        case 'thinking_end':
        case 'toolcall_start':
        case 'toolcall_delta':
        case 'toolcall_end':
          if (partialMessage) {
            partialMessage = event.partial;
            context.messages[context.messages.length - 1] = partialMessage;
            await emit({
              type: 'message_update',
              assistantMessageEvent: event,
              message: { ...partialMessage },
            });
          }
          break;

        case 'done':
        case 'error':
          finalMessage = await response.result();
          break;
      }
      if (finalMessage) break;
    }

    finalMessage ??= await response.result();
    if (
      attempt === 0 &&
      config.beforeModelCall &&
      isContextOverflow(finalMessage, config.model.contextWindow)
    ) {
      if (addedPartial) context.messages.pop();
      await emit({ type: 'message_retry', reason: 'context_overflow', attempt: 1 });
      attempt = 1;
      reason = 'overflow';
      continue;
    }

    if (addedPartial) {
      context.messages[context.messages.length - 1] = finalMessage;
    } else {
      context.messages.push(finalMessage);
      await emit({ type: 'message_start', message: { ...finalMessage } });
    }
    await emit({ type: 'message_end', message: finalMessage });
    return finalMessage;
  }
}

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
  const toolCalls = assistantMessage.content.filter((c) => c.type === 'toolCall');
  const hasSequentialToolCall = toolCalls.some(
    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === 'sequential',
  );
  if (config.toolExecution === 'sequential' || hasSequentialToolCall) {
    return executeToolCallsSequential(
      currentContext,
      assistantMessage,
      toolCalls,
      config,
      signal,
      emit,
    );
  }
  return executeToolCallsParallel(
    currentContext,
    assistantMessage,
    toolCalls,
    config,
    signal,
    emit,
  );
}

type ExecutedToolCallBatch = {
  messages: ToolResultMessage[];
  terminate: boolean;
  suspendedToolCall?: AgentToolSuspendedCall;
};

async function executeToolCallsSequential(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallOutcome[] = [];
  const messages: ToolResultMessage[] = [];

  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index]!;
    await emit({
      type: 'tool_execution_start',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal,
    );
    if (preparation.kind === 'suspended') {
      await emit({ type: 'tool_execution_suspended', suspension: preparation.suspension });
      for (const skipped of toolCalls.slice(index + 1)) {
        await emit({
          type: 'tool_execution_start',
          toolCallId: skipped.id,
          toolName: skipped.name,
          args: skipped.arguments,
        });
        const finalized = skippedToolCall(skipped);
        await emitToolExecutionEnd(finalized, emit);
        const message = createToolResultMessage(finalized);
        await emitToolResultMessage(message, emit);
        finalizedCalls.push(finalized);
        messages.push(message);
      }
      return {
        messages,
        terminate: true,
        suspendedToolCall: preparation.suspension,
      };
    }

    let finalized: FinalizedToolCallOutcome;
    if (preparation.kind === 'immediate') {
      finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
    } else {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal,
      );
    }

    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    finalizedCalls.push(finalized);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(finalizedCalls),
  };
}

async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
  const preparedCalls: Array<
    | { kind: 'prepared'; preparation: PreparedToolCall }
    | { kind: 'finalized'; finalized: FinalizedToolCallOutcome }
  > = [];
  let preflightSuspension: AgentToolSuspendedCall | undefined;

  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index]!;
    await emit({
      type: 'tool_execution_start',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal,
    );
    if (preparation.kind === 'suspended') {
      preflightSuspension = preparation.suspension;
      for (const skipped of toolCalls.slice(index + 1)) {
        await emit({
          type: 'tool_execution_start',
          toolCallId: skipped.id,
          toolName: skipped.name,
          args: skipped.arguments,
        });
      }
      break;
    }
    if (preparation.kind === 'immediate') {
      const finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      } satisfies FinalizedToolCallOutcome;
      await emitToolExecutionEnd(finalized, emit);
      preparedCalls.push({ kind: 'finalized', finalized });
      continue;
    }
    preparedCalls.push({ kind: 'prepared', preparation });
  }

  if (preflightSuspension) {
    await emit({ type: 'tool_execution_suspended', suspension: preflightSuspension });
    const finalizedCalls = preparedCalls.map((entry) =>
      entry.kind === 'finalized' ? entry.finalized : skippedToolCall(entry.preparation.toolCall),
    );
    const preparedIds = new Set(
      preparedCalls.map((entry) =>
        entry.kind === 'finalized' ? entry.finalized.toolCall.id : entry.preparation.toolCall.id,
      ),
    );
    for (const toolCall of toolCalls) {
      if (toolCall.id === preflightSuspension.toolCallId || preparedIds.has(toolCall.id)) continue;
      finalizedCalls.push(skippedToolCall(toolCall));
    }
    for (const finalized of finalizedCalls) {
      if (
        !preparedCalls.some((entry) => entry.kind === 'finalized' && entry.finalized === finalized)
      ) {
        await emitToolExecutionEnd(finalized, emit);
      }
    }
    const messages: ToolResultMessage[] = [];
    for (const finalized of finalizedCalls) {
      const message = createToolResultMessage(finalized);
      await emitToolResultMessage(message, emit);
      messages.push(message);
    }
    return {
      messages,
      terminate: true,
      suspendedToolCall: preflightSuspension,
    };
  }

  const outcomes = await Promise.all(
    preparedCalls.map(async (entry) => {
      if (entry.kind === 'finalized')
        return { kind: 'finalized' as const, finalized: entry.finalized };
      const outcome = await executePreparedToolCall(entry.preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        entry.preparation,
        outcome,
        config,
        signal,
      );
      await emitToolExecutionEnd(finalized, emit);
      return { kind: 'finalized' as const, finalized };
    }),
  );
  const orderedFinalizedCalls = outcomes.map((outcome) => outcome.finalized);
  const messages: ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
  };
}

type PreparedToolCall = {
  kind: 'prepared';
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
};

type ImmediateToolCallOutcome = {
  kind: 'immediate';
  result: AgentToolResult<any>;
  isError: boolean;
};

type SuspendedToolCallOutcome = {
  kind: 'suspended';
  suspension: AgentToolSuspendedCall;
};

type ExecutedToolCallOutcome = {
  kind: 'executed';
  result: AgentToolResult<any>;
  isError: boolean;
};

type FinalizedToolCallOutcome = {
  toolCall: AgentToolCall;
  result: AgentToolResult<any>;
  isError: boolean;
};

function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
  return (
    finalizedCalls.length > 0 &&
    finalizedCalls.every((finalized) => finalized.result.terminate === true)
  );
}

function skippedToolCall(toolCall: AgentToolCall): FinalizedToolCallOutcome {
  return {
    toolCall,
    result: createErrorToolResult(
      'Tool execution was skipped because another tool call suspended the turn.',
    ),
    isError: true,
  };
}

function suspendedToolCall(
  toolCall: AgentToolCall,
  args: unknown,
  suspension: AgentToolSuspension<any>,
): SuspendedToolCallOutcome {
  return {
    kind: 'suspended',
    suspension: {
      id: suspension.id,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args,
      reason: suspension.reason,
      details: suspension.details,
    },
  };
}

function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
  if (!tool.prepareArguments) {
    return toolCall;
  }
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }
  return {
    ...toolCall,
    arguments: preparedArguments as Record<string, any>,
  };
}

async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: AgentToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome | SuspendedToolCallOutcome> {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: 'immediate',
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }

  try {
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);
    const validatedArgs = validateToolArguments(tool, preparedToolCall);
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          context: currentContext,
        },
        signal,
      );
      if (beforeResult?.block) {
        return {
          kind: 'immediate',
          result: createErrorToolResult(beforeResult.reason || 'Tool execution was blocked'),
          isError: true,
        };
      }
      if (beforeResult?.suspend) {
        return suspendedToolCall(toolCall, validatedArgs, beforeResult.suspend);
      }
    }
    return {
      kind: 'prepared',
      toolCall,
      tool,
      args: validatedArgs,
    };
  } catch (error) {
    return {
      kind: 'immediate',
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}

async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
  try {
    const result = await executeAgentTool({
      tool: prepared.tool,
      toolCallId: prepared.toolCall.id,
      args: prepared.args,
      signal,
      onUpdate: (partialResult) =>
        emit({
          type: 'tool_execution_update',
          toolCallId: prepared.toolCall.id,
          toolName: prepared.toolCall.name,
          args: prepared.toolCall.arguments,
          partialResult,
        }),
    });
    return { kind: 'executed', result, isError: false };
  } catch (error) {
    return {
      kind: 'executed',
      result: agentToolErrorResult(error),
      isError: true,
    };
  }
}

async function finalizeExecutedToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  prepared: PreparedToolCall,
  executed: ExecutedToolCallOutcome,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<FinalizedToolCallOutcome> {
  let result = executed.result;
  let isError = executed.isError;

  if (config.afterToolCall) {
    try {
      const afterResult = await config.afterToolCall(
        {
          assistantMessage,
          toolCall: prepared.toolCall,
          args: prepared.args,
          result,
          isError,
          context: currentContext,
        },
        signal,
      );
      if (afterResult) {
        result = {
          content: afterResult.content ?? result.content,
          details: afterResult.details ?? result.details,
          terminate: afterResult.terminate ?? result.terminate,
        };
        isError = afterResult.isError ?? isError;
      }
    } catch (error) {
      result = createErrorToolResult(error instanceof Error ? error.message : String(error));
      isError = true;
    }
  }

  return {
    toolCall: prepared.toolCall,
    result,
    isError,
  };
}

function createErrorToolResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: 'text', text: message }],
    details: {},
  };
}

async function emitToolExecutionEnd(
  finalized: FinalizedToolCallOutcome,
  emit: AgentEventSink,
): Promise<void> {
  await emit({
    type: 'tool_execution_end',
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError,
  });
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    content: finalized.result.content,
    details: finalized.result.details,
    isError: finalized.isError,
    timestamp: Date.now(),
  };
}

async function emitToolResultMessage(
  toolResultMessage: ToolResultMessage,
  emit: AgentEventSink,
): Promise<void> {
  await emit({ type: 'message_start', message: toolResultMessage });
  await emit({ type: 'message_end', message: toolResultMessage });
}
