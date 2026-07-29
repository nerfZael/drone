import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  ChatAgentConfig,
} from '../../domain';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import type { RepoRemoteBranchOption } from '../types';
import type { CreateRuntime, RepoBranchSourceMode } from './drone-create-runtime';
import { NewDroneTargetControls } from './NewDroneTargetControls';
import { AgentsMdCreateSelector } from './AgentsMdCreateSelector';
import { repoPathLabel } from './repo-path-label';
import { SegmentedToolbarToggle } from './SegmentedToolbarToggle';
import type { AgentsMdFileSummary } from './settings-types';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type NewDroneSetupPanelProps = {
  createRuntime: CreateRuntime;
  onCreateRuntimeChange: (value: CreateRuntime) => void;
  createAsDraft: boolean;
  onCreateAsDraftChange: (value: boolean) => void;
  createPersistVolume: boolean;
  onCreatePersistVolumeChange: (value: boolean) => void;
  spawnAgentPermissionMode: AgentPermissionMode;
  onSpawnAgentPermissionModeChange: (value: AgentPermissionMode) => void;
  spawnApprovalPolicy: AgentApprovalPolicy;
  onSpawnApprovalPolicyChange: (value: AgentApprovalPolicy) => void;
  spawnAgentApprovalSupported: boolean;
  spawnAgentReadOnlySupported: boolean;
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  draftCreateRepoPath: string;
  agentsMdLibraryFiles: AgentsMdFileSummary[];
  agentsMdLibraryLoading: boolean;
  agentsMdLibraryError: string | null;
  draftAgentsMdLibraryFileId: string;
  onDraftAgentsMdLibraryFileIdChange: (fileId: string) => void;
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
  controlsLocked: boolean;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4.5 10.5 3.4 3.4 7.6-8" />
    </svg>
  );
}

