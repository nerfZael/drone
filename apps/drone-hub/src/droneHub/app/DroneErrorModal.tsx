import React from 'react';
import { copyText } from './clipboard';
import { IconCopy } from './icons';
import type { DroneErrorModalState } from './app-types';

type DroneErrorModalProps = {
  droneErrorModal: DroneErrorModalState;
  clearingDroneError: boolean;
  onClose: () => void;
  onClearDroneHubError: (droneId: string) => void;
};

export function DroneErrorModal({ droneErrorModal, clearingDroneError, onClose, onClearDroneHubError }: DroneErrorModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Error details for ${droneErrorModal.droneName}`}
    >
      <div className="w-full max-w-[720px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--red)] via-[rgba(255,140,140,.7)] to-transparent opacity-60" />
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase truncate" style={{ fontFamily: 'var(--display)' }}>
              Drone error
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-1 truncate font-mono" title={droneErrorModal.droneName}>
              {droneErrorModal.droneName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          {droneErrorModal.conflict.isConflict && (
            <div className="mb-3 p-3 rounded border border-[rgba(255,90,90,.18)] bg-[rgba(255,90,90,.08)]">
              <div className="text-[10px] font-semibold text-[var(--red)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Repo conflict detected
              </div>
              {droneErrorModal.conflict.patchName && (
                <div className="mt-1 text-[11px] text-[var(--muted)] font-mono truncate" title={droneErrorModal.conflict.patchName}>
                  patch: {droneErrorModal.conflict.patchName}
                </div>
              )}
              {droneErrorModal.conflict.files.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] text-[var(--muted-dim)] mb-1">Files</div>
                  <div className="max-h-20 overflow-y-auto rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] p-2 font-mono text-[10px] text-[var(--fg-secondary)]">
                    {droneErrorModal.conflict.files.map((file) => (
                      <div key={file} className="truncate" title={file}>
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 text-[10px] text-[var(--muted-dim)] leading-relaxed">
                Conflict markers: <span className="font-mono text-[var(--fg-secondary)]">&lt;&lt;&lt;&lt;&lt;&lt;&lt; ours</span> is the current branch in the target
                repo, and <span className="font-mono text-[var(--fg-secondary)]">&gt;&gt;&gt;&gt;&gt;&gt;&gt; theirs</span> is the incoming branch being merged.
              </div>
            </div>
          )}
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase mb-2" style={{ fontFamily: 'var(--display)' }}>
            Full message
          </div>
          <textarea
            readOnly
            value={droneErrorModal.message}
            className="w-full min-h-[220px] max-h-[55vh] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] font-mono resize-y focus:outline-none"
          />
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)] bg-[rgba(0,0,0,.1)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onClearDroneHubError(droneErrorModal.droneId)}
            disabled={clearingDroneError}
            className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
              clearingDroneError
                ? 'opacity-50 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Clear this drone error badge"
          >
            {clearingDroneError ? 'Clearing...' : 'Clear error'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copyText(droneErrorModal.message)}
              className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] transition-all inline-flex items-center gap-1.5"
              style={{ fontFamily: 'var(--display)' }}
            >
              <IconCopy className="opacity-70" />
              Copy
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] transition-all"
              style={{ fontFamily: 'var(--display)' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
