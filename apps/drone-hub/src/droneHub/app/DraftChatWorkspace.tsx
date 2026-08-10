import React from 'react';
import { buildModelCatalogChoices } from '@drone/assistant-chat';
import { useShallow } from 'zustand/react/shallow';
import {
  ChatInput,
  type ChatInputDraftContent,
  type ChatImageAttachmentPayload,
  type ChatSendContext,
  type ChatSendPayload,
  PendingTranscriptTurn,
} from '../chat';
import type { ChatComposerControl, ChatComposerControlsConfig } from '../chat/ChatComposerControls';
import { draftChatInputResetKey, droneChatQueueKey } from './helpers';
import type { UiMenuSelectEntry } from '../../ui/components';
import type { AgentApprovalPolicy, AgentPermissionMode, ChatAgentConfig } from '../../domain';
import type { AgentsMdFileSummary } from './settings-types';
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
import { AgentComposerPicker } from './AgentComposerPicker';
import { NewDroneAccessPicker } from './NewDroneAccessPicker';
import { NewDroneTargetControls } from './NewDroneTargetControls';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { useAgentModelCatalog } from './use-agent-model-catalog';

type DraftChatWorkspaceProps = {
  draftChat: DraftChatState;
  createRuntime: CreateRuntime;
  onCreateRuntimeChange: (value: CreateRuntime) => void;
  spawnAgentPermissionMode: AgentPermissionMode;
  onSpawnAgentPermissionModeChange: (value: AgentPermissionMode) => void;
  spawnApprovalPolicy: AgentApprovalPolicy;
  onSpawnApprovalPolicyChange: (value: AgentApprovalPolicy) => void;
  spawnAgentApprovalSupported: boolean;
  spawnAgentReadOnlySupported: boolean;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  draftHubPhase?: DroneSummary['hubPhase'];
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  draftCreateRepoPath: string;
  agentsMdLibraryFiles: AgentsMdFileSummary[];
  agentsMdLibraryLoading: boolean;
  agentsMdLibraryError: string | null;
  draftAgentsMdLibraryFileId: string;
  onDraftAgentsMdLibraryFileIdChange: (value: string) => void;
  draftAgentsMdOverrideEnabled: boolean;
  onDraftAgentsMdOverrideEnabledChange: (value: boolean) => void;
  draftAgentsMdOverride: string;
  onDraftAgentsMdOverrideChange: (value: string) => void;
  repoBranchSource: RepoBranchSourceMode;
  onRepoBranchSourceChange: (value: RepoBranchSourceMode) => void;
  repoCreateRemoteBranch: string;
  onRepoCreateRemoteBranchChange: (value: string) => void;
  draftRepoHostBranch: string | null;
  draftRepoRemoteBranches: RepoRemoteBranchOption[];
  draftRepoBranchesLoading: boolean;
  draftRepoBranchesError: string | null;
  draftCreateParentDroneLabel: string | null;
  draftCreateError: string | null;
  queuedPromptsByDroneChat: Record<string, QueuedPrompt[]>;
  onCancel: () => void;
  onStartDraftPrompt: (
    payload: ChatSendPayload,
    opts?: { keepComposerOpen?: boolean; deliveryMode?: ChatSendContext['deliveryMode'] },
  ) => Promise<boolean>;
  onQueueDraftPromptDuringCreate: (payload: ChatSendPayload) => boolean;
  onEnqueueQueuedPrompt: (
    droneId: string,
    chatName: string,
    prompt: string,
    attachments?: ChatImageAttachmentPayload[],
  ) => void;
  onSetDraftCreateError: (error: string | null) => void;
  onDraftContentChange: (content: ChatInputDraftContent) => void;
};

