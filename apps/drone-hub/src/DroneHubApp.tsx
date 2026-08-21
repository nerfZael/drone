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
import { useIdleMonacoEditorPreload } from './droneHub/files/monaco-editor-loader';
import { ContinuousDictationProvider } from './droneHub/chat/ContinuousDictationContext';
import { ActiveComposerProvider } from './droneHub/chat/ActiveComposerContext';
import { EditorZoomController } from './droneHub/files/editor-zoom';
import { FileDictationProvider } from './droneHub/files/FileDictationContext';
import { CompanionWorkspaceProvider } from './droneHub/companion/CompanionWorkspaceContext';
import { CompanionProvider } from './droneHub/companion/CompanionContext';
import { NavigationSizeController } from './droneHub/app/NavigationSizeController';

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
  useIdleMonacoEditorPreload();
  return (
    <DesktopDeviceProvider>
      <EditorZoomController />
      <NavigationSizeController />
      <AppConfirmDialogProvider>
        <ActiveComposerProvider>
          <CompanionWorkspaceProvider>
            <ContinuousDictationProvider>
              <CompanionProvider>
                <FileDictationProvider>
                  <DroneHubAppContent />
                </FileDictationProvider>
              </CompanionProvider>
            </ContinuousDictationProvider>
          </CompanionWorkspaceProvider>
        </ActiveComposerProvider>
      </AppConfirmDialogProvider>
    </DesktopDeviceProvider>
  );
}
