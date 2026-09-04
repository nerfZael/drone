import React from 'react';
import { Tooltip } from 'radix-ui';
import {
  companionProposalOperationLabel,
  companionProposalOperationDetails,
  formatModelDisplayLabel,
  formatReasoningLabel,
  type CompanionProposal,
  type CompanionProposalOperation,
  type CompanionProposalOperationDetail,
  type CompanionProposalExecution,
  type CompanionProposalExecutionItem,
  type CompanionProposalExecutionProgress,
  type CompanionStatus,
} from '@drone/assistant-chat';
import { UiBadge, type UiBadgeTone } from '../../ui/components/Badge';
import type { DesktopNewDronePreferences } from '../app/new-drone-preferences';

const BUILTIN_AGENT_LABELS: Readonly<Record<string, string>> = {
  native: 'Built-in',
  'builtin:cursor': 'Cursor Agent',
  'builtin:codex': 'Codex',
  'builtin:claude': 'Claude Code',
  'builtin:opencode': 'OpenCode',
  'builtin:pi': 'Pi',
  'builtin:blip': 'Blip',
};

function agentDisplayLabel(agent: string | undefined): string {
  if (!agent) return '';
  return BUILTIN_AGENT_LABELS[agent] ?? agent.replace(/^custom:/, '');
}

