import React from 'react';

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
    nameSuggestToastTone === 'success' ? 'border-[rgba(74,222,128,.28)]' : 'border-[rgba(255,90,90,.2)]';
  const nameSuggestToastLabelClass =
    nameSuggestToastTone === 'success' ? 'text-[var(--green)]' : 'text-[var(--red)]';
  const voiceLevel = Math.max(0, Math.min(1, Number(nameSuggestToast?.voiceLevel ?? 0)));

  return (
    <>
      {nameSuggestToast && (
        <div
          onClick={onDismissNameSuggestToast}
          title="Click to dismiss"
          className={`fixed right-4 z-50 max-w-[420px] rounded-lg border ${nameSuggestToastBorderClass} bg-[var(--panel-alt)] shadow-[0_16px_48px_rgba(0,0,0,.3)] px-4 py-3 animate-slide-up ${
            jobsModalError && !jobsModalOpen ? 'bottom-[98px]' : 'bottom-4'
          } cursor-pointer`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className={`text-[10px] font-semibold mb-1 tracking-wide uppercase ${nameSuggestToastLabelClass}`} style={{ fontFamily: 'var(--display)' }}>
                {nameSuggestToast.title ?? (nameSuggestToastTone === 'success' ? 'Action completed' : 'Action failed')}
              </div>
              {nameSuggestToast.voiceActive ? <VoiceLevelBars level={voiceLevel} /> : null}
              <div className="text-[11px] text-[var(--muted)] whitespace-pre-wrap">{nameSuggestToast.message}</div>
            </div>
            <button
              type="button"
              onClick={onDismissNameSuggestToast}
              className="inline-flex items-center justify-center w-6 h-6 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)] transition-all"
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
          className="fixed bottom-4 right-4 z-50 max-w-[420px] rounded-lg border border-[rgba(255,90,90,.2)] bg-[var(--panel-alt)] shadow-[0_16px_48px_rgba(0,0,0,.3)] px-4 py-3 animate-slide-up cursor-pointer"
        >
          <div className="text-[10px] font-semibold text-[var(--red)] mb-1 tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Failed to create jobs</div>
          <div className="text-[11px] text-[var(--muted)] whitespace-pre-wrap">{jobsModalError}</div>
        </div>
      )}
    </>
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
            className="w-1.5 rounded-full bg-[var(--green)] opacity-80 shadow-[0_0_10px_rgba(74,222,128,.18)] transition-[height,opacity] duration-100 ease-out"
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
