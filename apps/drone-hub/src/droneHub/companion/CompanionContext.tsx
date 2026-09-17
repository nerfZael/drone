import { CompanionScreen } from '@drone/assistant-chat';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { desktopCompanionSessionStore } from './companion-session-store';
import { useCompanionAutoApprove } from './use-companion-auto-approve';
import type { CompanionContextUsage, CompanionCompactionActivity } from '@drone/assistant-chat';
import React from 'react';
import { createCompanionActionReporter, type CompanionActionNotification } from './companion-action-notifications';
import { useRecorderCompanion } from '../dictation/RecorderCompanionContext';
import {
  CompanionProposalStore,
  type ProposalSummary,
  COMPANION_PROPOSAL_TARGET_ID,
  CompanionClientController,
  companionProposalApplyResult,
  companionProposalInterruptedExecution,
  executeCompanionBrowserTool,
  type CompanionBrowserToolName,
  type CompanionClientTelemetry,
  type CompanionProposal,
  type CompanionProposalExecution,
  type CompanionProposalExecutionContext,
  type CompanionProposalExecutionProgress,
  type CompanionStatus,
  type CompanionToolActivity,
} from '@drone/assistant-chat';

import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import { useChatVoiceRecorder } from '../chat/use-chat-voice-recorder';
import {
  shouldCancelCompanionRecordingWithEscape,
  CompanionShortcutPress,
  companionHoldAction,
  type CompanionHoldAction,
  isCompanionShortcutDoubleTap,
  type CompanionShortcutEvent,
} from './companion-shortcut';
import { playCompanionRecordingCue, prepareCompanionRecordingCues } from './companion-recording-cues';
import { createCompanionWebSocketTransport } from './companion-websocket-transport';
import { useCompanionLive } from './use-companion-live';
import { LIVE_COMPANION_PROMPT_PREFIX } from './CompanionLiveConversation';
import { waitForCompanionReply } from './waitForCompanionReply';
import { useCompanionWorkspace, type CapturedCompanionWorkspace } from './CompanionWorkspaceContext';

export type CompanionProposalHistoryEntry = {
  id: string;
  targetId?: string;
  proposal: CompanionProposal;
  execution: CompanionProposalExecution;
  defaultRepoPath: string;
  droneNames: Readonly<Record<string, string>>;
  startedAt: number;
  completedAt: number;
  autoApproved: boolean;
};

type CompanionTextSubmitResult = { ok: true } | { ok: false; error: string };

type CompanionContextValue = {
  screen: CompanionScreen;
  sessionId: string | null;
  live: ReturnType<typeof useCompanionLive>;
  status: CompanionStatus;
  recordingPaused: boolean;
  pendingTranscriptions: number;
  shortcutHint: CompanionHoldAction | null;
  panelVisibility: 'auto' | 'open' | 'closed';
  dismiss(): Promise<void>;
  handleShortcut(event?: CompanionShortcutEvent): void;
  resetContext(): Promise<void>;
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
  proposals: ProposalSummary[];
  selectedProposalId: string | null;
  selectProposal(id: string): void;
  proposal: CompanionProposal | null;
  proposalExecution: CompanionProposalExecution | null;
  proposalExecutionProgress: CompanionProposalExecutionProgress | null;
  proposalDroneNames: Readonly<Record<string, string>>;
  proposalDefaultRepoPath: string | null;
  proposalExecuting: boolean;
  selectedProposalExecuting: boolean;
  autoApprove: boolean;
  proposalHistory: CompanionProposalHistoryEntry[];
  actionNotifications: CompanionActionNotification[];
  dismissActionNotification(id: string): void;
  submitText(prompt: string): Promise<CompanionTextSubmitResult>;
  prepareTextSubmission(): (prompt: string) => Promise<CompanionTextSubmitResult>;
  toggle(): Promise<void>;
  toggleLiveVoice(): Promise<void>;
  switchingVoice: boolean;
  stop(): void;
  toggleRecordingPause(): void;
  discardRecording(): Promise<void>;
  close(): Promise<void>;
  executeProposal(targetId?: string, baseRevision?: string): Promise<void>;
  discardProposal(targetId?: string, baseRevision?: string): void;
  toggleAutoApprove(): void;
};

