import { useMobileCompanionAutoApproveSettings } from './use-mobile-companion-auto-approve-settings';
import type { CompanionCompactionActivity } from '@drone/assistant-chat';
import React from 'react';
import * as Crypto from 'expo-crypto';
import { COMPANION_CAPABILITY, COMPANION_RUN_OPERATIONS } from '@drone/device-protocol';
import {
  COMPANION_PROPOSAL_FORMAT,
  COMPANION_PROPOSAL_PATH,
  COMPANION_PROPOSAL_TARGET_ID,
  CompanionClientController,
  companionProposalApplyResult,
  waitForCompanionReply,
  LIVE_COMPANION_PROMPT_PREFIX,
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

import { useMobileCompanionLive } from './use-mobile-companion-live';
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

export type MobileCompanionProposalExecutionContext = CompanionProposalExecutionContext & { targetDeviceId: string };

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
    context: MobileCompanionProposalExecutionContext,
  ): Promise<CompanionProposalExecution>;
  openDroneChat(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  highlightDrones(args: Record<string, unknown>): Record<string, unknown>;
};

type MobileCompanionContextValue = {
  status: CompanionStatus;
  live: ReturnType<typeof useMobileCompanionLive>;
  checkingVoiceMode: boolean;
  autoApproveSettings: ReturnType<typeof useMobileCompanionAutoApproveSettings>;
  error: string;
  reply: string;
  transcript: string;
  durationMillis: number;
  startedAt: number | null;
  endedAt: number | null;
  activity: CompanionToolActivity[];
  compaction: CompanionCompactionActivity | null;
  proposal: CompanionProposal | null;
  proposalExecution: CompanionProposalExecution | null;
  proposalDefaultRepoPath: string | null;
  proposalExecuting: boolean;
  available: boolean;
  workspaceDeviceId: string;
  unavailableReason: string;
  toggle(): Promise<void>;
  /** Send already-transcribed text to Companion as if it had just been spoken. */
  submitText(prompt: string): Promise<{ ok: true } | { ok: false; error: string }>;
  close(): Promise<void>;
  cancel(): Promise<void>;
  executeProposal(): Promise<void>;
  discardProposal(): void;
  registerWorkspaceTarget(target: MobileCompanionWorkspaceTarget): () => void;
  registerEditorTarget(target: MobileCompanionEditorTarget): () => void;
};

const MobileCompanionContext = React.createContext<MobileCompanionContextValue | null>(null);

