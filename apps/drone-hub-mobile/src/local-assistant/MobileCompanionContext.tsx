import { CompanionScreen } from '@drone/assistant-chat';
import { useMobileCompanionAutoApproveSettings } from './use-mobile-companion-auto-approve-settings';
import { useMobileCompanionLiveSettings } from './use-mobile-companion-live-settings';
import type { CompanionContextUsage, CompanionCompactionActivity } from '@drone/assistant-chat';
import React from 'react';
import * as Crypto from 'expo-crypto';
import { COMPANION_CAPABILITY, COMPANION_RUN_OPERATIONS } from '@drone/device-protocol';
import {
  CompanionProposalStore,
  type ProposalSummary,
  COMPANION_PROPOSAL_TARGET_ID,
  CompanionClientController,
  companionProposalApplyResult,
  waitForCompanionReply,
  LIVE_COMPANION_PROMPT_PREFIX,
  executeCompanionBrowserTool,
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

import { useMobileCompanionHeadsetShortcut } from './use-mobile-companion-headset-shortcut';
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
  /** A known drone's display name on the target Hub, or null for unknown ids. */
  resolveDroneName?(droneId: string): string | null;
};

type MobileCompanionContextValue = {
  screen: CompanionScreen;
  status: CompanionStatus;
  live: ReturnType<typeof useMobileCompanionLive>;
  checkingVoiceMode: boolean;
  headsetShortcut: ReturnType<typeof useMobileCompanionHeadsetShortcut>;
  autoApproveSettings: ReturnType<typeof useMobileCompanionAutoApproveSettings>;
  /** The Hub's Live voice preference, shared with desktop Companion. */
  liveSettings: ReturnType<typeof useMobileCompanionLiveSettings> & { supported: boolean };
  switchingVoice: boolean;
  recordingPaused: boolean;
  /** Whether the target Hub can resolve the current drone's workspace for quick read access. */
  currentWorkspaceSupported: boolean;
  /** The Companion sheet is on screen. Chat composers collapse to one line while it is. */
  overlayOpen: boolean;
  /** Bottom space the chat screen reserves so the composer stays above the Companion sheet. */
  overlayInset: number;
  reportOverlayInset(px: number): void;
  /** A chat composer has the keyboard; the Companion sheet shrinks to its header. */
  composerFocused: boolean;
  setComposerFocused(focused: boolean): void;
  error: string;
  reply: string;
  transcript: string;
  durationMillis: number;
  startedAt: number | null;
  endedAt: number | null;
  activity: CompanionToolActivity[];
  subscriptions: import('@drone/assistant-chat').PresentedChatResourceSubscription[];
  compaction: CompanionCompactionActivity | null;
  contextUsage: CompanionContextUsage | null;
  proposalHistory: Array<{ targetId: string; proposal: CompanionProposal; execution: CompanionProposalExecution }>;
  proposals: ProposalSummary[];
  selectedProposalId: string | null;
  selectProposal(id: string): void;
  proposal: CompanionProposal | null;
  proposalExecution: CompanionProposalExecution | null;
  proposalDefaultRepoPath: string | null;
  proposalExecuting: boolean;
  selectedProposalExecuting: boolean;
  available: boolean;
  workspaceDeviceId: string;
  unavailableReason: string;
  toggle(): Promise<void>;
  /** Start or resume Live for an explicit Android assistant invocation. */
  startAssistantVoice(signal: AbortSignal): Promise<void>;
  /** Flip the Hub's Live voice preference and start the microphone in the new mode, like desktop. */
  toggleLiveVoice(): Promise<void>;
  toggleRecordingPause(): void;
  discardRecording(): Promise<void>;
  /** The registered workspace's app context, or null before Drone Hub is open. */
  readAppContext(): Record<string, unknown> | null;
  resolveDroneName(droneId: string): string | null;
  /** Send already-transcribed text to Companion as if it had just been spoken. */
  submitText(prompt: string): Promise<{ ok: true } | { ok: false; error: string }>;
  close(): Promise<void>;
  cancel(): Promise<void>;
  executeProposal(targetId?: string, baseRevision?: string): Promise<void>;
  discardProposal(targetId?: string, baseRevision?: string): void;
  registerWorkspaceTarget(target: MobileCompanionWorkspaceTarget): () => void;
  registerEditorTarget(target: MobileCompanionEditorTarget): () => void;
};

