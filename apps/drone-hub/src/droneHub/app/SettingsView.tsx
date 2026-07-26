import React from 'react';
import { UiBadge, UiButton } from '../../ui/components';
import { AgentsSettingsSection } from './AgentsSettingsSection';
import { ArchiveSettingsTab } from './ArchiveSettingsTab';
import { BackupsSettingsTab } from './BackupsSettingsTab';
import { ComponentLibraryPreview } from './ComponentLibraryPreview';
import { GeneralSettingsTab } from './GeneralSettingsTab';
import { DeviceMeshSettingsTab } from './DeviceMeshSettingsTab';
import { McpServersSection } from './McpServersSection';
import { ProfilesSettingsTab } from './ProfilesSettingsTab';
import { ShortcutSettingsSection } from './ShortcutSettingsSection';
import { SkillLibrarySection } from './SkillLibrarySection';
import { SyncSettingsTab } from './SyncSettingsTab';
import { SystemLogsSettingsTab } from './SystemLogsSettingsTab';
import { TrashBehaviorSettingsTab } from './TrashBehaviorSettingsTab';
import { SETTINGS_TABS, type SettingsTabId } from './settings-tabs';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { useAgentsSettings } from './use-agents-settings';
import type { UseDeleteActionSettingsResult } from './use-delete-action-settings';
import { useFilesystemSettings } from './use-filesystem-settings';
import { useGithubSettings } from './use-github-settings';
import type { UseHubLogsResult } from './use-hub-logs';
import type { UseLlmSettingsResult } from './use-llm-settings';
import { useMcpServers } from './use-mcp-servers';
import { useProfileSettings } from './use-profile-settings';
import { useRegistryBackupSettings } from './use-registry-backup-settings';
import { useSkillLibrary } from './use-skill-library';
import { useSyncSets } from './use-sync-sets';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type SettingsViewProps = {
  requestJson: RequestJsonFn;
  llm: UseLlmSettingsResult;
  deleteAction: UseDeleteActionSettingsResult;
  hubLogsState: UseHubLogsResult;
  hubLogsTailLines: number;
  hubLogsMaxBytes: number;
  activeTab: SettingsTabId;
  onBackToWorkspace: () => void;
  onSelectTab: (tabId: SettingsTabId) => void;
  onReplayOnboarding: () => void;
  onResetOnboarding: () => void;
};

function settingsNavButtonClass(active: boolean) {
  return `w-full rounded border px-3 py-3 text-left transition-all ${
    active
      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] shadow-[var(--glow-accent)]'
      : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:bg-[var(--hover)]'
  }`;
}

