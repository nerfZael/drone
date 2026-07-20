import React from 'react';
import { IconChevron, IconCopy } from './icons';
import type { UseHubLogsResult } from './use-hub-logs';
import type { HubLogsResponse } from './settings-types';

type SystemLogsSettingsTabProps = {
  hubLogsState: UseHubLogsResult;
  hubLogsTailLines: number;
  hubLogsMaxBytes: number;
};

type LogPanelProps = {
  title: string;
  description: string;
  emptyLabel: string;
  loadingLabel: string;
  copyTitle: string;
  refreshTitle: string;
  expandedLabel: string;
  collapsedLabel: string;
  copiedNotice: string | null;
  logs: HubLogsResponse | null;
  loading: boolean;
  error: string | null;
  expanded: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  loadLogs: () => Promise<void>;
  copyLogs: () => Promise<void>;
  handleScroll: (e: React.UIEvent<HTMLTextAreaElement>) => void;
  fallbackTailLines: number;
  fallbackMaxBytes: number;
};

function LogPanel({
  title,
  description,
  emptyLabel,
  loadingLabel,
  copyTitle,
  refreshTitle,
  expandedLabel,
  collapsedLabel,
  copiedNotice,
  logs,
  loading,
  error,
  expanded,
  textareaRef,
  setExpanded,
  loadLogs,
  copyLogs,
  handleScroll,
  fallbackTailLines,
  fallbackMaxBytes,
}: LogPanelProps) {
  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--settings-section-bg)] px-3 py-3 flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="flex flex-wrap items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-[var(--hover)] transition-colors cursor-pointer"
        aria-expanded={expanded}
        aria-label={expanded ? expandedLabel : collapsedLabel}
      >
        <div className="inline-flex items-center gap-2 min-w-0">
          <IconChevron down={expanded} className="text-[var(--muted-dim)] opacity-80" />
          <div>
            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
              {title}
            </div>
            <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">{description}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void loadLogs();
            }}
            disabled={loading}
            className={`h-8 px-3 rounded text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
              loading
                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={refreshTitle}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void copyLogs();
            }}
            disabled={loading || !String(logs?.text ?? '').trim()}
            className={`h-8 px-3 rounded text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all inline-flex items-center gap-1.5 ${
              loading || !String(logs?.text ?? '').trim()
                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={copyTitle}
          >
            <IconCopy className="opacity-80" />
            Copy
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {error && (
            <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
              {error}
            </div>
          )}
          {copiedNotice && (
            <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
              {copiedNotice}
            </div>
          )}

          <div className="text-[var(--text-11)] text-[var(--muted-dim)] leading-relaxed">
            {logs?.logPath ? (
              <>
                <span className="font-mono text-[var(--fg-secondary)]">{logs.logPath}</span>
                {logs.updatedAt ? ` • Updated ${new Date(logs.updatedAt).toLocaleString()}` : ''}
                {logs.truncated ? ' • Tail view (truncated)' : ''}
              </>
            ) : (
              emptyLabel
            )}
          </div>

          <textarea
            ref={textareaRef}
            readOnly
            value={logs?.text ?? ''}
            onScroll={handleScroll}
            placeholder={loading ? loadingLabel : emptyLabel}
            className="w-full min-h-[220px] max-h-[55vh] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-3 py-2 text-[var(--text-12)] leading-relaxed text-[var(--fg-secondary)] font-mono resize-y focus:outline-none"
          />
          <div className="text-[var(--text-10)] text-[var(--muted-dim)]">
            Showing up to {(logs?.tailLines ?? fallbackTailLines).toLocaleString()} lines and {(logs?.maxBytes ?? fallbackMaxBytes).toLocaleString()} bytes.
          </div>
        </>
      )}
    </div>
  );
}

export function SystemLogsSettingsTab({
  hubLogsState,
  hubLogsTailLines,
  hubLogsMaxBytes,
}: SystemLogsSettingsTabProps) {
  const {
    hubLogs,
    hubLogsLoading,
    hubLogsError,
    hubLogsNotice,
    hubLogsExpanded,
    hubLogsTextareaRef,
    setHubLogsExpanded,
    loadHubLogs,
    copyHubLogs,
    handleHubLogsScroll,
  } = hubLogsState;

  return (
    <div className="flex flex-col gap-3">
      <LogPanel
        title="Hub logs"
        description="Recent output from the Drone Hub process log."
        emptyLabel="No hub log file found yet."
        loadingLabel="Loading hub logs..."
        copyTitle="Copy hub logs"
        refreshTitle="Refresh hub logs"
        expandedLabel="Collapse hub logs"
        collapsedLabel="Expand hub logs"
        copiedNotice={hubLogsNotice}
        logs={hubLogs}
        loading={hubLogsLoading}
        error={hubLogsError}
        expanded={hubLogsExpanded}
        textareaRef={hubLogsTextareaRef}
        setExpanded={setHubLogsExpanded}
        loadLogs={loadHubLogs}
        copyLogs={copyHubLogs}
        handleScroll={handleHubLogsScroll}
        fallbackTailLines={hubLogsTailLines}
        fallbackMaxBytes={hubLogsMaxBytes}
      />
    </div>
  );
}
