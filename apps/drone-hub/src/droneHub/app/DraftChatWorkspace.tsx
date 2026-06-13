import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChatInput, type ChatImageAttachmentPayload, type ChatInputAutomationAction, type ChatSendPayload, EmptyState, PendingTranscriptTurn } from '../chat';
import { draftChatInputResetKey, droneChatQueueKey } from './helpers';
import { IconChat } from './icons';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import type { ChatAgentConfig } from '../../domain';
import type { DraftChatState } from './app-types';
import type { QueuedPrompt } from './use-queued-prompts-state';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import type { RepoRemoteBranchOption } from '../types';
import {
  AUTOMATION_RUNS_MAX,
  AUTOMATION_RUNS_MIN,
  automationSleepSecondsFromConfig,
  formatAutomationSleepInterval,
} from './automation-config';
import {
  filterSpawnAgentMenuEntriesForRuntime,
  runtimeSupportsCustomAgents,
  type CreateRuntime,
  type RepoBranchSourceMode,
} from './drone-create-runtime';
import type { DraftAutomationStartInput } from './use-drone-creation-actions';
import { SegmentedToolbarToggle } from './SegmentedToolbarToggle';
import { visibleDraftQueuedPrompts as resolveVisibleDraftQueuedPrompts } from './draft-chat-queue';
import { SpawnContextToolbar } from './SpawnContextToolbar';
import { RepoBranchSourceControls } from './RepoBranchSourceControls';

type DraftChatWorkspaceProps = {
  draftChat: DraftChatState;
  createRuntime: CreateRuntime;
  onCreateRuntimeChange: (value: CreateRuntime) => void;
  draftCreateMode: 'with-chat' | 'without-chat';
  onDraftCreateModeChange: (value: 'with-chat' | 'without-chat') => void;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  draftCreateRepoPath: string;
  repoBranchSource: RepoBranchSourceMode;
  onRepoBranchSourceChange: (value: RepoBranchSourceMode) => void;
  repoCreateRemoteBranch: string;
  onRepoCreateRemoteBranchChange: (value: string) => void;
  draftRepoHostBranch: string | null;
  draftRepoRemoteBranches: RepoRemoteBranchOption[];
  draftRepoBranchesLoading: boolean;
  draftRepoBranchesError: string | null;
  draftCreateName: string;
  draftCreateGroup: string;
  draftCreateParentDroneLabel: string | null;
  draftCreateError: string | null;
  queuedPromptsByDroneChat: Record<string, QueuedPrompt[]>;
  onCancel: () => void;
  onStartDraftPrompt: (payload: ChatSendPayload) => Promise<boolean>;
  onStartDraftAutomation: (automation: DraftAutomationStartInput) => Promise<boolean>;
  onQueueDraftPromptDuringCreate: (payload: ChatSendPayload) => boolean;
  onCreateEmptyDrone: () => Promise<boolean>;
  onEnqueueQueuedPrompt: (
    droneId: string,
    chatName: string,
    prompt: string,
    attachments?: ChatImageAttachmentPayload[],
  ) => void;
  onDraftCreateNameChange: (value: string) => void;
  onDraftCreateGroupChange: (value: string) => void;
  onSetDraftCreateError: (error: string | null) => void;
};

