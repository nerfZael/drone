import React from 'react';
import * as Crypto from 'expo-crypto';
import { COMPANION_CAPABILITY, isGranted } from '@drone/device-protocol';
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
  type CompanionBrowserWorkspace,
  type CompanionClientTelemetry,
  type CompanionProposal,
  type CompanionProposalExecution,
  type CompanionProposalExecutionContext,
  type CompanionStatus,
  type CompanionTextSnapshot,
  type CompanionToolActivity,
} from '@drone/assistant-chat';

import { useMesh } from '../mesh/MeshContext';
import { useSharedMobileChatVoiceRecorder } from './MobileChatVoiceRecorderContext';
import { createMobileCompanionTransport } from './mobile-companion-transport';
import { resolveMobileCompanionVoiceStatus } from './mobile-voice-session';

export type MobileCompanionEditorTarget = {
  id: string;
  isEligible(): boolean;
  read(): CompanionTextSnapshot;
  apply(baseRevision: string, content: string): { ok: true; revision: string };
};

export type MobileCompanionWorkspaceTarget = {
  targetDeviceId: string;
  targetName: string;
  reachable: boolean;
  getAppContext(): Record<string, unknown>;
  readComposer(): CompanionTextSnapshot;
  applyComposer(
    targetId: string,
    baseRevision: string,
    content: string,
  ): { ok: true; revision: string };
  executeProposal(
    proposal: CompanionProposal,
    context: CompanionProposalExecutionContext,
  ): Promise<CompanionProposalExecution>;
  openDroneChat(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  highlightDrones(args: Record<string, unknown>): Record<string, unknown>;
};

type MobileCompanionContextValue = {
  status: CompanionStatus;
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
  available: boolean;
  unavailableReason: string;
  toggle(): Promise<void>;
  /** Send already-transcribed text to Companion as if it had just been spoken. */
  submitText(prompt: string): Promise<{ ok: true } | { ok: false; error: string }>;
  close(): Promise<void>;
  executeProposal(): Promise<void>;
  discardProposal(): void;
  registerWorkspaceTarget(target: MobileCompanionWorkspaceTarget): () => void;
  registerEditorTarget(target: MobileCompanionEditorTarget): () => void;
};

const MobileCompanionContext = React.createContext<MobileCompanionContextValue | null>(null);

export function MobileCompanionProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const voice = useSharedMobileChatVoiceRecorder();
  const companionVoiceActive = voice.session.kind === 'companion';
  const controllerRef = React.useRef<CompanionClientController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CompanionClientController({ createId: Crypto.randomUUID });
  }
  const controller = controllerRef.current;
  const state = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const workspaceTargetRef = React.useRef<MobileCompanionWorkspaceTarget | null>(null);
  const editorTargetsRef = React.useRef(new Map<string, MobileCompanionEditorTarget>());
  const focusedEditorIdRef = React.useRef<string | null>(null);
  const activeTargetDeviceIdRef = React.useRef('');
  const [targetRevision, setTargetRevision] = React.useState(0);
  const [proposal, setProposal] = React.useState<CompanionProposal | null>(null);
  const [proposalExecution, setProposalExecution] =
    React.useState<CompanionProposalExecution | null>(null);
  const [proposalDefaultRepoPath, setProposalDefaultRepoPath] = React.useState<string | null>(null);
  const [proposalExecuting, setProposalExecuting] = React.useState(false);
  const proposalRef = React.useRef<CompanionProposal | null>(null);
  const proposalRevisionRef = React.useRef(0);
  const proposalExecutingRef = React.useRef(false);
  const proposalExecutionRef = React.useRef<CompanionProposalExecution | null>(null);
  const proposalExecutionContextRef = React.useRef<CompanionProposalExecutionContext | null>(null);
  const proposalExecutionGenerationRef = React.useRef(0);

  const registerWorkspaceTarget = React.useCallback((target: MobileCompanionWorkspaceTarget) => {
    workspaceTargetRef.current = target;
    setTargetRevision((value) => value + 1);
    return () => {
      if (workspaceTargetRef.current !== target) return;
      workspaceTargetRef.current = null;
      setTargetRevision((value) => value + 1);
    };
  }, []);

  const registerEditorTarget = React.useCallback((target: MobileCompanionEditorTarget) => {
    editorTargetsRef.current.set(target.id, target);
    focusedEditorIdRef.current = target.id;
    return () => {
      if (editorTargetsRef.current.get(target.id) !== target) return;
      editorTargetsRef.current.delete(target.id);
      if (focusedEditorIdRef.current === target.id) focusedEditorIdRef.current = null;
    };
  }, []);

  const target = workspaceTargetRef.current;
  const targetCapability = target
    ? mesh.profile?.capabilitiesByDevice[target.targetDeviceId]?.find(
        (capability) =>
          capability.id === COMPANION_CAPABILITY.id &&
          capability.version === COMPANION_CAPABILITY.version,
      )
    : undefined;
  const selfDevice = mesh.devices.find((device) => device.id === mesh.identity?.id);
  const hasOperations = COMPANION_CAPABILITY.operations.every((operation) =>
    targetCapability?.operations.includes(operation),
  );
  const hasGrant = Boolean(
    selfDevice &&
    COMPANION_CAPABILITY.operations.every((operation) =>
      isGranted(
        selfDevice.grants,
        COMPANION_CAPABILITY.id,
        COMPANION_CAPABILITY.version,
        operation,
      ),
    ),
  );
  const available = Boolean(target && target.reachable && hasOperations && hasGrant);
  const unavailableReason = !target
    ? 'Open Drone Hub before starting Companion.'
    : !target.reachable
      ? `${target.targetName} is offline.`
      : !hasOperations
        ? `${target.targetName} does not support mobile Companion yet.`
        : !hasGrant
          ? `Allow Companion for this phone in ${target.targetName} device settings.`
          : '';
  void targetRevision;

  const resolveEditor = React.useCallback(() => {
    const focused = focusedEditorIdRef.current
      ? editorTargetsRef.current.get(focusedEditorIdRef.current)
      : null;
    if (focused?.isEligible()) return focused;
    const eligible = [...editorTargetsRef.current.values()].filter((item) => item.isEligible());
    if (eligible.length === 0) throw new Error('NO_OPEN_FILE');
    return eligible[eligible.length - 1]!;
  }, []);

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
      const appContext = workspaceTargetRef.current?.getAppContext();
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
  }, []);

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
    const target = workspaceTargetRef.current;
    const executionContext = proposalExecutionContextRef.current;
    if (!target || !current || !executionContext || current.operations.length === 0 ||
      proposalExecutingRef.current || proposalExecutionRef.current) return;
    if (!target.reachable) {
      const execution: CompanionProposalExecution = {
        ok: false,
        operations: current.operations.map((operation, index) => index === 0
          ? {
              id: operation.id,
              type: operation.type,
              status: 'failed',
              error: 'TARGET_DEVICE_OFFLINE',
            }
          : { id: operation.id, type: operation.type, status: 'skipped' }),
      };
      proposalExecutionRef.current = execution;
      setProposalExecution(execution);
      return;
    }
    const executionGeneration = proposalExecutionGenerationRef.current + 1;
    proposalExecutionGenerationRef.current = executionGeneration;
    proposalExecutingRef.current = true;
    setProposalExecuting(true);
    setProposalExecution(null);
    try {
      const execution = await target.executeProposal(current, executionContext);
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
  }, []);

  const executeMobileTool = React.useCallback(
    async (
      expectedTargetDeviceId: string,
      tool: CompanionBrowserToolName,
      args: Record<string, unknown>,
    ) => {
      if (tool === 'read_companion_proposal') return readProposal();
      if (tool === 'apply_companion_proposal_patch') {
        return applyProposal(
          String(args.targetId ?? ''),
          String(args.baseRevision ?? ''),
          String(args.content ?? ''),
        );
      }
      const resolveTarget = () => {
        const activeTarget = workspaceTargetRef.current;
        if (!activeTarget) throw new Error('NO_ACTIVE_MOBILE_CONTEXT');
        if (activeTarget.targetDeviceId !== expectedTargetDeviceId) {
          throw new Error('STALE_MOBILE_CONTEXT');
        }
        return activeTarget;
      };
      const workspace: CompanionBrowserWorkspace = {
        getAppContext: () => resolveTarget().getAppContext(),
        readActiveComposer: () => resolveTarget().readComposer(),
        applyComposer: (...input) => resolveTarget().applyComposer(...input),
        readOpenFile: () => resolveEditor().read(),
        applyEditor: (targetId, baseRevision, content) => {
          const editor = resolveEditor();
          if (editor.id !== targetId) throw new Error('STALE_EDITOR_TARGET');
          return editor.apply(baseRevision, content);
        },
        openDroneChat: (input) => resolveTarget().openDroneChat(input),
        highlightDrones: (input) => resolveTarget().highlightDrones(input),
      };
      return await executeCompanionBrowserTool(workspace, tool, args);
    },
    [applyProposal, readProposal, resolveEditor],
  );

  const close = React.useCallback(async () => {
    if (proposalExecutingRef.current) return;
    activeTargetDeviceIdRef.current = '';
    await controller.close();
    await voice.discardRecording('companion');
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

  React.useEffect(() => {
    const activeTargetDeviceId = activeTargetDeviceIdRef.current;
    if (!activeTargetDeviceId) return;
    const activeTarget = workspaceTargetRef.current;
    if (
      !activeTarget ||
      activeTarget.targetDeviceId !== activeTargetDeviceId ||
      !activeTarget.reachable ||
      !hasOperations ||
      !hasGrant
    ) {
      void close();
    }
  }, [close, hasGrant, hasOperations, proposalExecuting, targetRevision]);

  const run = React.useCallback(
    async (prompt: string, telemetry?: CompanionClientTelemetry, requestedMessageId?: string) => {
      const activeTarget = workspaceTargetRef.current;
      if (!activeTarget) {
        controller.fail('Open Drone Hub before starting Companion.');
        return;
      }
      if (
        controller.hasSession() &&
        activeTargetDeviceIdRef.current !== activeTarget.targetDeviceId
      ) {
        await close();
      }
      activeTargetDeviceIdRef.current = activeTarget.targetDeviceId;
      await controller.submitPrompt({
        prompt,
        telemetry,
        messageId: requestedMessageId,
        createTransport: () =>
          createMobileCompanionTransport({
            targetDeviceId: activeTarget.targetDeviceId,
            request: mesh.request,
            subscribe: mesh.subscribe,
          }),
        executeTool: (tool, args) => executeMobileTool(activeTarget.targetDeviceId, tool, args),
      });
    },
    [close, controller, executeMobileTool, mesh.request, mesh.subscribe],
  );

  const submitText = React.useCallback(
    async (prompt: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const text = String(prompt ?? '').trim();
      if (!text) return { ok: false, error: 'There is no dictated text to send.' };
      if (!available) return { ok: false, error: unavailableReason || 'Companion is unavailable.' };
      if (companionVoiceActive) {
        return { ok: false, error: 'Companion is already handling a voice recording.' };
      }
      const status = controller.getSnapshot().status;
      if (status === 'working' || proposalExecutingRef.current) {
        return { ok: false, error: 'Companion is already working.' };
      }
      if (status === 'cancelled' || status === 'error') await close();
      await run(text);
      const next = controller.getSnapshot();
      if (next.status === 'error') {
        return { ok: false, error: next.error || 'Companion could not start.' };
      }
      return { ok: true };
    },
    [available, close, companionVoiceActive, controller, run, unavailableReason],
  );

  const toggle = React.useCallback(async () => {
    if (
      companionVoiceActive &&
      (voice.session.status === 'starting' || voice.session.status === 'transcribing')
    ) {
      return;
    }
    if (voice.session.kind === 'companion' && voice.session.status === 'recording') {
      const token = controller.getToken();
      const messageId = Crypto.randomUUID();
      const audioDurationMs = voice.session.durationMillis;
      const transcriptionStartedAt = performance.now();
      const text = await voice.stopRecordingForTranscript('companion');
      const transcriptionMs = Math.max(0, performance.now() - transcriptionStartedAt);
      if (!controller.isCurrent(token)) return;
      if (!text.trim()) {
        controller.reportVoiceError(voice.getError());
        return;
      }
      await run(text, { version: 1, transcriptionMs, audioDurationMs }, messageId);
      return;
    }
    const status = controller.getSnapshot().status;
    if (status === 'cancelled' || status === 'error') await close();
    const activeTarget = workspaceTargetRef.current;
    if (!activeTarget || !activeTarget.reachable || !available) {
      controller.fail(unavailableReason || 'Companion is unavailable.');
      return;
    }
    if (voice.session.kind !== 'idle' || !voice.session.microphoneAvailable) {
      controller.fail(
        voice.session.kind === 'continuous'
          ? 'Continuous voice is already using the microphone.'
          : 'A voice message is already using the microphone.',
      );
      return;
    }
    activeTargetDeviceIdRef.current = activeTarget.targetDeviceId;
    voice.setError('');
    const token = controller.getToken();
    const started = await voice.startRecording('companion');
    if (!controller.isCurrent(token)) return;
    if (!started) {
      controller.reportVoiceError(
        voice.getError() || 'The microphone could not start. Check microphone and Groq settings.',
      );
    }
  }, [
    available,
    close,
    companionVoiceActive,
    controller,
    run,
    unavailableReason,
    voice,
  ]);

  React.useEffect(() => {
    if (
      !companionVoiceActive ||
      !voice.error.trim() ||
      !['starting', 'recording', 'stopped', 'transcribing'].includes(voice.session.status)
    ) {
      return;
    }
    controller.reportVoiceError(voice.error);
  }, [companionVoiceActive, controller, voice.error, voice.session.status]);

  React.useEffect(() => {
    if (state.status === 'cancelled' || state.status === 'error' || state.status === 'idle') {
      activeTargetDeviceIdRef.current = '';
    }
    const active = state.status === 'working';
    mesh.setBackgroundActivityRequired(active);
    return () => {
      if (active) mesh.setBackgroundActivityRequired(false);
    };
  }, [mesh.setBackgroundActivityRequired, state.status]);

  React.useEffect(
    () => () => {
      proposalExecutionGenerationRef.current += 1;
      proposalExecutingRef.current = false;
      void controller.close();
      void voice.discardRecording('companion');
    },
    [controller, voice.discardRecording],
  );

  const effectiveStatus = resolveMobileCompanionVoiceStatus(state.status, voice.session);
  const effectiveDurationMillis =
    voice.session.kind === 'companion' ? voice.session.durationMillis : 0;

  const value = React.useMemo<MobileCompanionContextValue>(
    () => ({
      ...state,
      status: effectiveStatus,
      durationMillis: effectiveDurationMillis,
      proposal,
      proposalExecution,
      proposalDefaultRepoPath,
      proposalExecuting,
      available,
      unavailableReason,
      toggle,
      submitText,
      close,
      executeProposal,
      discardProposal,
      registerWorkspaceTarget,
      registerEditorTarget,
    }),
    [
      available,
      close,
      discardProposal,
      executeProposal,
      effectiveStatus,
      effectiveDurationMillis,
      registerEditorTarget,
      registerWorkspaceTarget,
      proposal,
      proposalExecution,
      proposalDefaultRepoPath,
      proposalExecuting,
      state,
      submitText,
      toggle,
      unavailableReason,
    ],
  );

  return (
    <MobileCompanionContext.Provider value={value}>{children}</MobileCompanionContext.Provider>
  );
}

export function useMobileCompanion(): MobileCompanionContextValue {
  const value = React.useContext(MobileCompanionContext);
  if (!value) throw new Error('useMobileCompanion must be used inside MobileCompanionProvider');
  return value;
}
