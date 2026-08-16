import React from 'react';
import {
  COMPANION_PROPOSAL_FORMAT,
  COMPANION_PROPOSAL_PATH,
  COMPANION_PROPOSAL_TARGET_ID,
  CompanionClientController,
  EMPTY_COMPANION_PROPOSAL,
  executeCompanionBrowserTool,
  parseCompanionProposalText,
  serializeCompanionProposal,
  type CompanionBrowserToolName,
  type CompanionClientTelemetry,
  type CompanionProposal,
  type CompanionProposalExecution,
  type CompanionProposalExecutionContext,
  type CompanionStatus,
  type CompanionToolActivity,
} from '@drone/assistant-chat';

import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import { useChatVoiceRecorder } from '../chat/use-chat-voice-recorder';
import { shouldCancelCompanionRecordingWithEscape } from './companion-shortcut';
import { createCompanionWebSocketTransport } from './companion-websocket-transport';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';

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

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `companion-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const workspace = useCompanionWorkspace();
  const controllerRef = React.useRef<CompanionClientController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CompanionClientController({ createId: newId });
  }
  const controller = controllerRef.current;
  const state = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
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
  const voiceSubmissionGenerationRef = React.useRef(0);

  const onVoiceError = React.useCallback(
    (message: string) => controller.reportVoiceError(message),
    [controller],
  );
  const voice = useChatVoiceRecorder({ onError: onVoiceError, microphoneOwner: 'companion' });
  const voiceStatusRef = React.useRef(voice.status);
  const discardVoiceRecordingRef = React.useRef(voice.discardRecording);
  voiceStatusRef.current = voice.status;
  discardVoiceRecordingRef.current = voice.discardRecording;

  const close = React.useCallback(async () => {
    if (proposalExecutingRef.current) return;
    voiceSubmissionGenerationRef.current += 1;
    await controller.close();
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
  }, [controller, voice.discardRecording]);

  const stop = React.useCallback(() => {
    if (controller.getSnapshot().status !== 'working') return;
    void controller.cancel();
  }, [controller]);

  const toggleRecordingPause = React.useCallback(() => {
    voice.toggleRecordingPause();
  }, [voice.toggleRecordingPause]);

  const discardRecording = React.useCallback(async () => {
    voiceSubmissionGenerationRef.current += 1;
    await voice.discardRecording();
    controller.resetIfNoSession();
  }, [controller, voice.discardRecording]);

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
      if (
        !shouldCancelCompanionRecordingWithEscape({
          key: event.key,
          repeat: event.repeat,
          isComposing: event.isComposing,
          voiceStatus: voiceStatusRef.current,
        })
      ) {
        return;
      }
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
      proposalExecutionGenerationRef.current += 1;
      proposalExecutingRef.current = false;
    },
    [],
  );

  const executeBrowserTool = React.useCallback(
    async (tool: CompanionBrowserToolName, args: Record<string, unknown>) => {
      if (tool === 'read_companion_proposal') return readProposal();
      if (tool === 'apply_companion_proposal_patch') {
        return applyProposal(
          String(args.targetId ?? ''),
          String(args.baseRevision ?? ''),
          String(args.content ?? ''),
        );
      }
      if (!workspace) {
        if (tool === 'read_active_composer' || tool === 'apply_composer_patch') {
          throw new Error('NO_ACTIVE_COMPOSER');
        }
        if (tool === 'read_open_file' || tool === 'apply_editor_patch') {
          throw new Error('NO_OPEN_FILE');
        }
        throw new Error('NO_ACTIVE_WORKSPACE');
      }
      return await executeCompanionBrowserTool(workspace, tool, args);
    },
    [applyProposal, readProposal, workspace],
  );

  const run = React.useCallback(
    async (prompt: string, telemetry?: CompanionClientTelemetry, requestedMessageId?: string) => {
      await controller.submitPrompt({
        prompt,
        telemetry,
        messageId: requestedMessageId,
        createTransport: () =>
          createCompanionWebSocketTransport(buildDirectApiWebSocketUrl('/api/companion/stream')),
        executeTool: executeBrowserTool,
      });
    },
    [controller, executeBrowserTool],
  );

  const toggle = React.useCallback(async () => {
    if (voice.status === 'starting' || voice.status === 'transcribing') return;
    if (voice.status === 'recording' || voice.status === 'paused') {
      const token = controller.getToken();
      const voiceSubmissionGeneration = voiceSubmissionGenerationRef.current;
      const messageId = newId();
      const audioDurationMs = voice.durationMillis;
      const transcriptionStartedAt = performance.now();
      const text = await voice.stopRecordingForTranscript({ telemetryId: messageId });
      const transcriptionMs = Math.max(0, performance.now() - transcriptionStartedAt);
      if (
        !controller.isCurrent(token) ||
        voiceSubmissionGenerationRef.current !== voiceSubmissionGeneration
      ) return;
      if (controller.getSnapshot().status === 'error') return;
      await run(text, { version: 1, transcriptionMs, audioDurationMs }, messageId);
      return;
    }
    const status = controller.getSnapshot().status;
    if (status === 'cancelled' || status === 'error') await close();
    const started = await voice.startRecording();
    if (!started && controller.getSnapshot().status !== 'error') controller.resetIfNoSession();
  }, [close, controller, run, voice]);

  React.useEffect(
    () => () => {
      void controller.close();
      void voice.discardRecording();
    },
    [controller, voice.discardRecording],
  );

  const effectiveStatus: CompanionStatus =
    voice.status === 'paused' ? 'recording' : voice.status !== 'idle' ? voice.status : state.status;

  const value = React.useMemo<CompanionContextValue>(
    () => ({
      ...state,
      status: effectiveStatus,
      recordingPaused: voice.status === 'paused',
      durationMillis: voice.durationMillis,
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
    }),
    [
      close,
      discardProposal,
      discardRecording,
      effectiveStatus,
      executeProposal,
      proposal,
      proposalDefaultRepoPath,
      proposalExecution,
      proposalExecuting,
      state,
      stop,
      toggle,
      toggleRecordingPause,
      voice.durationMillis,
      voice.status,
    ],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue | null {
  return React.useContext(CompanionContext);
}
