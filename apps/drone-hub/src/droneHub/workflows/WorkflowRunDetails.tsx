import React from 'react';

import type { WorkflowInvocation, WorkflowRun } from './workflow-types';
import {
  ACTIVE_WORKFLOW_RUN_STATUSES,
  TERMINAL_WORKFLOW_RUN_STATUSES,
  workflowStatusClass,
  workflowStatusLabel,
} from './workflow-presentation';

type Props = {
  ownerDroneId: string;
  run: WorkflowRun;
  invocations: WorkflowInvocation[];
  disabled: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenChat: (droneId: string, chatName: string) => void;
};

export function WorkflowRunDetails({
  ownerDroneId,
  run,
  invocations,
  disabled,
  onApprove,
  onDeny,
  onCancel,
  onDelete,
  onOpenChat,
}: Props) {
  return (
    <section className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3">
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-[var(--text-10)] font-[var(--weight-semibold)] ${workflowStatusClass(run.status)}`}
        >
          {workflowStatusLabel(run.status)}
        </span>
        <span className="text-[var(--text-10)] text-[var(--muted)]">
          {run.plan.timeoutMinutes}m · concurrency {run.plan.maxConcurrency}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {run.plan.permissions.map((permission) => (
          <span
            key={permission}
            className="rounded bg-[var(--surface-inset)] px-1.5 py-0.5 text-[var(--text-9)] text-[var(--muted)]"
          >
            {permission}
          </span>
        ))}
        <span className="text-[var(--text-9)] text-[var(--muted-dim)]">
          {run.plan.invocationCountEstimate == null
            ? 'dynamic invocation count'
            : `${run.plan.invocationCountEstimate} estimated`}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {run.status === 'pending_approval' ? (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={onApprove}
              className="rounded bg-[var(--accent-subtle)] px-2 py-1 text-[var(--text-10)] text-[var(--accent)] disabled:opacity-50"
            >
              Approve & run
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onDeny}
              className="rounded bg-[var(--red-subtle)] px-2 py-1 text-[var(--text-10)] text-[var(--red)] disabled:opacity-50"
            >
              Deny
            </button>
          </>
        ) : null}
        {ACTIVE_WORKFLOW_RUN_STATUSES.has(run.status) ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onCancel}
            className="rounded bg-[var(--red-subtle)] px-2 py-1 text-[var(--text-10)] text-[var(--red)] disabled:opacity-50"
          >
            Cancel
          </button>
        ) : null}
        {TERMINAL_WORKFLOW_RUN_STATUSES.has(run.status) ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            className="rounded border border-[var(--border-subtle)] px-2 py-1 text-[var(--text-10)] text-[var(--muted)] disabled:opacity-50"
          >
            Delete run
          </button>
        ) : null}
      </div>
      {run.error ? (
        <div className="mt-2 whitespace-pre-wrap text-[var(--text-10)] text-[var(--red)]">
          {run.error}
        </div>
      ) : null}
      {run.output !== null && run.output !== undefined ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-inset)] p-2 text-[var(--text-10)] text-[var(--fg)]">
          {JSON.stringify(run.output, null, 2)}
        </pre>
      ) : null}
      <div className="mt-3 space-y-1.5">
        {invocations.map((invocation) => (
          <div key={invocation.id} className="rounded border border-[var(--border-subtle)] p-2">
            <div className="flex items-center gap-2 text-[var(--text-10)]">
              <span className="font-[var(--weight-semibold)] text-[var(--fg)]">
                #{invocation.ordinal} {invocation.nodeId}
              </span>
              <span className={workflowStatusClass(invocation.status)}>{invocation.status}</span>
              {invocation.lastChatName ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenChat(
                      invocation.executionDroneId || ownerDroneId,
                      invocation.lastChatName!,
                    )
                  }
                  className="ml-auto text-[var(--accent)] hover:underline"
                >
                  {invocation.childDroneId ? 'Open child drone' : 'Open agent chat'}
                </button>
              ) : null}
            </div>
            {invocation.error ? (
              <div className="mt-1 text-[var(--red)]">{invocation.error}</div>
            ) : null}
            {invocation.textResult ? (
              <details className="mt-1 text-[var(--text-10)] text-[var(--muted)]">
                <summary className="cursor-pointer">Result</summary>
                <div className="mt-1 whitespace-pre-wrap">{invocation.textResult}</div>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
