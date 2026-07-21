import React from 'react';

import {
  AgentMessageExtras,
  extractAgentMessageContent,
  type AgentMessageExtrasProps,
} from '../chat/AgentMessageExtras';
import type { MarkdownTextMentionLink } from '../chat/MarkdownMessage';
import { ChatMessageBody } from '../chat/ChatMessageBody';
import { ChatMessageCopyAction } from '../chat/ChatMessageCopyAction';
import { ChatMessageFrame } from '../chat/ChatMessageFrame';
import { AgentRunSummaryLine, formatWorkingDuration } from '../chat/WorkingElapsedStatus';
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
  const statusLabel = failed ? 'Failed' : running ? 'Working' : 'Queued';
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
  status?: 'ok' | 'error';
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--fg-secondary)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {status ? (
          <span
            className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${
              status === 'error'
                ? 'bg-[var(--red)] text-[var(--bg)]'
                : 'bg-[var(--green)] text-[var(--bg)]'
            }`}
          >
            {status === 'error' ? (
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            ) : (
              <ToolCheckIcon className="h-2.5 w-2.5" />
            )}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border-subtle)] px-2 py-1.5">{children}</div>
      ) : null}
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

function ThinkingPulseDots() {
  return (
    <span
      className="inline-flex h-6 flex-shrink-0 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2"
      aria-hidden="true"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]" />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]"
        style={{ animationDelay: '120ms' }}
      />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted)]"
        style={{ animationDelay: '240ms' }}
      />
    </span>
  );
}

export function AssistantThinkingRow() {
  return (
    <div className="px-3 py-2">
      <ThinkingPulseDots />
    </div>
  );
}

function ReasoningBlock({ text, headerPulse }: { text: string; headerPulse: boolean }) {
  const [open, setOpen] = React.useState(false);
  const trimmed = text.trim();
  if (!trimmed && !headerPulse) return null;

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
        {headerPulse ? <ThinkingPulseDots /> : null}
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
      ) : headerPulse ? (
        <div className="border-t border-[var(--border-subtle)] px-2.5 py-2 text-[var(--text-11)] text-[var(--muted-dim)]">
          …
        </div>
      ) : null}
    </div>
  );
}

function ToolStatusIndicator({ result }: { result?: AssistantMessage }) {
  const dotClass = !result
    ? 'bg-[var(--accent)]'
    : result.isError
      ? 'bg-[var(--red)]'
      : 'bg-[var(--green)]';
  if (!result || result.isError)
    return <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass}`} />;
  return (
    <span
      className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${dotClass} text-[var(--bg)]`}
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
      className="ml-auto flex h-5 flex-shrink-0 items-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
      style={{ fontFamily: 'var(--display)' }}
    >
      {open ? 'Hide details' : 'Details'}
    </button>
  );
}

function ToolPayloadDetails({
  call,
  result,
}: {
  call?: AssistantToolCall;
  result?: AssistantMessage;
}) {
  const resultText = result ? messageText(result) : '';
  return (
    <div className="grid gap-2 border-t border-[var(--border-subtle)] px-2.5 py-2">
      {call ? (
        <div>
          <div
            className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Arguments
          </div>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[var(--text-10)] text-[var(--muted-dim)]">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        </div>
      ) : null}
      {result ? (
        <div className={call ? 'border-t border-[var(--border-subtle)] pt-2' : ''}>
          <div
            className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Result
          </div>
          {resultText ? (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[var(--text-11)] text-[var(--fg-secondary)]">
              {resultText}
            </pre>
          ) : (
            <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">No result payload.</div>
          )}
        </div>
      ) : (
        <div className="text-[var(--text-11)] text-[var(--muted-dim)]">Waiting for result...</div>
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
  const percent =
    totalBytes > 0
      ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100))
      : progress?.phase === 'completed'
        ? 100
        : 0;
  const files = Array.isArray(progress?.files) ? progress.files : [];
  const failed = result?.isError === true || progress?.phase === 'failed';
  const sourceLabel = progress?.source?.targetLabel || call.args?.sourceTarget || 'Source';
  const destinationLabel =
    progress?.destination?.targetLabel || call.args?.destinationTarget || 'Destination';
  return (
    <div
      className={`mx-3 overflow-hidden rounded border ${failed ? 'border-[var(--red)]' : 'border-[var(--border-subtle)]'} bg-[var(--surface-soft)]`}
    >
      <div className="px-2.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ToolStatusIndicator
            result={result && progress?.phase !== 'completed' && !failed ? undefined : result}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div
                className="truncate text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Transfer files
              </div>
              <div className="tabular-nums text-[var(--text-10)] text-[var(--muted)]">
                {progress
                  ? `${formatTransferBytes(transferredBytes)} / ${formatTransferBytes(totalBytes)}`
                  : 'Preparing…'}
              </div>
            </div>
            <div className="mt-1 truncate text-[var(--text-11)] text-[var(--fg-secondary)]">
              {sourceLabel} <span className="text-[var(--muted-dim)]">→</span> {destinationLabel}
            </div>
          </div>
          <ToolDetailsButton open={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} />
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-strong)]">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${failed ? 'bg-[var(--red)]' : 'bg-[var(--accent)]'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[var(--text-10)] text-[var(--muted-dim)]">
          <span>
            {progress?.phase === 'planning'
              ? 'Scanning folder…'
              : `${progress?.completedFiles ?? 0} of ${progress?.fileCount ?? files.length} files`}
          </span>
          <span>
            {progress?.retries
              ? `${progress.retries} ${progress.retries === 1 ? 'retry' : 'retries'}`
              : `${percent}%`}
          </span>
        </div>
        {failed && progress?.failure?.error ? (
          <div className="mt-1.5 text-[var(--text-10)] text-[var(--red)]">
            {progress.failure.error}
            {progress.failure.cleanupError ? ` Cleanup: ${progress.failure.cleanupError}` : ''}
          </div>
        ) : null}
        {failed && progress?.resumeToken ? (
          <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
            The assistant can resume after {progress.completedFiles ?? 0} committed files.
          </div>
        ) : null}
      </div>
      {detailsOpen && files.length > 0 ? (
        <div className="max-h-56 overflow-y-auto border-t border-[var(--border-subtle)] p-2">
          <div className="grid gap-1.5">
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
                  className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5"
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
        </div>
      ) : null}
    </div>
  );
}

export function RepeatedToolActivityRow({ items }: { items: AssistantToolRenderItem[] }) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const first = items[0];
  const name = toolItemName(first);
  const label = toolLabel(name);
  const errorCount = items.filter((item) => item.result?.isError).length;
  const pendingCount = items.filter((item) => !item.result).length;
  const statusText = [
    pendingCount > 0 ? `${pendingCount} pending` : '',
    errorCount > 0 ? `${errorCount} failed` : '',
  ].filter(Boolean).join(', ');
  const statusResult: AssistantMessage | undefined =
    errorCount > 0
      ? { role: 'toolResult', isError: true, content: '' }
      : pendingCount > 0
        ? undefined
        : { role: 'toolResult', content: '' };

  return (
    <div className="mx-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[var(--surface-soft)]">
      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-label={detailsOpen ? `Collapse ${label} calls` : `Expand ${label} calls`}
        onClick={() => setDetailsOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-[var(--surface-soft)]"
      >
        <ToolStatusIndicator result={statusResult} />
        <span
          className="min-w-0 truncate text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          {label}
        </span>
        <span className="flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
          x{items.length}
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
        <div className="grid gap-2 border-t border-[var(--border-subtle)] p-2">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="overflow-hidden rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)]"
            >
              <div className="flex min-w-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
                <ToolStatusIndicator result={item.result} />
                <div
                  className="min-w-0 flex-1 truncate text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {label} #{index + 1}
                </div>
              </div>
              <ToolPayloadDetails call={item.call} result={item.result} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MessageDroneActivityRow({
  call,
  result,
  droneNameById,
}: {
  call: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById: AssistantDroneNameMap;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const summary = messageDroneDetails(call.args, droneNameById);
  const preview = compactPreview(summary.message, 220);
  return (
    <div className="mx-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[var(--surface-soft)]">
      <div className="px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ToolStatusIndicator result={result} />
            <div
              className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Send user message
            </div>
            <ToolDetailsButton
              open={detailsOpen}
              onClick={() => setDetailsOpen((value) => !value)}
            />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-[var(--text-11)] text-[var(--fg-secondary)]">
              <span className="truncate">{summary.droneLabel || 'Target drone'}</span>
            </span>
            {summary.chatName && summary.chatName !== 'default' ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-[var(--text-11)] text-[var(--muted)]">
                <span className="truncate">{summary.chatName}</span>
              </span>
            ) : null}
          </div>
          {preview ? (
            <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5 text-[var(--text-12)] leading-5 text-[var(--fg-secondary)]">
              {preview}
            </div>
          ) : (
            <div className="mt-2 text-[var(--text-11)] text-[var(--muted-dim)]">
              No message preview available.
            </div>
          )}
        </div>
      </div>
      {detailsOpen ? <ToolPayloadDetails call={call} result={result} /> : null}
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
    <div className="mx-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[var(--surface-soft)]">
      <div className="border-b border-[var(--border-subtle)] px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ToolStatusIndicator result={result} />
            <div
              className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              {label}
            </div>
            <ToolDetailsButton
              open={detailsOpen}
              onClick={() => setDetailsOpen((value) => !value)}
            />
          </div>
          <div className="mt-1 text-[var(--text-12)] text-[var(--fg-secondary)]">
            {targetSummary || 'Resolving target drones'}
          </div>
        </div>
      </div>
      <div className="grid gap-1.5 p-2">
        {targets.length > 0 ? (
          targets.map((target) => (
            <div
              key={target.key}
              className="flex min-h-8 min-w-0 items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2"
            >
              <div className="min-w-0 flex-1 truncate text-[var(--text-12)] font-medium text-[var(--fg-secondary)]">
                {target.droneLabel}
              </div>
              {target.chatName && target.chatName !== 'default' ? (
                <div className="max-w-[42%] truncate rounded border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-1.5 py-0.5 text-[var(--text-10)] text-[var(--muted)]">
                  {target.chatName}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-2 text-[var(--text-11)] text-[var(--muted-dim)]">
            Waiting for result...
          </div>
        )}
      </div>
      {detailsOpen ? <ToolPayloadDetails call={call} result={result} /> : null}
    </div>
  );
}

export function ToolActivityRow({
  call,
  result,
  droneNameById = {},
}: {
  call?: AssistantToolCall;
  result?: AssistantMessage;
  droneNameById?: AssistantDroneNameMap;
}) {
  if (call?.name === 'transfer_files') {
    return <TransferActivityRow call={call} result={result} />;
  }
  if (call?.name === 'message_drone') {
    return <MessageDroneActivityRow call={call} result={result} droneNameById={droneNameById} />;
  }

  if (call && isChatIdleToolName(call.name)) {
    return <ChatsIdleActivityRow call={call} result={result} droneNameById={droneNameById} />;
  }

  const title = toolActivityTitle(call, result, droneNameById);
  const resultText = result ? messageText(result) : '';
  return (
    <div className="mx-3">
      <ToolDisclosure title={title} status={result ? (result.isError ? 'error' : 'ok') : undefined}>
        {call ? (
          <div>
            <div
              className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Arguments
            </div>
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[var(--text-10)] text-[var(--muted-dim)]">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
        ) : null}
        {result ? (
          <div className={call ? 'mt-2 border-t border-[var(--border-subtle)] pt-2' : ''}>
            <div
              className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Result
            </div>
            {resultText ? (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[var(--text-11)] text-[var(--fg-secondary)]">
                {resultText}
              </pre>
            ) : (
              <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">No result payload.</div>
            )}
          </div>
        ) : (
          <div
            className={
              call
                ? 'mt-2 border-t border-[var(--border-subtle)] pt-2 text-[var(--text-11)] text-[var(--muted-dim)]'
                : 'text-[var(--text-11)] text-[var(--muted-dim)]'
            }
          >
            Waiting for result...
          </div>
        )}
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

export function ToolRunActivity({
  items,
  active,
  startedAt,
  endedAt,
  droneNameById = {},
  initiallyExpanded = false,
}: {
  items: AssistantToolRenderItem[];
  active: boolean;
  startedAt?: number;
  endedAt?: number;
  droneNameById?: AssistantDroneNameMap;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(initiallyExpanded);
  const fallbackStart = React.useRef(Date.now()).current;
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (items.length === 0) return null;
  const start = Number.isFinite(startedAt) ? Number(startedAt) : fallbackStart;
  const end = active ? now : Number.isFinite(endedAt) ? Number(endedAt) : start;
  const callLabel = `${items.length} tool ${items.length === 1 ? 'call' : 'calls'}`;
  const groupedItems = compactRepeatedToolItems(items);

  return (
    <div>
      <AgentRunSummaryLine
        active={active}
        durationMs={Math.max(0, end - start)}
        detail={callLabel}
        trailing={<ToolRunChevron open={expanded} />}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className="mt-1 space-y-1">
          {groupedItems.map((item) =>
            item.type === 'toolGroup' ? (
              <RepeatedToolActivityRow key={item.key} items={item.items} />
            ) : item.type === 'tool' ? (
              <ToolActivityRow
                key={item.key}
                call={item.call}
                result={item.result}
                droneNameById={droneNameById}
              />
            ) : null,
          )}
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
  isStreamingAssistant = false,
  showReasoning = false,
  autoExpandAgentMessage = false,
}: {
  message: AssistantMessage;
  messageExtras?: Omit<AgentMessageExtrasProps, 'text' | 'tasks'>;
  droneMentionLinks?: MarkdownTextMentionLink[];
  onOpenDroneMention?: (mention: MarkdownTextMentionLink) => void;
  showToolCalls?: boolean;
  isStreamingAssistant?: boolean;
  showReasoning?: boolean;
  autoExpandAgentMessage?: boolean;
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
  const structuredAssistant =
    message.role === 'assistant' &&
    Array.isArray(content) &&
    content.some(
      (part) => part?.type === 'thinking' || part?.type === 'text' || part?.type === 'toolCall',
    );

  if (message.role === 'toolResult') {
    return <ToolActivityRow result={message} />;
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
        const headerPulse = Boolean(isStreamingAssistant && currentReasoning);
        if (currentReasoning) {
          blocks.push(
            <ReasoningBlock key={`th:${i}`} text={thinkingText} headerPulse={headerPulse} />,
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
              autoExpand={autoExpandAgentMessage}
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
    const text = message.role === 'assistant' ? agentMessage.text : visibleText;
    const images = messageImageParts(message);
    body = text || images.length > 0 || message.errorMessage ? (
      <ChatMessageBody
        role={message.role === 'user' ? 'user' : 'assistant'}
        text={text}
        error={Boolean(message.errorMessage)}
        errorMessage={message.errorMessage}
        images={images.map((image, index) => ({
          key: `${image.mimeType}:${index}`,
          src: `data:${image.mimeType};base64,${image.data}`,
          alt: 'Attached image',
        }))}
        autoExpand={message.role === 'assistant' && autoExpandAgentMessage}
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
      role={message.role === 'user' ? 'user' : 'assistant'}
      at={message.createdAt}
      error={Boolean(message.errorMessage)}
      showRoleLabel={false}
      plainAssistant
    >
      {message.role === 'user' ? <ChatMessageCopyAction text={visibleText} /> : null}
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
