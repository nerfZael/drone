import React from 'react';

import {
  AgentMessageExtras,
  extractAgentMessageContent,
  type AgentMessageExtrasProps,
} from '../chat/AgentMessageExtras';
import type { MarkdownTextMentionLink } from '../chat/MarkdownMessage';
import { ChatMessageBody } from '../chat/ChatMessageBody';
import { ChatMessageFrame } from '../chat/ChatMessageFrame';
import { ImageAttachmentChips, normalizeImageAttachmentRefs } from '../chat/ImageAttachmentChips';
import { collectInlineAgentMedia } from '../chat/inline-agent-media';
import { UserChatMessage } from '../chat/UserChatMessage';
import {
  AgentRunSummaryLine,
  formatWorkingDuration,
  WorkingElapsedStatus,
} from '../chat/WorkingElapsedStatus';
import { IconDrone } from '../icons';
import { dispatchAssistantOpenDroneChat } from './open-drone-chat-event';
import {
  compactRepeatedToolItems,
  compactPreview,
  isChatIdleToolName,
  lastAssistantContentBlock,
  latestThinkingText,
  messageDroneDetails,
  messageImageParts,
  messageText,
  normalizeAssistantWaitTargets,
  summarizeWaitTargets,
  toolActivityIsSettled,
  toolActivityTitle,
  toolCalls,
  toolItemName,
  toolLabel,
  type AssistantMessageDroneSummary,
  type AssistantToolCall,
  type AssistantToolRenderItem,
  type AssistantWaitTargetLabel,
} from './assistant-message-model';
import type {
  AssistantApproval,
  AssistantDroneNameMap,
  AssistantMessage,
  AssistantQueuedPrompt,
} from './assistant-types';

function assistantVisibleText(message: AssistantMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text ?? ''))
    .filter(Boolean)
    .join('\n');
}

export function AssistantQueuedPromptRow({
  prompt,
  cancelling,
  onCancel,
}: {
  prompt: AssistantQueuedPrompt;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const failed = prompt.status === 'failed';
  const running = prompt.status === 'running';
  const statusLabel =
    failed ? 'Failed' : running ? 'Working' : prompt.deliveryMode === 'asap' ? 'ASAP' : 'Queued';
  return (
    <div className="mx-3 flex justify-end">
      <div className={`max-w-[88%] rounded-[var(--radius-large)] border px-3 py-2 ${failed ? 'border-[var(--red-border)] bg-[var(--red-subtle)]' : 'border-[var(--border-subtle)] bg-[var(--surface-soft)]'}`}>
        <div className="mb-1 flex items-center gap-2 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide" style={{ fontFamily: 'var(--display)' }}>
          <span className={failed ? 'text-[var(--red)]' : 'text-[var(--muted)]'}>{statusLabel}</span>
          {prompt.imageCount > 0 ? <span className="text-[var(--muted-dim)]">{prompt.imageCount} image{prompt.imageCount === 1 ? '' : 's'}</span> : null}
          {!running ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className="ml-auto rounded px-1 py-0.5 text-[var(--text-9)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-40"
              aria-label={failed ? 'Dismiss failed prompt' : 'Cancel queued prompt'}
              title={failed ? 'Dismiss failed prompt' : 'Cancel queued prompt'}
            >
              {cancelling ? '…' : '×'}
            </button>
          ) : null}
        </div>
        {prompt.prompt ? <div className="whitespace-pre-wrap break-words text-[var(--text-12)] leading-relaxed text-[var(--fg-secondary)]">{prompt.prompt}</div> : null}
        {failed && prompt.error ? <div className="mt-1.5 text-[var(--text-10)] text-[var(--red)]">{prompt.error}</div> : null}
      </div>
    </div>
  );
}