function ProposalOperationMarker({
  index,
  active,
  outcome,
}: {
  index: number;
  active: boolean;
  outcome?: CompanionProposalExecutionItem;
}) {
  const base = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-[var(--weight-semibold)] leading-none';
  if (active) {
    return (
      <span
        className={`${base} border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]`}
        role="status"
        aria-label={`Applying operation ${index}`}
      >
        <svg className="h-3 w-3 animate-spin motion-reduce:animate-none" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
          <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (outcome?.status === 'completed') {
    return (
      <span
        className={`${base} border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]`}
        aria-label={`Operation ${index} applied`}
        title="Applied"
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 5.2l2 2 4-4.4" />
        </svg>
      </span>
    );
  }
  if (outcome?.status === 'failed') {
    return (
      <span
        className={`${base} border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]`}
        aria-label={`Operation ${index} failed`}
        title="Failed"
      >
        <span aria-hidden="true">×</span>
      </span>
    );
  }
  if (outcome?.status === 'skipped') {
    return (
      <span
        className={`${base} border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)]`}
        aria-label={`Operation ${index} not run`}
        title="Not run"
      >
        <span aria-hidden="true">–</span>
      </span>
    );
  }
  return (
    <span className={`${base} border-[var(--border)] bg-[var(--surface-soft)] text-[var(--fg-secondary)]`}>
      {index}
    </span>
  );
}

type HoverableProposalOperation = Extract<
  CompanionProposalOperation,
  { type: 'send_message' | 'create_drone' }
>;
type CreateDroneOperation = Extract<CompanionProposalOperation, { type: 'create_drone' }>;

function proposalLocation(
  operation: CreateDroneOperation,
  defaultRepoPath: string,
): { repository: string; groupPath: string } {
  const repository = (operation.repoPath ?? defaultRepoPath) || 'No repository';
  const group = operation.group || 'Ungrouped';
  return {
    repository,
    groupPath: repository === 'No repository' ? group : `${repository} / ${group}`,
  };
}

/** A creation setting with its effective value and whether it came from saved defaults. */
type EffectiveSetting = { value: string; isDefault: boolean };

type EffectiveCreationSettings = {
  runtime: EffectiveSetting;
  persistVolume: EffectiveSetting;
  branchSource: EffectiveSetting;
  remoteBranch: EffectiveSetting | null;
  agent: EffectiveSetting;
  provider: EffectiveSetting | null;
  model: EffectiveSetting;
  reasoning: EffectiveSetting;
  agentPermissionMode: EffectiveSetting;
  approvalPolicy: EffectiveSetting;
};

const UNRESOLVED_DEFAULT = 'Saved default';

function effectiveCreationSettings(
  operation: CreateDroneOperation,
  defaults: DesktopNewDronePreferences | null,
): EffectiveCreationSettings {
  const pick = (explicit: string | undefined, fallback: string | undefined): EffectiveSetting =>
    explicit
      ? { value: explicit, isDefault: false }
      : { value: fallback || (defaults ? '' : UNRESOLVED_DEFAULT), isDefault: true };
  const persistVolume = operation.persistVolume === undefined
    ? {
        value: defaults ? (defaults.persistVolume ? 'On' : 'Off') : UNRESOLVED_DEFAULT,
        isDefault: true,
      }
    : { value: operation.persistVolume ? 'On' : 'Off', isDefault: false };
  const branchSource = operation.repoBranchSource || (operation.remoteBranch ? 'remote' : undefined);
  return {
    runtime: pick(operation.runtime, defaults?.runtime),
    persistVolume,
    branchSource: pick(branchSource, defaults?.repoBranchSource),
    remoteBranch: operation.remoteBranch
      ? { value: operation.remoteBranch, isDefault: false }
      : defaults?.repoCreateRemoteBranch
        ? { value: defaults.repoCreateRemoteBranch, isDefault: true }
        : null,
    agent: pick(operation.agent, defaults?.spawnAgentKey),
    provider: operation.provider ? { value: operation.provider, isDefault: false } : null,
    model: pick(operation.model, defaults?.spawnModel),
    reasoning: pick(operation.reasoning, defaults?.spawnReasoning),
    agentPermissionMode: pick(operation.agentPermissionMode, defaults?.spawnAgentPermissionMode),
    approvalPolicy: pick(operation.approvalPolicy, defaults?.spawnApprovalPolicy),
  };
}

function runtimeLabel(value: string): string {
  if (value === 'container') return 'Container';
  if (value === 'host') return 'Host';
  return value;
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

/** Detail rows for a create_drone step, with inherited values resolved and marked "(default)". */
export function creationDetailRows(
  defaultRepoPath: string,
  operation: CreateDroneOperation,
  defaults: DesktopNewDronePreferences | null,
): CompanionProposalOperationDetail[] {
  return creationDetailRowsFromSettings(
    operation,
    defaultRepoPath,
    effectiveCreationSettings(operation, defaults),
  );
}

function creationDetailRowsFromSettings(
  operation: CreateDroneOperation,
  defaultRepoPath: string,
  settings: EffectiveCreationSettings,
): CompanionProposalOperationDetail[] {
  const location = proposalLocation(operation, defaultRepoPath);
  const show = (setting: EffectiveSetting | null, format: (value: string) => string = (v) => v) => {
    if (!setting) return null;
    if (setting.value === UNRESOLVED_DEFAULT) return UNRESOLVED_DEFAULT;
    const text = setting.value ? format(setting.value) : 'Not set';
    return setting.isDefault ? `${text} (default)` : text;
  };
  const rows: Array<[string, string | null]> = [
    ['Repository', location.repository],
    ['Group', operation.group || 'Ungrouped'],
    ['Runtime', show(settings.runtime, runtimeLabel)],
    ['Persist volume', show(settings.persistVolume)],
    ['Branch source', show(settings.branchSource, capitalize)],
    ['Remote branch', show(settings.remoteBranch)],
    ['Agent', show(settings.agent, agentDisplayLabel)],
    ['Provider', show(settings.provider)],
    ['Model', show(settings.model, formatModelDisplayLabel)],
    ['Reasoning', show(settings.reasoning, (v) => formatReasoningLabel(v) || v)],
    ['Agent permissions', show(settings.agentPermissionMode, capitalize)],
    ['Approval policy', show(settings.approvalPolicy, capitalize)],
  ];
  return rows.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
}

function ProposalOperationHoverCard({
  operation,
  defaultRepoPath,
  droneLabel,
  children,
}: {
  operation: HoverableProposalOperation;
  defaultRepoPath: string;
  droneLabel(droneId: string): string;
  children: React.ReactElement;
}) {
  const createLocation = operation.type === 'create_drone'
    ? proposalLocation(operation, defaultRepoPath)
    : null;
  const title = operation.type === 'send_message'
    ? `Message to ${droneLabel(operation.droneId)} / ${operation.chatName ?? 'default'}`
    : companionProposalOperationLabel(operation);
  const content = operation.type === 'send_message' ? operation.message : operation.prompt;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="left"
          align="center"
          sideOffset={10}
          collisionPadding={12}
          className="z-[200] max-h-[min(32rem,calc(100vh-1.5rem))] w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-overlay)] p-3 text-left shadow-[var(--edge-highlight),var(--shadow-menu)]"
        >
          <div className="text-xs font-[var(--weight-semibold)] text-[var(--fg)]">{title}</div>
          {createLocation ? (
            <dl className="mt-2 space-y-2 text-[11px]">
              <div>
                <dt className="font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">
                  Group path
                </dt>
                <dd className="mt-0.5 break-all text-[var(--fg-secondary)]">
                  {createLocation.groupPath}
                </dd>
              </div>
              <div>
                <dt className="font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">
                  Repository
                </dt>
                <dd className="mt-0.5 break-all text-[var(--fg-secondary)]">
                  {createLocation.repository}
                </dd>
              </div>
            </dl>
          ) : null}
          <div className="mt-2 text-[11px] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">
            {operation.type === 'send_message' ? 'Full message' : 'Full initial message'}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--fg-secondary)]">
            {content}
          </div>
          <Tooltip.Arrow className="fill-[var(--border-subtle)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Pill({ tone = 'neutral', title, children }: { tone?: UiBadgeTone; title?: string; children: React.ReactNode }) {
  return (
    <UiBadge tone={tone} title={title} className="h-[18px] px-1.5 text-[10px]">
      {children}
    </UiBadge>
  );
}

/** A creation setting pill: explicit overrides get color, inherited defaults stay quiet. */
function SettingPill({
  setting,
  label,
  tone,
  format = (value) => value,
}: {
  setting: EffectiveSetting | null;
  label: string;
  tone: UiBadgeTone;
  format?(value: string): string;
}) {
  if (!setting || !setting.value || setting.value === UNRESOLVED_DEFAULT) return null;
  return (
    <Pill
      tone={setting.isDefault ? 'neutral' : tone}
      title={setting.isDefault ? `${label} (saved default)` : label}
    >
      {format(setting.value)}
    </Pill>
  );
}

function Name({ children }: { children: React.ReactNode }) {
  return <span className="font-[var(--weight-medium)] text-[var(--fg)]">{children}</span>;
}

const ACTION_TONE_CLASS: Record<'create' | 'delete' | 'clone' | 'rename' | 'message', string> = {
  create: 'text-[var(--green)]',
  delete: 'text-[var(--red)]',
  clone: 'text-[var(--accent)]',
  rename: 'text-[var(--yellow)]',
  message: 'text-[var(--info)]',
};

function Action({ kind, children }: { kind: keyof typeof ACTION_TONE_CLASS; children: React.ReactNode }) {
  return (
    <span className={`font-[var(--weight-semibold)] ${ACTION_TONE_CLASS[kind]}`}>{children}</span>
  );
}

/** Operation headline: a fixed, colored action verb followed by what it applies to. */
function OperationHeadline({
  operation,
  droneLabel,
}: {
  operation: CompanionProposalOperation;
  droneLabel(droneId: string): string;
}) {
  const drone = 'droneId' in operation ? droneLabel(operation.droneId) : '';
  switch (operation.type) {
    case 'create_group':
      return <><Action kind="create">Create group</Action> <Name>{operation.name}</Name></>;
    case 'delete_group':
      return <><Action kind="delete">Delete group</Action> <Name>{operation.name}</Name> and its contents</>;
    case 'rename_group':
      return <><Action kind="rename">Rename group</Action> <Name>{operation.name}</Name> to <Name>{operation.newName}</Name></>;
    case 'create_drone':
      return (
        <>
          <Action kind="create">{operation.draft ? 'Create draft drone' : 'Create drone'}</Action>
          {operation.name ? <> <Name>{operation.name}</Name></> : null}
        </>
      );
    case 'clone_drone':
      return <><Action kind="clone">Clone drone</Action> <Name>{operation.sourceDroneId}</Name> as <Name>{operation.name}</Name></>;
    case 'delete_drone':
      return <><Action kind="delete">Delete drone</Action> <Name>{drone}</Name></>;
    case 'rename_drone':
      return <><Action kind="rename">Rename drone</Action> <Name>{drone}</Name> to <Name>{operation.newName}</Name></>;
    case 'create_chat':
      return <><Action kind="create">{operation.draft ? 'Create draft chat' : 'Create chat'}</Action> <Name>{operation.chatName}</Name> in <Name>{drone}</Name></>;
    case 'clone_chat':
      return <><Action kind="clone">Clone chat</Action> <Name>{operation.sourceChat}</Name> as <Name>{operation.chatName}</Name> in <Name>{drone}</Name></>;
    case 'delete_chat':
      return <><Action kind="delete">Delete chat</Action> <Name>{operation.chatName}</Name> from <Name>{drone}</Name></>;
    case 'rename_chat':
      return <><Action kind="rename">Rename chat</Action> <Name>{operation.chatName}</Name> to <Name>{operation.newName}</Name></>;
    case 'send_message':
      return <><Action kind="message">Send message</Action> to <Name>{drone}</Name></>;
  }
}

function failureStatus(
  execution: CompanionProposalExecution | null,
  completedCount: number,
): { tone: 'warning' | 'danger'; label: string } | null {
  if (!execution || execution.ok) return null;
  if (completedCount > 0) return { tone: 'warning', label: 'Partially applied' };
  return { tone: 'danger', label: 'Apply failed' };
}

const STATUS_PILL_CLASS: Record<'warning' | 'danger', string> = {
  warning: 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
  danger: 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]',
};