const CompanionContext = React.createContext<CompanionContextValue | null>(null);

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `companion-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const [screen] = React.useState(() => new CompanionScreen());
  React.useEffect(() => () => screen.detach(), [screen]);
  const workspace = useCompanionWorkspace();
  const recorder = useRecorderCompanion();
  const controllerRef = React.useRef<CompanionClientController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CompanionClientController({ createId: newId, sessionStore: desktopCompanionSessionStore });
  }
  const controller = controllerRef.current;
  const state = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [proposalActionError, setProposalActionError] = React.useState('');
  const [proposalStore] = React.useState(() => new CompanionProposalStore<CompanionProposalExecutionContext>(newId));
  const proposalStoreVersion = React.useSyncExternalStore(proposalStore.subscribe, proposalStore.getSnapshot, proposalStore.getSnapshot);
  const selectedProposal = proposalStore.selected;
  const proposalExecution = selectedProposal?.execution ?? null;
  const proposalDefaultRepoPath = selectedProposal?.context?.defaultRepoPath ?? null;
  const proposalExecuting = Boolean(proposalStore.executingId);
  const proposalExecutingRef = React.useMemo(() => ({ get current() { return Boolean(proposalStore.executingId); } }), [proposalStore]);
  const [proposalExecutionProgress, setProposalExecutionProgress] = React.useState<CompanionProposalExecutionProgress | null>(null);
  const [proposalDroneNames, setProposalDroneNames] = React.useState<Readonly<Record<string, string>>>({});
  const autoApproveSettings = useCompanionAutoApprove();
  const autoApprove = autoApproveSettings.enabled;
  // Keep proposals available for manual inspection in auto-approve mode.
  // Wait for settings before exposing drafts so unresolved settings cannot open a card.
  const reviewProposals = !autoApproveSettings.loading;
  const proposal = reviewProposals && selectedProposal?.visible ? selectedProposal.proposal : null;
  const autoApproveSettingsRef = React.useRef(autoApproveSettings);
  autoApproveSettingsRef.current = autoApproveSettings;
  const [actionNotifications, setActionNotifications] = React.useState<CompanionActionNotification[]>([]);
  const dismissActionNotification = React.useCallback((id: string) => {
    setActionNotifications((items) => items.filter((item) => item.id !== id));
  }, []);
  const [proposalHistory, setProposalHistory] = React.useState<CompanionProposalHistoryEntry[]>([]);
  const voiceSubmissionGenerationRef = React.useRef(0);
  const voiceSubmissionQueueRef = React.useRef(Promise.resolve());
  const resettingRef = React.useRef(false);
  const [shortcutPress] = React.useState(() => new CompanionShortcutPress());
  const [shortcutHint, setShortcutHint] = React.useState<CompanionHoldAction | null>(null);
  const [panelVisibility, setPanelVisibility] = React.useState<'auto' | 'open' | 'closed'>('auto');
  const lastLiveShortcutAtRef = React.useRef(0);
  const recordingWorkspaceRef = React.useRef<{ workspace: CapturedCompanionWorkspace | null } | null>(null);
  const textSubmissionGenerationRef = React.useRef(0);
  const captureWorkspace = React.useCallback(() => workspace?.capture() ?? null, [workspace]);

  const onVoiceError = React.useCallback(
    (message: string) => controller.reportVoiceError(message),
    [controller],
  );
  const voice = useChatVoiceRecorder({ onError: onVoiceError, microphoneOwner: 'companion', backgroundTranscription: true });
  const live = useCompanionLive(controller);
  const [switchingVoice, setSwitchingVoice] = React.useState(false);
  const switchingVoiceRef = React.useRef(false);
  const voiceStatusRef = React.useRef(voice.status);
  const discardVoiceRecordingRef = React.useRef(voice.discardRecording);
  voiceStatusRef.current = voice.status;

  const close = React.useCallback(async (stopApplyingProposal = false) => {
    screen.clear();
    if (proposalExecutingRef.current && !stopApplyingProposal) return;
    shortcutPress.cancel();
    setShortcutHint(null);
    live.reset();
    setPanelVisibility('closed');
    voiceSubmissionQueueRef.current = Promise.resolve();
    voiceSubmissionGenerationRef.current += 1;
    textSubmissionGenerationRef.current += 1;
    recordingWorkspaceRef.current = null;
    proposalStore.clear();
    setProposalActionError('');
    setProposalHistory([]);
    setActionNotifications([]);
    setProposalExecutionProgress(null);
    setProposalDroneNames({});
    await Promise.all([controller.close(), voice.discardRecording()]);
  }, [controller, voice.discardRecording, live.reset]);

  const dismiss = React.useCallback(async () => {
    shortcutPress.cancel();
    setShortcutHint(null);
    setPanelVisibility('closed');
    live.reset();
    voiceSubmissionGenerationRef.current += 1;
    textSubmissionGenerationRef.current += 1;
    recordingWorkspaceRef.current = null;
    proposalStore.clear();
    setProposalExecutionProgress(null);
    setProposalActionError('');
    screen.clear();
    const stopping = Promise.all([controller.cancel(), voice.discardRecording()]).then(() => {});
    voiceSubmissionQueueRef.current = stopping.catch(() => {});
    await stopping;
  }, [controller, live.reset, proposalStore, screen, shortcutPress, voice.discardRecording]);

  const stop = React.useCallback(() => {
    if (controller.getSnapshot().status !== 'working') return;
    live.cancelPending();
    textSubmissionGenerationRef.current += 1;
    voiceSubmissionGenerationRef.current += 1;
    voiceSubmissionQueueRef.current = Promise.resolve();
    void controller.cancel();
  }, [controller, live.cancelPending]);

  const toggleRecordingPause = React.useCallback(() => {
    voice.toggleRecordingPause();
  }, [voice.toggleRecordingPause]);

  const discardRecording = React.useCallback(async () => {
    shortcutPress.cancel();
    setShortcutHint(null);
    recordingWorkspaceRef.current = null;
    setPanelVisibility('open');
    await voice.discardRecording({ preserveTranscriptions: true });
    controller.resetIfNoSession();
  }, [controller, shortcutPress, voice.discardRecording]);
  discardVoiceRecordingRef.current = discardRecording;

  const proposalContext = (capturedWorkspace: CapturedCompanionWorkspace | null): CompanionProposalExecutionContext => {
    const appContext = capturedWorkspace?.getAppContext();
    return { defaultRepoPath: typeof appContext?.activeRepoPath === 'string' ? appContext.activeRepoPath : '' };
  };
  const readProposal = React.useCallback((targetId?: string) => proposalStore.read(targetId), [proposalStore]);
  const applyProposal = React.useCallback((targetId: string, baseRevision: string, content: string, capturedWorkspace: CapturedCompanionWorkspace | null) =>
    proposalStore.patch(targetId, baseRevision, content, () => proposalContext(capturedWorkspace), controller.getSessionId()), [controller, proposalStore]);
  const discardProposal = React.useCallback((targetId?: string, baseRevision?: string) => {
    const id = targetId ?? proposalStore.selectedId;
    try {
      if (id) proposalStore.discard(id, baseRevision ?? proposalStore.read(id).revision);
      setProposalActionError('');
    } catch (error) {
      setProposalActionError(error instanceof Error ? error.message : String(error));
    }
  }, [proposalStore]);
  const toggleAutoApprove = React.useCallback(() => {
    setActionNotifications([]);
    void autoApproveSettings.toggle();
  }, [autoApproveSettings.toggle]);

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
    const startedAt = Date.now();
    let droneNames: Record<string, string> = {};
    setProposalDroneNames(droneNames);
    setProposalExecutionProgress({ activeOperationId: null, operations: [] });
    let reportActions: ReturnType<typeof createCompanionActionReporter> | null = null;
    let execution: CompanionProposalExecution;
    let latestProgress: CompanionProposalExecutionProgress | null = null;
    try {
      droneNames = Object.fromEntries(entry.proposal.operations.flatMap(operation =>
        'droneId' in operation && !operation.droneId.startsWith('$')
          ? [[operation.droneId, workspace?.resolveDroneName(operation.droneId) || operation.droneId]] : []));
      setProposalDroneNames(droneNames);
      reportActions = createCompanionActionReporter(entry.proposal, droneNames, notifications => {
        if (autoApproved) setActionNotifications(items => [...items, ...notifications].slice(-3));
      });
      if (!workspace) throw new Error('PROPOSAL_EXECUTION_UNAVAILABLE');
      execution = await workspace.executeProposal(entry.proposal, entry.context!, (progress) => {
        // Reset clears the executing entry. Stop at the next progress boundary
        // so an in-flight operation cannot launch the rest of the old proposal.
        if (proposalStore.executingId !== entry.id) throw new Error('Companion proposal was stopped.');
        latestProgress = progress;
        setProposalExecutionProgress(progress);
        reportActions?.(progress.operations);
      });
    } catch (error) {
      execution = companionProposalInterruptedExecution(entry.proposal, error, latestProgress);
    }
    if (!proposalStore.finish(entry, execution, autoApproved)) return undefined;
    reportActions?.(execution.operations);
    setProposalExecutionProgress(null);
    setProposalHistory(history => [...history, {
      id: newId(), targetId: entry.id, proposal: entry.proposal, execution, defaultRepoPath: entry.context!.defaultRepoPath,
      droneNames, startedAt, completedAt: Date.now(), autoApproved,
    }]);
    const result = companionProposalApplyResult(entry.proposal, execution, autoApproved, revision, entry.id);
    if (!options?.returnResultToTool) await controller.submitProposalResult(result, entry.sessionId);
    return execution;
  }, [controller, proposalStore, workspace]);

  React.useLayoutEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (document.querySelector('[data-quick-action-menu]')) return;
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
      proposalStore.clear();
    },
    [],
  );

  const executeBrowserTool = React.useCallback(
    async (
      capturedWorkspace: CapturedCompanionWorkspace | null,
      tool: CompanionBrowserToolName,
      args: Record<string, unknown>,
    ) => {
      if (tool === 'read_recorder' || tool === 'apply_recorder_patch') {
        const target = recorder?.target.current;
        if (!target) throw new Error('NO_OPEN_RECORDER');
        return tool === 'read_recorder' ? target.read() : target.apply(
          String(args.targetId ?? ''), String(args.baseRevision ?? ''), String(args.content ?? ''),
        );
      }
      if (tool === 'show_on_screen') return await screen.execute(args);
      if (tool === 'list_proposals') return { proposals: proposalStore.list() };
      if (tool === 'create_proposal') return proposalStore.create(proposalContext(capturedWorkspace), controller.getSessionId(), typeof args.title === 'string' ? args.title : undefined);
      if (tool === 'read_proposal') return readProposal(typeof args.targetId === 'string' ? args.targetId : undefined);
      if (tool === 'discard_proposal') return proposalStore.discard(String(args.targetId ?? ''), String(args.baseRevision ?? ''));
      if (tool === 'apply_proposal_patch') return applyProposal(String(args.targetId ?? ''), String(args.baseRevision ?? ''), String(args.content ?? ''), capturedWorkspace);
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
      if (!capturedWorkspace) {
        if (tool === 'read_active_composer' || tool === 'apply_composer_patch') {
          throw new Error('NO_ACTIVE_COMPOSER');
        }
        if (tool === 'read_open_file' || tool === 'apply_editor_patch') {
          throw new Error('NO_OPEN_FILE');
        }
        throw new Error('NO_ACTIVE_WORKSPACE');
      }
      return await executeCompanionBrowserTool(capturedWorkspace, tool, args);
    },
    [applyProposal, executeProposal, readProposal, recorder],
  );

  const run = React.useCallback(
    async (
      prompt: string,
      capturedWorkspace: CapturedCompanionWorkspace | null,
      telemetry?: CompanionClientTelemetry,
      requestedMessageId?: string,
    ) => {
      await controller.submitPrompt({
        prompt,
        telemetry,
        messageId: requestedMessageId,
        createTransport: () =>
          createCompanionWebSocketTransport(buildDirectApiWebSocketUrl('/api/companion/stream')),
        executeTool: (tool, args) => executeBrowserTool(capturedWorkspace, tool, args),
      });
    },
    [controller, executeBrowserTool],
  );

  const startLiveVoice = React.useCallback(async () => {
      const capturedWorkspace = captureWorkspace();
      const context = capturedWorkspace?.getAppContext();
      const workspaceLabel = [context?.activeRepoPath, context?.selectedChat].filter((value) => typeof value === 'string' && value).join(' · ') || 'No workspace selected';
      await live.start(async (prompt, signal, telemetry) => {
        if (signal.aborted) throw new Error('Voice conversation ended.');
        if (proposalExecutingRef.current) throw new Error('Companion is applying a proposal. Please ask again when it finishes.');
        return await waitForCompanionReply(controller, () => run(prompt, capturedWorkspace, telemetry), signal);
      }, workspaceLabel);
  }, [captureWorkspace, controller, live.start, run]);

  const toggle = React.useCallback(async (finishForModeSwitch = false) => {
    if (live.loading || live.saving || (switchingVoiceRef.current && !finishForModeSwitch)) return;
    prepareCompanionRecordingCues();
    if (!live.resolved) {
      controller.reportVoiceError('Could not load the voice preference. Retry the Live voice setting before starting the microphone.');
      return;
    }
    setPanelVisibility('open');
    if (live.enabled && (voice.status === 'idle' || voice.status === 'transcribing')) {
      if (live.status === 'connecting' || live.status === 'listening') { live.stop(); return; }
      await startLiveVoice();
      return;
    }
    if (voice.status === 'starting') return;
    if (voice.status === 'recording' || voice.status === 'paused') {
      const recording = recordingWorkspaceRef.current;
      if (!recording) return;
      const capturedWorkspace = recording.workspace;
      recordingWorkspaceRef.current = null;
      const voiceSubmissionGeneration = voiceSubmissionGenerationRef.current;
      const messageId = newId();
      const audioDurationMs = voice.durationMillis;
      const transcriptionStartedAt = performance.now();
      const transcript = voice.stopRecordingForTranscript({ telemetryId: messageId }).then(text => ({
        text, transcriptionMs: Math.max(0, performance.now() - transcriptionStartedAt),
      }));
      playCompanionRecordingCue('send');
      // Uploads can overlap; agent requests retain the order of the user's taps.
      const sending = voiceSubmissionQueueRef.current.then(async () => {
        const { text, transcriptionMs } = await transcript;
        if (voiceSubmissionGenerationRef.current !== voiceSubmissionGeneration || !text.trim()) return;
        await run(text, capturedWorkspace, { version: 1, transcriptionMs, audioDurationMs }, messageId);
      });
      voiceSubmissionQueueRef.current = sending.catch(() => {});
      await sending;
      return;
    }
    // The recorder may have failed independently. Its synchronous status is
    // authoritative; a stale workspace reference must not prevent restarting.
    const capturedWorkspace = captureWorkspace();
    const recording = { workspace: capturedWorkspace };
    recordingWorkspaceRef.current = recording;
    const started = await voice.startRecording();
    if (recordingWorkspaceRef.current !== recording) return;
    if (started) playCompanionRecordingCue('start');
    if (!started) recordingWorkspaceRef.current = null;
    if (!started && controller.getSnapshot().status !== 'error') controller.resetIfNoSession();
  }, [captureWorkspace, close, controller, run, voice, live, startLiveVoice]);

  const resetContext = React.useCallback(async () => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    const closing = close(true);
    // An explicit tap may start a fresh recording while teardown completes,
    // but its request must wait for the previous conversation to close.
    voiceSubmissionQueueRef.current = closing.catch(() => {});
    try {
      await closing;
    } finally {
      resettingRef.current = false;
    }
  }, [close]);

  // Keep the callbacks fresh while a key is held, even if recording causes a render.
  const shortcutActionsRef = React.useRef({ toggle, discardRecording, resetContext, dismiss, voice });
  shortcutActionsRef.current = { toggle, discardRecording, resetContext, dismiss, voice };
  const handleShortcut = React.useCallback((event?: CompanionShortcutEvent) => {
    if (event?.phase === 'cancel') {
      shortcutPress.cancel();
      setShortcutHint(null);
      return;
    }
    if (event?.phase === 'up') {
      shortcutPress.up(event.heldMs);
      setShortcutHint(null);
      return;
    }
    if (live.enabled) {
      // Live voice retains its existing press / double-press behavior.
      const now = Date.now();
      if (isCompanionShortcutDoubleTap(lastLiveShortcutAtRef.current, now)) {
        lastLiveShortcutAtRef.current = 0;
        void close();
      } else {
        lastLiveShortcutAtRef.current = now;
        void toggle();
      }
      return;
    }
    if (!event) { void toggle(); return; }
    prepareCompanionRecordingCues();
    // The action is chosen from the state at keydown, not after a preview or
    // asynchronous recorder event. A cancel hold can never become close.
    const statusAtPress = shortcutActionsRef.current.voice.status;
    let previewed: CompanionHoldAction | null = null;
    shortcutPress.down(gesture => {
      const actions = shortcutActionsRef.current;
      if (gesture === 'tap') { void actions.toggle(); return; }
      const action = companionHoldAction(gesture, statusAtPress);
      if (!action) return;
      if (previewed !== action) playCompanionRecordingCue(action);
      if (action === 'cancel') void actions.discardRecording();
      else if (action === 'close') void actions.dismiss();
      else if (action === 'reset') void actions.resetContext();
      else if ((action === 'pause' && actions.voice.status === 'recording') ||
        (action === 'resume' && actions.voice.status === 'paused')) actions.voice.toggleRecordingPause();
    }, gesture => {
      const action = companionHoldAction(gesture, statusAtPress);
      if (!action) return;
      previewed = action;
      setShortcutHint(action);
      playCompanionRecordingCue(action);
    }, useDroneHubUiStore.getState().companionShortcutDurations);
  }, [close, live.enabled, shortcutPress, toggle]);

  React.useEffect(() => {
    shortcutPress.cancel();
    setShortcutHint(null);
    return () => shortcutPress.cancel();
  }, [live.enabled, shortcutPress]);

  const toggleLiveVoice = React.useCallback(async () => {
    if (resettingRef.current || switchingVoiceRef.current || live.loading || live.saving ||
      voice.status === 'starting' || voice.status === 'transcribing') return;
    shortcutPress.cancel();
    setShortcutHint(null);
    switchingVoiceRef.current = true;
    setPanelVisibility('open');
    setSwitchingVoice(true);
    const generation = voiceSubmissionGenerationRef.current;
    try {
      // Finish existing dictation before changing microphone modes.
      if (!live.enabled && (voice.status === 'recording' || voice.status === 'paused')) {
        await toggle(true);
      }
      if (generation !== voiceSubmissionGenerationRef.current) return;
      const enabled = await live.toggleEnabled();
      if (enabled === undefined || generation !== voiceSubmissionGenerationRef.current) return;
      if (enabled) {
        await startLiveVoice();
      } else {
        const recording = { workspace: captureWorkspace() };
        recordingWorkspaceRef.current = recording;
        const started = await voice.startRecording();
        if (!started && recordingWorkspaceRef.current === recording) recordingWorkspaceRef.current = null;
      }
    } finally {
      switchingVoiceRef.current = false;
      setSwitchingVoice(false);
    }
  }, [captureWorkspace, live, shortcutPress, startLiveVoice, toggle, voice]);

  const submitText = React.useCallback(
    async (prompt: string, capturedWorkspace = captureWorkspace()): Promise<CompanionTextSubmitResult> => {
      const text = String(prompt ?? '').trim();
      if (!text) return { ok: false, error: 'There is no dictated text to send.' };
      if (resettingRef.current) return { ok: false, error: 'Companion is resetting. Please send again when it finishes.' };
      if (voiceStatusRef.current !== 'idle') {
        return { ok: false, error: 'Companion is already handling a voice recording.' };
      }
      const status = controller.getSnapshot().status;
      if (status === 'working' || proposalExecutingRef.current) {
        return { ok: false, error: 'Companion is already working.' };
      }
      live.stop();
      setPanelVisibility('open');
      await run(text, capturedWorkspace);
      const next = controller.getSnapshot();
      if (next.status === 'error') {
        return { ok: false, error: next.error || 'Companion could not start.' };
      }
      return { ok: true };
    },
    [captureWorkspace, close, controller, run, live.stop],
  );

  const prepareTextSubmission = React.useCallback(() => {
    const capturedWorkspace = captureWorkspace();
    const generation = textSubmissionGenerationRef.current;
    return (prompt: string): Promise<CompanionTextSubmitResult> => {
      if (textSubmissionGenerationRef.current !== generation) {
        return Promise.resolve({ ok: false, error: 'Companion was closed or stopped. Send again to start a new request.' });
      }
      return submitText(prompt, capturedWorkspace);
    };
  }, [captureWorkspace, submitText]);

  React.useEffect(
    () => () => {
      textSubmissionGenerationRef.current += 1;
      voiceSubmissionGenerationRef.current += 1;
      recordingWorkspaceRef.current = null;
      void controller.suspend();
      void voice.discardRecording();
    },
    [controller, voice.discardRecording],
  );

  const effectiveStatus: CompanionStatus =
    switchingVoice ? 'starting' : voice.status === 'paused' ? 'recording' : voice.status !== 'idle' ? voice.status
      : state.status === 'working' ? 'working'
      : live.status === 'connecting' ? 'starting'
      : live.status === 'listening' && state.status === 'idle' ? 'recording'
      : live.status === 'error' && state.status === 'idle' ? 'error'
      : state.status;

  const value = React.useMemo<CompanionContextValue>(
    () => ({
      ...state,
      screen,
      sessionId: controller.getSessionId(),
      error: proposalActionError || state.error || autoApproveSettings.error,
      live,
      transcript: state.transcript.startsWith(LIVE_COMPANION_PROMPT_PREFIX) ? '' : state.transcript,
      status: effectiveStatus,
      recordingPaused: voice.status === 'paused',
      pendingTranscriptions: voice.pendingTranscriptions ?? 0,
      shortcutHint,
      panelVisibility,
      dismiss,
      handleShortcut,
      resetContext,
      durationMillis: voice.durationMillis,
      proposals: reviewProposals ? proposalStore.listPending() : [],
      selectedProposalId: proposalStore.selectedId,
      selectProposal: (id: string) => proposalStore.select(id),
      proposal,
      proposalExecution,
      proposalExecutionProgress: proposalStore.selectedId === proposalStore.executingId ? proposalExecutionProgress : null,
      proposalDroneNames: proposalStore.executingId === proposalStore.selectedId ? proposalDroneNames
        : proposalExecution ? proposalHistory.slice().reverse().find(item => item.targetId === proposalStore.selectedId)?.droneNames ?? {} : {},
      proposalDefaultRepoPath,
      proposalExecuting,
      selectedProposalExecuting: Boolean(proposalStore.executingId && proposalStore.selectedId === proposalStore.executingId),
      autoApprove,
      proposalHistory,
      actionNotifications,
      dismissActionNotification,
      submitText,
      prepareTextSubmission,
      toggle,
      toggleLiveVoice,
      switchingVoice,
      stop,
      toggleRecordingPause,
      discardRecording,
      close,
      executeProposal: async (targetId?: string, baseRevision?: string) => {
        try {
          await executeProposal({ targetId, baseRevision });
          setProposalActionError('');
        } catch (error) {
          setProposalActionError(error instanceof Error ? error.message : String(error));
        }
      },
      discardProposal,
      toggleAutoApprove,
    }),
    [
      proposalStore, proposalStoreVersion, proposalActionError,
      shortcutHint, panelVisibility, dismiss, handleShortcut, resetContext, voice.pendingTranscriptions,
      close,
      live,
      autoApproveSettings.error,
      autoApprove,
      reviewProposals,
      discardProposal,
      discardRecording,
      effectiveStatus,
      executeProposal,
      proposal,
      proposalDefaultRepoPath,
      proposalExecution,
      proposalExecutionProgress,
      proposalDroneNames,
      proposalExecuting,
      proposalHistory,
      actionNotifications,
      dismissActionNotification,
      state,
      stop,
      submitText,
      prepareTextSubmission,
      toggle,
      toggleLiveVoice,
      switchingVoice,
      toggleRecordingPause,
      toggleAutoApprove,
      voice.durationMillis,
      voice.status,
    ],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue | null {
  return React.useContext(CompanionContext);
}
