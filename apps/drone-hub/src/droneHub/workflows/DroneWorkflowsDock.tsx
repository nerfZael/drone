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
  workflowStatusClass,
  workflowStatusLabel,
  workflowTimeLabel,
} from './workflow-presentation';
import { WorkflowRunDetails } from './WorkflowRunDetails';
import type { DroneWorkflow, WorkflowInvocation, WorkflowRun } from './workflow-types';

type Props = {
  droneId: string;
  disabled?: boolean;
  onOpenChat: (droneId: string, chatName: string) => void;
};

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
  const [liveConnected, setLiveConnected] = React.useState(false);
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
        nextWorkflows.some((workflow) => workflow.id === current)
          ? current
          : (nextWorkflows[0]?.id ?? ''),
      );
      setSelectedRunId((current) =>
        nextRuns.some((run) => run.id === current) ? current : (nextRuns[0]?.id ?? ''),
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
    setLiveConnected(false);
    const stream = new EventSource(workflowEventUrl(droneId));
    stream.addEventListener('connected', () => setLiveConnected(true));
    stream.addEventListener('workflow_change', () => void refresh());
    stream.onerror = () => setLiveConnected(false);
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
    <div className="h-full min-h-0 bg-[var(--panel-alt)] flex flex-col overflow-hidden">
      <header className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]">
            Workflows
          </div>
          <span
            className={`h-1.5 w-1.5 rounded-full ${liveConnected ? 'bg-[var(--green)]' : 'bg-[var(--red)]'}`}
            title={
              liveConnected
                ? 'Live updates connected'
                : 'Live updates disconnected; refresh still works'
            }
          />
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto text-[var(--text-10)] text-[var(--muted)] hover:text-[var(--fg)]"
          >
            Refresh
          </button>
        </div>
      </header>
      {error ? (
        <div className="flex-shrink-0 border-b border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-12)] text-[var(--muted)]">
          Loading workflows...
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-8 text-center text-[var(--text-12)] text-[var(--muted)]">
          No workflows for this drone. Its agent can create one with the DroneHub MCP workflow
          tools.
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(120px,0.32fr)_minmax(0,1fr)] overflow-hidden">
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--border)] p-2">
            {workflows.map((workflow) => {
              const latest = runs.find((run) => run.workflowId === workflow.id);
              return (
                <button
                  key={workflow.id}
                  type="button"
                  onClick={() => {
                    setSelectedWorkflowId(workflow.id);
                    setSelectedRunId(latest?.id ?? '');
                  }}
                  className={`mb-1.5 w-full rounded-[var(--radius-medium)] border p-2 text-left ${
                    selectedWorkflowId === workflow.id
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:bg-[var(--hover)]'
                  }`}
                >
                  <div className="truncate text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">
                    {workflow.name}
                  </div>
                  <div className="mt-0.5 text-[var(--text-9)] text-[var(--muted)]">
                    v{workflow.version}
                    {latest ? ` · ${workflowStatusLabel(latest.status)}` : ''}
                  </div>
                </button>
              );
            })}
          </aside>
          <main className="min-h-0 overflow-y-auto p-3">
            {selectedWorkflow ? (
              <div className="space-y-4">
                <section>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[var(--text-14)] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
                        {selectedWorkflow.name}
                      </h2>
                      {selectedWorkflow.description ? (
                        <p className="mt-1 text-[var(--text-11)] text-[var(--muted)]">
                          {selectedWorkflow.description}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={working || disabled}
                      onClick={() => void removeSelectedWorkflow()}
                      className="text-[var(--text-10)] text-[var(--red)] disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                  <label className="mt-3 block text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]">
                    Input JSON
                  </label>
                  <textarea
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                    rows={3}
                    spellCheck={false}
                    className="mt-1 w-full resize-y rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 font-mono text-[var(--text-10)] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
                  />
                  <button
                    type="button"
                    disabled={working || disabled}
                    onClick={() => void runSelectedWorkflow()}
                    className="mt-2 rounded-[var(--radius-medium)] border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent)] disabled:opacity-50"
                  >
                    {working ? 'Working...' : 'Run'}
                  </button>
                </section>
                <section>
                  <div className="mb-2 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]">
                    Definition
                  </div>
                  <WorkflowDefinitionView workflow={selectedWorkflow} />
                </section>
                <section>
                  <div className="mb-2 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]">
                    Runs
                  </div>
                  {selectedWorkflowRuns.length === 0 ? (
                    <div className="text-[var(--text-11)] text-[var(--muted)]">Not run yet.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedWorkflowRuns.map((run) => (
                        <button
                          key={run.id}
                          type="button"
                          onClick={() => setSelectedRunId(run.id)}
                          className={`rounded border px-2 py-1 text-[var(--text-10)] ${selectedRunId === run.id ? 'border-[var(--accent)]' : 'border-[var(--border-subtle)]'} ${workflowStatusClass(run.status)}`}
                        >
                          {workflowStatusLabel(run.status)} · {workflowTimeLabel(run.requestedAt)}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
                {selectedRun ? (
                  <WorkflowRunDetails
                    ownerDroneId={droneId}
                    run={selectedRun}
                    invocations={invocations}
                    disabled={working || Boolean(disabled)}
                    onApprove={() => void action(() => approveWorkflowRun(droneId, selectedRun.id))}
                    onDeny={() => void action(() => denyWorkflowRun(droneId, selectedRun.id))}
                    onCancel={() => void action(() => cancelWorkflowRun(droneId, selectedRun.id))}
                    onDelete={() => void removeSelectedRun()}
                    onOpenChat={onOpenChat}
                  />
                ) : null}
              </div>
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}
