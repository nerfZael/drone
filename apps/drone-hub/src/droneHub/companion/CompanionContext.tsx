import React from 'react';
import {
  COMPANION_PROPOSAL_FORMAT,
  COMPANION_PROPOSAL_PATH,
  COMPANION_PROPOSAL_TARGET_ID,
  EMPTY_COMPANION_PROPOSAL,
  parseCompanionProposalText,
  reduceCompanionToolActivity,
  serializeCompanionProposal,
  type CompanionBrowserToolName,
  type CompanionClientTelemetry,
  type CompanionProposal,
  type CompanionProposalExecution,
  type CompanionProposalExecutionContext,
  type CompanionServerMessage,
  type CompanionStatus,
  type CompanionToolActivity,
} from '@drone/assistant-chat';
import { useChatVoiceRecorder } from '../chat/use-chat-voice-recorder';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';
import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import { shouldCancelCompanionRecordingWithEscape } from './companion-shortcut';

type CompanionContextValue = {
  status: CompanionStatus;
  recordingPaused: boolean;
  error: string;
  reply: string;
  transcript: string;
  durationMillis: number;
  startedAt: number | null;
  endedAt: number | null;
  activity: CompanionToolActivity[];
  proposal: CompanionProposal | null;
  proposalExecution: CompanionProposalExecution | null;
  proposalDefaultRepoPath: string | null;
  proposalExecuting: boolean;
  toggle(): Promise<void>;
  stop(): void;
  toggleRecordingPause(): void;
  discardRecording(): Promise<void>;
  close(): Promise<void>;
  executeProposal(): Promise<void>;
  discardProposal(): void;
};

const CompanionContext = React.createContext<CompanionContextValue | null>(null);
const COMPANION_CONNECTION_TIMEOUT_MS = 10_000;

function newRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `companion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const workspace = useCompanionWorkspace();
  const [status, setStatus] = React.useState<CompanionStatus>('idle');
  const [error, setError] = React.useState('');
  const [reply, setReply] = React.useState('');
  const [transcript, setTranscript] = React.useState('');
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [endedAt, setEndedAt] = React.useState<number | null>(null);
  const [activity, setActivity] = React.useState<CompanionToolActivity[]>([]);
  const [proposal, setProposal] = React.useState<CompanionProposal | null>(null);
  const [proposalExecution, setProposalExecution] =
    React.useState<CompanionProposalExecution | null>(null);
  const [proposalDefaultRepoPath, setProposalDefaultRepoPath] = React.useState<string | null>(null);
  const [proposalExecuting, setProposalExecuting] = React.useState(false);
  const proposalExecutingRef = React.useRef(false);
  const proposalExecutionRef = React.useRef<CompanionProposalExecution | null>(null);
  const proposalExecutionContextRef = React.useRef<CompanionProposalExecutionContext | null>(null);
  const proposalRef = React.useRef<CompanionProposal | null>(null);
  const proposalRevisionRef = React.useRef(0);
  const proposalExecutionGenerationRef = React.useRef(0);
  const statusRef = React.useRef<CompanionStatus>('idle');
  const socketRef = React.useRef<WebSocket | null>(null);
  const runIdRef = React.useRef('');
  const pendingPromptsRef = React.useRef<Array<{
    prompt: string;
    messageId: string;
    telemetry?: CompanionClientTelemetry;
  }>>([]);
  const generationRef = React.useRef(0);
  const voiceSubmissionGenerationRef = React.useRef(0);

  const setStatusValue = React.useCallback((next: CompanionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const onVoiceError = React.useCallback((message: string) => {
    if (!message.trim()) return;
    setError(message);
    if (!runIdRef.current) setStatusValue('error');
  }, [setStatusValue]);
  const voice = useChatVoiceRecorder({ onError: onVoiceError, microphoneOwner: 'companion' });
  const voiceStatusRef = React.useRef(voice.status);
  const discardVoiceRecordingRef = React.useRef(voice.discardRecording);
  voiceStatusRef.current = voice.status;
  discardVoiceRecordingRef.current = voice.discardRecording;

  const erase = React.useCallback(() => {
    setError('');
    setReply('');
    setTranscript('');
    setActivity([]);
    setStartedAt(null);
    setEndedAt(null);
    setStatusValue('idle');
  }, [setStatusValue]);

  const close = React.useCallback(async () => {
    if (proposalExecutingRef.current) return;
    generationRef.current += 1;
    voiceSubmissionGenerationRef.current += 1;
    const socket = socketRef.current;
    socketRef.current = null;
    const runId = runIdRef.current;
    runIdRef.current = '';
    pendingPromptsRef.current = [];
    if (socket?.readyState === WebSocket.OPEN && runId) {
      socket.send(JSON.stringify({ type: 'cancel_run', runId }));
    }
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
    await voice.discardRecording();
    proposalRevisionRef.current += 1;
    proposalExecutionGenerationRef.current += 1;
    proposalRef.current = null;
    proposalExecutionRef.current = null;
    proposalExecutionContextRef.current = null;
    setProposal(null);
    setProposalExecution(null);
    setProposalDefaultRepoPath(null);
    proposalExecutingRef.current = false;
    setProposalExecuting(false);
    erase();
  }, [erase, voice.discardRecording]);

  const stop = React.useCallback(() => {
    if (statusRef.current !== 'working') return;
    generationRef.current += 1;
    const socket = socketRef.current;
    socketRef.current = null;
    const runId = runIdRef.current;
    runIdRef.current = '';
    pendingPromptsRef.current = [];
    if (socket?.readyState === WebSocket.OPEN && runId) {
      socket.send(JSON.stringify({ type: 'cancel_run', runId }));
    }
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
    setEndedAt(Date.now());
    setStatusValue('cancelled');
  }, [setStatusValue]);

  const toggleRecordingPause = React.useCallback(() => {
    voice.toggleRecordingPause();
  }, [voice.toggleRecordingPause]);

  const discardRecording = React.useCallback(async () => {
    voiceSubmissionGenerationRef.current += 1;
    await voice.discardRecording();
    if (!runIdRef.current) erase();
  }, [erase, voice.discardRecording]);

  const readProposal = React.useCallback(() => ({
    targetId: COMPANION_PROPOSAL_TARGET_ID,
    path: COMPANION_PROPOSAL_PATH,
    content: serializeCompanionProposal(proposalRef.current ?? EMPTY_COMPANION_PROPOSAL),
    revision: String(proposalRevisionRef.current),
    mode: 'edit' as const,
    format: COMPANION_PROPOSAL_FORMAT,
  }), []);

  const applyProposal = React.useCallback((
    targetId: string,
    baseRevision: string,
    content: string,
  ) => {
    if (proposalExecutingRef.current) throw new Error('PROPOSAL_EXECUTION_IN_PROGRESS');
    if (proposalExecutionRef.current) throw new Error('PROPOSAL_ALREADY_EXECUTED');
    if (targetId !== COMPANION_PROPOSAL_TARGET_ID) throw new Error('STALE_PROPOSAL_TARGET');
    if (baseRevision !== String(proposalRevisionRef.current)) {
      throw new Error('STALE_PROPOSAL_REVISION');
    }
    const next = parseCompanionProposalText(content);
    if (!proposalRef.current) {
      const appContext = workspace?.getAppContext();
      const defaultRepoPath = typeof appContext?.activeRepoPath === 'string'
        ? appContext.activeRepoPath
        : '';
      proposalExecutionContextRef.current = { defaultRepoPath };
      setProposalDefaultRepoPath(defaultRepoPath);
    }
    proposalRevisionRef.current += 1;
    proposalExecutionGenerationRef.current += 1;
    proposalRef.current = next;
    setProposal(next);
    return {
      ok: true as const,
      revision: String(proposalRevisionRef.current),
      operationCount: next.operations.length,
    };
  }, [workspace]);

  const discardProposal = React.useCallback(() => {
    if (proposalExecutingRef.current) return;
    proposalRevisionRef.current += 1;
    proposalExecutionGenerationRef.current += 1;
    proposalRef.current = null;
    proposalExecutionRef.current = null;
    proposalExecutionContextRef.current = null;
    setProposal(null);
    setProposalExecution(null);
    setProposalDefaultRepoPath(null);
  }, []);

  const executeProposal = React.useCallback(async () => {
    const current = proposalRef.current;
    const executionContext = proposalExecutionContextRef.current;
    if (!workspace || !current || !executionContext || current.operations.length === 0 ||
      proposalExecutingRef.current || proposalExecutionRef.current) return;
    const executionGeneration = proposalExecutionGenerationRef.current + 1;
    proposalExecutionGenerationRef.current = executionGeneration;
    proposalExecutingRef.current = true;
    setProposalExecuting(true);
    setProposalExecution(null);
    try {
      const execution = await workspace.executeProposal(current, executionContext);
      if (proposalExecutionGenerationRef.current === executionGeneration) {
        proposalExecutionRef.current = execution;
        setProposalExecution(execution);
      }
    } catch (executionError) {
      if (proposalExecutionGenerationRef.current === executionGeneration) {
        const execution: CompanionProposalExecution = {
          ok: false,
          operations: current.operations.map((operation, index) => index === 0
            ? {
                id: operation.id,
                type: operation.type,
                status: 'failed',
                error: executionError instanceof Error
                  ? executionError.message
                  : String(executionError),
              }
            : { id: operation.id, type: operation.type, status: 'skipped' }),
        };
        proposalExecutionRef.current = execution;
        setProposalExecution(execution);
      }
    } finally {
      if (proposalExecutionGenerationRef.current === executionGeneration) {
        proposalExecutingRef.current = false;
        setProposalExecuting(false);
      }
    }
  }, [workspace]);

  React.useLayoutEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (!shouldCancelCompanionRecordingWithEscape({
        key: event.key,
        repeat: event.repeat,
        isComposing: event.isComposing,
        voiceStatus: voiceStatusRef.current,
      })) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void discardVoiceRecordingRef.current();
    };
    window.addEventListener('keydown', cancelOnEscape, { capture: true });
    return () => window.removeEventListener('keydown', cancelOnEscape, { capture: true });
  }, []);

  React.useEffect(
    () => () => {
      generationRef.current += 1;
      proposalExecutionGenerationRef.current += 1;
      proposalExecutingRef.current = false;
    },
    [],
  );

  const executeBrowserTool = React.useCallback(async (tool: CompanionBrowserToolName, args: Record<string, unknown>) => {
    if (tool === 'get_app_context') {
      if (!workspace) throw new Error('NO_ACTIVE_WORKSPACE');
      return workspace.getAppContext();
    }
    if (tool === 'read_active_composer') {
      if (!workspace) throw new Error('NO_ACTIVE_COMPOSER');
      return workspace.readActiveComposer();
    }
    if (tool === 'apply_composer_patch') {
      if (!workspace) throw new Error('NO_ACTIVE_COMPOSER');
      return workspace.applyComposer(
        String(args.targetId ?? ''),
        String(args.baseRevision ?? ''),
        String(args.content ?? ''),
      );
    }
    if (tool === 'read_open_file') {
      if (!workspace) throw new Error('NO_OPEN_FILE');
      return workspace.readOpenFile();
    }
    if (tool === 'apply_editor_patch') {
      if (!workspace) throw new Error('NO_OPEN_FILE');
      return workspace.applyEditor(
        String(args.targetId ?? ''),
        String(args.baseRevision ?? ''),
        String(args.content ?? ''),
      );
    }
    if (tool === 'read_companion_proposal') {
      return readProposal();
    }
    if (tool === 'apply_companion_proposal_patch') {
      return applyProposal(
        String(args.targetId ?? ''),
        String(args.baseRevision ?? ''),
        String(args.content ?? ''),
      );
    }
    if (tool === 'open_drone_chat') {
      if (!workspace) throw new Error('NO_ACTIVE_WORKSPACE');
      return await workspace.openDroneChat(args);
    }
    if (tool === 'highlight_drones') {
      if (!workspace) throw new Error('NO_ACTIVE_WORKSPACE');
      return await workspace.highlightDrones(args);
    }
    throw new Error(`Unsupported Companion browser tool: ${tool}`);
  }, [applyProposal, readProposal, workspace]);

  const run = React.useCallback(async (
    prompt: string,
    telemetry?: CompanionClientTelemetry,
    requestedMessageId?: string,
  ) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;
    const runId = runIdRef.current || newRunId();
    const messageId = requestedMessageId || newRunId();
    runIdRef.current = runId;
    setTranscript(cleanPrompt);
    setStartedAt((current) => current ?? Date.now());
    setEndedAt(null);
    setError('');
    setStatusValue('working');
    const existingSocket = socketRef.current;
    if (existingSocket?.readyState === WebSocket.OPEN) {
      existingSocket.send(
        JSON.stringify({
          type: 'start_run',
          runId,
          messageId,
          prompt: cleanPrompt,
          telemetry: { ...telemetry, version: 1, connectionMs: 0, connectionReused: true },
        }),
      );
      return;
    }
    pendingPromptsRef.current.push({ prompt: cleanPrompt, messageId, telemetry });
    if (existingSocket?.readyState === WebSocket.CONNECTING) return;

    const localGeneration = generationRef.current + 1;
    generationRef.current = localGeneration;
    let socket: WebSocket;
    const connectionStartedAt = performance.now();
    try {
      socket = new WebSocket(buildDirectApiWebSocketUrl('/api/companion/stream'));
    } catch (socketError) {
      setError(socketError instanceof Error ? socketError.message : 'Companion could not connect to Drone Hub.');
      setEndedAt(Date.now());
      setStatusValue('error');
      return;
    }
    socketRef.current = socket;
    let connectionTimer: number | null = window.setTimeout(() => {
      if (generationRef.current !== localGeneration || socket.readyState === WebSocket.OPEN) return;
      setError('Companion could not connect to Drone Hub.');
      setEndedAt(Date.now());
      setStatusValue('error');
      if (socketRef.current === socket) socketRef.current = null;
      try {
        socket.close();
      } catch {
        // The browser may reject closing a socket that has not started connecting.
      }
    }, COMPANION_CONNECTION_TIMEOUT_MS);
    const clearConnectionTimer = () => {
      if (connectionTimer == null) return;
      window.clearTimeout(connectionTimer);
      connectionTimer = null;
    };
    const finishSocket = () => {
      clearConnectionTimer();
      if (socketRef.current === socket) socketRef.current = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    };
    socket.onopen = () => {
      clearConnectionTimer();
      if (
        generationRef.current !== localGeneration ||
        socketRef.current !== socket ||
        statusRef.current !== 'working'
      ) {
        finishSocket();
        return;
      }
      const connectionMs = Math.max(0, performance.now() - connectionStartedAt);
      const pendingPrompts = pendingPromptsRef.current.splice(0);
      for (const pendingPrompt of pendingPrompts) {
        socket.send(
          JSON.stringify({
            type: 'start_run',
            runId,
            messageId: pendingPrompt.messageId,
            prompt: pendingPrompt.prompt,
            telemetry: {
              ...pendingPrompt.telemetry,
              version: 1,
              connectionMs,
              connectionReused: false,
            },
          }),
        );
      }
    };
    socket.onmessage = (event) => {
      if (generationRef.current !== localGeneration || typeof event.data !== 'string') return;
      let message: CompanionServerMessage;
      try {
        message = JSON.parse(event.data) as CompanionServerMessage;
      } catch {
        return;
      }
      if (message.runId && message.runId !== runId) return;
      if (message.type === 'tool_call') {
        const messageGeneration = Number(message.generation);
        void executeBrowserTool(message.tool, message.args ?? {}).then((result) => {
          if (generationRef.current !== localGeneration || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: 'tool_result', runId, generation: messageGeneration, callId: message.callId, ok: true, result }));
        }).catch((toolError) => {
          if (generationRef.current !== localGeneration || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: 'tool_result', runId, generation: messageGeneration, callId: message.callId, ok: false, error: toolError instanceof Error ? toolError.message : String(toolError) }));
        });
        return;
      }
      if (message.type === 'activity') {
        setActivity((current) => reduceCompanionToolActivity(current, message.event));
        return;
      }
      if (message.type === 'reply') setReply(String(message.reply ?? ''));
      if (message.type === 'status' && message.status === 'completed') {
        setEndedAt(Date.now());
        setStatusValue('completed');
      } else if (message.type === 'status' && message.status === 'cancelled') {
        setEndedAt(Date.now());
        setStatusValue('cancelled');
        finishSocket();
      } else if (message.type === 'error') {
        setError(String(message.error ?? 'Companion failed.'));
        setEndedAt(Date.now());
        setStatusValue('error');
        finishSocket();
      }
    };
    socket.onerror = () => {
      if (
        generationRef.current !== localGeneration ||
        ['completed', 'cancelled', 'error', 'idle'].includes(statusRef.current)
      ) return;
      setError('Companion could not connect to Drone Hub.');
      setEndedAt(Date.now());
      setStatusValue('error');
      finishSocket();
    };
    socket.onclose = () => {
      clearConnectionTimer();
      if (socketRef.current === socket) socketRef.current = null;
      if (generationRef.current !== localGeneration || ['completed', 'cancelled', 'error', 'idle'].includes(statusRef.current)) return;
      setError('Companion disconnected before the run finished.');
      setEndedAt(Date.now());
      setStatusValue('error');
    };
  }, [executeBrowserTool, setStatusValue]);

  const toggle = React.useCallback(async () => {
    if (voice.status === 'starting' || voice.status === 'transcribing') return;
    if (voice.status === 'recording' || voice.status === 'paused') {
      const stopGeneration = generationRef.current;
      const voiceSubmissionGeneration = voiceSubmissionGenerationRef.current;
      const messageId = newRunId();
      const audioDurationMs = voice.durationMillis;
      const transcriptionStartedAt = performance.now();
      const text = await voice.stopRecordingForTranscript({ telemetryId: messageId });
      const transcriptionMs = Math.max(0, performance.now() - transcriptionStartedAt);
      if (
        generationRef.current !== stopGeneration ||
        voiceSubmissionGenerationRef.current !== voiceSubmissionGeneration
      ) return;
      if (statusRef.current === 'error') return;
      await run(
        text,
        { version: 1, transcriptionMs, audioDurationMs },
        messageId,
      );
      return;
    }
    if (statusRef.current === 'cancelled' || statusRef.current === 'error') await close();
    const started = await voice.startRecording();
    if (!started && statusRef.current !== 'error' && !runIdRef.current) erase();
  }, [
    close,
    erase,
    run,
    voice.durationMillis,
    voice.startRecording,
    voice.status,
    voice.stopRecordingForTranscript,
  ]);

  React.useEffect(() => () => {
    generationRef.current += 1;
    socketRef.current?.close();
    void voice.discardRecording();
  }, [voice.discardRecording]);

  const effectiveStatus: CompanionStatus =
    voice.status === 'paused'
      ? 'recording'
      : voice.status !== 'idle'
        ? voice.status
        : status;

  const value = React.useMemo<CompanionContextValue>(() => ({
    status: effectiveStatus,
    recordingPaused: voice.status === 'paused',
    error,
    reply,
    transcript,
    durationMillis: voice.durationMillis,
    startedAt,
    endedAt,
    activity,
    proposal,
    proposalExecution,
    proposalDefaultRepoPath,
    proposalExecuting,
    toggle,
    stop,
    toggleRecordingPause,
    discardRecording,
    close,
    executeProposal,
    discardProposal,
  }), [activity, close, discardProposal, discardRecording, effectiveStatus, endedAt, error, executeProposal, proposal, proposalDefaultRepoPath, proposalExecution, proposalExecuting, reply, startedAt, stop, toggle, toggleRecordingPause, transcript, voice.durationMillis, voice.status]);

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue | null {
  return React.useContext(CompanionContext);
}