function ToolDisclosure({
  title,
  status,
  children,
}: {
  title: string;
  status?: 'pending' | 'blocked' | 'ok' | 'error';
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div data-tool-activity-row>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 py-1.5 text-left text-[var(--text-12)] text-[var(--muted)] hover:text-[var(--fg-secondary)]"
      >
        {status ? (
          <span
            data-tool-status={status}
            className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${
              status === 'error'
                ? 'bg-[var(--red)] text-[var(--bg)]'
                : status === 'ok'
                  ? 'bg-[var(--green)] text-[var(--bg)]'
                  : status === 'blocked'
                    ? 'text-[var(--yellow)]'
                    : 'text-[var(--accent)]'
            }`}
            title={status === 'blocked' ? 'Blocked pending approval' : undefined}
            aria-label={status === 'blocked' ? 'Blocked pending approval' : undefined}
          >
            {status === 'error' ? (
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            ) : status === 'pending' ? (
              <ToolSpinnerIcon className="h-3 w-3" />
            ) : status === 'blocked' ? (
              <ToolPausedIcon className="h-3 w-3" />
            ) : (
              <ToolCheckIcon className="h-2.5 w-2.5" />
            )}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <span className="text-[var(--muted-dim)] transition-colors group-hover:text-[var(--muted)]">
          <ToolRunChevron open={open} />
        </span>
      </button>
      {open ? (
        <ToolDetailRail>{children}</ToolDetailRail>
      ) : null}
    </div>
  );
}

function ToolDetailRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-[5px] border-l border-[var(--border-subtle)] pb-2 pl-[19px] pr-1 pt-1">
      {children}
    </div>
  );
}

function ToolCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 5.2l2 2 4-4.4" />
    </svg>
  );
}

function ToolSpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin motion-reduce:animate-none ${className ?? ''}`}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path
        d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ToolPausedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 2.5v7M8 2.5v7" />
    </svg>
  );
}

export function AssistantWorkingRow({ startedAt }: { startedAt?: string | number | null }) {
  return (
    <div className="px-3">
      <WorkingElapsedStatus startedAt={startedAt} />
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const trimmed = text.trim();
  if (!trimmed) return null;

  return (
    <div className="mb-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-faint)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--surface-strong)]"
      >
        <span
          className="flex-shrink-0 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          Reasoning
        </span>
        <span className="ml-auto flex-shrink-0 text-[var(--text-10)] text-[var(--muted)]">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {trimmed ? (
        open ? (
          <div className="border-t border-[var(--border-subtle)] px-2.5 py-2">
            <div className="max-h-[min(70vh,28rem)] overflow-auto whitespace-pre-wrap break-words text-[var(--text-11)] leading-relaxed text-[var(--muted)]">
              {trimmed}
            </div>
          </div>
        ) : (
          <div className="border-t border-[var(--border-subtle)] px-2.5 pb-2 pt-1">
            <div className="line-clamp-3 whitespace-pre-wrap break-words text-[var(--text-11)] leading-relaxed text-[var(--muted-dim)]">
              {trimmed}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function ToolStatusIndicator({
  result,
  blocked = false,
}: {
  result?: AssistantMessage;
  blocked?: boolean;
}) {
  if (!result) {
    if (blocked) {
      return (
        <span
          data-tool-status="blocked"
          className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center text-[var(--yellow)]"
          title="Blocked pending approval"
        >
          <ToolPausedIcon className="h-3 w-3" />
        </span>
      );
    }
    return (
      <span
        data-tool-status="pending"
        className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center text-[var(--accent)]"
      >
        <ToolSpinnerIcon className="h-3 w-3" />
      </span>
    );
  }
  if (result.isError) {
    return (
      <span
        data-tool-status="error"
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--red)]"
      />
    );
  }
  return (
    <span
      data-tool-status="ok"
      className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full bg-[var(--green)] text-[var(--bg)]"
    >
      <ToolCheckIcon className="h-2.5 w-2.5" />
    </span>
  );
}

function ToolDetailsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="ml-auto inline-flex flex-shrink-0 items-center gap-1 text-[var(--text-10)] text-[var(--muted-dim)] hover:text-[var(--fg-secondary)]"
    >
      {open ? 'Hide details' : 'Show details'}
      <ToolRunChevron open={open} />
    </button>
  );
}

function ToolPayloadDetails({
  call,
  result,
  pendingLabel = 'Waiting for result…',
}: {
  call?: AssistantToolCall;
  result?: AssistantMessage;
  pendingLabel?: string;
}) {
  const resultText = result ? messageText(result) : '';
  return (
    <div className="grid gap-3 py-1">
      {call ? (
        <div>
          <div className="text-[var(--text-11)] font-medium text-[var(--muted)]">
            Arguments
          </div>
          <pre className="mt-1 max-h-24 overflow-auto rounded bg-[var(--surface-inset-faint)] px-2 py-1.5 whitespace-pre-wrap break-words text-[var(--text-10)] leading-relaxed text-[var(--muted-dim)]">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        </div>
      ) : null}
      {result ? (
        <div>
          <div className="text-[var(--text-11)] font-medium text-[var(--muted)]">
            Result
          </div>
          {resultText ? (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-[var(--surface-inset-faint)] px-2 py-1.5 whitespace-pre-wrap break-words text-[var(--text-11)] leading-relaxed text-[var(--fg-secondary)]">
              {resultText}
            </pre>
          ) : (
            <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">No result payload.</div>
          )}
        </div>
      ) : (
        <div className="text-[var(--text-11)] text-[var(--muted-dim)]">{pendingLabel}</div>
      )}
    </div>
  );
}

function formatTransferBytes(value: unknown): string {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function TransferActivityRow({
  call,
  result,
}: {
  call: AssistantToolCall;
  result?: AssistantMessage;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const progress: any =
    result?.details && (result.details as any).type === 'workspace_transfer'
      ? result.details
      : null;
  const totalBytes = Number(progress?.totalBytes ?? 0);
  const transferredBytes = Number(progress?.transferredBytes ?? 0);
  const files = Array.isArray(progress?.files) ? progress.files : [];
  const settled = toolActivityIsSettled({ type: 'tool', key: call.id, call, result });
  const failed = result?.isError === true || progress?.phase === 'failed';
  const percent =
    totalBytes > 0
      ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100))
      : settled && !failed
        ? 100
        : 0;
  const sourceLabel = progress?.source?.targetLabel || call.args?.sourceTarget || 'Source';
  const destinationLabel =
    progress?.destination?.targetLabel || call.args?.destinationTarget || 'Destination';
  const amountLabel = progress
    ? `${formatTransferBytes(transferredBytes)} / ${formatTransferBytes(totalBytes)}`
    : failed
      ? 'Failed'
      : settled
        ? 'Complete'
        : 'Preparing…';
  const progressLabel = !progress
    ? failed
      ? 'Transfer failed'
      : settled
        ? 'Transfer complete'
        : 'Scanning files…'
    : progress.phase === 'planning'
      ? 'Scanning folder…'
      : `${progress.completedFiles ?? 0} of ${progress.fileCount ?? files.length} files`;
  return (
    <div className="mx-3 py-1" data-tool-activity-row>
      <div className="py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ToolStatusIndicator result={settled ? result : undefined} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-[var(--text-12)] font-medium text-[var(--muted)]">
                Transfer files
              </div>
              <div className="tabular-nums text-[var(--text-10)] text-[var(--muted)]">
                {amountLabel}
              </div>
            </div>
            <div className="mt-0.5 truncate text-[var(--text-11)] text-[var(--fg-secondary)]">
              {sourceLabel} <span className="text-[var(--muted-dim)]">→</span> {destinationLabel}
            </div>
          </div>
          {files.length > 0 ? (
            <ToolDetailsButton
              open={detailsOpen}
              onClick={() => setDetailsOpen((value) => !value)}
            />
          ) : null}
        </div>
        <div className="ml-5 mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-strong)]">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${failed ? 'bg-[var(--red)]' : 'bg-[var(--accent)]'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="ml-5 mt-1.5 flex items-center justify-between text-[var(--text-10)] text-[var(--muted-dim)]">
          <span>
            {progressLabel}
          </span>
          <span>
            {progress?.retries
              ? `${progress.retries} ${progress.retries === 1 ? 'retry' : 'retries'}`
              : `${percent}%`}
          </span>
        </div>
        {failed && progress?.failure?.error ? (
          <div className="ml-5 mt-1.5 text-[var(--text-10)] text-[var(--red)]">
            {progress.failure.error}
            {progress.failure.cleanupError ? ` Cleanup: ${progress.failure.cleanupError}` : ''}
          </div>
        ) : null}
        {failed && progress?.resumeToken ? (
          <div className="ml-5 mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
            The assistant can resume after {progress.completedFiles ?? 0} committed files.
          </div>
        ) : null}
      </div>
      {detailsOpen && files.length > 0 ? (
        <ToolDetailRail>
          <div className="grid max-h-56 gap-3 overflow-y-auto py-1">
            {files.map((file: any, index: number) => {
              const filePercent =
                file.size > 0
                  ? Math.min(100, (Number(file.transferredBytes ?? 0) / file.size) * 100)
                  : file.status === 'completed'
                    ? 100
                    : 0;
              return (
                <div
                  key={`${file.destinationPath}-${index}`}
                  className="py-0.5"
                >
                  <div className="flex min-w-0 items-center gap-2 text-[var(--text-10)]">
                    <span className="min-w-0 flex-1 truncate text-[var(--fg-secondary)]">
                      {file.sourcePath}
                    </span>
                    {file.status === 'retrying' ? (
                      <span className="text-[var(--yellow)]">
                        Retrying {file.retries}/{5}
                      </span>
                    ) : null}
                    <span className="flex-shrink-0 tabular-nums text-[var(--muted-dim)]">
                      {formatTransferBytes(file.transferredBytes)} /{' '}
                      {formatTransferBytes(file.size)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-strong)]">
                    <div
                      className={`h-full rounded-full ${file.status === 'failed' ? 'bg-[var(--red)]' : file.status === 'retrying' ? 'bg-[var(--yellow)]' : 'bg-[var(--green)]'}`}
                      style={{ width: `${filePercent}%` }}
                    />
                  </div>
                  {file.error && (file.status === 'retrying' || file.status === 'failed') ? (
                    <div className="mt-1 truncate text-[var(--text-9)] text-[var(--muted-dim)]">
                      {file.error}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </ToolDetailRail>
      ) : null}
    </div>
  );
}

export function RepeatedToolActivityRow({
  items,
  blocked = false,
}: {
  items: AssistantToolRenderItem[];
  blocked?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const first = items[0];
  const name = toolItemName(first);
  const label = toolLabel(name);
  const errorCount = items.filter((item) => item.result?.isError).length;
  const pendingCount = items.filter((item) => !toolActivityIsSettled(item)).length;
  const statusText = [
    pendingCount > 0 && !blocked ? `${pendingCount} pending` : '',
    errorCount > 0 ? `${errorCount} failed` : '',
  ].filter(Boolean).join(', ');
  const statusResult: AssistantMessage | undefined =
    pendingCount > 0
      ? undefined
      : errorCount > 0
        ? { role: 'toolResult', isError: true, content: '' }
        : { role: 'toolResult', content: '' };

  return (
    <div className="mx-3" data-tool-activity-row>
      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-label={detailsOpen ? `Collapse ${label} calls` : `Expand ${label} calls`}
        onClick={() => setDetailsOpen((value) => !value)}
        className="group flex w-full min-w-0 items-center gap-2 py-1.5 text-left"
      >
        <ToolStatusIndicator result={statusResult} blocked={blocked && pendingCount > 0} />
        <span className="min-w-0 truncate text-[var(--text-12)] font-medium text-[var(--muted)] group-hover:text-[var(--fg-secondary)]">
          {label}
        </span>
        <span className="flex-shrink-0 text-[var(--text-10)] tabular-nums text-[var(--muted-dim)]">
          ×{items.length}
        </span>
        {statusText ? (
          <span className="hidden flex-shrink-0 text-[var(--text-10)] text-[var(--muted-dim)] sm:inline">
            {statusText}
          </span>
        ) : null}
        <span className="ml-auto text-[var(--muted-dim)]">
          <ToolRunChevron open={detailsOpen} />
        </span>
      </button>
      {detailsOpen ? (
        <ToolDetailRail>
          <div className="grid gap-4 py-1">
            {items.map((item, index) => (
              <div key={item.key}>
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <ToolStatusIndicator
                    result={toolActivityIsSettled(item) ? item.result : undefined}
                    blocked={blocked && !toolActivityIsSettled(item)}
                  />
                  <div className="min-w-0 flex-1 truncate text-[var(--text-11)] font-medium text-[var(--muted)]">
                    {label} #{index + 1}
                  </div>
                </div>
                <ToolPayloadDetails
                  call={item.call}
                  result={item.result}
                  pendingLabel={blocked ? 'Blocked pending approval.' : undefined}
                />
              </div>
            ))}
          </div>
        </ToolDetailRail>
      ) : null}
    </div>
  );
}

export function MessageDroneActivityRow({
  call,
  result,
  droneNameById,
  blocked = false,
}: {
  call: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById: AssistantDroneNameMap;
  blocked?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const summary = messageDroneDetails(call.args, droneNameById);
  const preview = compactPreview(summary.message, 220);
  return (
    <div className="mx-3 py-1" data-tool-activity-row>
      <div className="py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ToolStatusIndicator result={result} blocked={blocked} />
            <div className="text-[var(--text-12)] font-medium text-[var(--muted)]">
              Send user message
            </div>
            <ToolDetailsButton
              open={detailsOpen}
              onClick={() => setDetailsOpen((value) => !value)}
            />
          </div>
          <div className="ml-5 mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[var(--text-11)]">
            <span className="truncate text-[var(--fg-secondary)]">
              to {summary.droneLabel || 'target drone'}
            </span>
            {summary.chatName && summary.chatName !== 'default' ? (
              <span className="inline-flex max-w-full items-center gap-1 text-[var(--muted)]">
                <span aria-hidden="true" className="text-[var(--muted-dim)]">·</span>
                <span className="truncate">{summary.chatName}</span>
              </span>
            ) : null}
          </div>
          {preview ? (
            <div className="ml-5 mt-1.5 line-clamp-3 text-[var(--text-12)] leading-5 text-[var(--fg-secondary)]">
              “{preview}”
            </div>
          ) : (
            <div className="mt-2 text-[var(--text-11)] text-[var(--muted-dim)]">
              No message preview available.
            </div>
          )}
        </div>
      </div>
      {detailsOpen ? (
        <ToolDetailRail><ToolPayloadDetails call={call} result={result} /></ToolDetailRail>
      ) : null}
    </div>
  );
}

export function ChatsIdleActivityRow({
  call,
  result,
  droneNameById,
}: {
  call: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById: AssistantDroneNameMap;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const targets = normalizeAssistantWaitTargets(call.args, droneNameById);
  const targetSummary = summarizeWaitTargets(targets);
  const label = toolLabel(call.name);
  return (
    <div className="mx-3 py-1" data-tool-activity-row>
      <div className="py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ToolStatusIndicator result={result} />
            <div className="text-[var(--text-12)] font-medium text-[var(--muted)]">
              {label}
            </div>
            <ToolDetailsButton
              open={detailsOpen}
              onClick={() => setDetailsOpen((value) => !value)}
            />
          </div>
          <div className="ml-5 mt-0.5 text-[var(--text-11)] text-[var(--fg-secondary)]">
            {targetSummary || 'Resolving target drones'}
          </div>
        </div>
      </div>
      <div className="ml-5 grid gap-1 py-0.5">
        {targets.length > 0 ? (
          targets.map((target) => (
            <div
              key={target.key}
              className="flex min-h-6 min-w-0 items-center gap-2 text-[var(--text-11)]"
            >
              <span className="h-1 w-1 flex-shrink-0 rounded-full bg-[var(--muted-dim)]" aria-hidden="true" />
              <div className="min-w-0 flex-1 truncate text-[var(--fg-secondary)]">
                {target.droneLabel}
              </div>
              {target.chatName && target.chatName !== 'default' ? (
                <div className="max-w-[42%] truncate text-[var(--text-10)] text-[var(--muted)]">
                  {target.chatName}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="py-1 text-[var(--text-11)] text-[var(--muted-dim)]">
            Waiting for result...
          </div>
        )}
      </div>
      {detailsOpen ? (
        <ToolDetailRail><ToolPayloadDetails call={call} result={result} /></ToolDetailRail>
      ) : null}
    </div>
  );
}

export function ToolActivityRow({
  call,
  result,
  droneNameById = {},
  blocked = false,
}: {
  call?: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById?: AssistantDroneNameMap;
  blocked?: boolean;
}) {
  if (call?.name === 'transfer_files') {
    return <TransferActivityRow call={call} result={result} />;
  }
  if (call?.name === 'message_drone') {
    return (
      <MessageDroneActivityRow
        call={call}
        result={result}
        droneNameById={droneNameById}
        blocked={blocked}
      />
    );
  }

  if (call && isChatIdleToolName(call.name)) {
    return <ChatsIdleActivityRow call={call} result={result} droneNameById={droneNameById} />;
  }

  const title = toolActivityTitle(call, result, droneNameById);
  return (
    <div className="mx-3">
      <ToolDisclosure
        title={title}
        status={result ? (result.isError ? 'error' : 'ok') : blocked ? 'blocked' : 'pending'}
      >
        <ToolPayloadDetails
          call={call}
          result={result}
          pendingLabel={blocked ? 'Blocked pending approval.' : undefined}
        />
      </ToolDisclosure>
    </div>
  );
}

export function formatAssistantRunDuration(durationMs: number): string {
  return formatWorkingDuration(durationMs);
}

export function AssistantRunActivity({
  active,
  startedAt,
  endedAt,
}: {
  active: boolean;
  startedAt?: number;
  endedAt?: number;
}) {
  const fallbackStart = React.useRef(Date.now()).current;
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const start = Number.isFinite(startedAt) ? Number(startedAt) : fallbackStart;
  const end = active ? now : Number.isFinite(endedAt) ? Number(endedAt) : start;

  return (
    <AgentRunSummaryLine
      active={active}
      durationMs={Math.max(0, end - start)}
    />
  );
}

function ToolRunChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 3 4 4-4 4" />
    </svg>
  );
}

function AgentThinkingActivityRow() {
  return (
    <div
      className="mx-3 flex min-h-7 items-center gap-2 py-1.5 text-[var(--text-12)] text-[var(--muted)]"
      data-agent-thinking
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex h-3 w-3 flex-shrink-0 items-center justify-center text-[var(--accent)]">
        <ToolSpinnerIcon className="h-3 w-3" />
      </span>
      <span className="font-medium">Thinking…</span>
    </div>
  );
}

export const AUTO_EXPANDED_TOOL_CALL_LIMIT = 5;

export function ToolRunActivity({
  items,
  active,
  startedAt,
  endedAt,
  droneNameById = {},
  initiallyExpanded = active,
  awaitingApproval = false,
  approvalStartedAt,
}: {
  items: AssistantToolRenderItem[];
  active: boolean;
  startedAt?: number;
  endedAt?: number;
  droneNameById?: AssistantDroneNameMap;
  initiallyExpanded?: boolean;
  awaitingApproval?: boolean;
  approvalStartedAt?: number;
}) {
  const [expansionMode, setExpansionMode] = React.useState<'auto' | 'manual' | 'collapsed'>(
    initiallyExpanded ? 'auto' : 'collapsed',
  );
  const expanded = expansionMode !== 'collapsed';
  const fallbackStart = React.useRef(Date.now()).current;
  const normalizedApprovalStartedAt = Number.isFinite(approvalStartedAt)
    ? Number(approvalStartedAt)
    : null;
  const [now, setNow] = React.useState(() => Date.now());
  const [pauseClock, setPauseClock] = React.useState<{
    accumulatedMs: number;
    startedAt: number | null;
  }>(() => ({
    accumulatedMs: 0,
    startedAt: awaitingApproval ? (normalizedApprovalStartedAt ?? Date.now()) : null,
  }));

  React.useEffect(() => {
    if (!active || awaitingApproval) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, awaitingApproval]);

  React.useEffect(() => {
    const timestamp =
      !active && Number.isFinite(endedAt) ? Number(endedAt) : Date.now();
    setPauseClock((current) => {
      if (awaitingApproval) {
        const startedAt = normalizedApprovalStartedAt ?? current.startedAt ?? timestamp;
        if (current.startedAt !== null && current.startedAt <= startedAt) return current;
        return { ...current, startedAt };
      }
      if (current.startedAt === null) return current;
      return {
        accumulatedMs:
          current.accumulatedMs + Math.max(0, timestamp - current.startedAt),
        startedAt: null,
      };
    });
  }, [active, awaitingApproval, endedAt, normalizedApprovalStartedAt]);

  if (items.length === 0) return null;
  const start = Number.isFinite(startedAt) ? Number(startedAt) : fallbackStart;
  const rawEnd = active ? now : Number.isFinite(endedAt) ? Number(endedAt) : start;
  const end =
    awaitingApproval && pauseClock.startedAt !== null ? pauseClock.startedAt : rawEnd;
  const resumingPauseMs =
    !awaitingApproval && pauseClock.startedAt !== null
      ? Math.max(0, rawEnd - pauseClock.startedAt)
      : 0;
  const durationMs = Math.max(
    0,
    end - start - pauseClock.accumulatedMs - resumingPauseMs,
  );
  const callLabel = `${items.length} tool ${items.length === 1 ? 'call' : 'calls'}`;
  const visibleItems =
    expansionMode === 'auto' ? items.slice(-AUTO_EXPANDED_TOOL_CALL_LIMIT) : items;
  const groupedItems = compactRepeatedToolItems(visibleItems);
  const showThinkingActivity =
    active && !awaitingApproval && items.every(toolActivityIsSettled);

  return (
    <div>
      <AgentRunSummaryLine
        active={active}
        durationMs={durationMs}
        label={awaitingApproval ? 'Approval required' : undefined}
        tone={awaitingApproval ? 'approval' : 'default'}
        detail={
          awaitingApproval
            ? `Worked ${formatWorkingDuration(durationMs)} · ${callLabel}`
            : callLabel
        }
        trailing={<ToolRunChevron open={expanded} />}
        expanded={expanded}
        onToggle={() =>
          setExpansionMode((current) => (current === 'collapsed' ? 'manual' : 'collapsed'))
        }
      />
      {expanded ? (
        <div className="mt-1 space-y-1">
          {groupedItems.map((item) =>
            item.type === 'toolGroup' ? (
              <RepeatedToolActivityRow
                key={item.key}
                items={item.items}
                blocked={awaitingApproval}
              />
            ) : item.type === 'tool' ? (
              <ToolActivityRow
                key={item.key}
                call={item.call}
                result={item.result}
                droneNameById={droneNameById}
                blocked={awaitingApproval && !item.result}
              />
            ) : null,
          )}
          {showThinkingActivity ? <AgentThinkingActivityRow /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AssistantMessageRow({
  message,
  messageExtras,
  droneMentionLinks,
  onOpenDroneMention,
  showToolCalls = true,
  showReasoning = false,
  autoExpandMessage = false,
}: {
  message: AssistantMessage;
  messageExtras?: Omit<AgentMessageExtrasProps, 'text' | 'tasks'>;
  droneMentionLinks?: MarkdownTextMentionLink[];
  onOpenDroneMention?: (mention: MarkdownTextMentionLink) => void;
  showToolCalls?: boolean;
  showReasoning?: boolean;
  autoExpandMessage?: boolean;
}) {
  const calls = showToolCalls ? toolCalls(message) : [];
  const content = message.content;
  const visibleText =
    message.role === 'assistant' ? assistantVisibleText(message) : messageText(message);
  const agentMessage = React.useMemo(
    () =>
      extractAgentMessageContent(
        visibleText,
        message.role === 'assistant' && !message.errorMessage,
      ),
    [message.errorMessage, message.role, visibleText],
  );
  const renderedInlineMediaHrefs = React.useMemo(
    () =>
      collectInlineAgentMedia(
        agentMessage.text,
        messageExtras?.droneId,
        messageExtras?.droneHomePath,
      )
        .map((media) => media.linkHref)
        .filter((href): href is string => Boolean(href)),
    [agentMessage.text, messageExtras?.droneHomePath, messageExtras?.droneId],
  );
  const structuredAssistant =
    message.role === 'assistant' &&
    Array.isArray(content) &&
    content.some(
      (part) => part?.type === 'thinking' || part?.type === 'text' || part?.type === 'toolCall',
    );

  if (message.role === 'toolResult') {
    return <ToolActivityRow result={message} />;
  }

  if (message.role === 'user') {
    const images = messageImageParts(message);
    const attachments = normalizeImageAttachmentRefs((message.details as any)?.attachments);
    return (
      <UserChatMessage
        at={message.createdAt}
        text={visibleText}
        images={images.map((image, index) => ({
          key: `${image.mimeType}:${index}`,
          src: `data:${image.mimeType};base64,${image.data}`,
          alt: 'Attached image',
        }))}
        attachmentContent={<ImageAttachmentChips attachments={attachments} />}
        autoExpand={autoExpandMessage}
        onOpenFileReference={messageExtras?.onOpenFileReference}
        onOpenLink={messageExtras?.onOpenLink}
        textMentionLinks={droneMentionLinks}
        onOpenTextMention={onOpenDroneMention}
      />
    );
  }

  let body: React.ReactNode = null;
  if (message.role === 'assistant' && structuredAssistant) {
    const blocks: React.ReactNode[] = [];
    let lastThinkingPartIndex = -1;
    for (let i = 0; i < content.length; i += 1) {
      if (content[i]?.type === 'thinking') lastThinkingPartIndex = i;
    }
    const lastBlock = lastAssistantContentBlock(message);
    for (let i = 0; i < content.length; i += 1) {
      const part = content[i];
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'thinking') {
        const thinkingText = String(part.thinking ?? '');
        const currentReasoning = Boolean(
          showReasoning && lastBlock?.type === 'thinking' && i === lastThinkingPartIndex,
        );
        if (currentReasoning) {
          blocks.push(
            <ReasoningBlock key={`th:${i}`} text={thinkingText} />,
          );
        }
      } else if (part.type === 'text') {
        const t = extractAgentMessageContent(
          String(part.text ?? ''),
          !message.errorMessage,
        ).text.trim();
        if (t) {
          blocks.push(
            <ChatMessageBody
              key={`tx:${i}`}
              role="assistant"
              text={t}
              autoExpand={autoExpandMessage}
              renderedInlineMediaHrefs={renderedInlineMediaHrefs}
              onOpenFileReference={messageExtras?.onOpenFileReference}
              onOpenLink={messageExtras?.onOpenLink}
              textMentionLinks={droneMentionLinks}
              onOpenTextMention={onOpenDroneMention}
            />,
          );
        }
      }
    }
    body = blocks.length > 0 ? <div className="space-y-1">{blocks}</div> : null;
  } else {
    const text = agentMessage.text;
    const images = messageImageParts(message);
    body = text || images.length > 0 || message.errorMessage ? (
      <ChatMessageBody
        role="assistant"
        text={text}
        error={Boolean(message.errorMessage)}
        errorMessage={message.errorMessage}
        images={images.map((image, index) => ({
          key: `${image.mimeType}:${index}`,
          src: `data:${image.mimeType};base64,${image.data}`,
          alt: 'Attached image',
        }))}
        autoExpand={autoExpandMessage}
        renderedInlineMediaHrefs={renderedInlineMediaHrefs}
        onOpenFileReference={messageExtras?.onOpenFileReference}
        onOpenLink={messageExtras?.onOpenLink}
        textMentionLinks={droneMentionLinks}
        onOpenTextMention={onOpenDroneMention}
      />
    ) : null;
  }

  if (
    message.role === 'assistant' &&
    !body &&
    !message.errorMessage &&
    calls.length === 0 &&
    agentMessage.tasks.length === 0
  )
    return null;

  return (
    <ChatMessageFrame
      role="assistant"
      at={message.createdAt}
      error={Boolean(message.errorMessage)}
      showRoleLabel={false}
      plainAssistant
    >
      {body}
      {!body && message.errorMessage ? (
        <div className="text-[var(--text-12)] text-[var(--red)]">{message.errorMessage}</div>
      ) : null}
      {calls.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {calls.map((call) => (
            <ToolDisclosure key={call.id} title={toolLabel(call.name)}>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[var(--text-10)] text-[var(--muted-dim)]">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </ToolDisclosure>
          ))}
        </div>
      ) : null}
      {message.role === 'assistant' ? (
        <AgentMessageExtras
          {...messageExtras}
          text={agentMessage.text}
          tasks={agentMessage.tasks}
          messageId={
            messageExtras?.messageId ??
            String(message.id ?? message.createdAt ?? message.timestamp ?? 'assistant-message')
          }
        />
      ) : null}
    </ChatMessageFrame>
  );
}
