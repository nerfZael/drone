import React from 'react';
import { UiBadge, UiToolbarButton } from '../../ui/components';
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
import { useResourceSubscriptionSettings } from './use-resource-subscription-settings';
import { useSkillLibrary } from './use-skill-library';
import { useSpeechSettings } from './use-speech-settings';
import { useVoiceInputSettings } from './use-voice-input-settings';
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
  return `relative min-h-8 w-full rounded-[var(--radius-medium)] px-2.5 py-1.5 text-left dh-type-control transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${
    active
      ? 'bg-[var(--selected)] text-[var(--fg)] before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--accent)]'
      : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)]'
  }`;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M9.75 3.5 5.25 8l4.5 4.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const speech = useSpeechSettings(requestJson);
  const voiceInput = useVoiceInputSettings(requestJson);
  const syncSets = useSyncSets(requestJson);
  const profile = useProfileSettings(requestJson);
  const backups = useRegistryBackupSettings(requestJson);
  const subscriptions = useResourceSubscriptionSettings(requestJson);

  const settingsBusy =
    hubLogsState.hubLogsLoading ||
    github.githubSettingsLoading ||
    llm.llmSettingsLoading ||
    deleteAction.deleteSettingsLoading ||
    filesystem.filesystemSettingsLoading ||
    speech.speechSettingsLoading ||
    voiceInput.loading ||
    syncSets.syncSetsLoading ||
    profile.profileSettingsLoading ||
    backups.backupSettingsLoading ||
    subscriptions.loading ||
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
    agents.agentsFileLoading ||
    agents.savingAgentsFile ||
    agents.deletingAgentsFile ||
    agents.importingAgentsFiles ||
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
    speech.speechSettingsSaving ||
    voiceInput.saving ||
    syncSets.creatingSyncSet ||
    backups.savingBackupSettings ||
    backups.runningBackup ||
    subscriptions.saving ||
    Boolean(syncSets.savingSyncSetId) ||
    Boolean(syncSets.deletingSyncSetId) ||
    Boolean(syncSets.applyingSyncSetId) ||
    profile.creatingProfile ||
    Boolean(profile.activatingProfileName) ||
    Boolean(profile.deletingProfileName);
  const activeTabMeta = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0];
  const agentsDraftDirty =
    agents.agentsContentDraft !== (agents.agentsSettings?.agents.content ?? '') ||
    agents.agentsFileDraftDirty;

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
    void speech.loadSpeechSettings();
    void voiceInput.load();
    void syncSets.loadSyncSets();
    void agents.loadAgentsSettings();
    void deleteAction.loadArchivedDrones();
    void deleteAction.loadArchivedChats();
    void profile.loadProfileSettings();
    void backups.loadBackupSettings();
    void subscriptions.load();
    void hubLogsState.loadHubLogs();
    void skillLibrary.loadSkills();
    void skillLibrary.loadSkillSources();
    void mcpServers.loadMcpServers();
  }, [agents, agentsDraftDirty, backups.loadBackupSettings, deleteAction, filesystem, github, hubLogsState, llm, mcpServers, profile, skillLibrary, speech, subscriptions.load, syncSets]);

  const renderActiveTab = () => {
    if (activeTab === 'general') {
      return (
        <GeneralSettingsTab
          github={github}
          llm={llm}
          filesystem={filesystem}
          speech={speech}
          voiceInput={voiceInput}
          subscriptions={subscriptions}
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
    <div ref={settingsScrollRef} className="dh-settings-view flex-1 overflow-y-auto">
      <div className="min-h-full w-full px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
        <div className="grid min-h-full grid-cols-1 items-start xl:grid-cols-[208px_minmax(0,1fr)]">
          <aside className="min-w-0 border-b border-[var(--border-subtle)] pb-3 xl:sticky xl:top-4 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-4">
            <div className="mb-2 flex h-9 items-center gap-1 px-1">
              <button
                type="button"
                onClick={onBackToWorkspace}
                aria-label="Back to drones"
                title="Back to drones"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
              >
                <BackIcon />
              </button>
              <h1 className="text-[18px] font-medium text-[var(--fg-strong)]">Settings</h1>
            </div>

            <nav aria-label="Settings" className="flex gap-0.5 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
              {SETTINGS_TABS.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => handleSelectTab(tab.id)}
                    className={`${settingsNavButtonClass(active)} shrink-0 xl:shrink`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0 xl:pl-6">
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-2">
              <div className="min-w-0">
                <h2 className="text-[18px] font-medium text-[var(--fg-strong)]">
                  {activeTabMeta.title}
                </h2>
              </div>
              {activeTab === 'components' ? (
                <UiBadge tone="success" dot>Live preview</UiBadge>
              ) : (
                <UiToolbarButton
                  onClick={handleRefreshAll}
                  disabled={settingsBusy}
                  title="Refresh settings and logs"
                >
                  Refresh
                </UiToolbarButton>
              )}
            </div>

            <div className="dh-settings-content flex min-w-0 flex-col gap-5 py-3">{renderActiveTab()}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
