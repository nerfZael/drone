import React from 'react';

type NameSuggestToast = {
  id: string;
  message: string;
};

type HubTransientToastsProps = {
  nameSuggestToast: NameSuggestToast | null;
  jobsModalError: string | null;
  jobsModalOpen: boolean;
  onDismissNameSuggestToast: () => void;
};

export function HubTransientToasts({
  nameSuggestToast,
  jobsModalError,
  jobsModalOpen,
  onDismissNameSuggestToast,
}: HubTransientToastsProps) {
  return (
    <>
      {nameSuggestToast && (
        <div
          className={`fixed right-4 z-50 max-w-[420px] rounded-lg border border-[rgba(255,90,90,.2)] bg-[var(--panel-alt)] shadow-[0_16px_48px_rgba(0,0,0,.3)] px-4 py-3 animate-slide-up ${
            jobsModalError && !jobsModalOpen ? 'bottom-[98px]' : 'bottom-4'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold text-[var(--red)] mb-1 tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Name suggestion failed
              </div>
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
        <div className="fixed bottom-4 right-4 z-50 max-w-[420px] rounded-lg border border-[rgba(255,90,90,.2)] bg-[var(--panel-alt)] shadow-[0_16px_48px_rgba(0,0,0,.3)] px-4 py-3 animate-slide-up">
          <div className="text-[10px] font-semibold text-[var(--red)] mb-1 tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Failed to create jobs</div>
          <div className="text-[11px] text-[var(--muted)] whitespace-pre-wrap">{jobsModalError}</div>
        </div>
      )}
    </>
  );
}
