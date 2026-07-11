import React from 'react';

import { MarkdownMessage } from '../chat/MarkdownMessage';
import type { AssistantApproval } from './assistant-types';

function formatAgentForApproval(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  const kind = String(raw.kind ?? '').trim();
  if (kind === 'builtin') return String(raw.id ?? '').trim();
  if (kind === 'custom') return String(raw.label ?? raw.id ?? '').trim();
  return '';
}

function approvalSummary(approval: AssistantApproval): {
  title: string;
  rows: Array<{ label: string; value: string }>;
  markdownLabel?: string;
  markdown?: string;
} {
  const args = approval.args ?? {};
  if (approval.toolName === 'message_drone') {
    const resolved = args.resolved ?? args;
    const droneName = String(resolved.droneName ?? resolved.droneId ?? args.droneId ?? '').trim();
    const chatName = String(resolved.chatName ?? args.chatName ?? '').trim();
    const message = String(resolved.message ?? args.message ?? args.prompt ?? '').trim();
    return {
      title: 'Send message',
      rows: [
        ...(droneName ? [{ label: 'Drone', value: droneName }] : []),
        ...(chatName && chatName !== 'default' ? [{ label: 'Chat', value: chatName }] : []),
      ],
      markdownLabel: 'Message',
      markdown: message,
    };
  }

  if (approval.toolName === 'create_drone') {
    const request = args.resolvedRequest ?? args;
    const agent = formatAgentForApproval(request.seedAgent);
    const initialMessage = String(request.seedPrompt ?? request.initialMessage ?? '').trim();
    return {
      title: 'Create drone',
      rows: [
        { label: 'Name', value: String(request.name ?? '').trim() },
        { label: 'Runtime', value: String(request.runtime ?? 'container').trim() || 'container' },
        ...(String(request.group ?? '').trim()
          ? [{ label: 'Group', value: String(request.group).trim() }]
          : []),
        ...(String(request.repoPath ?? '').trim()
          ? [{ label: 'Repo', value: String(request.repoPath).trim() }]
          : []),
        ...(String(request.repoBranchSource ?? '').trim()
          ? [{ label: 'Branch source', value: String(request.repoBranchSource).trim() }]
          : []),
        ...(String(request.remoteBranch ?? '').trim()
          ? [{ label: 'Remote branch', value: String(request.remoteBranch).trim() }]
          : []),
        ...(agent ? [{ label: 'Agent', value: agent }] : []),
        ...(String(request.seedModel ?? '').trim()
          ? [{ label: 'Model', value: String(request.seedModel).trim() }]
          : []),
      ].filter((row) => row.value),
      markdownLabel: initialMessage ? 'Initial message' : undefined,
      markdown: initialMessage,
    };
  }

  if (approval.toolName === 'set_drone_group') {
    const resolved = args.resolved ?? args;
    const droneNames = Array.isArray(resolved.drones)
      ? resolved.drones.map((drone: any) => String(drone?.name ?? '').trim()).filter(Boolean)
      : Array.isArray(resolved.droneIds ?? args.droneIds)
        ? (resolved.droneIds ?? args.droneIds)
            .map((id: any) => String(id ?? '').trim())
            .filter(Boolean)
        : [];
    const group = String(resolved.group ?? args.group ?? '').trim();
    return {
      title: 'Set drone group',
      rows: [
        ...(droneNames.length > 0
          ? [{ label: droneNames.length === 1 ? 'Drone' : 'Drones', value: droneNames.join(', ') }]
          : []),
        { label: 'Group', value: group || 'Ungrouped' },
      ],
    };
  }

  return {
    title: approval.label || 'Approval required',
    rows: [],
  };
}

export function ApprovalCard({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: AssistantApproval;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const [showJson, setShowJson] = React.useState(false);
  const summary = approvalSummary(approval);
  return (
    <div className="mx-3 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Approval required
          </div>
          <div className="mt-0.5 text-[12px] font-semibold text-[var(--fg)]">{summary.title}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowJson((value) => !value)}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.14)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {showJson ? 'Hide JSON' : 'JSON'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDeny}
            className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Deny
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="h-7 rounded border border-[var(--accent-muted)] bg-[var(--accent)] px-2 text-[10px] font-semibold uppercase tracking-wide text-black disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Approve
          </button>
        </div>
      </div>
      {summary.rows.length > 0 ? (
        <div className="mt-2 grid gap-1.5 text-[12px]">
          {summary.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <div
                className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                {row.label}
              </div>
              <div className="min-w-0 break-words text-[var(--fg-secondary)]">{row.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {summary.markdown ? (
        <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-2.5 py-2">
          {summary.markdownLabel ? (
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              {summary.markdownLabel}
            </div>
          ) : null}
          <MarkdownMessage text={summary.markdown} className="dh-markdown text-[12px]" />
        </div>
      ) : null}
      {showJson ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[rgba(0,0,0,.16)] p-2 text-[10px] text-[var(--muted)]">
          {JSON.stringify(approval.args, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
