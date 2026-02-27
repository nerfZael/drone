import React from 'react';
import type { ChatInputAutomationAction } from './ChatInput';

type AutomationRunnerPanelProps = {
  open: boolean;
  actions: ChatInputAutomationAction[];
  selectedAction: ChatInputAutomationAction | null;
  selectedActionId: string;
  onSelectActionId: (nextId: string) => void;
  runsDraft: string;
  onRunsDraftChange: (nextValue: string) => void;
  selectedRuns: number | null;
  selectedActionDisabled: boolean;
  controlsDisabled: boolean;
  onTriggerAction: () => void;
};

export function AutomationRunnerPanel({
  open,
  actions,
  selectedAction,
  selectedActionId,
  onSelectActionId,
  runsDraft,
  onRunsDraftChange,
  selectedRuns,
  selectedActionDisabled,
  controlsDisabled,
  onTriggerAction,
}: AutomationRunnerPanelProps) {
  if (!open || actions.length === 0) return null;

  return (
    <div className="px-3 pb-3">
      <div className="rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] p-2.5 flex flex-col gap-2">
        <div className="text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Automation Runner</div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_auto] gap-2 items-center">
          <select
            value={selectedActionId}
            onChange={(e) => onSelectActionId(e.target.value)}
            className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
            disabled={controlsDisabled}
          >
            {actions.map((action) => {
              const suffix = action.statusText ? ` (${action.statusText})` : '';
              return (
                <option key={action.id} value={action.id}>
                  {action.label}
                  {suffix}
                </option>
              );
            })}
          </select>
          <input
            type="number"
            min={selectedAction?.minRuns ?? 1}
            max={selectedAction?.maxRuns ?? 999}
            step={1}
            value={runsDraft}
            onChange={(e) => onRunsDraftChange(e.target.value)}
            disabled={!selectedAction?.onSelectWithRuns || selectedActionDisabled}
            className={`h-9 rounded border px-2 text-[12px] focus:outline-none ${
              !selectedAction?.onSelectWithRuns || selectedActionDisabled
                ? 'opacity-50 cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] text-[var(--fg)] focus:border-[var(--accent-muted)]'
            }`}
            title="Runs for this launch"
          />
          <button
            type="button"
            onClick={() => onTriggerAction()}
            disabled={selectedActionDisabled || !selectedAction}
            className={`h-9 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
              selectedActionDisabled || !selectedAction
                ? 'opacity-40 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : selectedAction.active
                  ? 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={selectedAction?.title}
          >
            {selectedAction?.label ?? 'Run'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted-dim)]">
          <span>
            {selectedAction?.onSelectWithRuns
              ? `Runs: ${selectedRuns ?? selectedAction.defaultRuns ?? 1}`
              : 'Runs: n/a'}
          </span>
          {selectedAction?.sleepBetweenRunsLabel && (
            <span>Sleep: {selectedAction.sleepBetweenRunsLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}
