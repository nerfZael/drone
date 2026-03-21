import React from 'react';
import { IconChevron, IconCopy } from './icons';
import type { UseHubLogsResult } from './use-hub-logs';

type SystemLogsSettingsTabProps = {
  hubLogsState: UseHubLogsResult;
  hubLogsTailLines: number;
  hubLogsMaxBytes: number;
};

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
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setHubLogsExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setHubLogsExpanded((v) => !v);
          }
        }}
        className="flex flex-wrap items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-[var(--hover)] transition-colors cursor-pointer"
        aria-expanded={hubLogsExpanded}
        aria-label={hubLogsExpanded ? 'Collapse hub logs' : 'Expand hub logs'}
      >
        <div className="inline-flex items-center gap-2 min-w-0">
          <IconChevron down={hubLogsExpanded} className="text-[var(--muted-dim)] opacity-80" />
          <div>
            <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
              Hub logs
            </div>
            <div className="text-[11px] text-[var(--muted-dim)] mt-1">Recent output from the Drone Hub process log.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void loadHubLogs();
            }}
            disabled={hubLogsLoading}
            className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
              hubLogsLoading
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Refresh hub logs"
          >
            {hubLogsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void copyHubLogs();
            }}
            disabled={hubLogsLoading || !String(hubLogs?.text ?? '').trim()}
            className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all inline-flex items-center gap-1.5 ${
              hubLogsLoading || !String(hubLogs?.text ?? '').trim()
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Copy hub logs"
          >
            <IconCopy className="opacity-80" />
            Copy
          </button>
        </div>
      </div>

      {hubLogsExpanded && (
        <>
          {hubLogsError && (
            <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
              {hubLogsError}
            </div>
          )}
          {hubLogsNotice && (
            <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
              {hubLogsNotice}
            </div>
          )}

          <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
            {hubLogs?.logPath ? (
              <>
                <span className="font-mono text-[var(--fg-secondary)]">{hubLogs.logPath}</span>
                {hubLogs.updatedAt ? ` • Updated ${new Date(hubLogs.updatedAt).toLocaleString()}` : ''}
                {hubLogs.truncated ? ' • Tail view (truncated)' : ''}
              </>
            ) : (
              'No hub log file found yet.'
            )}
          </div>

          <textarea
            ref={hubLogsTextareaRef}
            readOnly
            value={hubLogs?.text ?? ''}
            onScroll={handleHubLogsScroll}
            placeholder={hubLogsLoading ? 'Loading logs…' : 'No hub logs available yet.'}
            className="w-full min-h-[220px] max-h-[55vh] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] font-mono resize-y focus:outline-none"
          />
          <div className="text-[10px] text-[var(--muted-dim)]">
            Showing up to {(hubLogs?.tailLines ?? hubLogsTailLines).toLocaleString()} lines and {(hubLogs?.maxBytes ?? hubLogsMaxBytes).toLocaleString()} bytes.
          </div>
        </>
      )}
    </div>
  );
}
