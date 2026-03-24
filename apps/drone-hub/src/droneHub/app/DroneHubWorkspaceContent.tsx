import React from 'react';
import { DraftChatWorkspace } from './DraftChatWorkspace';
import { GroupMultiChatWorkspace } from './GroupMultiChatWorkspace';
import { KanbanBoardWorkspace } from './KanbanBoardWorkspace';
import { NoDroneSelectedState } from './NoDroneSelectedState';
import { PlaybookRunsWorkspace } from './PlaybookRunsWorkspace';
import { SelectedDroneWorkspace } from './SelectedDroneWorkspace';
import { SettingsView } from './SettingsView';
import type { AppView } from './app-types';

export type DroneHubWorkspaceContentProps = {
  appView: AppView;
  settingsViewProps: React.ComponentProps<typeof SettingsView>;
  draftChatWorkspaceProps: React.ComponentProps<typeof DraftChatWorkspace> | null;
  kanbanBoardWorkspaceProps: React.ComponentProps<typeof KanbanBoardWorkspace> | null;
  playbookRunsWorkspaceProps: React.ComponentProps<typeof PlaybookRunsWorkspace> | null;
  groupMultiChatWorkspaceProps: React.ComponentProps<typeof GroupMultiChatWorkspace> | null;
  noDroneSelectedStateProps: React.ComponentProps<typeof NoDroneSelectedState>;
  selectedDroneWorkspaceProps: React.ComponentProps<typeof SelectedDroneWorkspace> | null;
  renderPersistentPreviewContent: (activeDroneId: string | null, previewVisible: boolean) => React.ReactNode;
};

export function DroneHubWorkspaceContent({
  appView,
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

  return (
    <div data-drone-workspace-root="1" className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--panel)]">
      {appView === 'settings' ? (
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
        <SelectedDroneWorkspace {...selectedDroneWorkspaceProps} onPersistentPreviewHostChange={setPreviewHostState} />
      ) : (
        <NoDroneSelectedState {...noDroneSelectedStateProps} />
      )}
      <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
        <div
          className={`absolute overflow-hidden ${previewHostState.previewVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}
          style={previewHostState.style}
        >
          {renderPersistentPreviewContent(previewHostState.activeDroneId, previewHostState.previewVisible)}
        </div>
      </div>
    </div>
  );
}
