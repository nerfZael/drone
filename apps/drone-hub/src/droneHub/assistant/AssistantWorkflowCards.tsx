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

  if (approval.toolName === 'bash') {
    const resolved = args.resolved ?? args;
    const target = String(
      resolved.targetLabel ?? resolved.droneName ?? resolved.targetId ?? resolved.droneId ?? '',
    ).trim();
    const command = String(resolved.command ?? args.command ?? '').trim();
    return {
      title: 'Execute Bash command',
      rows: [
        ...(target ? [{ label: 'Runs on', value: target }] : []),
        ...(resolved.cwd ? [{ label: 'Working directory', value: String(resolved.cwd) }] : []),
      ],
      markdownLabel: 'Command',
      markdown: command ? `\`\`\`bash\n${command}\n\`\`\`` : '',
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
  const titleId = `assistant-approval-${approval.id}-title`;
  const jsonId = `assistant-approval-${approval.id}-json`;
  const jsonDisclosure = (
    <button
      type="button"
      onClick={() => setShowJson((value) => !value)}
      className="dh-approval-json-link"
      aria-expanded={showJson}
      aria-controls={jsonId}
    >
      {showJson ? 'Hide JSON' : 'View JSON'}
    </button>
  );
  return (
    <section
      className="dh-approval"
      role="region"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
    >
      <div className="dh-approval-header">
        <h3 id={titleId} className="dh-approval-title">
          <span className="sr-only">Approval required: </span>
          {summary.title}
        </h3>
        <div className="dh-approval-actions">
          <button
            type="button"
            disabled={busy}
            onClick={onDeny}
            className="dh-approval-button dh-approval-button--deny"
          >
            Deny
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="dh-approval-button dh-approval-button--approve"
          >
            Approve
          </button>
        </div>
      </div>
      {summary.rows.length > 0 ? (
        <dl className="dh-approval-metadata">
          {summary.rows.map((row) => (
            <div key={row.label} className="dh-approval-metadata-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {summary.markdown ? (
        <div className="dh-approval-payload">
          <div className="dh-approval-payload-header">
            {summary.markdownLabel ? (
              <div className="dh-approval-payload-label">{summary.markdownLabel}</div>
            ) : (
              <span />
            )}
            {jsonDisclosure}
          </div>
          <MarkdownMessage text={summary.markdown} className="dh-markdown dh-approval-markdown" />
        </div>
      ) : (
        <div className="dh-approval-utilities">{jsonDisclosure}</div>
      )}
      <pre id={jsonId} className="dh-approval-json" hidden={!showJson}>
        {JSON.stringify(approval.args, null, 2)}
      </pre>
    </section>
  );
}
