import React from 'react';
import type { CodexApprovalDecision, CodexPendingApproval } from '@drone/assistant-chat';

function approvalTitle(approval: CodexPendingApproval): string {
  if (approval.kind === 'command_execution') return 'Run command';
  if (approval.kind === 'file_change') return 'Apply file changes';
  return 'Grant additional permissions';
}

function approvalDetails(approval: CodexPendingApproval): unknown {
  if (approval.kind === 'permissions') return approval.permissions;
  if (approval.kind === 'file_change') {
    const item = approval.item as any;
    return item?.changes ?? item ?? { itemId: approval.itemId };
  }
  return (approval.item as any)?.commandActions ?? approval.item ?? null;
}

export function CodexApprovalCard({
  approval,
  busy,
  error,
  onDecision,
}: {
  approval: CodexPendingApproval;
  busy: boolean;
  error?: string | null;
  onDecision: (decision: CodexApprovalDecision) => void;
}) {
  const [showJson, setShowJson] = React.useState(false);
  const decisions = new Set(approval.availableDecisions);
  const details = approvalDetails(approval);
  const titleId = `codex-approval-${approval.id}-title`;
  const jsonId = `codex-approval-${approval.id}-json`;

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
          {approvalTitle(approval)}
        </h3>
        <div className="dh-approval-actions">
          {decisions.has('cancel') ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision('cancel')}
              className="dh-approval-button dh-approval-button--deny"
            >
              Cancel
            </button>
          ) : null}
          {decisions.has('decline') ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision('decline')}
              className="dh-approval-button dh-approval-button--deny"
            >
              Deny
            </button>
          ) : null}
          {decisions.has('accept') ? (
            <button
              type="button"
              disabled={busy || approval.detailsTruncated}
              onClick={() => onDecision('accept')}
              className="dh-approval-button dh-approval-button--approve"
            >
              Approve once
            </button>
          ) : null}
          {decisions.has('acceptForSession') ? (
            <button
              type="button"
              disabled={busy || approval.detailsTruncated}
              onClick={() => onDecision('acceptForSession')}
              className="dh-approval-button dh-approval-button--approve"
            >
              Approve for session
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="mt-2 text-[var(--text-10)] text-[var(--red)]">{error}</div> : null}
      {approval.detailsTruncated ? (
        <div className="mt-2 text-[var(--text-10)] text-[var(--yellow)]">
          Some request details are unavailable. Deny this request and retry from the originating
          device if you need to approve it.
        </div>
      ) : null}
      {approval.reason ? (
        <div className="mt-2 text-[var(--text-10)] leading-relaxed text-[var(--muted)]">
          {approval.reason}
        </div>
      ) : null}
      {approval.cwd || approval.grantRoot ? (
        <dl className="dh-approval-metadata">
          {approval.cwd ? (
            <div className="dh-approval-metadata-row">
              <dt>Working directory</dt>
              <dd>{approval.cwd}</dd>
            </div>
          ) : null}
          {approval.grantRoot ? (
            <div className="dh-approval-metadata-row">
              <dt>Requested root</dt>
              <dd>{approval.grantRoot}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {approval.command ? (
        <div className="dh-approval-payload">
          <div className="dh-approval-payload-header">
            <div className="dh-approval-payload-label">Command</div>
            <button
              type="button"
              onClick={() => setShowJson((value) => !value)}
              className="dh-approval-json-link"
              aria-expanded={showJson}
              aria-controls={jsonId}
            >
              {showJson ? 'Hide details' : 'View details'}
            </button>
          </div>
          <pre className="dh-approval-json !mt-0 whitespace-pre-wrap" hidden={false}>
            <code>{approval.command}</code>
          </pre>
        </div>
      ) : (
        <div className="dh-approval-utilities">
          <button
            type="button"
            onClick={() => setShowJson((value) => !value)}
            className="dh-approval-json-link"
            aria-expanded={showJson}
            aria-controls={jsonId}
          >
            {showJson ? 'Hide details' : 'View details'}
          </button>
        </div>
      )}
      <pre id={jsonId} className="dh-approval-json" hidden={!showJson}>
        {JSON.stringify(details, null, 2)}
      </pre>
    </section>
  );
}
