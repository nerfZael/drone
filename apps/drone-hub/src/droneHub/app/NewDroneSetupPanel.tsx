import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import type { RepoRemoteBranchOption } from '../types';
import type { CreateRuntime, RepoBranchSourceMode } from './drone-create-runtime';
import { RepoBranchSourceControls } from './RepoBranchSourceControls';
import { repoPathLabel } from './repo-path-label';
import { SegmentedToolbarToggle } from './SegmentedToolbarToggle';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type NewDroneSetupPanelProps = {
  createRuntime: CreateRuntime;
  onCreateRuntimeChange: (value: CreateRuntime) => void;
  createAsDraft: boolean;
  onCreateAsDraftChange: (value: boolean) => void;
  createPersistVolume: boolean;
  onCreatePersistVolumeChange: (value: boolean) => void;
  draftCreateMode: 'with-chat' | 'without-chat';
  onDraftCreateModeChange: (value: 'with-chat' | 'without-chat') => void;
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
  onDraftCreateNameChange: (value: string) => void;
  onDraftCreateGroupChange: (value: string) => void;
  controlsLocked: boolean;
};

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`About ${label}`}
        className="inline-flex h-5 w-5 items-center justify-center text-[var(--muted-dim)] transition-colors hover:text-[var(--fg-secondary)] focus:text-[var(--fg-secondary)] focus:outline-none"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 8.7v4.2" strokeLinecap="round" />
          <circle cx="10" cy="6.2" r=".8" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-overlay)] px-3 py-2 text-[var(--text-10)] font-normal leading-relaxed text-[var(--fg-secondary)] opacity-0 shadow-[0_12px_32px_var(--shadow-color)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

function SetupSwitch({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={`flex min-h-[54px] w-full items-center gap-4 py-2 ${disabled ? 'opacity-40' : ''}`}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
          {label}
          <InfoTip label={label}>{description}</InfoTip>
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface-strong)]'
        } ${disabled ? 'cursor-not-allowed' : 'hover:brightness-110'}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-[3px] h-[18px] w-[18px] rounded-full shadow-sm transition-transform ${
            checked
              ? 'translate-x-[23px] bg-[var(--accent-fg)]'
            : 'translate-x-[3px] bg-[var(--muted)]'
          }`}
        />
      </button>
    </div>
  );
}

function SetupTextField({
  label,
  value,
  placeholder,
  disabled,
  mono = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted)]">{label}</span>
      <span className="relative block">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.currentTarget.blur();
          }}
          disabled={disabled}
          placeholder={placeholder}
          className={`h-10 w-full border-b border-[var(--border)] bg-transparent px-0 pr-9 text-[var(--text-12)] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:border-[var(--accent)] focus:outline-none ${
            mono ? 'font-mono' : ''
          } ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-[var(--border)]'}`}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled}
            aria-label={`Clear ${label.toLowerCase()}`}
            title={`Clear ${label.toLowerCase()}`}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-medium)] text-base leading-none text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ×
          </button>
        ) : null}
      </span>
    </label>
  );
}

