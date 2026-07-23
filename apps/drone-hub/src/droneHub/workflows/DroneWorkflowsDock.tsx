import React from 'react';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  deleteWorkflow,
  deleteWorkflowRun,
  denyWorkflowRun,
  loadWorkflowInvocations,
  loadWorkflowRuns,
  loadWorkflows,
  requestWorkflowRun,
  workflowEventUrl,
} from './workflow-api';
import { WorkflowDefinitionView } from './WorkflowDefinitionView';
import {
  ACTIVE_WORKFLOW_RUN_STATUSES,
  TERMINAL_WORKFLOW_RUN_STATUSES,
  workflowStatusClass,
  workflowStatusLabel,
  workflowTimeLabel,
} from './workflow-presentation';
import type { DroneWorkflow, WorkflowInvocation, WorkflowRun } from './workflow-types';

type Props = {
  droneId: string;
  disabled?: boolean;
  onOpenChat: (droneId: string, chatName: string) => void;
};

type WorkflowLiveStatus = 'connecting' | 'connected' | 'disconnected';

function WorkflowGlyph({ active = false }: { active?: boolean }) {
  return (
    <svg
      className={`h-7 w-7 flex-none ${active ? 'text-[var(--accent)]' : 'text-[var(--muted-dim)]'}`}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <path d="M7 8.5h6.5c2.2 0 3.5 1.15 3.5 3.35v4.3" stroke="currentColor" strokeWidth="1.25" />
      <path d="M7 19.5h4c2 0 3-1.05 3-3.05v-1.2" stroke="currentColor" strokeWidth="1.25" />
      <rect
        x="3.5"
        y="5.5"
        width="5.5"
        height="5.5"
        rx="1.25"
        fill="var(--panel-overlay)"
        stroke="currentColor"
      />
      <rect
        x="3.5"
        y="16.5"
        width="5.5"
        height="5.5"
        rx="1.25"
        fill="var(--panel-overlay)"
        stroke="currentColor"
      />
      <rect
        x="15.5"
        y="14"
        width="6"
        height="6"
        rx="1.25"
        fill="var(--panel-overlay)"
        stroke="currentColor"
      />
      <path
        d="m20.5 12.5 2 1.5-2 1.5"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function workflowStatusDot(status: string | undefined): string {
  if (status === 'completed') return 'bg-[var(--green)]';
  if (status === 'failed' || status === 'cancelled' || status === 'denied') {
    return 'bg-[var(--red)]';
  }
  if (status) return 'bg-[var(--accent)]';
  return 'bg-[var(--muted-dim)]';
}

export function DroneWorkflowsDock({ droneId, disabled, onOpenChat }: Props) {
  const confirm = useAppConfirmDialog();
  const [workflows, setWorkflows] = React.useState<DroneWorkflow[]>([]);
  const [runs, setRuns] = React.useState<WorkflowRun[]>([]);
  const [invocations, setInvocations] = React.useState<WorkflowInvocation[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = React.useState('');
  const [selectedRunId, setSelectedRunId] = React.useState('');
  const [inputText, setInputText] = React.useState('{}');
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [liveStatus, setLiveStatus] = React.useState<WorkflowLiveStatus>('connecting');
  const refreshRequestRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    try {
      const [nextWorkflows, nextRuns] = await Promise.all([
        loadWorkflows(droneId),
        loadWorkflowRuns(droneId),
      ]);
      if (requestId !== refreshRequestRef.current) return;
      setWorkflows(nextWorkflows);
      setRuns(nextRuns);
      setSelectedWorkflowId((current) =>
        nextWorkflows.some((workflow) => workflow.id === current) ? current : '',
      );
      setSelectedRunId((current) =>
        nextRuns.some((run) => run.id === current) ? current : '',
      );
      setError(null);
    } catch (cause) {
      if (requestId !== refreshRequestRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestId === refreshRequestRef.current) setLoading(false);
    }
  }, [droneId]);

  React.useEffect(() => {
    setLoading(true);
    setSelectedWorkflowId('');
    setSelectedRunId('');
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    setLiveStatus('connecting');
    const stream = new EventSource(workflowEventUrl(droneId));
    stream.addEventListener('connected', () => setLiveStatus('connected'));
    stream.addEventListener('workflow_change', () => void refresh());
    stream.onerror = () => setLiveStatus('disconnected');
    return () => stream.close();
  }, [droneId, refresh]);

  React.useEffect(() => {
    if (!selectedRunId) {
      setInvocations([]);
      return;
    }
    let cancelled = false;
    void loadWorkflowInvocations(droneId, selectedRunId)
      .then((nextInvocations) => {
        if (!cancelled) setInvocations(nextInvocations);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [droneId, selectedRunId, runs]);

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedWorkflowRuns = React.useMemo(
    () => (selectedWorkflow ? runs.filter((run) => run.workflowId === selectedWorkflow.id) : []),
    [runs, selectedWorkflow],
  );
  const selectedRun = selectedWorkflowRuns.find((run) => run.id === selectedRunId) ?? null;

  React.useEffect(() => {
    if (!selectedWorkflow) return;
    if (selectedRunId && selectedWorkflowRuns.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(selectedWorkflowRuns[0]?.id ?? '');
  }, [selectedRunId, selectedWorkflow, selectedWorkflowRuns]);

  const action = async (work: () => Promise<unknown>) => {
    setWorking(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  const runSelectedWorkflow = async () => {
    if (!selectedWorkflow) return;
    let input: unknown;
    try {
      input = JSON.parse(inputText);
    } catch {
      setError('Workflow input must be valid JSON.');
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const pending = await requestWorkflowRun(droneId, selectedWorkflow.id, input);
      setSelectedRunId(pending.id);
      const permissionSummary = pending.plan.permissions.join(', ') || 'no permissions';
      const estimate =
        pending.plan.invocationCountEstimate == null
          ? 'dynamic invocation count'
          : `${pending.plan.invocationCountEstimate} estimated invocation${pending.plan.invocationCountEstimate === 1 ? '' : 's'}`;
      const runnerKinds = pending.plan.runnerKinds ?? [];
      const runnerSummary =
        runnerKinds.includes('drone') && runnerKinds.includes('drone-chat')
          ? 'creates hidden chats and child drones'
          : runnerKinds.includes('drone')
            ? 'creates hidden child drones'
            : 'creates hidden chats';
      const agentSummary = pending.plan.agentIds?.join(' and ') || 'configured agents';
      const accepted = await confirm({
        title: `Run ${selectedWorkflow.name}?`,
        message: `${estimate}; ${runnerSummary} using ${agentSummary}; concurrency ${pending.plan.maxConcurrency}; timeout ${pending.plan.timeoutMinutes} minutes; permissions: ${permissionSummary}.`,
        confirmLabel: 'Approve & run',
      });
      if (accepted) await approveWorkflowRun(droneId, pending.id);
      else await denyWorkflowRun(droneId, pending.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  const removeSelectedWorkflow = async () => {
    if (!selectedWorkflow) return;
    const accepted = await confirm({
      title: `Delete ${selectedWorkflow.name}?`,
      message:
        'This permanently deletes the workflow, retained runs, and every agent chat or child drone created by those runs.',
      confirmLabel: 'Delete workflow',
      destructive: true,
    });
    if (accepted) await action(() => deleteWorkflow(droneId, selectedWorkflow.id));
  };

  const removeSelectedRun = async () => {
    if (!selectedRun) return;
    const accepted = await confirm({
      title: 'Delete this workflow run?',
      message:
        'The run history and all agent chats or child drones created by this run will be permanently deleted.',
      confirmLabel: 'Delete run',
      destructive: true,
    });
    if (accepted) await action(() => deleteWorkflowRun(droneId, selectedRun.id));
  };

  return (
    <div className="dh-workflows-dock flex h-full min-h-0 flex-col overflow-hidden bg-[var(--panel)]">
      {error ? (
        <div className="flex-shrink-0 border-b border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      {liveStatus === 'disconnected' ? (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--yellow-border)] bg-[var(--yellow-subtle)] px-3 py-1.5 text-[var(--text-9)] text-[var(--yellow)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--yellow)]" />
          Live updates are unavailable. Changes may be delayed.
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto rounded px-2 py-0.5 font-[var(--weight-semibold)] uppercase tracking-wide hover:bg-[var(--surface-strong)]"
          >
            Refresh now
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-12)] text-[var(--muted)]">
          Loading workflows...
        </div>
      ) : workflows.length === 0 ? (
        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8 text-center">
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(var(--canvas-dot-rgb), .12) 0.6px, transparent 0.8px)',
              backgroundSize: '28px 28px',
            }}
          />
          <div className="relative max-w-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel-overlay)] shadow-[0_14px_32px_var(--shadow-color)]">
              <WorkflowGlyph />
            </div>
            <div className="mt-4 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
              No workflow graph yet
            </div>
            <p className="mt-1 text-[var(--text-11)] leading-relaxed text-[var(--muted)]">
              This drone’s agent can create one with the DroneHub MCP workflow tools.
            </p>
          </div>
        </div>
      ) : selectedWorkflow ? (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <section className="flex-none border-b border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedWorkflowId('');
                  setSelectedRunId('');
                  setInputText('{}');
                }}
                className="flex h-7 flex-none items-center gap-1 rounded-lg px-2 text-[var(--text-9)] text-[var(--muted)] hover:bg-[var(--surface-softest)] hover:text-[var(--fg)]"
                aria-label="Back to workflows"
              >
                ← <span>Workflows</span>
              </button>
              <span className="mt-1 h-5 w-px flex-none bg-[var(--border-subtle)]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[var(--text-14)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
                    {selectedWorkflow.name}
                  </h2>
                  <span className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-1.5 py-0.5 font-mono text-[var(--text-8)] text-[var(--muted)]">
                    v{selectedWorkflow.version}
                  </span>
                  <span className="text-[var(--text-9)] text-[var(--muted-dim)]">
                    {Object.keys(selectedWorkflow.definition.agents).length} agents ·{' '}
                    {selectedWorkflow.definition.phases.length} phases
                  </span>
                </div>
                {selectedWorkflow.description ? (
                  <p className="mt-1 line-clamp-1 max-w-3xl text-[var(--text-10)] leading-relaxed text-[var(--muted)]">
                    {selectedWorkflow.description}
                  </p>
                ) : null}
                <details className="mt-1.5 text-[var(--text-9)] text-[var(--muted)]">
                  <summary className="w-fit cursor-pointer select-none hover:text-[var(--fg)]">
                    Input{' '}
                    <span className="font-mono text-[var(--muted-dim)]">
                      {inputText.trim() === '{}' ? '{}' : 'modified'}
                    </span>
                  </summary>
                  <textarea
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                    rows={3}
                    spellCheck={false}
                    aria-label="Workflow input JSON"
                    className="mt-2 w-full resize-y rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 font-mono text-[var(--text-10)] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
                  />
                </details>
              </div>
              <button
                type="button"
                disabled={working || disabled}
                onClick={() => void removeSelectedWorkflow()}
                className="h-7 flex-none rounded-lg px-2 text-[var(--text-9)] uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--red-subtle)] hover:text-[var(--red)] disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                disabled={working || disabled}
                onClick={() => void runSelectedWorkflow()}
                className="h-7 flex-none rounded-lg border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-3 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--accent)] hover:border-[var(--accent-muted)] disabled:opacity-50"
              >
                {working ? 'Working…' : 'Run workflow'}
              </button>
            </div>
          </section>
          <section className="flex min-h-[44px] flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-1.5">
            <span
              className="flex-none text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Runs
            </span>
            <span className="flex-none font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
              {String(selectedWorkflowRuns.length).padStart(2, '0')}
            </span>
            {selectedWorkflowRuns.length === 0 ? (
              <span className="text-[var(--text-9)] text-[var(--muted-dim)]">
                No execution history
              </span>
            ) : (
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {selectedWorkflowRuns.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    aria-pressed={selectedRunId === run.id}
                    className={`flex h-7 flex-none items-center gap-1.5 rounded-lg border px-2.5 text-[var(--text-9)] transition-colors ${
                      selectedRunId === run.id
                        ? 'border-[var(--accent-muted)] shadow-[0_0_0_1px_var(--accent-subtle)]'
                        : 'border-[var(--border-subtle)] opacity-65 hover:opacity-100'
                    } ${workflowStatusClass(run.status)}`}
                    title={`Open run requested ${workflowTimeLabel(run.requestedAt)}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${workflowStatusDot(run.status)}`} />
                    <span className="capitalize">{workflowStatusLabel(run.status)}</span>
                    <span className="font-mono opacity-65">
                      {new Date(run.requestedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedRun?.status === 'pending_approval' ? (
              <>
                <button
                  type="button"
                  disabled={working || Boolean(disabled)}
                  onClick={() => void action(() => approveWorkflowRun(droneId, selectedRun.id))}
                  className="h-7 flex-none rounded-lg border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-2.5 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--accent)] disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={working || Boolean(disabled)}
                  onClick={() => void action(() => denyWorkflowRun(droneId, selectedRun.id))}
                  className="h-7 flex-none rounded-lg px-2 text-[var(--text-9)] text-[var(--red)] hover:bg-[var(--red-subtle)] disabled:opacity-50"
                >
                  Deny
                </button>
              </>
            ) : null}
            {selectedRun && ACTIVE_WORKFLOW_RUN_STATUSES.has(selectedRun.status) ? (
              <button
                type="button"
                disabled={working || Boolean(disabled)}
                onClick={() => void action(() => cancelWorkflowRun(droneId, selectedRun.id))}
                className="h-7 flex-none rounded-lg border border-[var(--red-border)] bg-[var(--red-subtle)] px-2.5 text-[var(--text-9)] text-[var(--red)] disabled:opacity-50"
              >
                Cancel
              </button>
            ) : null}
            {selectedRun && TERMINAL_WORKFLOW_RUN_STATUSES.has(selectedRun.status) ? (
              <button
                type="button"
                disabled={working || Boolean(disabled)}
                onClick={() => void removeSelectedRun()}
                className="h-7 flex-none rounded-lg px-2 text-[var(--text-9)] text-[var(--muted)] hover:bg-[var(--red-subtle)] hover:text-[var(--red)] disabled:opacity-50"
                title="Delete selected run"
              >
                Delete
              </button>
            ) : null}
          </section>
          <WorkflowDefinitionView
            workflow={selectedWorkflow}
            run={selectedRun}
            invocations={invocations}
            ownerDroneId={droneId}
            onOpenChat={onOpenChat}
          />
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-5 py-5">
            <div className="mb-4 flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[var(--text-14)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
                  Workflows
                </h2>
                <p className="mt-1 text-[var(--text-10)] text-[var(--muted)]">
                  Reusable multi-agent processes and their latest execution state.
                </p>
              </div>
              <span className="font-mono text-[var(--text-9)] text-[var(--muted-dim)]">
                {workflows.length}
              </span>
            </div>
            <div className="overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-alt)]">
              {workflows.map((workflow, index) => {
                const workflowRuns = runs.filter((run) => run.workflowId === workflow.id);
                const latest = workflowRuns[0];
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => {
                      setSelectedWorkflowId(workflow.id);
                      setSelectedRunId(latest?.id ?? '');
                      setInputText('{}');
                    }}
                    className={`group flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-[var(--surface-softest)] ${
                      index > 0 ? 'border-t border-[var(--border-subtle)]' : ''
                    }`}
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)]">
                      <WorkflowGlyph />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">
                          {workflow.name}
                        </span>
                        <span className="font-mono text-[var(--text-8)] text-[var(--muted-dim)]">
                          v{workflow.version}
                        </span>
                      </span>
                      {workflow.description ? (
                        <span className="mt-1 line-clamp-1 block text-[var(--text-9)] text-[var(--muted)]">
                          {workflow.description}
                        </span>
                      ) : null}
                      <span className="mt-1.5 flex items-center gap-2 text-[var(--text-8)] text-[var(--muted-dim)]">
                        <span>{Object.keys(workflow.definition.agents).length} agents</span>
                        <span>·</span>
                        <span>{workflow.definition.phases.length} phases</span>
                        <span>·</span>
                        <span>
                          {workflowRuns.length} run{workflowRuns.length === 1 ? '' : 's'}
                        </span>
                      </span>
                    </span>
                    <span className="flex w-32 flex-none items-center justify-end gap-1.5 text-[var(--text-9)]">
                      <span className={`h-1.5 w-1.5 rounded-full ${workflowStatusDot(latest?.status)}`} />
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          latest
                            ? workflowStatusClass(latest.status)
                            : 'text-[var(--muted-dim)]'
                        }`}
                      >
                        {latest ? workflowStatusLabel(latest.status) : 'Not run'}
                      </span>
                    </span>
                    <span className="flex-none text-[var(--muted-dim)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--fg)]">
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
