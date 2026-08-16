import React from 'react';
import { Tooltip } from 'radix-ui';
import {
  companionProposalOperationLabel,
  companionProposalOperationDetails,
  type CompanionProposal,
  type CompanionProposalOperation,
  type CompanionProposalExecution,
  type CompanionProposalExecutionItem,
  type CompanionProposalExecutionProgress,
  type CompanionStatus,
} from '@drone/assistant-chat';

function ProposalOperationMarker({
  index,
  active,
  outcome,
}: {
  index: number;
  active: boolean;
  outcome?: CompanionProposalExecutionItem;
}) {
  const className = 'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--panel-hover)]';
  if (active) {
    return (
      <span className={`${className} text-[var(--accent)]`} role="status" aria-label={`Applying operation ${index}`}>
        <svg className="h-3 w-3 animate-spin motion-reduce:animate-none" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
          <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (outcome?.status === 'completed') {
    return (
      <span className={`${className} text-[var(--green)]`} aria-label={`Operation ${index} applied`} title="Applied">
        <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 5.2l2 2 4-4.4" />
        </svg>
      </span>
    );
  }
  if (outcome?.status === 'failed') {
    return (
      <span className={`${className} text-[var(--red)]`} aria-label={`Operation ${index} failed`} title="Failed">
        <span aria-hidden="true">×</span>
      </span>
    );
  }
  if (outcome?.status === 'skipped') {
    return (
      <span className={`${className} text-[var(--muted-dim)]`} aria-label={`Operation ${index} not run`} title="Not run">
        <span aria-hidden="true">–</span>
      </span>
    );
  }
  return <span className={`${className} text-[9px] text-[var(--muted)]`}>{index}</span>;
}

type HoverableProposalOperation = Extract<
  CompanionProposalOperation,
  { type: 'send_message' | 'create_drone' }
>;

function proposalLocation(
  operation: Extract<CompanionProposalOperation, { type: 'create_drone' }>,
  defaultRepoPath: string,
): { repository: string; groupPath: string } {
  const repository = (operation.repoPath ?? defaultRepoPath) || 'No repository';
  const group = operation.group || 'Ungrouped';
  return {
    repository,
    groupPath: repository === 'No repository' ? group : `${repository} / ${group}`,
  };
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
            <dl className="mt-2 space-y-2 text-[10px]">
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
          <div className="mt-2 text-[10px] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">
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

export function CompanionProposalCard({
  proposal,
  defaultRepoPath,
  execution,
  executionProgress = null,
  executing,
  companionStatus,
  droneNames = {},
  resolveDroneName,
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
  onExecute(): void;
  onDiscard(): void;
}) {
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
  const droneLabel = React.useCallback((droneId: string) => {
    if (droneId.startsWith('$')) {
      const created = proposal.operations.find(
        (operation) => operation.type === 'create_drone' && operation.id === droneId.slice(1),
      );
      if (created?.type === 'create_drone') return created.name || 'New drone';
    }
    return droneNames[droneId] || resolveDroneName?.(droneId) || droneId;
  }, [droneNames, proposal.operations, resolveDroneName]);

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
      <aside
        className="flex max-h-[min(34rem,calc(100vh-2rem))] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] shadow-2xl min-[860px]:w-80"
        aria-label="Companion proposal"
      >
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-[var(--weight-semibold)] uppercase tracking-[0.1em] text-[var(--muted)]">
            Proposal
          </div>
          <div className={`text-[10px] ${execution?.ok ? 'text-[var(--green)]' : execution ? 'text-[var(--red)]' : 'text-[var(--muted-dim)]'}`}>
            {executing
              ? 'Applying…'
              : execution?.ok
                ? 'Applied'
                : execution
                  ? completedCount > 0 ? 'Partially applied' : 'Apply failed'
                  : 'Ready for review'}
          </div>
        </div>
        <div className="mt-1 text-sm font-[var(--weight-semibold)] text-[var(--fg)]">
          {proposal.title}
        </div>
        {proposal.summary ? (
          <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            {proposal.summary}
          </div>
        ) : null}
      </div>

      <div className="dh-agent-activity-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {proposal.operations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs text-[var(--muted)]">
            Companion has not added any operations yet.
          </div>
        ) : (
          <ol className="divide-y divide-[var(--border-subtle)]">
            {proposal.operations.map((operation, index) => {
              const outcome = operationResult.get(operation.id);
              const details = operation.type === 'send_message' || operation.type === 'create_drone'
                ? []
                : companionProposalOperationDetails(operation, defaultRepoPath);
              const isMessage = operation.type === 'send_message';
              const isCreateDrone = operation.type === 'create_drone';
              const createLocation = isCreateDrone
                ? proposalLocation(operation, defaultRepoPath)
                : null;
              const summary = (
                <div
                  className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  tabIndex={isMessage || isCreateDrone ? 0 : undefined}
                  aria-label={isMessage
                    ? `Preview full message to ${droneLabel(operation.droneId)}`
                    : isCreateDrone
                      ? `Preview full initial message and group path for ${operation.name || 'new drone'}`
                      : undefined}
                >
                  {isMessage ? (
                    <>
                      <div className="truncate text-[10px] text-[var(--muted)]">
                        Message to{' '}
                        <span className="font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
                          {droneLabel(operation.droneId)}
                        </span>
                        <span className="text-[var(--muted-dim)]">
                          {' '}· {operation.chatName ?? 'default'}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--fg)]">
                        {operation.message}
                      </div>
                    </>
                  ) : isCreateDrone ? (
                    <>
                      <div className="text-xs leading-snug text-[var(--fg-secondary)]">
                        {companionProposalOperationLabel(operation)}
                      </div>
                      <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[var(--muted)]">
                        {operation.prompt}
                      </div>
                      <div className="mt-1 truncate text-[10px] text-[var(--muted-dim)]">
                        {createLocation?.groupPath}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs leading-snug text-[var(--fg-secondary)]">
                      {companionProposalOperationLabel(
                        operation,
                        'droneId' in operation ? droneLabel(operation.droneId) : '',
                      )}
                    </div>
                  )}
                </div>
              );
              return (
                <li
                  key={operation.id}
                  className="py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start gap-2">
                    <ProposalOperationMarker
                      index={index + 1}
                      active={executing && executionProgress?.activeOperationId === operation.id}
                      outcome={outcome}
                    />
                    <div className="min-w-0 flex-1">
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
                      {details.length > 0 ? (
                        <details className="mt-1 text-[10px] text-[var(--muted)]">
                          <summary className="cursor-pointer select-none">Review details</summary>
                          <dl className="mt-1 space-y-1 border-l border-[var(--border-subtle)] pl-2">
                            {details.map((detail) => (
                              <div key={detail.label}>
                                <dt className="font-[var(--weight-semibold)] text-[var(--muted-dim)]">
                                  {detail.label}
                                </dt>
                                <dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[var(--fg-secondary)]">
                                  {detail.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : null}
                      {outcome && outcome.status !== 'completed' ? (
                        <div className={`mt-1 text-[10px] ${outcome.status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--muted-dim)]'}`}>
                          {outcome.status === 'skipped' ? 'Not run' : outcome.error || 'Failed'}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-3 py-3">
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
      </aside>
    </Tooltip.Provider>
  );
}
