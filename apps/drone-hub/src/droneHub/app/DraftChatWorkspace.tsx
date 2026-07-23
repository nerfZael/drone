import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ChatInput,
  type ChatImageAttachmentPayload,
  type ChatSendContext,
  type ChatSendPayload,
  PendingTranscriptTurn,
} from '../chat';
import type {
  ChatComposerControl,
  ChatComposerControlsConfig,
} from '../chat/ChatComposerControls';
import { draftChatInputResetKey, droneChatQueueKey } from './helpers';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import type { ChatAgentConfig } from '../../domain';
import type { DraftChatState } from './app-types';
import type { QueuedPrompt } from './use-queued-prompts-state';
import type { DroneSummary, RepoRemoteBranchOption } from '../types';
import { droneProvisioningLabel } from '../hub-phase';
import {
  filterSpawnAgentMenuEntriesForRuntime,
  runtimeSupportsCustomAgents,
  type CreateRuntime,
  type RepoBranchSourceMode,
} from './drone-create-runtime';
import { visibleDraftQueuedPrompts as resolveVisibleDraftQueuedPrompts } from './draft-chat-queue';
import { NewDroneSetupPanel } from './NewDroneSetupPanel';
import { NewDroneTargetControls } from './NewDroneTargetControls';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { useSpawnModelCatalog } from './use-spawn-model-catalog';

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
    spawnAgentKey,
    spawnModel,
    spawnReasoning,
    setSpawnAgentKey,
    setSpawnModel,
    setSpawnReasoning,
    setCustomAgentModalOpen,
  } = useDroneHubUiStore(
    useShallow((state) => ({
      spawnAgentKey: state.spawnAgentKey,
      spawnModel: state.spawnModel,
      spawnReasoning: state.spawnReasoning,
      setSpawnAgentKey: state.setSpawnAgentKey,
      setSpawnModel: state.setSpawnModel,
      setSpawnReasoning: state.setSpawnReasoning,
      setCustomAgentModalOpen: state.setCustomAgentModalOpen,
    })),
  );
  const controlsLocked = draftCreating || draftAutoRenaming || Boolean(draftChat.prompt);
  const createWithChat = draftCreateMode === 'with-chat' || Boolean(draftChat.prompt);
  const filteredAgentMenuEntries = React.useMemo(
    () => filterSpawnAgentMenuEntriesForRuntime(createRuntime, spawnAgentMenuEntries),
    [createRuntime, spawnAgentMenuEntries],
  );
  const agentCatalogId =
    spawnAgentConfig.kind === 'native'
      ? 'native'
      : spawnAgentConfig.kind === 'builtin'
        ? spawnAgentConfig.id
        : '';
  const modelCatalog = useSpawnModelCatalog({
    agentId: agentCatalogId,
    runtime: createRuntime,
    enabled: createWithChat && spawnAgentConfig.kind !== 'custom',
  });
  const agentLabel = React.useMemo(() => {
    const selectedEntry = filteredAgentMenuEntries.find(
      (entry) => entry.kind !== 'separator' && entry.value === spawnAgentKey,
    );
    if (selectedEntry?.kind !== 'separator' && typeof selectedEntry?.label === 'string') {
      return selectedEntry.label;
    }
    if (spawnAgentConfig.kind === 'native') return 'Built-in';
    if (spawnAgentConfig.kind === 'custom') return spawnAgentConfig.label;
    return spawnAgentConfig.id;
  }, [filteredAgentMenuEntries, spawnAgentConfig, spawnAgentKey]);
  const modelProvider = agentCatalogId || 'default';
  const modelChoices = React.useMemo(
    () => [
      {
        provider: modelProvider,
        id: '',
        name: modelCatalog.loading ? 'Detecting models…' : 'Default model',
      },
      ...modelCatalog.models.flatMap((model) =>
        model.reasoningLevels.length > 0
          ? model.reasoningLevels.map((thinkingLevel) => ({
              provider: modelProvider,
              id: model.id,
              name: model.label,
              thinkingLevel,
            }))
          : [{ provider: modelProvider, id: model.id, name: model.label }],
      ),
    ],
    [modelCatalog.loading, modelCatalog.models, modelProvider],
  );
  const newDroneComposerControls = React.useMemo<ChatComposerControlsConfig | undefined>(() => {
    if (!createWithChat) return undefined;
    const controls: ChatComposerControl[] = [
      {
        kind: 'select',
        id: 'new-drone-agent',
        value: spawnAgentKey,
        label: agentLabel,
        title: 'Choose agent',
        entries: filteredAgentMenuEntries,
        onValueChange: setSpawnAgentKey,
        disabled: controlsLocked,
        searchable: true,
        searchPlaceholder: 'Search agents',
        width: 'medium',
      },
    ];
    if (spawnAgentConfig.kind !== 'custom') {
      controls.push({
        kind: 'model-picker',
        id: 'new-drone-model',
        currentProvider: modelProvider,
        currentModel: spawnModel,
        currentThinkingLevel: spawnReasoning || undefined,
        options: modelChoices,
        disabled: controlsLocked,
        showReasoning: true,
        searchable: true,
        searchPlaceholder: 'Search models',
        title: 'Choose model and reasoning',
        onSelect: (choice, selection) => {
          if (selection === 'reasoning') {
            setSpawnReasoning(choice.thinkingLevel ?? '');
            return;
          }
          setSpawnModel(choice.id);
          setSpawnReasoning(choice.thinkingLevel ?? '');
        },
      });
    }
    return {
      controls,
      menuActions: runtimeSupportsCustomAgents(createRuntime)
        ? [
            {
              id: 'manage-custom-agents',
              label: 'Manage custom agents',
              title: 'Add or edit custom agents',
              onSelect: () => setCustomAgentModalOpen(true),
            },
          ]
        : undefined,
      menuLabel: 'New drone options',
    };
  }, [
    agentLabel,
    controlsLocked,
    createRuntime,
    createWithChat,
    filteredAgentMenuEntries,
    modelChoices,
    modelProvider,
    setCustomAgentModalOpen,
    setSpawnAgentKey,
    setSpawnModel,
    setSpawnReasoning,
    spawnAgentConfig.kind,
    spawnAgentKey,
    spawnModel,
    spawnReasoning,
  ]);
  const queuedDraftPrompts = draftChat.droneId
    ? queuedPromptsByDroneChat[droneChatQueueKey(draftChat.droneId, 'default')] ?? []
    : [];
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
  const idleSetupPanel = (
    <NewDroneSetupPanel
      createRuntime={createRuntime}
      onCreateRuntimeChange={onCreateRuntimeChange}
      createAsDraft={createAsDraft}
      onCreateAsDraftChange={onCreateAsDraftChange}
      createPersistVolume={createPersistVolume}
      onCreatePersistVolumeChange={onCreatePersistVolumeChange}
      draftCreateMode={draftCreateMode}
      onDraftCreateModeChange={onDraftCreateModeChange}
      createRepoMenuEntries={createRepoMenuEntries}
      draftCreateRepoPath={draftCreateRepoPath}
      repoBranchSource={repoBranchSource}
      onRepoBranchSourceChange={onRepoBranchSourceChange}
      repoCreateRemoteBranch={repoCreateRemoteBranch}
      onRepoCreateRemoteBranchChange={onRepoCreateRemoteBranchChange}
      draftRepoHostBranch={draftRepoHostBranch}
      draftRepoRemoteBranches={draftRepoRemoteBranches}
      draftRepoBranchesLoading={draftRepoBranchesLoading}
      draftRepoBranchesError={draftRepoBranchesError}
      draftCreateName={draftCreateName}
      draftCreateGroup={draftCreateGroup}
      onDraftCreateNameChange={onDraftCreateNameChange}
      onDraftCreateGroupChange={onDraftCreateGroupChange}
      controlsLocked={controlsLocked}
      targetsBelowComposer={createWithChat}
    />
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
              <PendingTranscriptTurn
                item={draftChat.prompt}
                autoExpandPrompt={visibleQueuedDraftPrompts.length === 0}
              />
              {visibleQueuedDraftPrompts.map((p, index) => (
                <PendingTranscriptTurn
                  key={`draft-queued-${p.id}`}
                  item={p}
                  autoExpandPrompt={index === visibleQueuedDraftPrompts.length - 1}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-[980px] flex-col justify-center px-5 py-8 sm:px-8 sm:py-10">
            <div className="mb-5">
              <h2 className="text-lg font-[var(--weight-semibold)] tracking-tight text-[var(--fg)]">
                {createWithChat ? 'Start with a message' : 'Create an empty drone'}
              </h2>
            </div>
            {idleSetupPanel}
            {!createWithChat ? (
              <button
                type="button"
                onClick={() => {
                  void onCreateEmptyDrone();
                }}
                disabled={draftCreating || draftAutoRenaming}
                className={`mt-4 inline-flex h-11 w-full items-center justify-center rounded-[var(--radius-large)] bg-[var(--accent)] px-4 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--accent-fg)] transition-[filter,opacity] ${
                  draftCreating || draftAutoRenaming
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:brightness-105 active:brightness-95'
                }`}
              >
                {draftCreating ? 'Creating…' : 'Create drone'}
              </button>
            ) : null}
          </div>
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
          composerControls={newDroneComposerControls}
          composerFooter={
            !draftChat.prompt ? (
              <NewDroneTargetControls
                createRuntime={createRuntime}
                onCreateRuntimeChange={onCreateRuntimeChange}
                repoPath={draftCreateRepoPath}
                branchSource={repoBranchSource}
                onBranchSourceChange={onRepoBranchSourceChange}
                remoteBranch={repoCreateRemoteBranch}
                onRemoteBranchChange={onRepoCreateRemoteBranchChange}
                hostBranch={draftRepoHostBranch}
                remoteBranches={draftRepoRemoteBranches}
                branchesLoading={draftRepoBranchesLoading}
                branchesError={draftRepoBranchesError}
                disabled={controlsLocked}
              />
            ) : null
          }
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
