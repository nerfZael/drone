import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChatInput, type ChatImageAttachmentPayload, type ChatSendContext, type ChatSendPayload, EmptyState, PendingTranscriptTurn } from '../chat';
import { draftChatInputResetKey, droneChatQueueKey } from './helpers';
import { IconChat } from './icons';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import type { ChatAgentConfig } from '../../domain';
import type { DraftChatState } from './app-types';
import type { QueuedPrompt } from './use-queued-prompts-state';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import type { DroneSummary, RepoRemoteBranchOption } from '../types';
import { droneProvisioningLabel } from '../hub-phase';
import {
  filterSpawnAgentMenuEntriesForRuntime,
  runtimeSupportsCustomAgents,
  type CreateRuntime,
  type RepoBranchSourceMode,
} from './drone-create-runtime';
import { SegmentedToolbarToggle } from './SegmentedToolbarToggle';
import { visibleDraftQueuedPrompts as resolveVisibleDraftQueuedPrompts } from './draft-chat-queue';
import { SpawnContextToolbar } from './SpawnContextToolbar';
import { RepoBranchSourceControls } from './RepoBranchSourceControls';

type DraftChatWorkspaceProps = {
  draftChat: DraftChatState;
  createRuntime: CreateRuntime;
  onCreateRuntimeChange: (value: CreateRuntime) => void;
  createAsDraft: boolean;
  onCreateAsDraftChange: (value: boolean) => void;
  createPersistVolume: boolean;
  onCreatePersistVolumeChange: (value: boolean) => void;
  draftCreateMode: 'with-chat' | 'without-chat';
  onDraftCreateModeChange: (value: 'with-chat' | 'without-chat') => void;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  draftHubPhase?: DroneSummary['hubPhase'];
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
  onStartDraftPrompt: (payload: ChatSendPayload, opts?: { keepComposerOpen?: boolean }) => Promise<boolean>;
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
  createAsDraft,
  onCreateAsDraftChange,
  createPersistVolume,
  onCreatePersistVolumeChange,
  draftCreateMode,
  onDraftCreateModeChange,
  spawnAgentMenuEntries,
  draftCreating,
  draftAutoRenaming,
  draftHubPhase,
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
  onQueueDraftPromptDuringCreate,
  onCreateEmptyDrone,
  onEnqueueQueuedPrompt,
  onDraftCreateNameChange,
  onDraftCreateGroupChange,
  onSetDraftCreateError,
}: DraftChatWorkspaceProps) {
  const {
    pullHostBranchBeforeCreate,
    setPullHostBranchBeforeCreate,
    setCustomAgentModalOpen,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      pullHostBranchBeforeCreate: s.pullHostBranchBeforeCreate,
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
  const draftTitle = String(draftChat.droneName ?? '').trim() || 'New drone';
  const startupLabel = droneProvisioningLabel(
    draftHubPhase ?? (draftCreating && !draftChat.droneId ? 'creating' : 'starting'),
  );
  const idleSetupCard = (
    <div className="w-full rounded-[20px] border border-[var(--border-subtle)] bg-[var(--panel-raised)] p-5 text-left shadow-[0_12px_36px_var(--shadow-color)]">
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
        {createRuntime === 'container' ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
              Persist volume
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={createPersistVolume}
              onClick={() => onCreatePersistVolumeChange(!createPersistVolume)}
              disabled={controlsLocked}
              className={`inline-flex items-center gap-2 h-[28px] px-2 rounded border text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                controlsLocked
                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : createPersistVolume
                    ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                    : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title={
                createPersistVolume
                  ? 'Mount /dvm-data on a Docker volume for this new drone.'
                  : 'Keep /dvm-data in the container image layer for this new drone.'
              }
            >
              <span
                className={`relative inline-flex h-3.5 w-6 rounded-full transition-colors ${
                  createPersistVolume ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'
                }`}
              >
                <span
                  className={`absolute top-[1px] h-3 w-3 rounded-full bg-white transition-transform ${
                    createPersistVolume ? 'translate-x-[11px]' : 'translate-x-[1px]'
                  }`}
                />
              </span>
              {createPersistVolume ? 'On' : 'Off'}
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
            Draft
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={createAsDraft}
            onClick={() => onCreateAsDraftChange(!createAsDraft)}
            disabled={controlsLocked}
            className={`inline-flex items-center gap-2 h-[28px] px-2 rounded border text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
              controlsLocked
                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : createAsDraft
                  ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                  : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Save this drone as a draft. Messages queue until you publish it."
          >
            <span
              className={`relative inline-flex h-3.5 w-6 rounded-full transition-colors ${
                createAsDraft ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'
              }`}
            >
              <span
                className={`absolute top-[1px] h-3 w-3 rounded-full bg-white transition-transform ${
                  createAsDraft ? 'translate-x-[11px]' : 'translate-x-[1px]'
                }`}
              />
            </span>
            {createAsDraft ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
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
            className={`h-[28px] w-[220px] rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 text-[var(--text-11)] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
              controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
            }`}
            title="Optionally name this drone now."
          />
          <button
            type="button"
            onClick={() => onDraftCreateNameChange('')}
            disabled={controlsLocked || !draftCreateName.trim()}
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
              controlsLocked || !draftCreateName.trim()
                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] text-[var(--muted-dim)]'
                : 'bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Clear name"
          >
            Clear
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
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
            className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 text-[var(--text-11)] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all ${
              controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
            }`}
            title="Set group for this new drone."
          />
          <button
            type="button"
            onClick={() => onDraftCreateGroupChange('')}
            disabled={controlsLocked || !draftCreateGroup.trim()}
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
              controlsLocked || !draftCreateGroup.trim()
                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] text-[var(--muted-dim)]'
                : 'bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
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
          runtime={createRuntime}
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
        <div className="mt-3 text-[var(--text-10)] text-[var(--muted-dim)]">
          Pick a repo above if you want the drone to start from a host branch or a remote branch.
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex h-[3.25rem] flex-shrink-0 items-center border-b border-[var(--border)] bg-[var(--panel-alt)] px-4">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="max-w-[min(34vw,360px)] truncate dh-type-title dh-type-workspace-title">
              {draftTitle}
            </span>
            {draftChat.prompt && draftChat.prompt.state !== 'failed' ? (
              <span
                className="inline-flex items-center gap-1.5 text-[var(--text-10)] font-[var(--weight-medium)] text-[var(--muted-dim)]"
                aria-label={`${startupLabel} drone`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--yellow)] animate-pulse" />
                {startupLabel}
              </span>
            ) : null}
            {draftCreateParentDroneLabel ? (
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-2 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted-dim)]">
                Child of {draftCreateParentDroneLabel}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center justify-center h-7 px-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase"
              style={{ fontFamily: 'var(--display)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {draftCreateError && !createWithChat && !draftChat.prompt ? (
          <div className="px-5 pt-4">
            <div className="mx-auto max-w-[1275px] rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)] whitespace-pre-wrap">
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
                  className={`inline-flex items-center justify-center gap-2 h-10 w-full rounded border text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
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
          onSend={async (payload: ChatSendPayload, context: ChatSendContext) => {
            if (!draftChat.prompt) {
              return await onStartDraftPrompt(payload, {
                keepComposerOpen: context.trigger === 'keyboard' && context.modifierKey,
              });
            }
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