export function NewDroneSetupPanel({
  createRuntime,
  onCreateRuntimeChange,
  createAsDraft,
  onCreateAsDraftChange,
  createPersistVolume,
  onCreatePersistVolumeChange,
  draftCreateMode,
  onDraftCreateModeChange,
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
  onDraftCreateNameChange,
  onDraftCreateGroupChange,
  controlsLocked,
}: NewDroneSetupPanelProps) {
  const {
    pullHostBranchBeforeCreate,
    setPullHostBranchBeforeCreate,
    chatHeaderRepoPath,
    setChatHeaderRepoPath,
  } = useDroneHubUiStore(
    useShallow((state) => ({
      pullHostBranchBeforeCreate: state.pullHostBranchBeforeCreate,
      setPullHostBranchBeforeCreate: state.setPullHostBranchBeforeCreate,
      chatHeaderRepoPath: state.chatHeaderRepoPath,
      setChatHeaderRepoPath: state.setChatHeaderRepoPath,
    })),
  );
  const createWithChat = draftCreateMode === 'with-chat';
  const remoteBranchCheckoutEnabled = createRuntime === 'container';

  return (
    <div className="w-full text-left">
      <div className="grid grid-cols-2 border-b border-[var(--border)]" role="tablist" aria-label="Drone creation mode">
        {([
          ['with-chat', 'Start with chat'],
          ['without-chat', 'Empty drone'],
        ] as const).map(([value, label]) => {
          const active = draftCreateMode === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={controlsLocked}
              onClick={() => onDraftCreateModeChange(value)}
              className={`relative h-11 text-[var(--text-11)] font-[var(--weight-semibold)] transition-colors ${
                active
                  ? 'text-[var(--fg)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--accent)]'
                  : 'text-[var(--muted)] hover:text-[var(--fg-secondary)]'
              } ${controlsLocked ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div>
        <section className="py-6">
          <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
            <div>
              <div className="flex items-center gap-1 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
                Runtime
                <InfoTip label="runtime">Containers are isolated and managed by Drone Hub. Host mode runs directly on this device.</InfoTip>
              </div>
            </div>
            <div className="max-w-[420px]">
              <SegmentedToolbarToggle
                label="Runtime"
                hideLabel
                value={createRuntime}
                options={[
                  {
                    value: 'container',
                    label: 'Container',
                    title: 'Create the new drone in a managed container.',
                  },
                  {
                    value: 'host',
                    label: 'Host',
                    title: 'Create the new drone directly on the host machine.',
                  },
                ]}
                onChange={onCreateRuntimeChange}
                disabled={controlsLocked}
              />
            </div>
          </div>
          <div className={`mt-5 grid border-y border-[var(--border-subtle)] ${createRuntime === 'container' ? 'sm:grid-cols-2' : ''}`}>
            {createRuntime === 'container' ? (
              <div className="sm:pr-6">
                <SetupSwitch
                  label="Persist volume"
                  description="Keep /dvm-data between container rebuilds."
                  checked={createPersistVolume}
                  disabled={controlsLocked}
                  onChange={onCreatePersistVolumeChange}
                />
              </div>
            ) : null}
            <div className={createRuntime === 'container' ? 'border-t border-[var(--border-subtle)] sm:border-l sm:border-t-0 sm:pl-6' : ''}>
              <SetupSwitch
                label="Save as draft"
                description="Queue messages until you publish the drone."
                checked={createAsDraft}
                disabled={controlsLocked}
                onChange={onCreateAsDraftChange}
              />
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--border-subtle)] py-6">
          <div className="mb-3">
            <div className="flex items-center gap-1 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
              Name &amp; group
              <InfoTip label="name and group">Both fields are optional and can be changed later. A blank name is generated from the first message.</InfoTip>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SetupTextField
              label="Name"
              value={draftCreateName}
              placeholder={createWithChat ? 'Automatic from first message' : 'Automatic name'}
              disabled={controlsLocked}
              mono
              onChange={onDraftCreateNameChange}
            />
            <SetupTextField
              label="Group"
              value={draftCreateGroup}
              placeholder="No group"
              disabled={controlsLocked}
              onChange={onDraftCreateGroupChange}
            />
          </div>
        </section>

        <section className="border-t border-[var(--border-subtle)] py-6">
          <div className="mb-3">
            <div className="flex items-center gap-1 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
              Repository
              <InfoTip label="repository">Choose the repository where the new drone starts, or leave it unassigned.</InfoTip>
            </div>
          </div>
          <UiMenuSelect
            variant="form"
            value={chatHeaderRepoPath}
            onValueChange={setChatHeaderRepoPath}
            entries={createRepoMenuEntries}
            disabled={controlsLocked}
            panelClassName="w-[380px] max-w-[calc(100vw-3rem)]"
            menuClassName="max-h-[240px] overflow-y-auto"
            title={chatHeaderRepoPath || 'No repo'}
            triggerLabel={chatHeaderRepoPath ? repoPathLabel(chatHeaderRepoPath) : 'No repo'}
            triggerLabelClassName={chatHeaderRepoPath ? 'font-mono text-[var(--text-11)]' : undefined}
          />
        </section>

        {draftCreateRepoPath ? (
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
            appearance="flat"
          />
        ) : null}
      </div>
    </div>
  );
}