export function SettingsView({
  requestJson,
  llm,
  deleteAction,
  hubLogsState,
  hubLogsTailLines,
  hubLogsMaxBytes,
  activeTab,
  onBackToWorkspace,
  onSelectTab,
  onReplayOnboarding,
  onResetOnboarding,
}: SettingsViewProps) {
  const settingsScrollRef = React.useRef<HTMLDivElement>(null);
  const github = useGithubSettings(requestJson);
  const agents = useAgentsSettings(requestJson);
  const skillLibrary = useSkillLibrary(requestJson);
  const mcpServers = useMcpServers(requestJson);
  const filesystem = useFilesystemSettings(requestJson);
  const syncSets = useSyncSets(requestJson);
  const profile = useProfileSettings(requestJson);
  const backups = useRegistryBackupSettings(requestJson);

  const settingsBusy =
    hubLogsState.hubLogsLoading ||
    github.githubSettingsLoading ||
    llm.llmSettingsLoading ||
    deleteAction.deleteSettingsLoading ||
    filesystem.filesystemSettingsLoading ||
    syncSets.syncSetsLoading ||
    profile.profileSettingsLoading ||
    backups.backupSettingsLoading ||
    deleteAction.archivedDronesLoading ||
    deleteAction.archivedChatsLoading ||
    llm.savingOpenAiSettings ||
    llm.clearingOpenAiSettings ||
    llm.savingGeminiSettings ||
    llm.clearingGeminiSettings ||
    llm.savingGroqSettings ||
    llm.clearingGroqSettings ||
    llm.savingLlmProvider ||
    agents.agentsSettingsLoading ||
    agents.savingAgentsSettings ||
    skillLibrary.skillsLoading ||
    skillLibrary.skillSourcesLoading ||
    skillLibrary.sourceSkillsLoading ||
    skillLibrary.sourceSkillPreviewLoading ||
    skillLibrary.skillsSaving ||
    skillLibrary.skillsDeleting ||
    mcpServers.mcpServersLoading ||
    mcpServers.mcpServersSaving ||
    mcpServers.mcpServersDeleting ||
    mcpServers.mcpAccessTokensLoading ||
    mcpServers.mcpAccessTokensSaving ||
    deleteAction.savingDeleteSettings ||
    filesystem.savingFilesystemSettings ||
    syncSets.creatingSyncSet ||
    backups.savingBackupSettings ||
    backups.runningBackup ||
    Boolean(syncSets.savingSyncSetId) ||
    Boolean(syncSets.deletingSyncSetId) ||
    Boolean(syncSets.applyingSyncSetId) ||
    profile.creatingProfile ||
    Boolean(profile.activatingProfileName) ||
    Boolean(profile.deletingProfileName);
  const activeTabMeta = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0];
  const agentsDraftDirty = agents.agentsContentDraft !== (agents.agentsSettings?.agents.content ?? '');

  React.useEffect(() => {
    settingsScrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  const handleSelectTab = React.useCallback(
    (tabId: SettingsTabId) => {
      onSelectTab(tabId);
      if (tabId === 'archive') {
        void deleteAction.loadArchivedDrones();
        void deleteAction.loadArchivedChats();
      }
    },
    [deleteAction, onSelectTab],
  );

  const handleRefreshAll = React.useCallback(() => {
    if (skillLibrary.draftDirty) {
      const ok = window.confirm('Discard unsaved skill edits and refresh all settings?');
      if (!ok) return;
    }
    if (mcpServers.mcpDraftDirty) {
      const ok = window.confirm('Discard unsaved MCP server edits and refresh all settings?');
      if (!ok) return;
    }
    if (agentsDraftDirty) {
      const ok = window.confirm('Discard unsaved AGENTS.md edits and refresh all settings?');
      if (!ok) return;
    }
    void llm.loadLlmSettings();
    void github.loadGithubSettings();
    void deleteAction.loadDeleteSettings();
    void filesystem.loadFilesystemSettings();
    void syncSets.loadSyncSets();
    void agents.loadAgentsSettings();
    void deleteAction.loadArchivedDrones();
    void deleteAction.loadArchivedChats();
    void profile.loadProfileSettings();
    void backups.loadBackupSettings();
    void hubLogsState.loadHubLogs();
    void skillLibrary.loadSkills();
    void skillLibrary.loadSkillSources();
    void mcpServers.loadMcpServers();
  }, [agents, agentsDraftDirty, backups.loadBackupSettings, deleteAction, filesystem, github, hubLogsState, llm, mcpServers, profile, skillLibrary, syncSets]);

  const renderActiveTab = () => {
    if (activeTab === 'general') {
      return (
        <GeneralSettingsTab
          github={github}
          llm={llm}
          filesystem={filesystem}
          onReplayOnboarding={onReplayOnboarding}
          onResetOnboarding={onResetOnboarding}
        />
      );
    }
    if (activeTab === 'devices') return <DeviceMeshSettingsTab requestJson={requestJson} />;
    if (activeTab === 'sync') return <SyncSettingsTab syncSets={syncSets} />;
    if (activeTab === 'backups') return <BackupsSettingsTab backups={backups} />;
    if (activeTab === 'profiles') return <ProfilesSettingsTab profile={profile} />;
    if (activeTab === 'trash') return <TrashBehaviorSettingsTab deleteAction={deleteAction} />;
    if (activeTab === 'archive') return <ArchiveSettingsTab deleteAction={deleteAction} />;
    if (activeTab === 'shortcuts') return <ShortcutSettingsSection />;
    if (activeTab === 'skills') return <SkillLibrarySection skillLibrary={skillLibrary} />;
    if (activeTab === 'mcp') return <McpServersSection mcp={mcpServers} />;
    if (activeTab === 'agents') return <AgentsSettingsSection agents={agents} />;
    if (activeTab === 'components') return <ComponentLibraryPreview />;
    return <SystemLogsSettingsTab hubLogsState={hubLogsState} hubLogsTailLines={hubLogsTailLines} hubLogsMaxBytes={hubLogsMaxBytes} />;
  };

  return (
    <div ref={settingsScrollRef} className="flex-1 overflow-y-auto">
      <div className="w-full min-h-full px-4 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8">
        <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-4 items-start min-h-full">
          <aside className="xl:sticky xl:top-5">
            <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden">
              <div className="px-4 py-4 border-b border-[var(--border)]">
                <div className="text-[length:var(--text-10)] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-[var(--weight-semibold)]" style={{ fontFamily: 'var(--display)' }}>
                  Drone Hub
                </div>
                <div className="text-[18px] font-[var(--weight-semibold)] text-[var(--fg-strong)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                  Settings
                </div>
                <div className="text-[length:var(--text-12)] text-[var(--muted)] mt-1 leading-relaxed">
                  Split by area so archive controls, shortcuts, and the skill library each have room.
                </div>
              </div>

              <div className="p-3 flex flex-col gap-2">
                {SETTINGS_TABS.map((tab) => {
                  const active = tab.id === activeTab;
                  return (
                    <button key={tab.id} type="button" onClick={() => handleSelectTab(tab.id)} className={settingsNavButtonClass(active)}>
                      <div
                        className={`text-[length:var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${
                          active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {tab.label}
                      </div>
                      <div className={`text-[length:var(--text-11)] mt-1 leading-relaxed ${active ? 'text-[var(--fg-secondary)]' : 'text-[var(--muted-dim)]'}`}>
                        {tab.description}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="px-3 pb-3">
                <UiButton
                  onClick={onBackToWorkspace}
                  fullWidth
                  size="large"
                  className="uppercase"
                >
                  Back to drones
                </UiButton>
              </div>
            </div>
          </aside>

          <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden min-w-0">
            <div className="px-5 py-4 border-b border-[var(--border)] flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[length:var(--text-10)] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-[var(--weight-semibold)]" style={{ fontFamily: 'var(--display)' }}>
                  {activeTabMeta.label}
                </div>
                <h1 className="text-[18px] font-[var(--weight-semibold)] text-[var(--fg-strong)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                  {activeTabMeta.title}
                </h1>
                <p className="text-[length:var(--text-12)] text-[var(--muted)] mt-1 max-w-[72ch]">{activeTabMeta.description}</p>
              </div>
              {activeTab === 'components' ? (
                <UiBadge tone="success" dot className="mt-1">Live preview</UiBadge>
              ) : (
                <UiButton
                  onClick={handleRefreshAll}
                  disabled={settingsBusy}
                  size="medium"
                  className="uppercase"
                  title="Refresh settings and logs"
                >
                  Refresh
                </UiButton>
              )}
            </div>

            <div className="px-5 py-4 flex flex-col gap-4 min-w-0">{renderActiveTab()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