export function CompanionProposalCard({
  proposal,
  defaultRepoPath,
  execution,
  executionProgress = null,
  executing,
  companionStatus,
  droneNames = {},
  resolveDroneName,
  resolveCreationDefaults,
  onExecute,
  onDiscard,
}: {
  proposal: CompanionProposal;
  defaultRepoPath: string;
  execution: CompanionProposalExecution | null;
  executionProgress?: CompanionProposalExecutionProgress | null;
  executing: boolean;
  companionStatus: CompanionStatus;
  droneNames?: Readonly<Record<string, string>>;
  resolveDroneName?(droneId: string): string | null;
  /** Saved new-drone preferences for a repository, used to show inherited values. */
  resolveCreationDefaults?(repoPath: string): DesktopNewDronePreferences | null;
  onExecute(): void;
  onDiscard(): void;
}) {
  const [expandedOperationIds, setExpandedOperationIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const operationResult = React.useMemo(
    () => new Map((execution?.operations ?? executionProgress?.operations ?? []).map((item) => [item.id, item])),
    [execution, executionProgress],
  );
  const companionBusy = ['starting', 'recording', 'transcribing', 'working'].includes(
    companionStatus,
  );
  const completedCount = execution?.operations.filter((item) => item.status === 'completed').length ?? 0;
  const applyDisabled =
    executing || companionBusy || proposal.operations.length === 0 || execution !== null;
  const status = failureStatus(execution, completedCount);
  const [descriptionOpen, setDescriptionOpen] = React.useState(false);
  /** 1-based step number of the create/clone operation an `$id` drone reference points at. */
  const stepIndexByOperationId = React.useMemo(
    () => new Map(proposal.operations.map((operation, index) => [operation.id, index + 1])),
    [proposal.operations],
  );
  const creationDefaults = React.useMemo(() => {
    const byRepo = new Map<string, DesktopNewDronePreferences | null>();
    for (const operation of proposal.operations) {
      if (operation.type !== 'create_drone') continue;
      const repoPath = operation.repoPath ?? defaultRepoPath;
      if (!byRepo.has(repoPath)) {
        byRepo.set(repoPath, resolveCreationDefaults?.(repoPath) ?? null);
      }
    }
    return byRepo;
  }, [defaultRepoPath, proposal.operations, resolveCreationDefaults]);
  const droneLabel = React.useCallback((droneId: string) => {
    if (droneId.startsWith('$')) {
      const created = proposal.operations.find(
        (operation) =>
          (operation.type === 'create_drone' || operation.type === 'clone_drone') &&
          operation.id === droneId.slice(1),
      );
      if (created?.type === 'create_drone') return created.name || 'New drone';
      if (created?.type === 'clone_drone') return created.name;
    }
    return droneNames[droneId] || resolveDroneName?.(droneId) || droneId;
  }, [droneNames, proposal.operations, resolveDroneName]);
  const createdInStep = React.useCallback((droneId: string): number | null => {
    if (!droneId.startsWith('$')) return null;
    return stepIndexByOperationId.get(droneId.slice(1)) ?? null;
  }, [stepIndexByOperationId]);
  const toggleOperationDetails = React.useCallback((operationId: string) => {
    setExpandedOperationIds((current) => {
      const next = new Set(current);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  }, []);

  // The Apply button already reads "Applying…" / "Applied"; the pill only adds
  // information when the apply went wrong.
  const statusPill = status ? (
    <div className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-[var(--weight-medium)] ${STATUS_PILL_CLASS[status.tone]}`}>
      {status.label}
    </div>
  ) : null;

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
      <aside
        className="flex max-h-[min(36rem,calc(100vh-2rem))] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl min-[860px]:w-[22rem] min-[1100px]:w-[26rem]"
        aria-label="Companion proposal"
      >
      <div className="dh-agent-activity-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {proposal.operations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs text-[var(--muted)]">
            Companion has not added any operations yet.
          </div>
        ) : (
          <ol className="space-y-0">
            {proposal.operations.map((operation, index) => {
              const outcome = operationResult.get(operation.id);
              const isMessage = operation.type === 'send_message';
              const isCreateDrone = operation.type === 'create_drone';
              const isLast = index === proposal.operations.length - 1;
              const createSettings = isCreateDrone
                ? effectiveCreationSettings(
                    operation,
                    creationDefaults.get(operation.repoPath ?? defaultRepoPath) ?? null,
                  )
                : null;
              const details: CompanionProposalOperationDetail[] = isCreateDrone && createSettings
                ? creationDetailRowsFromSettings(operation, defaultRepoPath, createSettings)
                : isMessage
                  ? []
                  : companionProposalOperationDetails(operation, defaultRepoPath);
              const createLocation = isCreateDrone
                ? proposalLocation(operation, defaultRepoPath)
                : null;
              const operationLabel = companionProposalOperationLabel(
                operation,
                'droneId' in operation ? droneLabel(operation.droneId) : '',
              );
              const detailsExpanded = expandedOperationIds.has(operation.id);
              const targetStep = 'droneId' in operation ? createdInStep(operation.droneId) : null;
              const targetStepPill = targetStep !== null ? (
                <Pill tone="accent" title={`Targets the drone created in step ${targetStep}`}>
                  ↑ Step {targetStep}
                </Pill>
              ) : null;
              const headline = (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-snug text-[var(--fg-secondary)]">
                  <span><OperationHeadline operation={operation} droneLabel={droneLabel} /></span>
                  {targetStepPill}
                  {isMessage && operation.chatName && operation.chatName !== 'default' ? (
                    <Pill title="Chat">{operation.chatName}</Pill>
                  ) : null}
                  {isMessage && operation.delivery === 'asap' ? (
                    <Pill tone="warning" title="Delivered right away, interrupting whatever the drone is doing">
                      Send immediately
                    </Pill>
                  ) : null}
                </div>
              );
              const summaryContent = (
                <>
                  {headline}
                  {isMessage ? (
                    <blockquote className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words border-l-2 border-[var(--info-border)] pl-2.5 text-xs leading-relaxed text-[var(--fg)]">
                      {operation.message}
                    </blockquote>
                  ) : null}
                  {isCreateDrone && createSettings ? (
                    <>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <SettingPill setting={createSettings.runtime} label="Runtime" tone="neutral" format={runtimeLabel} />
                        <SettingPill setting={createSettings.agent} label="Agent" tone="accent" format={agentDisplayLabel} />
                        {createSettings.model.value && createSettings.model.value !== UNRESOLVED_DEFAULT ? (
                          <Pill
                            tone={createSettings.model.isDefault && createSettings.reasoning.isDefault ? 'neutral' : 'info'}
                            title={[
                              `Model${createSettings.model.isDefault ? ' (saved default)' : ''}`,
                              createSettings.reasoning.value && createSettings.reasoning.value !== UNRESOLVED_DEFAULT
                                ? `Reasoning${createSettings.reasoning.isDefault ? ' (saved default)' : ''}`
                                : '',
                            ].filter(Boolean).join(' · ')}
                          >
                            {formatModelDisplayLabel(createSettings.model.value)}
                            {createSettings.reasoning.value && createSettings.reasoning.value !== UNRESOLVED_DEFAULT
                              ? ` · ${formatReasoningLabel(createSettings.reasoning.value) || createSettings.reasoning.value}`
                              : ''}
                          </Pill>
                        ) : null}
                      </div>
                      <div className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--fg-secondary)]">
                        {operation.prompt}
                      </div>
                      <div className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] text-[var(--muted)]">
                        <svg className="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
                          <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h2.2l1 1.2h3.8a1 1 0 0 1 1 1v4.3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1z" />
                        </svg>
                        <span className="truncate">{createLocation?.groupPath}</span>
                      </div>
                    </>
                  ) : null}
                </>
              );
              const summary = details.length > 0 ? (
                <button
                  type="button"
                  className="relative block w-full min-w-0 appearance-none rounded-sm bg-transparent p-0 pr-5 text-left outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  aria-expanded={detailsExpanded}
                  aria-controls={`proposal-operation-details-${operation.id}`}
                  aria-label={`${
                    isCreateDrone
                      ? `Preview full initial message and group path for ${operation.name || 'new drone'}; `
                      : ''
                  }${detailsExpanded ? 'hide' : 'review'} details for ${operationLabel}`}
                  onClick={() => toggleOperationDetails(operation.id)}
                >
                  {summaryContent}
                  <svg
                    className={`absolute right-0 top-1 h-3 w-3 text-[var(--muted)] transition-transform ${
                      detailsExpanded ? 'rotate-90' : ''
                    }`}
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m3.5 2 3 3-3 3" />
                  </svg>
                </button>
              ) : (
                <div
                  className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  tabIndex={isMessage || isCreateDrone ? 0 : undefined}
                  aria-label={isMessage
                    ? `Preview full message to ${droneLabel(operation.droneId)}`
                    : isCreateDrone
                      ? `Preview full initial message and group path for ${operation.name || 'new drone'}`
                      : undefined}
                >
                  {summaryContent}
                </div>
              );
              return (
                <li key={operation.id} className="relative flex gap-3 pb-4 last:pb-0">
                  <div className="relative flex shrink-0 flex-col items-center">
                    <ProposalOperationMarker
                      index={index + 1}
                      active={executing && executionProgress?.activeOperationId === operation.id}
                      outcome={outcome}
                    />
                    {!isLast ? (
                      <span
                        className="mt-1 w-px flex-1 bg-[var(--border-subtle)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    {isMessage || isCreateDrone ? (
                      <ProposalOperationHoverCard
                        operation={operation}
                        defaultRepoPath={defaultRepoPath}
                        droneLabel={droneLabel}
                      >
                        {summary}
                      </ProposalOperationHoverCard>
                    ) : (
                      summary
                    )}
                    {details.length > 0 && detailsExpanded ? (
                      <dl
                        id={`proposal-operation-details-${operation.id}`}
                        className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-[var(--surface-soft)] px-2.5 py-2 text-[11px]"
                      >
                        {details.map((detail) => (
                          <React.Fragment key={detail.label}>
                            <dt className="text-[var(--muted-dim)]">{detail.label}</dt>
                            <dd className="max-h-40 min-w-0 overflow-auto whitespace-pre-wrap break-words text-[var(--fg-secondary)]">
                              {detail.value}
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    ) : null}
                    {outcome && outcome.status !== 'completed' ? (
                      <div className={`mt-1.5 text-[11px] ${outcome.status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--muted-dim)]'}`}>
                        {outcome.status === 'skipped' ? 'Not run' : outcome.error || 'Failed'}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {proposal.summary ? (
              <button
                type="button"
                className="flex min-w-0 cursor-pointer items-center gap-1 rounded-sm bg-transparent p-0 text-left text-[11px] font-[var(--weight-medium)] leading-snug text-[var(--muted)] outline-none hover:text-[var(--fg-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                aria-expanded={descriptionOpen}
                aria-controls="proposal-description"
                title={descriptionOpen ? 'Hide description' : 'Show description'}
                onClick={() => setDescriptionOpen((open) => !open)}
              >
                <span className="min-w-0 truncate">{proposal.title}</span>
                <svg
                  className={`h-2.5 w-2.5 shrink-0 text-[var(--muted-dim)] transition-transform ${descriptionOpen ? 'rotate-90' : ''}`}
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m3.5 2 3 3-3 3" />
                </svg>
              </button>
            ) : (
              <div className="min-w-0 truncate text-[11px] font-[var(--weight-medium)] leading-snug text-[var(--muted)]">
                {proposal.title}
              </div>
            )}
            {statusPill}
          </div>
          <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={executing}
          className="rounded-md px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onExecute}
          disabled={applyDisabled}
          className="inline-flex min-h-8 items-center rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-xs font-[var(--weight-bold)] text-[var(--accent-fg)] shadow-sm transition-[filter,opacity] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-border)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {executing
            ? 'Applying…'
            : execution?.ok
              ? 'Applied'
              : execution
                ? 'Discard to retry'
                : 'Apply proposal'}
        </button>
          </div>
        </div>
        {proposal.summary && descriptionOpen ? (
          <div id="proposal-description" className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
            {proposal.summary}
          </div>
        ) : null}
      </div>
      </aside>
    </Tooltip.Provider>
  );
}