export function NewDroneSetupPanel({
  createRuntime,
  onCreateRuntimeChange,
  createAsDraft,
  onCreateAsDraftChange,
  createPersistVolume,
  onCreatePersistVolumeChange,
  spawnAgentPermissionMode,
  onSpawnAgentPermissionModeChange,
  spawnApprovalPolicy,
  onSpawnApprovalPolicyChange,
  spawnAgentApprovalSupported,
  spawnAgentReadOnlySupported,
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
  controlsLocked,
}: NewDroneSetupPanelProps) {
  const [advancedOpen, setAdvancedOpen] = React.useState(
    draftAgentsMdOverrideEnabled || Boolean(draftAgentsMdLibraryFileId),
  );
  const { chatHeaderRepoPath, setChatHeaderRepoPath } = useDroneHubUiStore(
    useShallow((state) => ({
      chatHeaderRepoPath: state.chatHeaderRepoPath,
      setChatHeaderRepoPath: state.setChatHeaderRepoPath,
    })),
  );
  const advancedPanelId = React.useId();
  const repositoryLabel = chatHeaderRepoPath ? repoPathLabel(chatHeaderRepoPath) : '';
  const spawnAgentIsCodex =
    spawnAgentConfig.kind === 'builtin' && spawnAgentConfig.id === 'codex';
  const spawnAgentSupportsApprovals =
    spawnAgentConfig.kind === 'native' || spawnAgentIsCodex;

  return (
    <div className="px-1 pb-1">
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
        actions={
          <>
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls={advancedPanelId}
              onClick={() => setAdvancedOpen((open) => !open)}
              disabled={controlsLocked}
              className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--chat-composer-control-radius)] px-2 text-[var(--text-10)] font-medium transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40 ${
                advancedOpen
                  ? 'bg-[var(--surface-soft)] text-[var(--fg-secondary)]'
                  : 'text-[var(--chat-composer-placeholder)] hover:text-[var(--chat-composer-control-fg)]'
              }`}
            >
              <ChevronIcon open={advancedOpen} />
              Advanced
            </button>
            <button
              type="button"
              aria-pressed={createAsDraft}
              onClick={() => onCreateAsDraftChange(!createAsDraft)}
              disabled={controlsLocked}
              title={createAsDraft ? 'This drone will be saved as a draft' : 'Save this drone as a draft'}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[.625rem] font-[var(--weight-semibold)] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                createAsDraft
                  ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--chat-composer-control-border)] bg-transparent text-[var(--chat-composer-placeholder)] hover:border-[var(--border)] hover:text-[var(--chat-composer-control-fg)]'
              }`}
            >
              {createAsDraft ? <CheckIcon /> : null}
              {createAsDraft ? 'Draft' : 'Save as draft'}
            </button>
          </>
        }
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--border-subtle)] pb-2">
        <SegmentedToolbarToggle<AgentPermissionMode>
          label="Chat access"
          value={spawnAgentPermissionMode}
          options={[
            {
              value: 'read-only',
              label: 'Read',
              title: spawnAgentReadOnlySupported
                ? 'The default chat can inspect files in a read-only sandbox.'
                : 'Access controls are available for native, Codex, and Blip.',
              disabled: !spawnAgentReadOnlySupported,
            },
            {
              value: 'workspace-write',
              label: 'Write',
              title: spawnAgentReadOnlySupported
                ? 'The default chat can write inside the workspace sandbox.'
                : 'Access controls are available for native, Codex, and Blip.',
              disabled: !spawnAgentReadOnlySupported,
            },
            {
              value: 'full-access',
              label: 'Execute',
              title: 'The default chat can run with full command access.',
            },
          ]}
          onChange={onSpawnAgentPermissionModeChange}
          disabled={controlsLocked}
          tone="accent"
          density="compact"
        />

        <SegmentedToolbarToggle<AgentApprovalPolicy>
          label="Approvals"
          value={spawnApprovalPolicy}
          options={[
            {
              value: 'ask',
              label: 'Ask',
              title: spawnAgentIsCodex
                ? 'Ask requires an interactive Codex integration.'
                : 'Ask before approval-gated commands.',
              disabled: spawnAgentIsCodex,
            },
            ...(spawnAgentIsCodex
              ? [
                  {
                    value: 'agent-decides' as const,
                    label: 'Decide for me',
                    title: 'Codex decides when a command needs confirmation.',
                  },
                ]
              : []),
            {
              value: 'never',
              label: 'Always Allow',
              title: 'Run commands without waiting for confirmation.',
            },
          ]}
          onChange={onSpawnApprovalPolicyChange}
          disabled={controlsLocked || !spawnAgentApprovalSupported}
          tone="accent"
          density="compact"
        />

        {!spawnAgentReadOnlySupported ? (
          <span className="basis-full text-left text-[var(--text-10)] text-[var(--muted-dim)]">
            Access controls are available for native, Codex, and Blip.
          </span>
        ) : !spawnAgentSupportsApprovals ? (
          <span className="basis-full text-left text-[var(--text-10)] text-[var(--muted-dim)]">
            Approval policies are available for native and Codex.
          </span>
        ) : spawnAgentPermissionMode !== 'full-access' ? (
          <span className="basis-full text-left text-[var(--text-10)] text-[var(--muted-dim)]">
            Approvals are available when Access is Execute.
          </span>
        ) : null}
      </div>

      {advancedOpen ? (
        <div
          id={advancedPanelId}
          className="mt-2 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3 sm:p-4"
        >
          <div className={`grid gap-4 ${createRuntime === 'container' ? 'sm:grid-cols-[18rem_auto]' : ''}`}>
            <section className="w-full min-w-0 max-w-[18rem]">
              <div className="mb-1.5 text-[var(--text-10)] font-[var(--weight-bold)] uppercase tracking-[0.1em] text-[var(--muted)]">
                Repository
              </div>
              <UiMenuSelect
                variant="form"
                value={chatHeaderRepoPath}
                onValueChange={setChatHeaderRepoPath}
                entries={createRepoMenuEntries}
                disabled={controlsLocked}
                panelClassName="bottom-full !right-auto !mt-0 mb-1.5 w-[18rem] max-w-[calc(100vw-3rem)]"
                menuClassName="max-h-[240px] overflow-y-auto"
                title={chatHeaderRepoPath || 'No repository'}
                triggerLabel={repositoryLabel || 'No repository'}
                triggerLabelClassName={chatHeaderRepoPath ? 'font-mono text-[var(--text-11)]' : undefined}
              />
            </section>

            {createRuntime === 'container' ? (
              <section>
                <div className="mb-1.5 text-[var(--text-10)] font-[var(--weight-bold)] uppercase tracking-[0.1em] text-[var(--muted)]">
                  Storage
                </div>
                <button
                  type="button"
                  aria-pressed={createPersistVolume}
                  onClick={() => onCreatePersistVolumeChange(!createPersistVolume)}
                  disabled={controlsLocked}
                  className={`mt-2 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[var(--text-10)] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    createPersistVolume
                      ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg-secondary)]'
                  }`}
                  title="Keep /dvm-data between container rebuilds"
                >
                  {createPersistVolume ? <CheckIcon /> : null}
                  Persistent volume
                </button>
              </section>
            ) : null}
          </div>

          <AgentsMdCreateSelector
            runtime={createRuntime}
            repoPath={draftCreateRepoPath}
            files={agentsMdLibraryFiles}
            loading={agentsMdLibraryLoading}
            error={agentsMdLibraryError}
            selectedFileId={draftAgentsMdLibraryFileId}
            customOverrideEnabled={draftAgentsMdOverrideEnabled}
            customOverride={draftAgentsMdOverride}
            onSelectedFileIdChange={onDraftAgentsMdLibraryFileIdChange}
            onCustomOverrideEnabledChange={onDraftAgentsMdOverrideEnabledChange}
            onCustomOverrideChange={onDraftAgentsMdOverrideChange}
            disabled={controlsLocked}
            scopeLabel="this drone"
            className="mt-4 border-t border-[var(--border-subtle)] pt-4"
          />
        </div>
      ) : null}
    </div>
  );
}
