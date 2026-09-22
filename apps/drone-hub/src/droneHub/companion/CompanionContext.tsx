import { useCompanionLiveSettingsStore, type CompanionLiveSettingsStore } from './companion-live-settings-store';
import type { CompanionImageAttachment } from '@drone/assistant-chat';
import { requestJson } from '../http';
import { setCompanionClipboard } from './companion-clipboard';
import { isCompanionPreviewable } from './companion-attachment-files';
import { CompanionScreen, type CompanionSenseSources } from '@drone/assistant-chat';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { companionSessionStore, COMPANION_SLOTS, readCompanionSlots, writeCompanionSlots } from './companion-session-store';
import { companionSessionShortcut } from './companion-session-shortcut';
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

export type PendingCompanionAttachment = CompanionImageAttachment & { id: string; path: string };

type CompanionSessionValue = {
  /** Pending captures and pasted text. Each is already saved in Companion home; the bytes stay here for previews only. */
  attachments: PendingCompanionAttachment[];
  removeAttachment(id: string): void;
  /** Queue clipboard text for the next instruction, like a capture. */
  addTextAttachment(text: string): void;
  /** Queue an image (for example one pasted from the clipboard) for the next instruction. */
  addAttachment(file: CompanionImageAttachment): Promise<void>;
  /** Show why a pasted or dropped file could not be attached. */
  reportAttachmentError(error: unknown): void;
  reportVoiceError(message: string): void;
  screen: CompanionScreen;
  sessionId: string | null;
  live: ReturnType<typeof useCompanionLive>;
  status: CompanionStatus;
  working: boolean;
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

type CompanionContextValue = CompanionSessionValue & {
  activeSlot: number;
  sessions: { slot: number; status: CompanionStatus; recordingPaused: boolean; working: boolean }[];
  selectSession(slot: number, fromKeyboard?: boolean): void;
  deleteSession(): Promise<void>;
};
const CompanionContext = React.createContext<CompanionContextValue | null>(null);

type SharedRecording = {
  liveSettings: CompanionLiveSettingsStore;
  voice: ReturnType<typeof useChatVoiceRecorder>;
  workspace: React.MutableRefObject<{ workspace: CapturedCompanionWorkspace | null } | null>;
  activeSlot: React.MutableRefObject<number>;
  autoApprove: ReturnType<typeof useCompanionAutoApprove>;
  microphoneCleanup: React.MutableRefObject<Promise<void> | null>;
  startGeneration: React.MutableRefObject<number>;
  liveStartMuted: React.MutableRefObject<boolean>;
  panelVisibility: 'auto' | 'open' | 'closed';
  setPanelVisibility: React.Dispatch<React.SetStateAction<'auto' | 'open' | 'closed'>>;
};

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `companion-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function useCompanionSession(slot: number, shared: SharedRecording): CompanionSessionValue {
  const active = shared.activeSlot.current === slot;
  const [screen] = React.useState(() => new CompanionScreen());
  React.useEffect(() => () => screen.detach(), [screen]);
  const workspace = useCompanionWorkspace();
  const recorder = useRecorderCompanion();
  const controllerRef = React.useRef<CompanionClientController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CompanionClientController({ createId: newId, sessionStore: companionSessionStore(slot) });
  }
  const controller = controllerRef.current;
  const state = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [proposalActionError, setProposalActionError] = React.useState('');
  const [attachments, setAttachments] = React.useState<PendingCompanionAttachment[]>([]);
  const attachmentsRef = React.useRef(attachments);
  const submittedAttachments = React.useRef<typeof attachments>([]);
  const captureGeneration = React.useRef(0);
  const captureBusy = React.useRef(false);
  const updateAttachments = React.useCallback((items: typeof attachments) => {
    attachmentsRef.current = items;
    setAttachments(items);
  }, []);
  React.useEffect(() => controller.subscribe(() => {
    const status = controller.getSnapshot().status;
    if (status === 'error' || status === 'cancelled') {
      if (submittedAttachments.current.length) updateAttachments([...submittedAttachments.current, ...attachmentsRef.current]);
      submittedAttachments.current = [];
    } else if (status === 'completed') submittedAttachments.current = [];
  }), [controller, updateAttachments]);
  const removeAttachment = React.useCallback((id: string) => {
    const removed = attachmentsRef.current.find(item => item.id === id);
    updateAttachments(attachmentsRef.current.filter(item => item.id !== id));
    // It was never sent, so its upload is of no use to anyone.
    if (removed) void requestJson('/api/companion/home/uploads/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: removed.path }) }).catch(() => {});
  }, [updateAttachments]);
  const [proposalStore] = React.useState(() => new CompanionProposalStore<CompanionProposalExecutionContext>(newId));
  const proposalStoreVersion = React.useSyncExternalStore(proposalStore.subscribe, proposalStore.getSnapshot, proposalStore.getSnapshot);
  const selectedProposal = proposalStore.selected;
  const proposalExecution = selectedProposal?.execution ?? null;
  const proposalDefaultRepoPath = selectedProposal?.context?.defaultRepoPath ?? null;
  const proposalExecuting = Boolean(proposalStore.executingId);
  const proposalExecutingRef = React.useMemo(() => ({ get current() { return Boolean(proposalStore.executingId); } }), [proposalStore]);
  const [proposalExecutionProgress, setProposalExecutionProgress] = React.useState<CompanionProposalExecutionProgress | null>(null);
  const [proposalDroneNames, setProposalDroneNames] = React.useState<Readonly<Record<string, string>>>({});
  const autoApproveSettings = shared.autoApprove;
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
  const [pendingVoice, setPendingVoice] = React.useState(0);
  const voiceSubmissionGenerationRef = React.useRef(0);
  const voiceSubmissionQueueRef = React.useRef(Promise.resolve());
  const resettingRef = React.useRef(false);
  const [shortcutPress] = React.useState(() => new CompanionShortcutPress());
  const [shortcutHint, setShortcutHint] = React.useState<CompanionHoldAction | null>(null);
  const { panelVisibility, setPanelVisibility } = shared;
  const lastLiveShortcutAtRef = React.useRef(0);
  const recordingWorkspaceRef = shared.workspace;
  // Every attachment is saved to Companion home as it is taken, so an instruction only names files
  // and neither their number nor their combined size can make it fail.
  const addAttachment = React.useCallback(async (file: CompanionImageAttachment) => {
    const generation = captureGeneration.current;
    try {
      const { attachment } = await requestJson<{ attachment: { name: string; path: string; size: number } }>('/api/companion/home/uploads', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(file),
      });
      if (generation !== captureGeneration.current) return;
      // The bytes stay in memory only for the tray's preview; any other file is already safe on disk.
      updateAttachments([...attachmentsRef.current, { ...file, dataBase64: isCompanionPreviewable(file) ? file.dataBase64 : '', name: attachment.name, size: attachment.size, path: attachment.path, id: newId() }]);
      setProposalActionError('');
    } catch (error) {
      if (generation !== captureGeneration.current) return;
      setProposalActionError(error instanceof Error ? error.message : String(error));
    }
    setPanelVisibility('open');
  }, [updateAttachments]);
  const reportAttachmentError = React.useCallback((error: unknown) => {
    setProposalActionError(error instanceof Error ? error.message : String(error));
    setPanelVisibility('open');
  }, []);
  const addTextAttachment = React.useCallback((text: string) => {
    if (!text.trim()) return;
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    void addAttachment({ name: `pasted-text-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, mime: 'text/plain', size: bytes.length, dataBase64: btoa(binary) });
  }, [addAttachment]);
  const textSubmissionGenerationRef = React.useRef(0);
  const captureWorkspace = React.useCallback(() => workspace?.capture() ?? null, [workspace]);
  React.useEffect(() => {
    const capture = async (event: Event) => {
      const mode = (event as CustomEvent).detail;
      if (shared.activeSlot.current !== slot || (mode !== 'region' && mode !== 'screen') || captureBusy.current) return;
      captureBusy.current = true;
      const generation = captureGeneration.current;
      try {
        if (!window.droneHubDesktop?.captureCompanion) throw new Error('Screen capture requires the Drone Hub desktop app.');
        const image = await window.droneHubDesktop.captureCompanion(mode);
        if (!image || generation !== captureGeneration.current) return;
        await addAttachment(image);
      } catch (error) {
        if (generation !== captureGeneration.current) return;
        setProposalActionError(error instanceof Error ? error.message : String(error));
        setPanelVisibility('open');
      } finally { captureBusy.current = false; }
    };
    window.addEventListener('companion-capture', capture);
    return () => { captureGeneration.current++; window.removeEventListener('companion-capture', capture); };
  }, [addAttachment]);

  const voice = shared.voice;
  const live = useCompanionLive(controller, undefined, active, shared.liveSettings);
  const [switchingVoice, setSwitchingVoice] = React.useState(false);
  const switchingVoiceRef = React.useRef(false);
  const voiceStatusRef = React.useRef(voice.status);
  voiceStatusRef.current = voice.status;

  const close = React.useCallback(async (stopApplyingProposal = false) => {
    screen.clear();
    if (proposalExecutingRef.current && !stopApplyingProposal) return;
    captureGeneration.current++;
    submittedAttachments.current = [];
    updateAttachments([]);
    shortcutPress.cancel();
    setShortcutHint(null);
    live.reset();
    setPanelVisibility('closed');
    voiceSubmissionQueueRef.current = Promise.resolve();
    voiceSubmissionGenerationRef.current += 1;
    setPendingVoice(0);
    textSubmissionGenerationRef.current += 1;
    recordingWorkspaceRef.current = null;
    proposalStore.clear();
    setProposalActionError('');
    setProposalHistory([]);
    setActionNotifications([]);
    setProposalExecutionProgress(null);
    setProposalDroneNames({});
    await Promise.all([controller.close(), voice.discardRecording({ preserveTranscriptions: true })]);
  }, [controller, voice.discardRecording, live.reset]);

  const dismiss = React.useCallback(async () => {
    shortcutPress.cancel();
    setShortcutHint(null);
    setPanelVisibility('closed');
    if (live.mode === 'jev') live.stop(); else live.reset();
    voiceSubmissionGenerationRef.current += 1;
    setPendingVoice(0);
    textSubmissionGenerationRef.current += 1;
    recordingWorkspaceRef.current = null;
    proposalStore.clear();
    setProposalExecutionProgress(null);
    setProposalActionError('');
    screen.clear();
    const stopping = Promise.all([controller.cancel(), voice.discardRecording({ preserveTranscriptions: true })]).then(() => {});
    voiceSubmissionQueueRef.current = stopping.catch(() => {});
    await stopping;
  }, [controller, live.reset, live.stop, live.mode, proposalStore, screen, shortcutPress, voice.discardRecording]);

  const stop = React.useCallback(() => {
    if (controller.getSnapshot().status !== 'working') return;
    live.cancelPending();
    textSubmissionGenerationRef.current += 1;
    voiceSubmissionGenerationRef.current += 1;
    setPendingVoice(0);
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
      if (tool === 'set_clipboard') return await setCompanionClipboard(args.text);
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
      const sending = attachmentsRef.current;
      // Reserve this batch before awaiting transport startup so concurrent voice
      // instructions cannot send it twice. New captures belong to the next turn.
      updateAttachments([]);
      submittedAttachments.current.push(...sending);
      await controller.submitPrompt({
        prompt,
        attachments: sending.map(({ name, mime, size, path }) => ({ name, mime, size, path })),
        telemetry,
        messageId: requestedMessageId,
        createTransport: () =>
          createCompanionWebSocketTransport(buildDirectApiWebSocketUrl('/api/companion/stream')),
        executeTool: (tool, args) => executeBrowserTool(capturedWorkspace, tool, args),
      });
    },
    [controller, executeBrowserTool, updateAttachments],
  );

  const startLiveVoice = React.useCallback(async () => {
      if (shared.activeSlot.current !== slot) return;
      const capturedWorkspace = captureWorkspace();
      const generation = shared.startGeneration.current;
      if (shared.microphoneCleanup.current) await shared.microphoneCleanup.current;
      if (shared.activeSlot.current !== slot || generation !== shared.startGeneration.current) return;
      const context = capturedWorkspace?.getAppContext();
      const workspaceLabel = [context?.activeRepoPath, context?.selectedChat].filter((value) => typeof value === 'string' && value).join(' · ') || 'No workspace selected';
      // Senses for the reflex agent: backend progress from the controller snapshot, app context from the capture, and notes on screen.
      let activityMark = ''; let lastActivityAt: number | null = null;
      const senses: CompanionSenseSources = {
        observe: () => {
          const snapshot = controller.getSnapshot();
          const activity = snapshot.activity.slice(-5).map(item => `${item.tool}${item.status === 'failed' ? ' (failed)' : item.status === 'running' ? ' (running)' : ''}`);
          const mark = `${snapshot.activity.length}:${snapshot.activity[snapshot.activity.length - 1]?.status ?? ''}`;
          if (mark !== activityMark) { activityMark = mark; lastActivityAt = Date.now(); }
          const app = context ? Object.fromEntries(Object.entries({ selectedDrone: context.selectedDrone, selectedChat: context.selectedChat, repoPath: context.activeRepoPath })
            .filter(([, value]) => typeof value === 'string' && value)) as Record<string, string> : undefined;
          return {
            backend: { status: snapshot.status === 'working' ? 'working' : 'idle', startedAt: snapshot.startedAt, lastActivityAt, activity,
              ...(snapshot.reply ? { lastReply: snapshot.reply, lastReplyAt: snapshot.endedAt } : {}), ...(snapshot.error ? { error: snapshot.error } : {}) },
            ...(app && Object.keys(app).length ? { app } : {}),
            ...(snapshot.trigger === 'subscription' && snapshot.reply && snapshot.endedAt && Date.now() - snapshot.endedAt < 60_000 ? { events: [snapshot.reply.slice(0, 500)] } : {}),
          };
        },
        notify: text => { void screen.execute({ action: 'show', markdown: text }); },
      };
      const initiallyMuted = shared.liveStartMuted.current;
      shared.liveStartMuted.current = false;
      await live.start(async (prompt, signal, telemetry) => {
        if (signal.aborted) throw new Error('Voice conversation ended.');
        if (proposalExecutingRef.current) throw new Error('Companion is applying a proposal. Please ask again when it finishes.');
        return await waitForCompanionReply(controller, () => run(prompt, capturedWorkspace, telemetry), signal);
      }, workspaceLabel, () => controller.cancel(), senses, initiallyMuted);
  }, [captureWorkspace, controller, live.start, run, screen]);

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
      setPendingVoice(count => count + 1);
      const transcript = voice.stopRecordingForTranscript({ telemetryId: messageId, onError: message => {
        if (voiceSubmissionGenerationRef.current === voiceSubmissionGeneration) controller.reportVoiceError(message);
      } }).then(text => ({
        text, transcriptionMs: Math.max(0, performance.now() - transcriptionStartedAt),
      })).finally(() => {
        if (voiceSubmissionGenerationRef.current === voiceSubmissionGeneration) setPendingVoice(count => Math.max(0, count - 1));
      });
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
    const generation = shared.startGeneration.current;
    if (shared.microphoneCleanup.current) await shared.microphoneCleanup.current;
    if (shared.activeSlot.current !== slot || generation !== shared.startGeneration.current) return;
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
  const shortcutActionsRef = React.useRef({ toggle, discardRecording, resetContext, dismiss, voice, live });
  shortcutActionsRef.current = { toggle, discardRecording, resetContext, dismiss, voice, live };
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
    if (live.enabled && live.mode !== 'jev') {
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
    const jevAtPress = live.enabled && live.mode === 'jev';
    const gestureStatus = () => {
      const current = shortcutActionsRef.current;
      if (!jevAtPress) return current.voice.status;
      if (current.live.status === 'connecting') return 'starting';
      if (current.live.status === 'listening') return current.live.muted ? 'paused' : 'recording';
      if (current.live.status === 'error' && current.live.capturing) return 'paused';
      return 'idle';
    };
    const statusAtPress = gestureStatus();
    let previewed: CompanionHoldAction | null = null;
    shortcutPress.down(gesture => {
      const actions = shortcutActionsRef.current;
      if (gesture === 'tap') { void actions.toggle(); return; }
      const action = companionHoldAction(gesture, statusAtPress);
      if (!action) return;
      if (previewed !== action) playCompanionRecordingCue(action);
      if (action === 'cancel') { if (jevAtPress) actions.live.stop(); else void actions.discardRecording(); }
      else if (action === 'close') void actions.dismiss();
      else if (action === 'reset') void actions.resetContext();
      else if ((action === 'pause' && gestureStatus() === 'recording') ||
        (action === 'resume' && gestureStatus() === 'paused')) {
        if (jevAtPress) actions.live.toggleMute(); else actions.voice.toggleRecordingPause();
      }
    }, gesture => {
      const action = companionHoldAction(gesture, statusAtPress);
      if (!action) return;
      previewed = action;
      setShortcutHint(action);
      playCompanionRecordingCue(action);
    }, useDroneHubUiStore.getState().companionShortcutDurations);
  }, [close, live.enabled, live.mode, shortcutPress, toggle]);

  React.useEffect(() => {
    shortcutPress.cancel();
    setShortcutHint(null);
    return () => shortcutPress.cancel();
  }, [live.enabled, live.mode, shortcutPress]);

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
      if (enabled === undefined || generation !== voiceSubmissionGenerationRef.current || shared.activeSlot.current !== slot) return;
      if (enabled) {
        await startLiveVoice();
      } else {
        const startGeneration = shared.startGeneration.current;
        await live.stop();
        if (shared.microphoneCleanup.current) await shared.microphoneCleanup.current;
        if (shared.activeSlot.current !== slot || startGeneration !== shared.startGeneration.current || generation !== voiceSubmissionGenerationRef.current) return;
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
      void controller.suspend();
    },
    [controller],
  );

  const effectiveStatus: CompanionStatus =
    switchingVoice ? 'starting' : active && voice.status === 'paused' ? 'recording'
      : active && (voice.status === 'starting' || voice.status === 'recording') ? voice.status
      : pendingVoice > 0 ? 'transcribing'
      : state.status === 'working' ? 'working'
      : live.status === 'connecting' ? 'starting'
      : live.status === 'listening' && state.status === 'idle' ? 'recording'
      : live.status === 'error' && state.status === 'idle' ? 'error'
      : state.status;

  const value = React.useMemo<CompanionSessionValue>(
    () => ({
      ...state,
      screen,
      attachments, removeAttachment, addTextAttachment, addAttachment, reportAttachmentError,
      reportVoiceError: message => controller.reportVoiceError(message),
      sessionId: controller.getSessionId(),
      error: proposalActionError || state.error || autoApproveSettings.error,
      live,
      transcript: state.transcript.startsWith(LIVE_COMPANION_PROMPT_PREFIX) ? '' : state.transcript,
      status: effectiveStatus,
      working: state.status === 'working' || proposalExecuting,
      recordingPaused: live.enabled && (live.status === 'connecting' || live.status === 'listening') ? live.muted : active && voice.status === 'paused',
      pendingTranscriptions: pendingVoice,
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
      active, attachments, removeAttachment, addTextAttachment, addAttachment, reportAttachmentError,
      proposalStore, proposalStoreVersion, proposalActionError,
      shortcutHint, panelVisibility, dismiss, handleShortcut, resetContext, pendingVoice,
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

  return value;
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const [slots, setSlots] = React.useState(readCompanionSlots);
  const slotsRef = React.useRef(slots);
  slotsRef.current = slots;
  const activeSlot = React.useRef(slots.active);
  activeSlot.current = slots.active;
  const workspace = React.useRef<{ workspace: CapturedCompanionWorkspace | null } | null>(null);
  const valuesRef = React.useRef<CompanionSessionValue[]>([]);
  const onError = React.useCallback((message: string) => {
    valuesRef.current[COMPANION_SLOTS.indexOf(activeSlot.current as typeof COMPANION_SLOTS[number])]?.reportVoiceError(message);
  }, []);
  const voice = useChatVoiceRecorder({ onError, microphoneOwner: 'companion', backgroundTranscription: true });
  const autoApprove = useCompanionAutoApprove();
  const liveSettings = useCompanionLiveSettingsStore();
  const [panelVisibility, setPanelVisibility] = React.useState<'auto' | 'open' | 'closed'>('auto');
  const startGeneration = React.useRef(0);
  const liveStartMuted = React.useRef(false);
  const microphoneCleanup = React.useRef<Promise<void> | null>(null);
  const shared = { liveSettings, voice, workspace, activeSlot, autoApprove, panelVisibility, setPanelVisibility, microphoneCleanup, startGeneration, liveStartMuted };
  // Fixed hook order keeps each slot's controller, subscriptions and in-flight callbacks
  // alive when another slot is selected. Unused slots never open a transport.
  const values = [
    useCompanionSession(1, shared), useCompanionSession(2, shared),
    useCompanionSession(3, shared), useCompanionSession(4, shared),
    useCompanionSession(5, shared), useCompanionSession(6, shared),
    useCompanionSession(7, shared), useCompanionSession(8, shared),
    useCompanionSession(9, shared), useCompanionSession(0, shared),
  ];
  valuesRef.current = values;
  const at = (slot: number) => valuesRef.current[COMPANION_SLOTS.indexOf(slot as typeof COMPANION_SLOTS[number])];
  const selected = at(slots.active);
  const pendingStart = React.useRef<number | null>(null);
  const liveHandoff = React.useRef(false);
  const cancelPendingStart = () => { pendingStart.current = null; startGeneration.current++; liveStartMuted.current = false; liveHandoff.current = false; };
  const deleting = React.useRef(new Set<number>());
  const saveSlots = (next: typeof slots) => {
    slotsRef.current = next;
    activeSlot.current = next.active;
    setSlots(next);
    writeCompanionSlots(next);
  };
  const ensureSlot = (slot: number) => {
    const current = slotsRef.current;
    saveSlots({ active: slot, slots: COMPANION_SLOTS.filter(id => id === slot || current.slots.includes(id)) });
  };
  const selectSession = (slot: number, fromKeyboard = false) => {
    if (!COMPANION_SLOTS.includes(slot as typeof COMPANION_SLOTS[number]) || deleting.current.size > 0) return;
    const previous = at(activeSlot.current);
    const hidden = panelVisibility === 'closed' ||
      (panelVisibility === 'auto' && previous.status === 'idle' && !previous.live.hasStarted);
    const resumingLive = liveHandoff.current;
    const wasMuted = resumingLive ? liveStartMuted.current : previous.live.muted;
    const liveRecording = resumingLive || (!previous.live.announcing && (previous.live.status === 'connecting' || previous.live.status === 'listening'));
    cancelPendingStart();
    if (slot !== activeSlot.current) {
      const cleanup = Promise.all([microphoneCleanup.current, previous.live.stop()]).then(() => {});
      microphoneCleanup.current = cleanup;
      void cleanup.then(() => { if (microphoneCleanup.current === cleanup) microphoneCleanup.current = null; });
    }
    // An open panel only selects (or stages an idle draft). Only a closed panel
    // starts recording from a number key. Clear any delayed start from an earlier
    // selection so a settings load cannot unexpectedly activate an idle draft.
    // An already active live connection follows the selection by reconnecting.
    pendingStart.current = (fromKeyboard && hidden) || ((slot !== activeSlot.current || resumingLive) && liveRecording) ? slot : null;
    liveHandoff.current = pendingStart.current !== null && liveRecording;
    liveStartMuted.current = Boolean(liveHandoff.current && wasMuted);
    previous.handleShortcut({ phase: 'cancel' });
    ensureSlot(slot);
    setPanelVisibility('open');
  };
  React.useEffect(() => {
    if (pendingStart.current !== slots.active || selected.live.loading || selected.live.saving) return;
    pendingStart.current = null;
    if (['starting', 'recording', 'paused'].includes(voice.status)) return;
    const generation = startGeneration.current;
    const slot = slots.active;
    void Promise.resolve(microphoneCleanup.current).then(() => {
      if (generation === startGeneration.current && activeSlot.current === slot) {
        liveHandoff.current = false;
        void at(slot).toggle();
      }
    });
  }, [slots.active, selected.live.loading, selected.live.saving, selected.toggle, voice.status]);
  const deleteSession = async () => {
    const slot = activeSlot.current;
    const target = at(slot);
    if (target.proposalExecuting || deleting.current.has(slot)) return;
    deleting.current.add(slot);
    cancelPendingStart();
    try {
      await Promise.all([target.live.stop(), target.resetContext()]);
      const current = slotsRef.current;
      const remaining = current.slots.filter(id => id !== slot);
      saveSlots({ slots: remaining, active: current.active === slot ? remaining[0] ?? 1 : current.active });
      setPanelVisibility(remaining.length > 0 ? 'open' : 'closed');
    } finally { deleting.current.delete(slot); }
  };
  React.useEffect(() => {
    if (!slots.slots.includes(slots.active) && selected.panelVisibility === 'open' && deleting.current.size === 0) ensureSlot(slots.active);
  }, [slots.active, slots.slots, selected.panelVisibility]);
  const value: CompanionContextValue = {
    ...selected,
    activeSlot: slots.active,
    sessions: slots.slots.map(slot => ({ slot, status: at(slot).status, recordingPaused: at(slot).recordingPaused,
      working: at(slot).working })),
    selectSession, deleteSession,
    // Legacy proposals use the same target ID in every session. Only UI IDs are
    // qualified; browser tools and the backend continue using their original IDs.
    proposals: slots.slots.flatMap(slot => at(slot).proposals.map(proposal => ({ ...proposal, targetId: `${slot}:${proposal.targetId}`, sessionSlot: slot }))),
    selectedProposalId: selected.selectedProposalId ? `${slots.active}:${selected.selectedProposalId}` : null,
    selectProposal: id => {
      const separator = id.indexOf(':');
      const slot = Number(id.slice(0, separator));
      if (separator < 0 || !slotsRef.current.slots.includes(slot)) return;
      selectSession(slot);
      at(slot).selectProposal(id.slice(separator + 1));
    },
    executeProposal: async (id, revision) => {
      if (!id) return at(activeSlot.current).executeProposal(undefined, revision);
      const separator = id.indexOf(':');
      if (separator < 0) return at(activeSlot.current).executeProposal(id, revision);
      const slot = Number(id.slice(0, separator));
      if (slotsRef.current.slots.includes(slot)) await at(slot).executeProposal(id.slice(separator + 1), revision);
    },
    discardProposal: (id, revision) => {
      if (!id) return at(activeSlot.current).discardProposal(undefined, revision);
      const separator = id.indexOf(':');
      if (separator < 0) return at(activeSlot.current).discardProposal(id, revision);
      const slot = Number(id.slice(0, separator));
      if (slotsRef.current.slots.includes(slot)) at(slot).discardProposal(id.slice(separator + 1), revision);
    },
    handleShortcut: event => {
      if (deleting.current.size > 0) return;
      if (event?.phase !== 'cancel' && event?.phase !== 'up') { cancelPendingStart(); ensureSlot(activeSlot.current); }
      at(activeSlot.current).handleShortcut(event);
    },
    toggle: async () => { if (deleting.current.size > 0) return; cancelPendingStart(); ensureSlot(activeSlot.current); await at(activeSlot.current).toggle(); },
    toggleLiveVoice: async () => { if (deleting.current.size > 0) return; cancelPendingStart(); ensureSlot(activeSlot.current); await at(activeSlot.current).toggleLiveVoice(); },
    submitText: async prompt => { if (deleting.current.size > 0) return { ok: false, error: 'Companion is deleting a session. Please try again.' }; ensureSlot(activeSlot.current); return at(activeSlot.current).submitText(prompt); },
    prepareTextSubmission: () => {
      const slot = activeSlot.current;
      ensureSlot(slot);
      return at(slot).prepareTextSubmission();
    },
    dismiss: async () => { cancelPendingStart(); await at(activeSlot.current).dismiss(); },
    close: async () => { cancelPendingStart(); await at(activeSlot.current).close(); },
    resetContext: async () => { cancelPendingStart(); await at(activeSlot.current).resetContext(); },
    discardRecording: async () => { cancelPendingStart(); await at(activeSlot.current).discardRecording(); },
    stop: () => { cancelPendingStart(); at(activeSlot.current).stop(); },
  };
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const voiceRef = React.useRef(voice);
  voiceRef.current = voice;
  React.useLayoutEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (document.querySelector('[data-quick-action-menu]') || !shouldCancelCompanionRecordingWithEscape({
        key: event.key, repeat: event.repeat, isComposing: event.isComposing, voiceStatus: voiceRef.current.status,
      })) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void valueRef.current.discardRecording();
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    return () => window.removeEventListener('keydown', cancelOnEscape, true);
  }, []);
  React.useEffect(() => () => {
    startGeneration.current++;
    pendingStart.current = null;
    workspace.current = null;
    void voiceRef.current.discardRecording();
  }, []);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const slot = companionSessionShortcut(event, useDroneHubUiStore.getState().shortcutBindings);
      if (slot === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      valueRef.current.selectSession(slot, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue | null {
  return React.useContext(CompanionContext);
}
