import React from 'react';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import {
  UiCountBadge,
  UiNavigationRow,
  UiPaneState,
  UiPanel,
  UiPanelBody,
  UiPanelHeader,
  UiPanelStatusStrip,
  UiPanelToolbar,
  UiStatusChip,
  UiStatusDot,
  UiTextarea,
  UiToolbarButton,
  type UiToolbarControlTone,
} from '../../ui/components';
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

function workflowRunTone(status: string | undefined): UiToolbarControlTone {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled' || status === 'denied') {
    return 'danger';
  }
  if (status === 'pending_approval') return 'warning';
  if (status) return 'accent';
  return 'neutral';
}

function WorkflowGlyph({
  active = false,
  compact = false,
}: {
  active?: boolean;
  compact?: boolean;
}) {
  return (
    <svg
      className={`${compact ? 'h-4 w-4' : 'h-7 w-7'} flex-none ${
        active ? 'text-[var(--accent)]' : 'text-[var(--muted-dim)]'
      }`}
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
    <UiPanel flush className="dh-workflows-dock h-full">
      {error ? (
        <UiPanelStatusStrip tone="danger">
          {error}
        </UiPanelStatusStrip>
      ) : null}
      {liveStatus === 'disconnected' ? (
        <UiPanelStatusStrip
          tone="warning"
          dot
          action={
            <UiToolbarButton
              size="xsmall"
              tone="warning"
              onClick={() => void refresh()}
            >
              Refresh now
            </UiToolbarButton>
          }
        >
          Live updates are unavailable. Changes may be delayed.
        </UiPanelStatusStrip>
      ) : null}
      {loading ? (
        <UiPaneState kind="loading" title="Loading workflows" />
      ) : workflows.length === 0 ? (
        <UiPanelBody className="relative">
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                'radial-gradient(circle, rgba(var(--canvas-dot-rgb), .12) 0.6px, transparent 0.8px)',
              backgroundSize: '28px 28px',
            }}
          />
          <UiPaneState
            kind="empty"
            title="No workflow graph yet"
            description="This drone’s agent can create one with the DroneHub MCP workflow tools."
            icon={<WorkflowGlyph />}
            className="relative"
          />
        </UiPanelBody>
      ) : selectedWorkflow ? (
        <UiPanelBody role="main" className="flex flex-col">
          <UiPanelHeader
            eyebrow="Workflow"
            title={selectedWorkflow.name}
            description={`${selectedWorkflow.description ? `${selectedWorkflow.description} · ` : ''}${
              Object.keys(selectedWorkflow.definition.agents).length
            } agents · ${selectedWorkflow.definition.phases.length} phases`}
            leading={
              <UiToolbarButton
                size="xsmall"
                onClick={() => {
                  setSelectedWorkflowId('');
                  setSelectedRunId('');
                  setInputText('{}');
                }}
                aria-label="Back to workflows"
              >
                ← Workflows
              </UiToolbarButton>
            }
            meta={<UiStatusChip>v{selectedWorkflow.version}</UiStatusChip>}
            actions={
              <>
                <UiToolbarButton
                  tone="danger"
                  disabled={working || disabled}
                  onClick={() => void removeSelectedWorkflow()}
                >
                  Delete
                </UiToolbarButton>
                <UiToolbarButton
                  tone="accent"
                  active
                  loading={working}
                  disabled={disabled}
                  onClick={() => void runSelectedWorkflow()}
                >
                  Run workflow
                </UiToolbarButton>
              </>
            }
          />
          <div className="flex-none border-b border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-2">
                <details className="mt-1.5 text-[var(--text-9)] text-[var(--muted)]">
                  <summary className="w-fit cursor-pointer select-none hover:text-[var(--fg)]">
                    Input{' '}
                    <span className="font-mono text-[var(--muted-dim)]">
                      {inputText.trim() === '{}' ? '{}' : 'modified'}
                    </span>
                  </summary>
                  <UiTextarea
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                    rows={3}
                    spellCheck={false}
                    aria-label="Workflow input JSON"
                    className="mt-2 font-mono text-[var(--text-10)]"
                  />
                </details>
          </div>
          <UiPanelToolbar aria-label="Workflow runs" className="min-h-11 px-3 py-1.5">
            <span
              className="flex-none text-[var(--text-8)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Runs
            </span>
            <UiCountBadge>
              {String(selectedWorkflowRuns.length).padStart(2, '0')}
            </UiCountBadge>
            {selectedWorkflowRuns.length === 0 ? (
              <span className="text-[var(--text-9)] text-[var(--muted-dim)]">
                No execution history
              </span>
            ) : (
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {selectedWorkflowRuns.map((run) => (
                  <UiToolbarButton
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    pressed={selectedRunId === run.id}
                    active={selectedRunId === run.id}
                    tone={workflowRunTone(run.status)}
                    leadingIcon={
                      <UiStatusDot tone={workflowRunTone(run.status)} />
                    }
                    title={`Open run requested ${workflowTimeLabel(run.requestedAt)}`}
                  >
                    <span className="capitalize">{workflowStatusLabel(run.status)}</span>
                    <span className="font-mono opacity-65">
                      {new Date(run.requestedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </UiToolbarButton>
                ))}
              </div>
            )}
            {selectedRun?.status === 'pending_approval' ? (
              <>
                <UiToolbarButton
                  tone="accent"
                  disabled={working || Boolean(disabled)}
                  onClick={() => void action(() => approveWorkflowRun(droneId, selectedRun.id))}
                >
                  Approve
                </UiToolbarButton>
                <UiToolbarButton
                  tone="danger"
                  disabled={working || Boolean(disabled)}
                  onClick={() => void action(() => denyWorkflowRun(droneId, selectedRun.id))}
                >
                  Deny
                </UiToolbarButton>
              </>
            ) : null}
            {selectedRun && ACTIVE_WORKFLOW_RUN_STATUSES.has(selectedRun.status) ? (
              <UiToolbarButton
                tone="danger"
                disabled={working || Boolean(disabled)}
                onClick={() => void action(() => cancelWorkflowRun(droneId, selectedRun.id))}
              >
                Cancel
              </UiToolbarButton>
            ) : null}
            {selectedRun && TERMINAL_WORKFLOW_RUN_STATUSES.has(selectedRun.status) ? (
              <UiToolbarButton
                tone="danger"
                disabled={working || Boolean(disabled)}
                onClick={() => void removeSelectedRun()}
                title="Delete selected run"
              >
                Delete
              </UiToolbarButton>
            ) : null}
          </UiPanelToolbar>
          <WorkflowDefinitionView
            workflow={selectedWorkflow}
            run={selectedRun}
            invocations={invocations}
            ownerDroneId={droneId}
            onOpenChat={onOpenChat}
          />
        </UiPanelBody>
      ) : (
        <UiPanelBody role="main" scroll>
          <UiPanelHeader
            title="Workflows"
            description="Reusable multi-agent processes and their latest execution state."
            meta={<UiCountBadge>{workflows.length}</UiCountBadge>}
          />
          <div className="mx-auto w-full max-w-5xl px-5 py-5">
            <div className="overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-alt)]">
              {workflows.map((workflow, index) => {
                const workflowRuns = runs.filter((run) => run.workflowId === workflow.id);
                const latest = workflowRuns[0];
                return (
                  <UiNavigationRow
                    key={workflow.id}
                    onClick={() => {
                      setSelectedWorkflowId(workflow.id);
                      setSelectedRunId(latest?.id ?? '');
                      setInputText('{}');
                    }}
                    label={workflow.name}
                    description={`${workflow.description ? `${workflow.description} · ` : ''}${
                      Object.keys(workflow.definition.agents).length
                    } agents · ${workflow.definition.phases.length} phases · ${
                      workflowRuns.length
                    } run${workflowRuns.length === 1 ? '' : 's'}`}
                    leading={<WorkflowGlyph compact />}
                    status={<UiStatusChip>v{workflow.version}</UiStatusChip>}
                    meta={
                      <span className="inline-flex items-center gap-1.5">
                        <UiStatusDot
                          tone={workflowRunTone(latest?.status)}
                        />
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            latest ? workflowStatusClass(latest.status) : ''
                          }`}
                        >
                          {latest ? workflowStatusLabel(latest.status) : 'Not run'}
                        </span>
                        <span aria-hidden="true">→</span>
                      </span>
                    }
                    className={`rounded-none px-1 py-1 ${
                      index > 0 ? 'border-t border-[var(--border-subtle)]' : ''
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </UiPanelBody>
      )}
    </UiPanel>
  );
}