export function MobileCompanionProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const voice = useSharedMobileChatVoiceRecorder();
  const live = useMobileCompanionLive(voice.microphoneCoordinator);
  const [checkingVoiceMode, setCheckingVoiceMode] = React.useState(false);
  const preparingVoice = React.useRef(false);
  const liveActive = live.status === 'connecting' || live.status === 'listening';
  const liveArmed = liveActive || live.status === 'paused';
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
  const proposalSessionRef = React.useRef<string | null>(null);
  const proposalExecutingRef = React.useRef(false);
  const proposalExecutionRef = React.useRef<CompanionProposalExecution | null>(null);
  const proposalExecutionContextRef = React.useRef<MobileCompanionProposalExecutionContext | null>(null);
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
  const hasOperations = COMPANION_RUN_OPERATIONS.every((operation) =>
    targetCapability?.operations.includes(operation),
  );
  // Grants in the phone directory are not the target Hub's current access policy.
  // Let the Hub authorize each request so saved permission changes apply immediately.
  const available = Boolean(target && target.reachable && hasOperations);
  const unavailableReason = !target
    ? 'Open Drone Hub before starting Companion.'
    : !target.reachable
      ? `${target.targetName} is offline.`
      : !hasOperations
        ? `${target.targetName} does not support mobile Companion yet.`
        : '';
  const autoApproveSettings = useMobileCompanionAutoApproveSettings(
    available && targetCapability?.operations.includes('auto-approve.settings.get') ? target!.targetDeviceId : '',
  );
  void targetRevision;
  const autoApproveSettingsRef = React.useRef(autoApproveSettings);
  autoApproveSettingsRef.current = autoApproveSettings;

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
      const targetDeviceId = workspaceTargetRef.current?.targetDeviceId;
      if (!targetDeviceId) throw new Error('NO_ACTIVE_MOBILE_CONTEXT');
      proposalExecutionContextRef.current = { defaultRepoPath, targetDeviceId };
      setProposalDefaultRepoPath(defaultRepoPath);
    }
    proposalRevisionRef.current += 1;
    proposalExecutionGenerationRef.current += 1;
    proposalRef.current = next;
    proposalSessionRef.current = controller.getSessionId();
    setProposal(next);
    return {
      ok: true as const,
      revision: String(proposalRevisionRef.current),
      operationCount: next.operations.length,
    };
  }, [controller]);

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

  const executeProposal = React.useCallback(async (options?: {
    autoApproved?: boolean;
    returnResultToTool?: boolean;
  }): Promise<CompanionProposalExecution | undefined> => {
    const current = proposalRef.current;
    const appliedRevision = String(proposalRevisionRef.current);
    const proposalSessionId = proposalSessionRef.current;
    const target = workspaceTargetRef.current;
    const executionContext = proposalExecutionContextRef.current;
    if (!target || !current || !executionContext || current.operations.length === 0 ||
      proposalExecutingRef.current || proposalExecutionRef.current) return;
    if (!target.reachable || target.targetDeviceId !== executionContext.targetDeviceId) {
      const execution: CompanionProposalExecution = {
        ok: false,
        operations: current.operations.map((operation, index) => index === 0
          ? {
              id: operation.id,
              type: operation.type,
              status: 'failed',
              error: target.targetDeviceId !== executionContext.targetDeviceId ? 'PROPOSAL_TARGET_CHANGED' : 'TARGET_DEVICE_OFFLINE',
            }
          : { id: operation.id, type: operation.type, status: 'skipped' }),
      };
      proposalExecutionRef.current = execution;
      setProposalExecution(execution);
      if (!options?.returnResultToTool) {
        await controller.submitProposalResult(
          companionProposalApplyResult(current, execution, options?.autoApproved === true, appliedRevision),
          proposalSessionId,
        );
      }
      return execution;
    }
    const executionGeneration = proposalExecutionGenerationRef.current + 1;
    proposalExecutionGenerationRef.current = executionGeneration;
    proposalExecutingRef.current = true;
    setProposalExecuting(true);
    setProposalExecution(null);
    let completedExecution: CompanionProposalExecution;
    try {
      completedExecution = await target.executeProposal(current, executionContext);
      if (proposalExecutionGenerationRef.current === executionGeneration) {
        proposalExecutionRef.current = completedExecution;
        setProposalExecution(completedExecution);
      }
    } catch (executionError) {
      completedExecution = {
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
      if (proposalExecutionGenerationRef.current === executionGeneration) {
        proposalExecutionRef.current = completedExecution;
        setProposalExecution(completedExecution);
      }
    } finally {
      if (proposalExecutionGenerationRef.current === executionGeneration) {
        proposalExecutingRef.current = false;
        setProposalExecuting(false);
      }
    }
    if (proposalExecutionGenerationRef.current !== executionGeneration) return undefined;
    // Successful applications are no longer an editable draft. Allow the next
    // tool call to create a new proposal, just as on desktop.
    if (completedExecution!.ok) {
      proposalRevisionRef.current += 1;
      proposalRef.current = null;
      proposalExecutionRef.current = null;
      proposalExecutionContextRef.current = null;
      setProposal(null);
      setProposalExecution(null);
      setProposalDefaultRepoPath(null);
    }
    const applyResult = companionProposalApplyResult(
      current,
      completedExecution!,
      options?.autoApproved === true,
      appliedRevision,
    );
    if (!options?.returnResultToTool) await controller.submitProposalResult(applyResult, proposalSessionId);
    return completedExecution!;
  }, [controller]);

  const executeMobileTool = React.useCallback(
    async (
      expectedTargetDeviceId: string,
      tool: CompanionBrowserToolName,
      args: Record<string, unknown>,
    ) => {
      if (workspaceTargetRef.current?.targetDeviceId !== expectedTargetDeviceId) throw new Error('STALE_MOBILE_CONTEXT');
      if (tool === 'read_companion_proposal') return readProposal();
      if (tool === 'apply_companion_proposal_patch') {
        const proposalUpdate = applyProposal(
          String(args.targetId ?? ''),
          String(args.baseRevision ?? ''),
          String(args.content ?? ''),
        );
        if (!autoApproveSettingsRef.current.enabled || autoApproveSettingsRef.current.loading) return proposalUpdate;
        const current = proposalRef.current;
        if (!current?.operations.length) return proposalUpdate;
        const execution = await executeProposal({ autoApproved: true, returnResultToTool: true });
        if (!execution) throw new Error('PROPOSAL_EXECUTION_UNAVAILABLE');
        return companionProposalApplyResult(current, execution, true, proposalUpdate.revision);
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
    [applyProposal, executeProposal, readProposal, resolveEditor],
  );

  const cancel = React.useCallback(async () => {
    live.stop();
    await controller.cancel();
    await voice.discardRecording('companion');
  }, [controller, live.stop, voice.discardRecording]);

  const close = React.useCallback(async () => {
    live.reset();
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
  }, [controller, live.reset, voice.discardRecording]);

  React.useEffect(() => {
    const activeTargetDeviceId = activeTargetDeviceIdRef.current;
    if (!activeTargetDeviceId) return;
    const activeTarget = workspaceTargetRef.current;
    if (
      !activeTarget ||
      activeTarget.targetDeviceId !== activeTargetDeviceId ||
      !activeTarget.reachable ||
      !hasOperations
    ) {
      void close();
    }
  }, [close, hasOperations, proposalExecuting, targetRevision]);

  const run = React.useCallback(
    async (prompt: string, telemetry?: CompanionClientTelemetry, requestedMessageId?: string, liveWorkspaceKey?: string) => {
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
        executeTool: (tool, args) => {
          if (liveWorkspaceKey !== undefined && mobileLiveWorkspaceKey(workspaceTargetRef.current) !== liveWorkspaceKey) {
            throw new Error('Live workspace changed. Start a new voice conversation before editing the new workspace.');
          }
          return executeMobileTool(activeTarget.targetDeviceId, tool, args);
        },
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
      live.stop();
      await run(text);
      const next = controller.getSnapshot();
      if (next.status === 'error') {
        return { ok: false, error: next.error || 'Companion could not start.' };
      }
      return { ok: true };
    },
    [available, close, companionVoiceActive, controller, live.stop, run, unavailableReason],
  );

  const toggle = React.useCallback(async () => {
    if (liveActive) { live.stop(); return; }
    if (live.status === 'paused') { await live.resume(); return; }
    if (preparingVoice.current) return;
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
    const supportsLive = targetCapability?.operations.includes('live.settings.get');
    if (supportsLive) {
      preparingVoice.current = true;
      setCheckingVoiceMode(true);
      try {
        const preference = await mesh.request(activeTarget.targetDeviceId, COMPANION_CAPABILITY.id, 'live.settings.get') as { enabled?: unknown };
        if (!controller.isCurrent(token) || workspaceTargetRef.current?.targetDeviceId !== activeTarget.targetDeviceId) return;
        if (typeof preference?.enabled !== 'boolean') throw new Error('Could not read the Hub Live voice preference.');
        if (preference.enabled) {
          const operations = ['live.start', 'live.event', 'live.ping', 'live.close'];
          if (operations.some((operation) => !targetCapability?.operations.includes(operation))) {
            throw new Error('This Hub does not support all required Live voice operations. Update the Hub and try again.');
          }
          const workspaceKey = mobileLiveWorkspaceKey(activeTarget);
          await live.start(activeTarget.targetDeviceId, activeTarget.targetName, (prompt, signal) => {
            if (proposalExecutingRef.current) return Promise.reject(new Error('Companion is applying a proposal. Please ask again when it finishes.'));
            if (mobileLiveWorkspaceKey(workspaceTargetRef.current) !== workspaceKey) return Promise.reject(new Error('Live workspace changed. Start a new voice conversation.'));
            return waitForCompanionReply(controller, () => run(prompt, undefined, undefined, workspaceKey), signal);
          });
          return;
        }
      } catch (error) {
        if (controller.isCurrent(token)) controller.reportVoiceError(error instanceof Error ? error.message : 'Could not start Live voice.');
        return;
      } finally { preparingVoice.current = false; setCheckingVoiceMode(false); }
    }
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
    liveActive, live.status, live.resume, live.start, live.stop, mesh.request, targetCapability,
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
    if (!liveArmed && !checkingVoiceMode && (state.status === 'cancelled' || state.status === 'error' || state.status === 'idle')) {
      activeTargetDeviceIdRef.current = '';
    }
    const active = state.status === 'working' || liveArmed;
    mesh.setBackgroundActivityRequired(active);
    return () => {
      if (active) mesh.setBackgroundActivityRequired(false);
    };
  }, [mesh.setBackgroundActivityRequired, state.status, liveArmed, checkingVoiceMode]);

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

  React.useEffect(() => {
    if (!autoApproveSettings.enabled || autoApproveSettings.loading || effectiveStatus !== 'completed' ||
      !proposal?.operations.length || proposalExecuting || proposalExecution ||
      proposalExecutionContextRef.current?.targetDeviceId !== target?.targetDeviceId) return;
    void executeProposal({ autoApproved: true });
  }, [autoApproveSettings.enabled, autoApproveSettings.loading, effectiveStatus, proposal, proposalExecuting, proposalExecution, target?.targetDeviceId, executeProposal]);

  const value = React.useMemo<MobileCompanionContextValue>(
    () => ({
      ...state,
      transcript: state.transcript.startsWith(LIVE_COMPANION_PROMPT_PREFIX) ? '' : state.transcript,
      live,
      checkingVoiceMode,
      autoApproveSettings,
      status: effectiveStatus,
      durationMillis: effectiveDurationMillis,
      proposal,
      proposalExecution,
      proposalDefaultRepoPath,
      proposalExecuting,
      available,
      workspaceDeviceId: activeTargetDeviceIdRef.current || target?.targetDeviceId || '',
      unavailableReason,
      toggle,
      submitText,
      close,
      cancel,
      executeProposal: async () => { await executeProposal(); },
      discardProposal,
      registerWorkspaceTarget,
      registerEditorTarget,
    }),
    [
      live, checkingVoiceMode, autoApproveSettings,
      target?.targetDeviceId,
      available,
      cancel,
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

function mobileLiveWorkspaceKey(target: MobileCompanionWorkspaceTarget | null): string {
  const context = target?.getAppContext();
  const openFile = context?.openFile as { path?: unknown } | undefined;
  return JSON.stringify([target?.targetDeviceId, context?.mainDroneId, context?.selectedChat, context?.pane, openFile?.path]);
}