const MobileCompanionContext = React.createContext<MobileCompanionContextValue | null>(null);

export function MobileCompanionProvider({ children }: { children: React.ReactNode }) {
  const [screen] = React.useState(() => new CompanionScreen());
  React.useEffect(() => () => screen.detach(), [screen]);
  const mesh = useMesh();
  const voice = useSharedMobileChatVoiceRecorder();
  const [checkingVoiceMode, setCheckingVoiceMode] = React.useState(false);
  const preparingVoice = React.useRef(false);
  const companionVoiceActive = voice.session.kind === 'companion';
  const controllerRef = React.useRef<CompanionClientController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CompanionClientController({ createId: Crypto.randomUUID });
  }
  const controller = controllerRef.current;
  const headsetCallbacks = React.useRef({ start: async () => {}, ended: () => {} });
  const live = useMobileCompanionLive(voice.microphoneCoordinator, controller, {
    start: () => headsetCallbacks.current.start(), ended: () => headsetCallbacks.current.ended(),
  });
  const headsetShortcut = useMobileCompanionHeadsetShortcut(live.setHeadsetShortcut);
  const liveActive = live.status === 'connecting' || live.status === 'listening';
  const liveArmed = liveActive || live.status === 'paused';
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
  const [proposalActionError, setProposalActionError] = React.useState('');
  const [proposalStore] = React.useState(() => new CompanionProposalStore<MobileCompanionProposalExecutionContext>(Crypto.randomUUID));
  const proposalStoreVersion = React.useSyncExternalStore(proposalStore.subscribe, proposalStore.getSnapshot, proposalStore.getSnapshot);
  const selectedProposal = proposalStore.selected;
  const proposal = selectedProposal?.visible ? selectedProposal.proposal : null;
  const proposalExecution = selectedProposal?.execution ?? null;
  const proposalDefaultRepoPath = selectedProposal?.context?.defaultRepoPath ?? null;
  const proposalExecuting = Boolean(proposalStore.executingId);
  const proposalExecutingRef = React.useMemo(() => ({ get current() { return Boolean(proposalStore.executingId); } }), [proposalStore]);

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
  const liveSupported = Boolean(
    available &&
    targetCapability?.operations.includes('live.settings.get') &&
    targetCapability?.operations.includes('live.settings.update'),
  );
  const liveSettingsState = useMobileCompanionLiveSettings(liveSupported ? target!.targetDeviceId : '', false);
  const liveSettings = React.useMemo(
    () => ({ ...liveSettingsState, supported: liveSupported }),
    [liveSettingsState, liveSupported],
  );
  const currentWorkspaceSupported = Boolean(
    available && targetCapability?.operations.includes('workspaces.current'),
  );
  const [switchingVoice, setSwitchingVoice] = React.useState(false);
  const switchingVoiceRef = React.useRef(false);
  const [overlayInset, setOverlayInset] = React.useState(0);
  const [composerFocused, setComposerFocused] = React.useState(false);
  const reportOverlayInset = React.useCallback((px: number) => {
    setOverlayInset((current) => (Math.abs(current - px) < 0.5 ? current : px));
  }, []);
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

  const proposalContext = (): MobileCompanionProposalExecutionContext => {
    const target = workspaceTargetRef.current;
    if (!target) throw new Error('NO_ACTIVE_MOBILE_CONTEXT');
    const appContext = target.getAppContext();
    return { defaultRepoPath: typeof appContext?.activeRepoPath === 'string' ? appContext.activeRepoPath : '', targetDeviceId: target.targetDeviceId };
  };
  const readProposal = React.useCallback((targetId?: string) => proposalStore.read(targetId), [proposalStore]);
  const applyProposal = React.useCallback((targetId: string, baseRevision: string, content: string) =>
    proposalStore.patch(targetId, baseRevision, content, () => proposalContext(), controller.getSessionId()), [controller, proposalStore]);
  const discardProposal = React.useCallback((targetId?: string, baseRevision?: string) => {
    const id = targetId ?? proposalStore.selectedId;
    try {
      if (id) proposalStore.discard(id, baseRevision ?? proposalStore.read(id).revision);
      setProposalActionError('');
    } catch (error) {
      setProposalActionError(error instanceof Error ? error.message : String(error));
    }
  }, [proposalStore]);
  const executeProposal = React.useCallback(async (options?: {
    autoApproved?: boolean;
    returnResultToTool?: boolean;
    targetId?: string;
    baseRevision?: string;
  }): Promise<CompanionProposalExecution | undefined> => {
    const targetId = options?.targetId ?? proposalStore.selectedId;
    if (!targetId) return;
    const revision = options?.baseRevision ?? proposalStore.read(targetId).revision;
    const entry = proposalStore.begin(targetId, revision);
    const autoApproved = options?.autoApproved === true;
    let execution: CompanionProposalExecution;
    try {
      const target = workspaceTargetRef.current;
      if (!target || !target.reachable || target.targetDeviceId !== entry.context!.targetDeviceId) {
        throw new Error(target?.targetDeviceId !== entry.context!.targetDeviceId ? 'PROPOSAL_TARGET_CHANGED' : 'TARGET_DEVICE_OFFLINE');
      }
      execution = await target.executeProposal(entry.proposal, entry.context!);
    } catch (error) {
      execution = { ok: false, operations: entry.proposal.operations.map((operation, index) => index === 0
        ? { id: operation.id, type: operation.type, status: 'failed', error: error instanceof Error ? error.message : String(error) }
        : { id: operation.id, type: operation.type, status: 'skipped' }) };
    }
    if (!proposalStore.finish(entry, execution, autoApproved)) return undefined;
    const result = companionProposalApplyResult(entry.proposal, execution, autoApproved, revision, entry.id);
    if (!options?.returnResultToTool) await controller.submitProposalResult(result, entry.sessionId);
    return execution;
  }, [controller, proposalStore]);

  const executeMobileTool = React.useCallback(
    async (
      expectedTargetDeviceId: string,
      tool: CompanionBrowserToolName,
      args: Record<string, unknown>,
    ) => {
      if (workspaceTargetRef.current?.targetDeviceId !== expectedTargetDeviceId) throw new Error('STALE_MOBILE_CONTEXT');
      if (tool === 'show_on_screen') return await screen.execute(args);
      if (tool === 'list_proposals') return { proposals: proposalStore.list() };
      if (tool === 'create_proposal') return proposalStore.create(proposalContext(), controller.getSessionId(), typeof args.title === 'string' ? args.title : undefined);
      if (tool === 'read_proposal') return readProposal(typeof args.targetId === 'string' ? args.targetId : undefined);
      if (tool === 'discard_proposal') return proposalStore.discard(String(args.targetId ?? ''), String(args.baseRevision ?? ''));
      if (tool === 'apply_proposal_patch') return applyProposal(String(args.targetId ?? ''), String(args.baseRevision ?? ''), String(args.content ?? ''));
      if (tool === 'execute_proposal') {
        const targetId = String(args.targetId ?? '');
        const revision = String(args.baseRevision ?? '');
        const entry = proposalStore.ready(targetId, revision);
        if (!autoApproveSettingsRef.current.enabled || autoApproveSettingsRef.current.loading) {
          proposalStore.selectIfUnreviewed(targetId);
          return { applied: false, status: 'pending_review', targetId, revision, operationCount: entry.proposal.operations.length };
        }
        const execution = await executeProposal({ autoApproved: true, returnResultToTool: true, targetId, baseRevision: revision });
        if (!execution) throw new Error('PROPOSAL_EXECUTION_UNAVAILABLE');
        return companionProposalApplyResult(entry.proposal, execution, true, revision, targetId);
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
    screen.clear();
    live.reset();
    if (proposalExecutingRef.current) return;
    activeTargetDeviceIdRef.current = '';
    await controller.close();
    await voice.discardRecording('companion');
    proposalStore.clear();
    setProposalActionError('');

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
    async (prompt: string, telemetry?: CompanionClientTelemetry, requestedMessageId?: string, liveScope?: MobileLiveScope) => {
      if (liveScope) observeMobileLiveWorkspace(liveScope, workspaceTargetRef.current, 'submit');
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
      const messageId = requestedMessageId ?? (liveScope ? Crypto.randomUUID() : undefined);
      await controller.submitPrompt({
        prompt,
        telemetry,
        messageId,
        createTransport: () =>
          createMobileCompanionTransport({
            targetDeviceId: activeTarget.targetDeviceId,
            request: mesh.request,
            subscribe: mesh.subscribe,
          }),
        executeTool: async (tool, args) => {
          const started = performance.now();
          const log = { contextId: liveScope?.id, messageId, tool };
          try {
            if (liveScope) observeMobileLiveWorkspace(liveScope, workspaceTargetRef.current, 'tool', tool);
            const result = await executeMobileTool(activeTarget.targetDeviceId, tool, args);
            if (liveScope) console.info('[CompanionLive] Browser tool completed', { ...log, durationMs: Math.round(performance.now() - started) });
            return result;
          } catch (error) {
            if (liveScope) console.warn('[CompanionLive] Browser tool failed', {
              ...log, durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      });
    },
    [close, controller, executeMobileTool, mesh.request, mesh.subscribe],
  );

  const startLive = React.useCallback(async () => {
    const activeTarget = workspaceTargetRef.current;
    if (!activeTarget || !available) throw new Error(unavailableReason || 'Companion is unavailable.');
    if (voice.session.kind !== 'idle' || !voice.session.microphoneAvailable) {
      throw new Error('Another voice feature is using the microphone. Stop it before starting Live.');
    }
    const operations = ['live.start', 'live.event', 'live.ping', 'live.close'];
    if (operations.some((operation) => !targetCapability?.operations.includes(operation))) {
      throw new Error('This Hub does not support all required Live voice operations. Update the Hub and try again.');
    }
    activeTargetDeviceIdRef.current = activeTarget.targetDeviceId;
    voice.setError('');
    const liveScope: MobileLiveScope = {
      id: Crypto.randomUUID(), targetDeviceId: activeTarget.targetDeviceId,
      lastWorkspace: mobileLiveWorkspaceSnapshot(activeTarget),
    };
    console.info('[CompanionLive] Context attached', { contextId: liveScope.id, workspace: liveScope.lastWorkspace });
    await live.start(activeTarget.targetDeviceId, activeTarget.targetName, async (prompt, signal, telemetry) => {
      if (proposalExecutingRef.current) return Promise.reject(new Error('Companion is applying a proposal. Please ask again when it finishes.'));
      observeMobileLiveWorkspace(liveScope, workspaceTargetRef.current, 'delegation');
      return waitForCompanionReply(controller, () => run(prompt, telemetry, undefined, liveScope), signal);
    });
  }, [available, unavailableReason, targetCapability, live.start, voice, controller, run]);
  headsetCallbacks.current = { start: async () => {
    if (preparingVoice.current) throw new Error('Companion is already preparing voice.');
    await startLive();
  }, ended: headsetShortcut.ended };

  const startAssistantVoiceImpl = async (signal: AbortSignal) => {
    if (signal.aborted) return;
    if (liveActive) return;
    const startOwnedAudio = async (start: () => Promise<void>) => {
      // Only cancel audio started by this request, never an already-established conversation.
      const cancel = () => live.stop();
      signal.addEventListener('abort', cancel, { once: true });
      try { if (!signal.aborted) await start(); }
      finally { signal.removeEventListener('abort', cancel); }
    };
    if (live.status === 'paused') { await startOwnedAudio(live.resume); return; }
    if (preparingVoice.current) throw new Error('Companion is already preparing voice.');
    const activeTarget = workspaceTargetRef.current;
    if (!activeTarget || !available) throw new Error(unavailableReason || 'Companion is unavailable.');
    preparingVoice.current = true;
    setCheckingVoiceMode(true);
    try {
      const preference = await mesh.request(activeTarget.targetDeviceId, COMPANION_CAPABILITY.id,
        'live.settings.get', undefined, signal) as { enabled?: unknown };
      if (signal.aborted || workspaceTargetRef.current?.targetDeviceId !== activeTarget.targetDeviceId) return;
      if (preference?.enabled !== true) throw new Error('Enable Companion Live voice in Drone Hub settings first.');
      await startOwnedAudio(startLive);
    } finally { preparingVoice.current = false; setCheckingVoiceMode(false); }
  };
  const assistantStartImpl = React.useRef(startAssistantVoiceImpl);
  assistantStartImpl.current = startAssistantVoiceImpl;
  const assistantStartup = React.useRef(Promise.resolve());
  const startAssistantVoice = React.useCallback((signal: AbortSignal) => {
    // A new press waits for the cancelled request's audio cleanup before starting again.
    const pending = assistantStartup.current.catch(() => {}).then(async () => {
      if (!signal.aborted) await assistantStartImpl.current(signal);
    });
    assistantStartup.current = pending;
    return pending;
  }, []);

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
    if (liveActive) { live.pause(); return; }
    if (live.status === 'paused') { await live.resume(); return; }
    if (preparingVoice.current) return;
    if (
      companionVoiceActive &&
      (voice.session.status === 'starting' || voice.session.status === 'transcribing')
    ) {
      return;
    }
    if (voice.session.kind === 'companion' &&
      (voice.session.status === 'recording' || voice.session.status === 'paused')) {
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
          await startLive();
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
    liveActive, live.status, live.resume, startLive, live.pause, mesh.request, targetCapability,
  ]);

  const companionRecording =
    voice.session.kind === 'companion' &&
    (voice.session.status === 'recording' || voice.session.status === 'paused');
  const toggleLiveVoice = React.useCallback(async () => {
    if (
      switchingVoiceRef.current || !liveSettings.supported || liveSettings.loading || liveSettings.saving ||
      preparingVoice.current ||
      (companionVoiceActive && (voice.session.status === 'starting' || voice.session.status === 'transcribing'))
    ) return;
    switchingVoiceRef.current = true;
    setSwitchingVoice(true);
    try {
      const wasLiveActive = liveActive || live.status === 'paused';
      // Finish existing dictation before changing microphone modes.
      if (!liveSettings.enabled && companionRecording) await toggle();
      const token = controller.getToken();
      const enabled = await liveSettings.save(!liveSettings.enabled);
      // Closing Companion while the preference is saving must not reopen its microphone.
      if (enabled === undefined || !controller.isCurrent(token)) return;
      if (!enabled) {
        // Ending Live is the whole change; dictation starts on the next microphone tap.
        if (wasLiveActive) { live.stop(); return; }
      }
      if (controller.getSnapshot().status === 'working' || proposalExecutingRef.current) return;
      await toggle();
    } finally {
      switchingVoiceRef.current = false;
      setSwitchingVoice(false);
    }
  }, [companionRecording, companionVoiceActive, controller, live.status, live.stop, liveActive, liveSettings, toggle, voice.session.status]);

  const toggleRecordingPause = React.useCallback(() => {
    if (!companionRecording) return;
    voice.toggleRecordingPause('companion');
  }, [companionRecording, voice]);

  const discardRecording = React.useCallback(async () => {
    if (!companionVoiceActive) return;
    await voice.discardRecording('companion');
    controller.resetIfNoSession();
  }, [companionVoiceActive, controller, voice]);

  const readAppContext = React.useCallback(
    () => workspaceTargetRef.current?.getAppContext() ?? null,
    [],
  );
  const resolveDroneName = React.useCallback(
    (droneId: string) => workspaceTargetRef.current?.resolveDroneName?.(droneId) ?? null,
    [],
  );

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
    const active = state.status === 'working' || liveArmed || live.shortcutArmed;
    mesh.setBackgroundActivityRequired(active);
    return () => {
      if (active) mesh.setBackgroundActivityRequired(false);
    };
  }, [mesh.setBackgroundActivityRequired, state.status, liveArmed, live.shortcutArmed, checkingVoiceMode]);

  React.useEffect(
    () => () => {
      proposalStore.clear();
      void controller.close();
      void voice.discardRecording('companion');
    },
    [controller, voice.discardRecording],
  );

  const effectiveStatus = resolveMobileCompanionVoiceStatus(state.status, voice.session);
  const overlayOpen =
    effectiveStatus !== 'idle' || live.hasStarted || liveArmed || live.status === 'error' || checkingVoiceMode;
  const effectiveDurationMillis =
    voice.session.kind === 'companion' ? voice.session.durationMillis : 0;

  const value = React.useMemo<MobileCompanionContextValue>(
    () => ({
      ...state,
      screen,
      error: proposalActionError || state.error,
      transcript: state.transcript.startsWith(LIVE_COMPANION_PROMPT_PREFIX) ? '' : state.transcript,
      live,
      checkingVoiceMode,
      headsetShortcut,
      autoApproveSettings,
      liveSettings,
      switchingVoice,
      recordingPaused: voice.session.kind === 'companion' && voice.session.status === 'paused',
      currentWorkspaceSupported,
      overlayOpen,
      overlayInset,
      reportOverlayInset,
      composerFocused,
      setComposerFocused,
      status: effectiveStatus,
      durationMillis: effectiveDurationMillis,
      proposalHistory: proposalStore.history.map(item => ({ targetId: item.entry.id, proposal: item.entry.proposal, execution: item.execution })),
      proposals: proposalStore.listPending(),
      selectedProposalId: proposalStore.selectedId,
      selectProposal: (id: string) => proposalStore.select(id),
      proposal,
      proposalExecution,
      proposalDefaultRepoPath,
      proposalExecuting,
      selectedProposalExecuting: Boolean(proposalStore.executingId && proposalStore.selectedId === proposalStore.executingId),
      available,
      workspaceDeviceId: activeTargetDeviceIdRef.current || target?.targetDeviceId || '',
      unavailableReason,
      toggle,
      startAssistantVoice,
      toggleLiveVoice,
      toggleRecordingPause,
      discardRecording,
      readAppContext,
      resolveDroneName,
      submitText,
      close,
      cancel,
      executeProposal: async (targetId?: string, baseRevision?: string) => {
        try {
          await executeProposal({ targetId, baseRevision });
          setProposalActionError('');
        } catch (error) {
          setProposalActionError(error instanceof Error ? error.message : String(error));
        }
      },
      discardProposal,
      registerWorkspaceTarget,
      registerEditorTarget,
    }),
    [
      proposalStore, proposalStoreVersion, proposalActionError,
      live, checkingVoiceMode, headsetShortcut, autoApproveSettings, liveSettings, switchingVoice, currentWorkspaceSupported,
      overlayOpen, overlayInset, reportOverlayInset, composerFocused,
      voice.session,
      toggleLiveVoice, toggleRecordingPause, discardRecording, readAppContext, resolveDroneName,
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
      startAssistantVoice,
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

type MobileLiveWorkspaceSnapshot = ReturnType<typeof mobileLiveWorkspaceSnapshot>;
type MobileLiveScope = { id: string; targetDeviceId: string; lastWorkspace: MobileLiveWorkspaceSnapshot };

function mobileLiveWorkspaceSnapshot(target: MobileCompanionWorkspaceTarget | null) {
  const context = target?.getAppContext();
  const openFile = context?.openFile as { path?: unknown } | undefined;
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  return {
    targetDeviceId: target?.targetDeviceId ?? null,
    droneId: text(context?.mainDroneId), chat: text(context?.selectedChat),
    pane: text(context?.pane), openFile: text(openFile?.path),
  };
}

/** Navigation is context for tools, never a reason to invalidate a Live conversation. */
function observeMobileLiveWorkspace(scope: MobileLiveScope, target: MobileCompanionWorkspaceTarget | null,
  stage: 'delegation' | 'submit' | 'tool', tool?: CompanionBrowserToolName) {
  const current = mobileLiveWorkspaceSnapshot(target);
  const fields = Object.keys(current) as Array<keyof MobileLiveWorkspaceSnapshot>;
  const changes = Object.fromEntries(fields.filter((field) => current[field] !== scope.lastWorkspace[field])
    .map((field) => [field, { from: scope.lastWorkspace[field], to: current[field] }]));
  const log = { contextId: scope.id, stage, ...(tool ? { tool } : {}), changes };
  // Keep routing bound to the Hub that owns this voice session. Individual edit
  // tools validate target IDs and revisions when they actually apply a change.
  if (current.targetDeviceId !== scope.targetDeviceId) {
    console.warn('[CompanionLive] Hub routing mismatch', log);
    throw new Error('Live is connected to a different Hub. Restart Live to use the selected Hub.');
  }
  if (Object.keys(changes).length) console.info('[CompanionLive] Workspace context changed', log);
  scope.lastWorkspace = current;
}
