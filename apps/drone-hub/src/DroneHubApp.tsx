import React from 'react';
import { FrontendUpdatePrompt } from './FrontendUpdatePrompt';
import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { DroneSidebar } from './droneHub/app/DroneSidebar';
import { DroneHubOverlays } from './droneHub/app/DroneHubOverlays';
import { DroneHubWorkspaceContent } from './droneHub/app/DroneHubWorkspaceContent';
import { DroneHubDndProvider } from './droneHub/app/drone-hub-dnd';
import { useMobileViewport } from './droneHub/app/use-mobile-viewport';
import { useDroneHubUiStore } from './droneHub/app/use-drone-hub-ui-store';
import { useDroneHubAppModel } from './use-drone-hub-app-model';
import { applyDesktopTheme } from './theme';
import { AppConfirmDialogProvider } from './ui/AppConfirmDialog';
import { DesktopDeviceProvider, useDesktopDevice } from './droneHub/app/DesktopDeviceProvider';
import { RemoteDeviceWorkspace } from './droneHub/app/RemoteDeviceWorkspace';

function LocalDroneHubAppContent() {
  const { sidebarProps, overlaysProps, workspaceContentProps } = useDroneHubAppModel();
  const sidebarDockSide = useDroneHubUiStore((s) => s.sidebarDockSide);
  const sidebarCollapsed = useDroneHubUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useDroneHubUiStore((s) => s.setSidebarCollapsed);
  const isMobileViewport = useMobileViewport();
  const mobileAutoCollapsedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isMobileViewport) {
      if (mobileAutoCollapsedRef.current) {
        mobileAutoCollapsedRef.current = false;
        setSidebarCollapsed(false);
      }
      return;
    }
    if (mobileAutoCollapsedRef.current || sidebarCollapsed) return;
    mobileAutoCollapsedRef.current = true;
    setSidebarCollapsed(true);
  }, [isMobileViewport, setSidebarCollapsed, sidebarCollapsed]);
  const sidebar = <DroneSidebar {...sidebarProps} />;
  const workspace = <DroneHubWorkspaceContent {...workspaceContentProps} />;
  return (
    <AppConfirmDialogProvider>
      <DroneHubDndProvider>
        <div data-drone-app-shell="true" className="flex h-screen overflow-hidden fixed inset-0">
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
          <FrontendUpdatePrompt />
        </div>
      </DroneHubDndProvider>
    </AppConfirmDialogProvider>
  );
}

function DroneHubAppContent() {
  const { selectedDeviceId, selfDeviceId } = useDesktopDevice();
  const themeId = useDroneHubUiStore((state) => state.themeId);
  React.useEffect(() => {
    applyDesktopTheme(themeId);
  }, [themeId]);

  return selectedDeviceId && selfDeviceId && selectedDeviceId !== selfDeviceId ? (
    <RemoteDeviceWorkspace />
  ) : (
    <LocalDroneHubAppContent />
  );
}

export default function DroneHubApp() {
  return (
    <DesktopDeviceProvider>
      <DroneHubAppContent />
    </DesktopDeviceProvider>
  );
}
