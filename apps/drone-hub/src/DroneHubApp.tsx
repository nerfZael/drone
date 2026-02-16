import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { DroneSidebar } from './droneHub/app/DroneSidebar';
import { DroneHubOverlays } from './droneHub/app/DroneHubOverlays';
import { DroneHubWorkspaceContent } from './droneHub/app/DroneHubWorkspaceContent';
import { useDroneHubAppModel } from './use-drone-hub-app-model';

export default function DroneHubApp() {
  const { sidebarProps, overlaysProps, workspaceContentProps } = useDroneHubAppModel();
  return (
    <div className="flex h-screen overflow-hidden fixed inset-0">
      <DroneSidebar {...sidebarProps} />
      <DroneHubOverlays {...overlaysProps} />
      <DroneHubWorkspaceContent {...workspaceContentProps} />
      <GuidedOnboarding />
    </div>
  );
}
