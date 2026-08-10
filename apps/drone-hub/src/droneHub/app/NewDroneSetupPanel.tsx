import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/components';
import type { CreateRuntime } from './drone-create-runtime';
import { AgentsMdCreateSelector } from './AgentsMdCreateSelector';
import { repoPathLabel } from './repo-path-label';
import type { AgentsMdFileSummary } from './settings-types';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type NewDroneSetupPanelProps = {
  createRuntime: CreateRuntime;
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
  controlsLocked: boolean;
};

const INLINE_TRIGGER_CLASS =
  '!h-8 justify-start !gap-1 !border-transparent !bg-transparent px-2 text-[.6875rem] !font-medium normal-case tracking-normal !text-[var(--chat-composer-model-fg)] hover:!opacity-70';

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

export function NewDroneSetupPanel({
  createRuntime,
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
  return (
    <div className="px-1 pb-1">
      <div className="flex flex-wrap items-center gap-x-[.4375rem] gap-y-1.5">
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <UiMenuSelect
            variant="toolbar"
            value={chatHeaderRepoPath}
            onValueChange={setChatHeaderRepoPath}
            entries={createRepoMenuEntries}
            disabled={controlsLocked}
            searchable
            searchPlaceholder="Search repositories"
            panelClassName="bottom-full !mt-0 mb-1.5 w-[18rem] max-w-[calc(100vw-3rem)]"
            menuClassName="max-h-[240px] overflow-y-auto"
            title={chatHeaderRepoPath || 'No repository'}
            triggerLabel={repositoryLabel || 'No repository'}
            triggerLabelClassName={
              chatHeaderRepoPath ? 'font-mono text-[var(--text-11)]' : undefined
            }
            triggerClassName={`${INLINE_TRIGGER_CLASS} min-w-[6.5rem] max-w-[12rem]`}
          />

          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls={advancedPanelId}
            onClick={() => setAdvancedOpen((open) => !open)}
            disabled={controlsLocked}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--chat-composer-control-radius)] px-2 text-[var(--text-10)] font-medium transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40 ${
              advancedOpen
                ? 'bg-[var(--surface-soft)] text-[var(--fg-secondary)]'
                : 'text-[var(--chat-composer-placeholder)] hover:text-[var(--chat-composer-control-fg)]'
            }`}
          >
            <ChevronIcon open={advancedOpen} />
            Advanced
          </button>
        </div>
      </div>

      {advancedOpen ? (
        <div
          id={advancedPanelId}
          className="mt-2 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3 sm:p-4"
        >
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
          />
        </div>
      ) : null}
    </div>
  );
}
