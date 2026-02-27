import React from 'react';
import {
  AUTOMATION_RUNS_MAX,
  AUTOMATION_RUNS_MIN,
  AUTOMATION_SLEEP_AMOUNT_MAX,
  AUTOMATION_SLEEP_AMOUNT_MIN,
  formatAutomationSleepInterval,
  type AutomationConfig,
  type AutomationSleepUnit,
} from './automation-config';

const AUTOMATION_SLEEP_UNIT_OPTIONS: Array<{ value: AutomationSleepUnit; label: string }> = [
  { value: 'seconds', label: 'Seconds' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
];

type AutomationSettingsCardProps = {
  automation: AutomationConfig;
  index: number;
  onDelete: () => void;
  onUpdate: (patch: Partial<AutomationConfig>) => void;
};

export function AutomationSettingsCard({ automation, index, onDelete, onUpdate }: AutomationSettingsCardProps) {
  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-3 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
          Automation #{index + 1}
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]"
          style={{ fontFamily: 'var(--display)' }}
          title="Delete this automation"
        >
          Delete
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-center">
        <label className="text-[11px] text-[var(--muted-dim)]">Label</label>
        <input
          type="text"
          value={automation.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="w-full h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
          placeholder="e.g. Review and fix wins"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-center">
        <label className="text-[11px] text-[var(--muted-dim)]">Runs per click</label>
        <input
          type="number"
          min={AUTOMATION_RUNS_MIN}
          max={AUTOMATION_RUNS_MAX}
          step={1}
          value={automation.runs}
          onChange={(e) => onUpdate({ runs: Number(e.target.value) })}
          className="w-full sm:w-[140px] h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-start">
        <label className="text-[11px] text-[var(--muted-dim)] pt-2">Sleep between runs</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={AUTOMATION_SLEEP_AMOUNT_MIN}
            max={AUTOMATION_SLEEP_AMOUNT_MAX}
            step={1}
            value={automation.sleepAmount}
            onChange={(e) => onUpdate({ sleepAmount: Number(e.target.value) })}
            className="w-full sm:w-[120px] h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
          />
          <select
            value={automation.sleepUnit}
            onChange={(e) =>
              onUpdate({
                sleepUnit: e.target.value as AutomationSleepUnit,
              })
            }
            className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
          >
            {AUTOMATION_SLEEP_UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-[var(--muted-dim)]">{formatAutomationSleepInterval(automation)}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-start">
        <label className="text-[11px] text-[var(--muted-dim)] pt-2">Stop phrase (optional)</label>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={automation.stopPhrase}
            onChange={(e) => onUpdate({ stopPhrase: e.target.value })}
            className="w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] h-9 px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
            placeholder="If agent output contains this phrase, finish early"
          />
          <label className="inline-flex items-center gap-2 text-[11px] text-[var(--muted-dim)]">
            <input
              type="checkbox"
              checked={automation.stopPhraseCaseSensitive}
              onChange={(e) =>
                onUpdate({
                  stopPhraseCaseSensitive: e.currentTarget.checked,
                })
              }
              className="rounded border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)]"
            />
            Case sensitive
          </label>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--muted-dim)]">Prompt</label>
        <textarea
          value={automation.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          className="w-full min-h-[140px] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)]"
          placeholder="Enter automation prompt..."
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-[var(--muted-dim)]">Final message (optional)</label>
        <textarea
          value={automation.onFailurePrompt}
          onChange={(e) => onUpdate({ onFailurePrompt: e.target.value })}
          className="w-full min-h-[110px] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y focus:outline-none focus:border-[var(--accent-muted)]"
          placeholder="Optional message to send after automation runs finish, if at least one run succeeded (e.g. summarize what was fixed)."
        />
      </div>
    </div>
  );
}