export function DraftChatWorkspace({
  draftChat,
  createRuntime,
  onCreateRuntimeChange,
  spawnAgentPermissionMode,
  onSpawnAgentPermissionModeChange,
  spawnApprovalPolicy,
  onSpawnApprovalPolicyChange,
  spawnAgentApprovalSupported,
  spawnAgentReadOnlySupported,
  spawnAgentMenuEntries,
  draftCreating,
  draftAutoRenaming,
  draftHubPhase,
  spawnAgentConfig,
  createRepoMenuEntries,
  draftCreateRepoPath,
  agentsMdLibraryFiles,
  agentsMdLibraryLoading,
  agentsMdLibraryError,
  draftAgentsMdLibraryFileId,
  onDraftAgentsMdLibraryFileIdChange,
  draftAgentsMdOverrideEnabled,
  onDraftAgentsMdOverrideEnabledChange,
  draftAgentsMdOverride,
  onDraftAgentsMdOverrideChange,
  repoBranchSource,
  onRepoBranchSourceChange,
  repoCreateRemoteBranch,
  onRepoCreateRemoteBranchChange,
  draftRepoHostBranch,
  draftRepoRemoteBranches,
  draftRepoBranchesLoading,
  draftRepoBranchesError,
  draftCreateParentDroneLabel,
  draftCreateError,
  queuedPromptsByDroneChat,
  onCancel,
  onStartDraftPrompt,
  onQueueDraftPromptDuringCreate,
  onEnqueueQueuedPrompt,
  onSetDraftCreateError,
  onDraftContentChange,
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
  const modelCatalog = useAgentModelCatalog({
    agentId: agentCatalogId,
    runtime: createRuntime,
    enabled: spawnAgentConfig.kind !== 'custom',
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
        name: 'Auto',
      },
      ...buildModelCatalogChoices(modelCatalog.models, modelProvider),
    ],
    [modelCatalog.models, modelProvider],
  );
  const modelCatalogStatusMessage = modelCatalog.error
    ? `${modelCatalog.models.length > 0 ? 'Using the last detected catalog. ' : ''}${modelCatalog.error}`
    : modelCatalog.loading && modelCatalog.models.length === 0
      ? 'Detecting available models…'
      : modelCatalog.stale
        ? 'Updating the agent model catalog in the background…'
        : undefined;
  const newDroneComposerControls = React.useMemo<ChatComposerControlsConfig | undefined>(() => {
    const controls: ChatComposerControl[] = [];
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
        statusMessage: modelCatalogStatusMessage,
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
    controlsLocked,
    createRuntime,
    modelChoices,
    modelCatalogStatusMessage,
    modelProvider,
    setCustomAgentModalOpen,
    setSpawnModel,
    setSpawnReasoning,
    spawnAgentConfig.kind,
    spawnAgentKey,
    spawnModel,
    spawnReasoning,
  ]);
  const queuedDraftPrompts = draftChat.droneId
    ? (queuedPromptsByDroneChat[droneChatQueueKey(draftChat.droneId, 'default')] ?? [])
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
      createRepoMenuEntries={createRepoMenuEntries}
      draftCreateRepoPath={draftCreateRepoPath}
      agentsMdLibraryFiles={agentsMdLibraryFiles}
      agentsMdLibraryLoading={agentsMdLibraryLoading}
      agentsMdLibraryError={agentsMdLibraryError}
      draftAgentsMdLibraryFileId={draftAgentsMdLibraryFileId}
      onDraftAgentsMdLibraryFileIdChange={onDraftAgentsMdLibraryFileIdChange}
      draftAgentsMdOverrideEnabled={draftAgentsMdOverrideEnabled}
      onDraftAgentsMdOverrideEnabledChange={onDraftAgentsMdOverrideEnabledChange}
      draftAgentsMdOverride={draftAgentsMdOverride}
      onDraftAgentsMdOverrideChange={onDraftAgentsMdOverrideChange}
      controlsLocked={controlsLocked}
    />
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex h-11 flex-shrink-0 items-center border-b border-[var(--border)] bg-[var(--panel-alt)] px-3">
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
          <div className="mx-auto flex min-h-full w-full max-w-[760px] items-center justify-center px-6 py-12 text-center">
            <div className="relative -mt-6 max-w-[460px]">
              <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-alt)] text-[var(--accent)] shadow-[0_12px_32px_var(--shadow-color)]">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v4" />
                  <path d="M12 17v4" />
                  <path d="m4.2 7.5 3.5 2" />
                  <path d="m16.3 14.5 3.5 2" />
                  <path d="m4.2 16.5 3.5-2" />
                  <path d="m16.3 9.5 3.5-2" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </div>
              <h2 className="text-[1.05rem] font-[var(--weight-semibold)] tracking-tight text-[var(--fg)]">
                Start a new drone
              </h2>
            </div>
          </div>
        )}
      </div>
      <ChatInput
        resetKey={draftChatInputResetKey(draftChat)}
        focusTargetId="primary-chat"
        droneName="new drone"
        promptError={draftCreateError}
        waiting={false}
        autoFocus={
          !draftCreating &&
          !draftAutoRenaming &&
          !draftChat.prompt &&
          visibleQueuedDraftPrompts.length === 0
        }
        attachmentsEnabled
        continuousVoiceEnabled={false}
        alwaysExpanded
        onDraftContentChange={onDraftContentChange}
        composerLeadingControls={
          <AgentComposerPicker
            value={spawnAgentKey}
            label={agentLabel}
            entries={filteredAgentMenuEntries}
            onChange={setSpawnAgentKey}
            disabled={controlsLocked}
          />
        }
        composerTrailingControls={
          <NewDroneAccessPicker
            permissionMode={spawnAgentPermissionMode}
            onPermissionModeChange={onSpawnAgentPermissionModeChange}
            approvalPolicy={spawnApprovalPolicy}
            onApprovalPolicyChange={onSpawnApprovalPolicyChange}
            readOnlySupported={spawnAgentReadOnlySupported}
            approvalsSupported={spawnAgentApprovalSupported}
            agentIsCodex={
              spawnAgentConfig.kind === 'builtin' && spawnAgentConfig.id === 'codex'
            }
            disabled={controlsLocked}
          />
        }
        composerControls={newDroneComposerControls}
        composerTopAction={
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
        composerFooter={!draftChat.prompt ? idleSetupPanel : null}
        onSend={async (payload: ChatSendPayload, context: ChatSendContext) => {
          if (!draftChat.prompt) {
            return await onStartDraftPrompt(payload, {
              keepComposerOpen: context.trigger === 'keyboard' && context.deliveryMode === 'queue',
              deliveryMode: context.deliveryMode,
            });
          }
          const droneId = String(draftChat.droneId ?? '').trim();
          if (!droneId) {
            if (!draftCreating) {
              onSetDraftCreateError(
                'Drone creation failed before it could be queued. Retry the first message.',
              );
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
    </div>
  );
}
