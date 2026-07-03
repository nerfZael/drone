import React from 'react';
import { AgentsSettingsSection } from './AgentsSettingsSection';
import { AutomationSettingsSection } from './AutomationSettingsSection';
import { ArchiveSettingsTab } from './ArchiveSettingsTab';
import { BackupsSettingsTab } from './BackupsSettingsTab';
import { GeneralSettingsTab } from './GeneralSettingsTab';
import { PlaybookSettingsSection } from './PlaybookSettingsSection';
import { ProfilesSettingsTab } from './ProfilesSettingsTab';
import { RemoteAccessSettingsTab } from './RemoteAccessSettingsTab';
import { ShortcutSettingsSection } from './ShortcutSettingsSection';
import { SkillLibrarySection } from './SkillLibrarySection';
import { SyncSettingsTab } from './SyncSettingsTab';
import { SystemLogsSettingsTab } from './SystemLogsSettingsTab';
import { TrashBehaviorSettingsTab } from './TrashBehaviorSettingsTab';
import { VoiceApprovalSettingsTab } from './VoiceApprovalSettingsTab';
import { SETTINGS_TABS, type SettingsTabId } from './settings-tabs';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { useAgentMessageAutoContinueSettings } from './use-agent-message-auto-continue-settings';
import { useAgentSuggestionSettings } from './use-agent-suggestion-settings';
import { useAgentsSettings } from './use-agents-settings';
import type { UseDeleteActionSettingsResult } from './use-delete-action-settings';
import { useDesktopVoiceModelSettings } from './use-desktop-voice-model-settings';
import { useFilesystemSettings } from './use-filesystem-settings';
import { useGithubSettings } from './use-github-settings';
import type { UseHubLogsResult } from './use-hub-logs';
import type { UseLlmSettingsResult } from './use-llm-settings';
import { useProfileSettings } from './use-profile-settings';
import { useRegistryBackupSettings } from './use-registry-backup-settings';
import { useSkillLibrary } from './use-skill-library';
import { useSyncSets } from './use-sync-sets';
import { useVoiceApprovalSettings } from './use-voice-approval-settings';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type SettingsViewProps = {
  requestJson: RequestJsonFn;
  llm: UseLlmSettingsResult;
  deleteAction: UseDeleteActionSettingsResult;
  hubLogsState: UseHubLogsResult;
  hubLogsTailLines: number;
  hubLogsMaxBytes: number;
  activeTab: SettingsTabId;
  focusedPlaybookId: string | null;
  onBackToWorkspace: () => void;
  onSelectTab: (tabId: SettingsTabId) => void;
  onFocusedPlaybookHandled: () => void;
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
  requestJson,
  llm,
  deleteAction,
  hubLogsState,
  hubLogsTailLines,
  hubLogsMaxBytes,
  activeTab,
  focusedPlaybookId,
  onBackToWorkspace,
  onSelectTab,
  onFocusedPlaybookHandled,
  onReplayOnboarding,
  onResetOnboarding,
}: SettingsViewProps) {
  const transcriptInlineImages = useDroneHubUiStore((s) => s.transcriptInlineImages);
  const setTranscriptInlineImages = useDroneHubUiStore((s) => s.setTranscriptInlineImages);
  const settingsScrollRef = React.useRef<HTMLDivElement>(null);
  const github = useGithubSettings(requestJson);
  const agentMessageAutoContinue = useAgentMessageAutoContinueSettings(requestJson);
  const agentSuggestion = useAgentSuggestionSettings(requestJson);
  const agents = useAgentsSettings(requestJson);
  const skillLibrary = useSkillLibrary(requestJson);
  const filesystem = useFilesystemSettings(requestJson);
  const desktopVoiceModel = useDesktopVoiceModelSettings(requestJson);
  const voiceApproval = useVoiceApprovalSettings(requestJson);
  const syncSets = useSyncSets(requestJson);
  const profile = useProfileSettings(requestJson);
  const backups = useRegistryBackupSettings(requestJson);

  const settingsBusy =
    hubLogsState.hubLogsLoading ||
    hubLogsState.androidLogsLoading ||
    github.githubSettingsLoading ||
    llm.llmSettingsLoading ||
    agentMessageAutoContinue.agentMessageAutoContinueSettingsLoading ||
    agentSuggestion.agentSuggestionSettingsLoading ||
    deleteAction.deleteSettingsLoading ||
    filesystem.filesystemSettingsLoading ||
    desktopVoiceModel.desktopVoiceModelSettingsLoading ||
    voiceApproval.voiceApprovalSettingsLoading ||
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
    llm.savingVoiceStreamPairingPassword ||
    llm.clearingVoiceStreamPairingPassword ||
    llm.savingLlmProvider ||
    agentMessageAutoContinue.savingAgentMessageAutoContinueSettings ||
    agentSuggestion.savingAgentSuggestionSettings ||
    agents.agentsSettingsLoading ||
    agents.savingAgentsSettings ||
    skillLibrary.skillsLoading ||
    skillLibrary.skillSourcesLoading ||
    skillLibrary.sourceSkillsLoading ||
    skillLibrary.sourceSkillPreviewLoading ||
    skillLibrary.skillsSaving ||
    skillLibrary.skillsDeleting ||
    deleteAction.savingDeleteSettings ||
    filesystem.savingFilesystemSettings ||
    desktopVoiceModel.installingDesktopVoiceModel ||
    desktopVoiceModel.removingDesktopVoiceModel ||
    voiceApproval.savingVoiceApprovalSettings ||
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
    if (agentsDraftDirty) {
      const ok = window.confirm('Discard unsaved AGENTS.md edits and refresh all settings?');
      if (!ok) return;
    }
    void llm.loadLlmSettings();
    void agentMessageAutoContinue.loadAgentMessageAutoContinueSettings();
    void agentSuggestion.loadAgentSuggestionSettings();
    void github.loadGithubSettings();
    void deleteAction.loadDeleteSettings();
    void filesystem.loadFilesystemSettings();
    void desktopVoiceModel.loadDesktopVoiceModelSettings();
    void voiceApproval.loadVoiceApprovalSettings();
    void syncSets.loadSyncSets();
    void agents.loadAgentsSettings();
    void deleteAction.loadArchivedDrones();
    void deleteAction.loadArchivedChats();
    void profile.loadProfileSettings();
    void backups.loadBackupSettings();
    void hubLogsState.loadHubLogs();
    void hubLogsState.loadAndroidLogs();
    void skillLibrary.loadSkills();
    void skillLibrary.loadSkillSources();
  }, [agentMessageAutoContinue, agentSuggestion, agents, agentsDraftDirty, backups.loadBackupSettings, deleteAction, desktopVoiceModel, filesystem, github, hubLogsState, llm, profile, skillLibrary, syncSets, voiceApproval]);

  const renderActiveTab = () => {
    if (activeTab === 'general') {
      return (
        <GeneralSettingsTab
          github={github}
          llm={llm}
          filesystem={filesystem}
          desktopVoiceModel={desktopVoiceModel}
          agentMessageAutoContinue={agentMessageAutoContinue}
          agentSuggestion={agentSuggestion}
          transcriptInlineImages={transcriptInlineImages}
          setTranscriptInlineImages={setTranscriptInlineImages}
          onReplayOnboarding={onReplayOnboarding}
          onResetOnboarding={onResetOnboarding}
        />
      );
    }
    if (activeTab === 'remote') return <RemoteAccessSettingsTab requestJson={requestJson} />;
    if (activeTab === 'sync') return <SyncSettingsTab syncSets={syncSets} />;
    if (activeTab === 'voice') return <VoiceApprovalSettingsTab voiceApproval={voiceApproval} />;
    if (activeTab === 'backups') return <BackupsSettingsTab backups={backups} />;
    if (activeTab === 'profiles') return <ProfilesSettingsTab profile={profile} />;
    if (activeTab === 'trash') return <TrashBehaviorSettingsTab deleteAction={deleteAction} />;
    if (activeTab === 'archive') return <ArchiveSettingsTab deleteAction={deleteAction} />;
    if (activeTab === 'shortcuts') return <ShortcutSettingsSection />;
    if (activeTab === 'automations') return <AutomationSettingsSection />;
    if (activeTab === 'playbooks') {
      return <PlaybookSettingsSection focusedPlaybookId={focusedPlaybookId} onFocusedPlaybookHandled={onFocusedPlaybookHandled} />;
    }
    if (activeTab === 'skills') return <SkillLibrarySection skillLibrary={skillLibrary} />;
    if (activeTab === 'agents') return <AgentsSettingsSection agents={agents} />;
    return <SystemLogsSettingsTab hubLogsState={hubLogsState} hubLogsTailLines={hubLogsTailLines} hubLogsMaxBytes={hubLogsMaxBytes} />;
  };

  return (
    <div ref={settingsScrollRef} className="flex-1 overflow-y-auto">
      <div className="w-full min-h-full px-4 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8">
        <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)] gap-4 items-start min-h-full">
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
                    <button key={tab.id} type="button" onClick={() => handleSelectTab(tab.id)} className={settingsNavButtonClass(active)}>
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
