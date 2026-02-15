import React from 'react';
import { DraftChatWorkspace } from './DraftChatWorkspace';
import { GroupMultiChatWorkspace } from './GroupMultiChatWorkspace';
import { NoDroneSelectedState } from './NoDroneSelectedState';
import { SelectedDroneWorkspace } from './SelectedDroneWorkspace';
import { SettingsView } from './SettingsView';
import type { AppView } from './app-types';

type DroneHubWorkspaceContentProps = {
  appView: AppView;
  settingsViewProps: React.ComponentProps<typeof SettingsView>;
  draftChatWorkspaceProps: React.ComponentProps<typeof DraftChatWorkspace> | null;
  groupMultiChatWorkspaceProps: React.ComponentProps<typeof GroupMultiChatWorkspace> | null;
  noDroneSelectedStateProps: React.ComponentProps<typeof NoDroneSelectedState>;
  selectedDroneWorkspaceProps: React.ComponentProps<typeof SelectedDroneWorkspace> | null;
};

export function DroneHubWorkspaceContent({
  appView,
  settingsViewProps,
  draftChatWorkspaceProps,
  groupMultiChatWorkspaceProps,
  noDroneSelectedStateProps,
  selectedDroneWorkspaceProps,
}: DroneHubWorkspaceContentProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--panel)]">
      {appView === 'settings' ? (
        <SettingsView {...settingsViewProps} />
      ) : draftChatWorkspaceProps ? (
        <DraftChatWorkspace {...draftChatWorkspaceProps} />
      ) : groupMultiChatWorkspaceProps ? (
        <GroupMultiChatWorkspace {...groupMultiChatWorkspaceProps} />
      ) : selectedDroneWorkspaceProps ? (
        <SelectedDroneWorkspace {...selectedDroneWorkspaceProps} />
      ) : (
        <NoDroneSelectedState {...noDroneSelectedStateProps} />
      )}
    </div>
  );
}