export function DraftChatWorkspace({
  draftChat,
  createRuntime,
  onCreateRuntimeChange,
  draftCreateMode,
  onDraftCreateModeChange,
  spawnAgentMenuEntries,
  draftCreating,
  draftAutoRenaming,
  spawnAgentConfig,
  createRepoMenuEntries,
  draftCreateRepoPath,
  repoBranchSource,
  onRepoBranchSourceChange,
  repoCreateRemoteBranch,
  onRepoCreateRemoteBranchChange,
  draftRepoHostBranch,
  draftRepoRemoteBranches,
  draftRepoBranchesLoading,
  draftRepoBranchesError,
  draftCreateName,
  draftCreateGroup,
  draftCreateParentDroneLabel,
  draftCreateError,
  queuedPromptsByDroneChat,
  onCancel,
  onStartDraftPrompt,
  onStartDraftAutomation,
  onQueueDraftPromptDuringCreate,
  onCreateEmptyDrone,
  onEnqueueQueuedPrompt,
  onDraftCreateNameChange,
  onDraftCreateGroupChange,
  onSetDraftCreateError,
}: DraftChatWorkspaceProps) {
  const {
    pullHostBranchBeforeCreate,
    automations,
    setPullHostBranchBeforeCreate,
    setCustomAgentModalOpen,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      pullHostBranchBeforeCreate: s.pullHostBranchBeforeCreate,
      automations: s.automations,
      setPullHostBranchBeforeCreate: s.setPullHostBranchBeforeCreate,
      setCustomAgentModalOpen: s.setCustomAgentModalOpen,
    })),
  );

  const controlsLocked = draftCreating || draftAutoRenaming || Boolean(draftChat.prompt);
  const createWithChat = draftCreateMode === 'with-chat' || Boolean(draftChat.prompt);
  const hostCustomAgentsUnsupported = !runtimeSupportsCustomAgents(createRuntime);
  const remoteBranchCheckoutEnabled = createRuntime === 'container';
  const filteredSpawnAgentMenuEntries = React.useMemo(
    () => filterSpawnAgentMenuEntriesForRuntime(createRuntime, spawnAgentMenuEntries),
    [createRuntime, spawnAgentMenuEntries],
  );
  const modeToggleOptions = React.useMemo(
    () => [
      {
        value: 'with-chat' as const,
        label: 'Start with chat',
        title: 'Create the drone and start with a first chat.',
      },
      {
        value: 'without-chat' as const,
        label: 'Create empty drone',
        title: 'Create the drone without starting a chat yet.',
      },
    ],
    [],
  );
  const runtimeToggleOptions = React.useMemo(
    () => [
      {
        value: 'container' as const,
        label: 'Container',
        title: 'Create the new drone in a managed container.',
      },
      {
        value: 'host' as const,
        label: 'Host',
        title: 'Create the new drone directly on the host machine.',
      },
    ],
    [],
  );
  const draftAutomationActions = React.useMemo<ChatInputAutomationAction[]>(() => {
    const supportsDraftAutomation = spawnAgentConfig.kind === 'builtin';
    const actions: ChatInputAutomationAction[] = [];
    for (const [idx, automation] of (Array.isArray(automations) ? automations : []).entries()) {
      const automationId = String(automation?.id ?? '').trim();
      if (!automationId) continue;
      const automationLabel = String(automation?.label ?? '').trim() || `Automation ${idx + 1}`;
      const prompt = String(automation?.prompt ?? '').trim();
      const onFailurePrompt = String(automation?.onFailurePrompt ?? '').trim();
      const runsRaw = Number(automation?.runs);
      const runs = Number.isFinite(runsRaw)
        ? Math.max(AUTOMATION_RUNS_MIN, Math.min(AUTOMATION_RUNS_MAX, Math.round(runsRaw)))
        : AUTOMATION_RUNS_MIN;
      const sleepBetweenRunsSeconds = automationSleepSecondsFromConfig(automation);
      const sleepBetweenRunsLabel = formatAutomationSleepInterval(automation);
      const stopPhrase = String(automation?.stopPhrase ?? '').trim();
      const stopPhraseCaseSensitive = Boolean(automation?.stopPhraseCaseSensitive);
      const title = !supportsDraftAutomation
        ? 'Automations require a builtin transcript agent.'
        : !prompt
          ? `Set a prompt for "${automationLabel}" in Settings > Automation first.`
          : `Create a new drone and run "${automationLabel}" for ${runs} ${
              runs === 1 ? 'run' : 'runs'
            }${sleepBetweenRunsSeconds > 0 ? ` (${sleepBetweenRunsLabel.toLowerCase()} between runs)` : ''}.`;
      actions.push({
        id: `draft-automation:${automationId}`,
        kind: 'automation',
        label: `Run ${automationLabel}`,
        onSelect: () => {
          void onStartDraftAutomation({
            automationId,
            automationLabel,
            prompt,
            onFailurePrompt,
            runs,
            sleepBetweenRunsSeconds,
            stopPhrase,
            stopPhraseCaseSensitive,
          });
        },
        onSelectWithRuns: (selectedRuns) => {
          const normalizedRuns = Math.max(
            AUTOMATION_RUNS_MIN,
            Math.min(AUTOMATION_RUNS_MAX, Math.round(Number(selectedRuns) || runs)),
          );
          void onStartDraftAutomation({
            automationId,
            automationLabel,
            prompt,
            onFailurePrompt,
            runs: normalizedRuns,
            sleepBetweenRunsSeconds,
            stopPhrase,
            stopPhraseCaseSensitive,
          });
        },
        title,
        disabled: controlsLocked || !supportsDraftAutomation || !prompt || !createWithChat,
        active: false,
        defaultRuns: runs,
        minRuns: AUTOMATION_RUNS_MIN,
        maxRuns: AUTOMATION_RUNS_MAX,
        sleepBetweenRunsLabel,
        statusText: `${runs} ${runs === 1 ? 'run' : 'runs'}`,
      });
    }
    return actions;
  }, [automations, controlsLocked, createWithChat, onStartDraftAutomation, spawnAgentConfig.kind]);
  const queuedDraftPrompts = draftChat.droneId ? queuedPromptsByDroneChat[droneChatQueueKey(draftChat.droneId, 'default')] ?? [] : [];
  const visibleQueuedDraftPrompts = React.useMemo(
    () =>
      resolveVisibleDraftQueuedPrompts({
        pendingPrompt: draftChat.prompt,
        localQueuedPrompts: draftChat.queuedPrompts,
        stagedQueuedPrompts: queuedDraftPrompts,
      }),
    [draftChat.prompt, draftChat.queuedPrompts, queuedDraftPrompts],
  );
  const idleSetupCard = (
    <div className="w-full rounded-[20px] border border-[var(--border-subtle)] bg-[linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02))] p-4 text-left shadow-[0_24px_80px_rgba(0,0,0,.18)]">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedToolbarToggle
          label="Mode"
          value={draftCreateMode}
          options={modeToggleOptions}
          onChange={onDraftCreateModeChange}
          disabled={controlsLocked}
        />
        <SegmentedToolbarToggle
          label="Runtime"
          value={createRuntime}
          options={runtimeToggleOptions}
          onChange={onCreateRuntimeChange}
          disabled={controlsLocked}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
            Name
          </span>
          <input
            value={draftCreateName}
            onChange={(e) => onDraftCreateNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
            disabled={controlsLocked}
            placeholder={createWithChat ? 'Optional (auto-renames if blank)' : 'Optional name'}
            className={`h-[28px] w-[220px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
              controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
            }`}
            title="Optionally name this drone now."
          />
          <button
            type="button"
            onClick={() => onDraftCreateNameChange('')}
            disabled={controlsLocked || !draftCreateName.trim()}
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
              controlsLocked || !draftCreateName.trim()
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Clear name"
          >
            Clear
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
            Group
          </span>
          <input
            value={draftCreateGroup}
            onChange={(e) => onDraftCreateGroupChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
            disabled={controlsLocked}
            placeholder="Optional group"
            className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all ${
              controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
            }`}
            title="Set group for this new drone."
          />
          <button
            type="button"
            onClick={() => onDraftCreateGroupChange('')}
            disabled={controlsLocked || !draftCreateGroup.trim()}
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
              controlsLocked || !draftCreateGroup.trim()
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Clear group"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="mt-3">
        <SpawnContextToolbar
          agentMenuEntries={filteredSpawnAgentMenuEntries}
          spawnAgentConfig={spawnAgentConfig}
          createRepoMenuEntries={createRepoMenuEntries}
          allowWrap
          onOpenCustomAgentModal={() => setCustomAgentModalOpen(true)}
          agentTitle="Choose agent for this new drone."
          modelTitle="Set default model for this new drone chat."
          customButtonTitle={
            hostCustomAgentsUnsupported ? 'Custom agents are not yet supported for host runtime.' : 'Manage custom agents'
          }
          controlsLocked={controlsLocked}
          showAgentControls={createWithChat}
          customButtonDisabled={hostCustomAgentsUnsupported}
        />
      </div>
      {draftCreateRepoPath ? (
        <div className="mt-3">
          <RepoBranchSourceControls
            repoPath={draftCreateRepoPath}
            hostBranch={draftRepoHostBranch}
            remoteBranches={draftRepoRemoteBranches}
            loading={draftRepoBranchesLoading}
            error={draftRepoBranchesError}
            branchSource={remoteBranchCheckoutEnabled ? repoBranchSource : 'host'}
            onBranchSourceChange={onRepoBranchSourceChange}
            pullHostBranchBeforeCreate={pullHostBranchBeforeCreate}
            onPullHostBranchBeforeCreateChange={setPullHostBranchBeforeCreate}
            remoteBranch={repoCreateRemoteBranch}
            onRemoteBranchChange={onRepoCreateRemoteBranchChange}
            remoteBranchCheckoutEnabled={remoteBranchCheckoutEnabled}
            remoteBranchCheckoutDisabledReason={
              createRuntime === 'host'
                ? 'Remote branch checkout is only available for container runtime drones.'
                : null
            }
            disabled={controlsLocked}
          />
        </div>
      ) : null}
      {!draftCreateRepoPath ? (
        <div className="mt-3 text-[10px] text-[var(--muted-dim)]">
          Pick a repo above if you want the drone to start from a host branch or a remote branch.
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex-shrink-0 bg-[var(--panel-alt)] border-b border-[var(--border)] relative">
        <div className="px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border bg-[var(--yellow-subtle)] border-[rgba(255,178,36,.15)]">
                <IconChat className="text-[var(--yellow)]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'var(--display)' }}>
                    New drone
                  </span>
                  {draftCreateParentDroneLabel ? (
                    <span className="rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-dim)]">
                      Child of {draftCreateParentDroneLabel}
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">
                  {draftChat.prompt
                    ? 'Creating your drone. Any new messages you send will queue and auto-send when it is ready.'
                    : createWithChat
                      ? 'Send the first message to create the drone and start its first chat.'
                      : 'Create the runtime now. You can add chats later.'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all text-[10px] font-semibold tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {draftCreateError && !createWithChat && !draftChat.prompt ? (
          <div className="px-5 pt-4">
            <div className="mx-auto max-w-[1275px] rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)] whitespace-pre-wrap">
              {draftCreateError}
            </div>
          </div>
        ) : null}
        {draftChat.prompt ? (
          <div className="px-5 py-5">
            <div className="mx-auto max-w-[1275px] space-y-5">
              <PendingTranscriptTurn item={draftChat.prompt} />
              {visibleQueuedDraftPrompts.map((p) => (
                <PendingTranscriptTurn key={`draft-queued-${p.id}`} item={p} />
              ))}
            </div>
          </div>
        ) : !createWithChat ? (
          <EmptyState
            icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
            title="Create without a chat"
            description="This creates the drone runtime now. You can start one or more chats later from the drone workspace."
            actions={
              <div className="space-y-4">
                {idleSetupCard}
                <button
                  type="button"
                  onClick={() => {
                    void onCreateEmptyDrone();
                  }}
                  disabled={draftCreating || draftAutoRenaming}
                  className={`inline-flex items-center justify-center gap-2 h-10 w-full rounded border text-[11px] font-semibold tracking-wide uppercase transition-all ${
                    draftCreating || draftAutoRenaming
                      ? 'opacity-50 cursor-not-allowed bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                      : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {draftCreating ? 'Creating...' : 'Create drone'}
                </button>
              </div>
            }
            actionsClassName="max-w-[980px]"
          />
        ) : (
          <EmptyState
            icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
            title="Start with a message"
            description="Sending creates a new untitled drone immediately, then auto-renames it."
            actions={idleSetupCard}
            actionsClassName="max-w-[980px]"
          />
        )}
      </div>
      {createWithChat || draftChat.prompt ? (
        <ChatInput
          resetKey={draftChatInputResetKey(draftChat)}
          focusTargetId="primary-chat"
          droneName="new drone"
          promptError={draftCreateError}
          sending={false}
          waiting={false}
          autoFocus={!draftCreating && !draftAutoRenaming && !draftChat.prompt && visibleQueuedDraftPrompts.length === 0}
          attachmentsEnabled
          automationActions={draftAutomationActions}
          onSend={async (payload: ChatSendPayload) => {
            if (!draftChat.prompt) return await onStartDraftPrompt(payload);
            const droneId = String(draftChat.droneId ?? '').trim();
            if (!droneId) {
              if (!draftCreating) {
                onSetDraftCreateError('Drone creation failed before it could be queued. Retry the first message.');
                return false;
              }
              const queued = onQueueDraftPromptDuringCreate(payload);
              if (queued) onSetDraftCreateError(null);
              return queued;
            }
            const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
            const prompt = String(payload?.prompt ?? '').trim();
            if (!prompt && attachments.length === 0) return false;
            onEnqueueQueuedPrompt(droneId, 'default', prompt, attachments);
            onSetDraftCreateError(null);
            return true;
          }}
        />
      ) : null}
    </div>
  );
}
