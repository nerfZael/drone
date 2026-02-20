import React from 'react';
import { DroneChangesDock } from '../changes';
import { DroneFilesDock } from '../files';
import { DroneLinksDock, DronePreviewDock } from '../overview';
import { DronePullRequestsDock } from '../pullRequests';
import { DroneTerminalDock } from '../terminal';
import type {
  DroneFsEntry,
  DronePortMapping,
  RepoPullRequestSummary,
  DroneSummary,
  PortReachabilityByHostPort,
} from '../types';
import type { RightPanelTab } from './app-config';
import { isDroneStartingOrSeeding } from './helpers';

type PaneReadinessState = {
  waiting: boolean;
  timedOut: boolean;
};

type RightPanelTabContentProps = {
  drone: DroneSummary;
  tab: RightPanelTab;
  paneKey: 'top' | 'bottom' | 'single';
  selectedChat: string;
  currentDroneId: string | null;
  defaultFsPathForCurrentDrone: string;
  uiDroneName: (nameRaw: string) => string;
  currentFsPath: string;
  fsEntries: DroneFsEntry[];
  fsLoading: boolean;
  fsError: string | null;
  fsErrorUi: string | null;
  filesPane: PaneReadinessState;
  fsExplorerView: 'list' | 'thumb';
  setFsExplorerView: React.Dispatch<React.SetStateAction<'list' | 'thumb'>>;
  setCurrentFsPath: (nextPath: string) => void;
  refreshFsList: () => void;
  selectedPreviewPort: DronePortMapping | null;
  currentPortReachability: PortReachabilityByHostPort;
  portsLoading: boolean;
  portsError: string | null;
  portsErrorUi: string | null;
  portsPane: PaneReadinessState;
  selectedPreviewDefaultUrl: string | null;
  selectedPreviewUrlOverride: string | null;
  setSelectedPreviewUrlOverride: (nextUrl: string | null) => void;
  agentLabel: string;
  portRows: DronePortMapping[];
  setSelectedPreviewPort: (port: DronePortMapping | null) => void;
  onOpenFileInEditor: (entry: DroneFsEntry) => void;
  onOpenPullRequestInChanges: (paneKey: 'top' | 'bottom' | 'single', pullRequest: RepoPullRequestSummary) => void;
};

export function RightPanelTabContent({
  drone,
  tab,
  paneKey,
  selectedChat,
  currentDroneId,
  defaultFsPathForCurrentDrone,
  uiDroneName,
  currentFsPath,
  fsEntries,
  fsLoading,
  fsError,
  fsErrorUi,
  filesPane,
  fsExplorerView,
  setFsExplorerView,
  setCurrentFsPath,
  refreshFsList,
  selectedPreviewPort,
  currentPortReachability,
  portsLoading,
  portsError,
  portsErrorUi,
  portsPane,
  selectedPreviewDefaultUrl,
  selectedPreviewUrlOverride,
  setSelectedPreviewUrlOverride,
  agentLabel,
  portRows,
  setSelectedPreviewPort,
  onOpenFileInEditor,
  onOpenPullRequestInChanges,
}: RightPanelTabContentProps) {
  const disabled = isDroneStartingOrSeeding(drone.hubPhase);
  const chatName = selectedChat || 'default';
  const isCurrent = Boolean(currentDroneId && String(currentDroneId) === String(drone.id));

  switch (tab) {
    case 'terminal':
      return (
        <DroneTerminalDock
          key={`${paneKey}-terminal`}
          droneId={drone.id}
          droneName={drone.name}
          chatName={chatName}
          defaultCwd={defaultFsPathForCurrentDrone}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
        />
      );

    case 'files':
      return (
        <DroneFilesDock
          key={`${paneKey}-files`}
          droneId={drone.id}
          droneName={drone.name}
          droneLabel={uiDroneName(drone.name)}
          path={currentFsPath}
          homePath={defaultFsPathForCurrentDrone}
          entries={fsEntries}
          loading={fsLoading}
          error={isCurrent ? fsErrorUi : fsError}
          startup={
            isCurrent
              ? {
                  waiting: filesPane.waiting,
                  timedOut: filesPane.timedOut,
                  hubPhase: drone.hubPhase,
                  hubMessage: drone.hubMessage,
                }
              : null
          }
          viewMode={fsExplorerView}
          onSetViewMode={setFsExplorerView}
          onOpenPath={setCurrentFsPath}
          onRefresh={refreshFsList}
          onOpenFile={onOpenFileInEditor}
        />
      );

    case 'preview':
      return (
        <DronePreviewDock
          key={`${paneKey}-preview`}
          selectedPort={selectedPreviewPort}
          portReachabilityByHostPort={currentPortReachability}
          portsLoading={portsLoading}
          portsError={isCurrent ? portsErrorUi : portsError}
          startup={
            isCurrent
              ? {
                  waiting: portsPane.waiting,
                  timedOut: portsPane.timedOut,
                  hubPhase: drone.hubPhase,
                  hubMessage: drone.hubMessage,
                }
              : null
          }
          defaultPreviewUrl={selectedPreviewDefaultUrl}
          previewUrlOverride={selectedPreviewUrlOverride}
          onSetPreviewUrlOverride={setSelectedPreviewUrlOverride}
        />
      );

    case 'links':
      return (
        <DroneLinksDock
          key={`${paneKey}-links`}
          droneId={drone.id}
          droneName={drone.name}
          agentLabel={agentLabel}
          chatName={chatName}
          portRows={portRows}
          selectedPort={selectedPreviewPort}
          portReachabilityByHostPort={currentPortReachability}
          onSelectPort={setSelectedPreviewPort}
          portsLoading={portsLoading}
          portsError={isCurrent ? portsErrorUi : portsError}
        />
      );

    case 'changes':
      return (
        <DroneChangesDock
          key={`${paneKey}-changes`}
          droneId={drone.id}
          droneName={drone.name}
          repoAttached={drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim())}
          repoPath={drone.repoPath}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
        />
      );

    case 'prs':
      return (
        <DronePullRequestsDock
          key={`${paneKey}-prs`}
          droneId={drone.id}
          droneName={drone.name}
          repoAttached={drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim())}
          repoPath={drone.repoPath}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
          onOpenPullRequestInChanges={(pullRequest) => onOpenPullRequestInChanges(paneKey, pullRequest)}
        />
      );

    default:
      return null;
  }
}
