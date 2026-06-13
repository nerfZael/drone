import React from 'react';
import { NoDroneSelectedState } from './NoDroneSelectedState';
import type { DraftChatWorkspace as DraftChatWorkspaceComponent } from './DraftChatWorkspace';
import type { GroupMultiChatWorkspace as GroupMultiChatWorkspaceComponent } from './GroupMultiChatWorkspace';
import type { KanbanBoardWorkspace as KanbanBoardWorkspaceComponent } from './KanbanBoardWorkspace';
import type { PlaybookRunsWorkspace as PlaybookRunsWorkspaceComponent } from './PlaybookRunsWorkspace';
import type { SelectedDroneWorkspace as SelectedDroneWorkspaceComponent } from './SelectedDroneWorkspace';
import type { SettingsView as SettingsViewComponent } from './SettingsView';
import type { SetupWelcomeView as SetupWelcomeViewComponent } from './SetupWelcomeView';
import type { AppView } from './app-types';
import { FloatingAssistantDock } from '../assistant/FloatingAssistantDock';

const SetupWelcomeView = React.lazy(async () => {
  const module = await import('./SetupWelcomeView');
  return { default: module.SetupWelcomeView };
});

const SettingsView = React.lazy(async () => {
  const module = await import('./SettingsView');
  return { default: module.SettingsView };
});

const DraftChatWorkspace = React.lazy(async () => {
  const module = await import('./DraftChatWorkspace');
  return { default: module.DraftChatWorkspace };
});

const KanbanBoardWorkspace = React.lazy(async () => {
  const module = await import('./KanbanBoardWorkspace');
  return { default: module.KanbanBoardWorkspace };
});

const PlaybookRunsWorkspace = React.lazy(async () => {
  const module = await import('./PlaybookRunsWorkspace');
  return { default: module.PlaybookRunsWorkspace };
});

const GroupMultiChatWorkspace = React.lazy(async () => {
  const module = await import('./GroupMultiChatWorkspace');
  return { default: module.GroupMultiChatWorkspace };
});

const SelectedDroneWorkspace = React.lazy(async () => {
  const module = await import('./SelectedDroneWorkspace');
  return { default: module.SelectedDroneWorkspace };
});

export type DroneHubWorkspaceContentProps = {
  appView: AppView;
  setupWelcomeProps: React.ComponentProps<typeof SetupWelcomeViewComponent> | null;
  settingsViewProps: React.ComponentProps<typeof SettingsViewComponent>;
  draftChatWorkspaceProps: React.ComponentProps<typeof DraftChatWorkspaceComponent> | null;
  kanbanBoardWorkspaceProps: React.ComponentProps<typeof KanbanBoardWorkspaceComponent> | null;
  playbookRunsWorkspaceProps: React.ComponentProps<typeof PlaybookRunsWorkspaceComponent> | null;
  groupMultiChatWorkspaceProps: React.ComponentProps<typeof GroupMultiChatWorkspaceComponent> | null;
  noDroneSelectedStateProps: React.ComponentProps<typeof NoDroneSelectedState>;
  selectedDroneWorkspaceProps: React.ComponentProps<typeof SelectedDroneWorkspaceComponent> | null;
  renderPersistentPreviewContent: (activeDroneId: string | null, previewVisible: boolean) => React.ReactNode;
};

function WorkspaceViewFallback() {
  return (
    <div className="flex-1 min-h-0 bg-[var(--panel)]">
      <div className="flex h-full w-full items-center justify-center px-4">
        <div
          role="status"
          aria-live="polite"
          className="inline-flex h-9 items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] shadow-[0_16px_40px_rgba(0,0,0,.28)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          <span className="h-2 w-2 rounded-full bg-[var(--accent)] opacity-80 animate-pulse" />
          <span>Loading workspace...</span>
        </div>
      </div>
    </div>
  );
}

export function DroneHubWorkspaceContent({
  appView,
  setupWelcomeProps,
  settingsViewProps,
  draftChatWorkspaceProps,
  kanbanBoardWorkspaceProps,
  playbookRunsWorkspaceProps,
  groupMultiChatWorkspaceProps,
  noDroneSelectedStateProps,
  selectedDroneWorkspaceProps,
  renderPersistentPreviewContent,
}: DroneHubWorkspaceContentProps) {
  const [previewHostState, setPreviewHostState] = React.useState<{
    style: React.CSSProperties;
    activeDroneId: string | null;
    previewVisible: boolean;
  }>({
    style: { left: 0, top: 0, width: 0, height: 0 },
    activeDroneId: null,
    previewVisible: false,
  });
  const [embeddedAssistantPanelVisible, setEmbeddedAssistantPanelVisible] = React.useState(false);
  const selectedWorkspaceDroneId = selectedDroneWorkspaceProps?.currentDrone.id ?? null;
  React.useEffect(() => {
    setEmbeddedAssistantPanelVisible(false);
  }, [selectedWorkspaceDroneId]);
  React.useEffect(() => {
    if (selectedDroneWorkspaceProps?.rightPanelOpen) return;
    setEmbeddedAssistantPanelVisible(false);
  }, [selectedDroneWorkspaceProps?.rightPanelOpen]);
  const assistantEmbeddedVisible = Boolean(selectedDroneWorkspaceProps?.rightPanelOpen && embeddedAssistantPanelVisible);

  const workspaceContent =
    setupWelcomeProps && appView !== 'settings' ? (
      <SetupWelcomeView {...setupWelcomeProps} />
    ) : appView === 'settings' ? (
      <SettingsView {...settingsViewProps} />
    ) : draftChatWorkspaceProps ? (
      <DraftChatWorkspace {...draftChatWorkspaceProps} />
    ) : kanbanBoardWorkspaceProps ? (
      <KanbanBoardWorkspace {...kanbanBoardWorkspaceProps} />
    ) : playbookRunsWorkspaceProps ? (
      <PlaybookRunsWorkspace {...playbookRunsWorkspaceProps} />
    ) : groupMultiChatWorkspaceProps ? (
      <GroupMultiChatWorkspace {...groupMultiChatWorkspaceProps} />
    ) : selectedDroneWorkspaceProps ? (
      <SelectedDroneWorkspace
        {...selectedDroneWorkspaceProps}
        onPersistentPreviewHostChange={setPreviewHostState}
        onEmbeddedAssistantVisibleChange={setEmbeddedAssistantPanelVisible}
      />
    ) : (
      <NoDroneSelectedState {...noDroneSelectedStateProps} />
    );

  return (
    <div data-drone-workspace-root="1" className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--panel)]">
      <React.Suspense fallback={<WorkspaceViewFallback />}>{workspaceContent}</React.Suspense>
      <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
        <div
          className={`absolute overflow-hidden ${previewHostState.previewVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}
          style={previewHostState.style}
        >
          {renderPersistentPreviewContent(previewHostState.activeDroneId, previewHostState.previewVisible)}
        </div>
      </div>
      <FloatingAssistantDock embeddedVisible={assistantEmbeddedVisible} />
    </div>
  );
}
