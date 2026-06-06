import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { DroneSidebar } from './droneHub/app/DroneSidebar';
import { DroneHubOverlays } from './droneHub/app/DroneHubOverlays';
import { DroneHubWorkspaceContent } from './droneHub/app/DroneHubWorkspaceContent';
import { DroneHubDndProvider } from './droneHub/app/drone-hub-dnd';
import { useDroneHubUiStore } from './droneHub/app/use-drone-hub-ui-store';
import { useDroneHubAppModel } from './use-drone-hub-app-model';

export default function DroneHubApp() {
  const { sidebarProps, overlaysProps, workspaceContentProps } = useDroneHubAppModel();
  const sidebarDockSide = useDroneHubUiStore((s) => s.sidebarDockSide);
  const sidebar = <DroneSidebar {...sidebarProps} />;
  const workspace = <DroneHubWorkspaceContent {...workspaceContentProps} />;
  return (
    <DroneHubDndProvider>
      <div className="flex h-screen overflow-hidden fixed inset-0">
        {sidebarDockSide === 'right' ? (
          <>
            {workspace}
            {sidebar}
          </>
        ) : (
          <>
            {sidebar}
            {workspace}
          </>
        )}
        <DroneHubOverlays {...overlaysProps} />
        <GuidedOnboarding />
      </div>
    </DroneHubDndProvider>
  );
}
