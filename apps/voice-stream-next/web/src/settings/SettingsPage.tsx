import React from 'react';
import { SETTINGS_PANES, type SettingsPane } from '../dashboardRoutes.js';
import { cn } from '../ui/cn.js';
import { UiMenuSelect, type UiMenuSelectEntry } from '../ui/MenuSelect.js';

const settingsTabClass =
  'relative -mb-px inline-flex h-8 items-center justify-center rounded-t-md border border-[var(--border-subtle)] border-b-transparent bg-black/[.12] px-3 font-display text-[10px] font-semibold uppercase text-[var(--muted)] shadow-none transition hover:bg-white/[.04] hover:text-[var(--fg-secondary)]';
const settingsTabActiveClass =
  'border-[rgba(74,222,128,.30)] border-b-[var(--panel-alt)] bg-[rgba(74,222,128,.08)] text-[var(--green)]';

export function SettingsPage({
  settingsPane,
  settingsPaneEntries,
  activeSettingsPaneLabel,
  onSettingsPaneChange,
  children,
}: {
  settingsPane: SettingsPane;
  settingsPaneEntries: UiMenuSelectEntry[];
  activeSettingsPaneLabel: string;
  onSettingsPaneChange: (pane: SettingsPane) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 bg-[var(--panel-alt)] px-3 pt-3">
        <div className="hidden pb-1 max-[620px]:block">
          <UiMenuSelect
            value={settingsPane}
            entries={settingsPaneEntries}
            placement="below"
            title={`Settings pane: ${activeSettingsPaneLabel}`}
            triggerLabel={activeSettingsPaneLabel}
            triggerClassName="h-9 border-[var(--border)] bg-white/[.025] text-[var(--fg-secondary)]"
            panelClassName="w-full"
            menuClassName="max-h-[320px]"
            onValueChange={(value) => onSettingsPaneChange(value as SettingsPane)}
          />
        </div>
        <div className="flex w-full flex-nowrap items-end gap-1 overflow-x-auto bg-[var(--panel-alt)] pb-1 pt-0 max-[620px]:hidden">
          {SETTINGS_PANES.map((pane) => (
            <button
              key={pane.id}
              type="button"
              className={cn(settingsTabClass, settingsPane === pane.id && settingsTabActiveClass)}
              aria-pressed={settingsPane === pane.id}
              onClick={() => onSettingsPaneChange(pane.id)}
            >
              {pane.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3">
        {children}
      </div>
    </section>
  );
}
