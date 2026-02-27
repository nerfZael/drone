import React from 'react';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import {
  AUTOMATION_RUNS_MAX,
  AUTOMATION_RUNS_MIN,
} from './automation-config';
import { AutomationSettingsCard } from './AutomationSettingsCard';

export function AutomationSettingsSection() {
  const automations = useDroneHubUiStore((s) => s.automations);
  const addAutomation = useDroneHubUiStore((s) => s.addAutomation);
  const updateAutomation = useDroneHubUiStore((s) => s.updateAutomation);
  const removeAutomation = useDroneHubUiStore((s) => s.removeAutomation);
  const clearAutomations = useDroneHubUiStore((s) => s.clearAutomations);

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
      <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
        Automation
      </div>
      <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
        Create reusable automation jobs. Each job runs its prompt repeatedly from chat.
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-[var(--muted-dim)]">
          Runs are clamped to {AUTOMATION_RUNS_MIN}-{AUTOMATION_RUNS_MAX}. Sleep amount uses whole numbers only.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => addAutomation()}
            className="h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110"
            style={{ fontFamily: 'var(--display)' }}
            title="Add automation job"
          >
            Add automation
          </button>
          <button
            type="button"
            onClick={() => clearAutomations()}
            disabled={automations.length === 0}
            className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
              automations.length === 0
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Delete all automation jobs"
          >
            Delete all
          </button>
        </div>
      </div>

      {automations.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
          No automation jobs yet. Create one, then run it from the chat automation button.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {automations.map((automation, idx) => (
            <AutomationSettingsCard
              key={automation.id}
              automation={automation}
              index={idx}
              onDelete={() => removeAutomation(automation.id)}
              onUpdate={(patch) => updateAutomation(automation.id, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
