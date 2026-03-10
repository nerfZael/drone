import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { DroneSidebar } from './droneHub/app/DroneSidebar';
import { DroneHubOverlays } from './droneHub/app/DroneHubOverlays';
import { DroneHubWorkspaceContent } from './droneHub/app/DroneHubWorkspaceContent';
import { RightPanel } from './droneHub/app/RightPanel';
import { useDroneHubAppModel } from './use-drone-hub-app-model';

export default function DroneHubApp() {
  const { sidebarProps, overlaysProps, workspaceContentProps, rightPanelProps } = useDroneHubAppModel();
  return (
    <div className="flex h-screen overflow-hidden fixed inset-0">
      <DroneSidebar {...sidebarProps} />
      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
        <DroneHubWorkspaceContent {...workspaceContentProps} />
        <RightPanel {...rightPanelProps} />
      </div>
      <DroneHubOverlays {...overlaysProps} />
      <GuidedOnboarding />
    </div>
  );
}
