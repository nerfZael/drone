import React from 'react';
import {
  useDroneHubRuntimeStore,
  type RepoApplyProgress,
} from './use-drone-hub-runtime-store';

type NameSuggestToast = {
  id: string;
  title?: string;
  message: string;
  tone?: 'success' | 'error';
  voiceLevel?: number;
  voiceActive?: boolean;
};

type HubTransientToastsProps = {
  nameSuggestToast: NameSuggestToast | null;
  jobsModalError: string | null;
  jobsModalOpen: boolean;
  onDismissNameSuggestToast: () => void;
  onDismissJobsModalError: () => void;
};

export function HubTransientToasts({
  nameSuggestToast,
  jobsModalError,
  jobsModalOpen,
  onDismissNameSuggestToast,
  onDismissJobsModalError,
}: HubTransientToastsProps) {
  const nameSuggestToastTone = nameSuggestToast?.tone === 'success' ? 'success' : 'error';
  const nameSuggestToastBorderClass =
    nameSuggestToastTone === 'success' ? 'border-[var(--green-border)]' : 'border-[var(--red-border)]';
  const nameSuggestToastLabelClass =
    nameSuggestToastTone === 'success' ? 'text-[var(--green)]' : 'text-[var(--red)]';
  const voiceLevel = Math.max(0, Math.min(1, Number(nameSuggestToast?.voiceLevel ?? 0)));
  const repoApplyProgressByToken = useDroneHubRuntimeStore(
    (state) => state.repoApplyProgressByToken,
  );
  const repoApplyProgress = React.useMemo(
    () =>
      Object.values(repoApplyProgressByToken).sort((a, b) => a.startedAt - b.startedAt),
    [repoApplyProgressByToken],
  );

  return (
    <>
      <RepoApplyProgressToast
        progress={repoApplyProgress}
        stackedToastCount={
          (nameSuggestToast ? 1 : 0) + (jobsModalError && !jobsModalOpen ? 1 : 0)
        }
      />

      {nameSuggestToast && (
        <div
          onClick={onDismissNameSuggestToast}
          title="Click to dismiss"
          className={`fixed right-4 z-50 max-w-[420px] rounded-[var(--radius-large)] border ${nameSuggestToastBorderClass} bg-[var(--panel-alt)] shadow-[0_16px_48px_var(--shadow-color)] px-4 py-3 animate-slide-up ${
            jobsModalError && !jobsModalOpen ? 'bottom-[98px]' : 'bottom-4'
          } cursor-pointer`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className={`text-[var(--text-10)] font-[var(--weight-semibold)] mb-1 tracking-wide uppercase ${nameSuggestToastLabelClass}`} style={{ fontFamily: 'var(--display)' }}>
                {nameSuggestToast.title ?? (nameSuggestToastTone === 'success' ? 'Action completed' : 'Action failed')}
              </div>
              {nameSuggestToast.voiceActive ? <VoiceLevelBars level={voiceLevel} /> : null}
              <div className="text-[var(--text-11)] text-[var(--muted)] whitespace-pre-wrap">{nameSuggestToast.message}</div>
            </div>
            <button
              type="button"
              onClick={onDismissNameSuggestToast}
              className="inline-flex items-center justify-center w-6 h-6 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)] transition-all"
              title="Dismiss"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {jobsModalError && !jobsModalOpen && (
        <div
          onClick={onDismissJobsModalError}
          title="Click to dismiss"
          className="fixed bottom-4 right-4 z-50 max-w-[420px] rounded-[var(--radius-large)] border border-[var(--red-border)] bg-[var(--panel-alt)] shadow-[0_16px_48px_var(--shadow-color)] px-4 py-3 animate-slide-up cursor-pointer"
        >
          <div className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--red)] mb-1 tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Failed to create jobs</div>
          <div className="text-[var(--text-11)] text-[var(--muted)] whitespace-pre-wrap">{jobsModalError}</div>
        </div>
      )}
    </>
  );
}

export function RepoApplyProgressToast({
  progress,
  stackedToastCount = 0,
}: {
  progress: RepoApplyProgress[];
  stackedToastCount?: number;
}) {
  const applyCount = progress.length;
  if (applyCount === 0) return null;
  const applyLabel =
    applyCount === 1 ? progress[0]?.droneLabel ?? 'drone' : `${applyCount} drones`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Applying changes from ${applyLabel} to host`}
      className={`fixed right-4 z-50 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_54px_var(--shadow-color)] animate-slide-up ${
        stackedToastCount >= 2
          ? 'bottom-[210px]'
          : stackedToastCount === 1
            ? 'bottom-[112px]'
            : 'bottom-4'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div
          aria-hidden="true"
          className="relative flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--info-border)] bg-[var(--info-subtle)]"
        >
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--info-border)] border-t-[var(--info)] motion-reduce:animate-none" />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--info)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Applying changes to host
          </div>
          <div className="mt-0.5 truncate text-[var(--text-11)] text-[var(--muted)]">
            Syncing from {applyLabel}. You can keep chatting.
          </div>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Apply progress"
        className="h-0.5 overflow-hidden bg-[var(--surface-softest)]"
      >
        <span className="block h-full w-1/3 animate-[repo-sync-progress_1.4s_ease-in-out_infinite] rounded-full bg-[var(--info)] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
      </div>
    </div>
  );
}

function VoiceLevelBars({ level }: { level: number }) {
  const bars = [0.28, 0.5, 0.72, 0.94, 0.64, 0.42, 0.8];
  return (
    <div className="mb-2 flex h-8 items-end gap-1" aria-hidden="true">
      {bars.map((base, index) => {
        const lift = Math.max(0.12, Math.min(1, base * 0.35 + level * (0.65 + (index % 3) * 0.1)));
        return (
          <span
            key={index}
            className="w-1.5 rounded-full bg-[var(--green)] opacity-80 shadow-[var(--glow-green)] transition-[height,opacity] duration-100 ease-out"
            style={{
              height: `${Math.round(6 + lift * 22)}px`,
              opacity: 0.35 + level * 0.6,
            }}
          />
        );
      })}
    </div>
  );
}
