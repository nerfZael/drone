import React from 'react';
import { AutomationSettingsSection } from './AutomationSettingsSection';
import { ArchiveSettingsTab } from './ArchiveSettingsTab';
import { GeneralSettingsTab } from './GeneralSettingsTab';
import { ShortcutSettingsSection } from './ShortcutSettingsSection';
import { SkillLibrarySection } from './SkillLibrarySection';
import { SystemLogsSettingsTab } from './SystemLogsSettingsTab';
import { TrashBehaviorSettingsTab } from './TrashBehaviorSettingsTab';
import { SETTINGS_TABS, type SettingsTabId } from './settings-tabs';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import type { UseDeleteActionSettingsResult } from './use-delete-action-settings';
import type { UseFilesystemSettingsResult } from './use-filesystem-settings';
import type { UseHubLogsResult } from './use-hub-logs';
import type { UseLlmSettingsResult } from './use-llm-settings';
import type { UseSkillLibraryResult } from './use-skill-library';

type SettingsViewProps = {
  llm: UseLlmSettingsResult;
  skillLibrary: UseSkillLibraryResult;
  deleteAction: UseDeleteActionSettingsResult;
  filesystem: UseFilesystemSettingsResult;
  hubLogsState: UseHubLogsResult;
  hubLogsTailLines: number;
  hubLogsMaxBytes: number;
  onBackToWorkspace: () => void;
  onReplayOnboarding: () => void;
  onResetOnboarding: () => void;
};

function settingsNavButtonClass(active: boolean) {
  return `w-full rounded border px-3 py-3 text-left transition-all ${
    active
      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] shadow-[var(--glow-accent)]'
      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] hover:bg-[var(--hover)]'
  }`;
}

export function SettingsView({
  llm,
  skillLibrary,
  deleteAction,
  filesystem,
  hubLogsState,
  hubLogsTailLines,
  hubLogsMaxBytes,
  onBackToWorkspace,
  onReplayOnboarding,
  onResetOnboarding,
}: SettingsViewProps) {
  const transcriptInlineImages = useDroneHubUiStore((s) => s.transcriptInlineImages);
  const setTranscriptInlineImages = useDroneHubUiStore((s) => s.setTranscriptInlineImages);
  const [activeTab, setActiveTab] = React.useState<SettingsTabId>('general');
  const settingsScrollRef = React.useRef<HTMLDivElement>(null);

  const settingsBusy =
    hubLogsState.hubLogsLoading ||
    llm.llmSettingsLoading ||
    deleteAction.deleteSettingsLoading ||
    filesystem.filesystemSettingsLoading ||
    deleteAction.archivedDronesLoading ||
    deleteAction.archivedChatsLoading ||
    llm.savingOpenAiSettings ||
    llm.clearingOpenAiSettings ||
    llm.savingGeminiSettings ||
    llm.clearingGeminiSettings ||
    llm.savingLlmProvider ||
    skillLibrary.skillsLoading ||
    skillLibrary.skillSourcesLoading ||
    skillLibrary.sourceSkillsLoading ||
    skillLibrary.sourceSkillPreviewLoading ||
    skillLibrary.skillsSaving ||
    skillLibrary.skillsDeleting ||
    deleteAction.savingDeleteSettings ||
    filesystem.savingFilesystemSettings;
  const activeTabMeta = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0];

  React.useEffect(() => {
    settingsScrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  const handleRefreshAll = React.useCallback(() => {
    if (skillLibrary.draftDirty) {
      const ok = window.confirm('Discard unsaved skill edits and refresh all settings?');
      if (!ok) return;
    }
    void llm.loadLlmSettings();
    void deleteAction.loadDeleteSettings();
    void filesystem.loadFilesystemSettings();
    void deleteAction.loadArchivedDrones();
    void deleteAction.loadArchivedChats();
    void hubLogsState.loadHubLogs();
    void skillLibrary.loadSkills();
    void skillLibrary.loadSkillSources();
  }, [deleteAction, filesystem, hubLogsState, llm, skillLibrary]);

  const renderActiveTab = () => {
    if (activeTab === 'general') {
      return (
        <GeneralSettingsTab
          llm={llm}
          filesystem={filesystem}
          transcriptInlineImages={transcriptInlineImages}
          setTranscriptInlineImages={setTranscriptInlineImages}
          onReplayOnboarding={onReplayOnboarding}
          onResetOnboarding={onResetOnboarding}
        />
      );
    }
    if (activeTab === 'trash') return <TrashBehaviorSettingsTab deleteAction={deleteAction} />;
    if (activeTab === 'archive') return <ArchiveSettingsTab deleteAction={deleteAction} />;
    if (activeTab === 'shortcuts') return <ShortcutSettingsSection />;
    if (activeTab === 'automations') return <AutomationSettingsSection />;
    if (activeTab === 'skills') return <SkillLibrarySection skillLibrary={skillLibrary} />;
    return <SystemLogsSettingsTab hubLogsState={hubLogsState} hubLogsTailLines={hubLogsTailLines} hubLogsMaxBytes={hubLogsMaxBytes} />;
  };

  return (
    <div ref={settingsScrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-[1480px] mx-auto px-4 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8">
        <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-4 items-start">
          <aside className="xl:sticky xl:top-5">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden">
              <div className="px-4 py-4 border-b border-[var(--border)]">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                  Drone Hub
                </div>
                <div className="text-[18px] font-semibold text-[var(--fg)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                  Settings
                </div>
                <div className="text-[12px] text-[var(--muted)] mt-1 leading-relaxed">
                  Split by area so archive controls, shortcuts, automations, and the skill library each have room.
                </div>
              </div>

              <div className="p-3 flex flex-col gap-2">
                {SETTINGS_TABS.map((tab) => {
                  const active = tab.id === activeTab;
                  return (
                    <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={settingsNavButtonClass(active)}>
                      <div
                        className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${
                          active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {tab.label}
                      </div>
                      <div className={`text-[11px] mt-1 leading-relaxed ${active ? 'text-[var(--fg-secondary)]' : 'text-[var(--muted-dim)]'}`}>
                        {tab.description}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={onBackToWorkspace}
                  className="w-full h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Back to drones
                </button>
              </div>
            </div>
          </aside>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden min-w-0">
            <div className="px-5 py-4 border-b border-[var(--border)] flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                  {activeTabMeta.label}
                </div>
                <h1 className="text-[18px] font-semibold text-[var(--fg)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                  {activeTabMeta.title}
                </h1>
                <p className="text-[12px] text-[var(--muted)] mt-1 max-w-[72ch]">{activeTabMeta.description}</p>
              </div>
              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={settingsBusy}
                className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                  settingsBusy
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Refresh settings and logs"
              >
                Refresh
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4 min-w-0">{renderActiveTab()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
