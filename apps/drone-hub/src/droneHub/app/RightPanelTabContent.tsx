import React from 'react';
import { DroneCanvasDock } from '../canvas';
import { DroneChangesDock } from '../changes';
import { DroneFilesDock } from '../files';
import { DroneLinksDock, DronePreviewDock } from '../overview';
import { DronePullRequestsDock } from '../pullRequests';
import { DroneTerminalDock } from '../terminal';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
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
  orderedCanvasChatNodeIds: string[];
  droneNameById: Record<string, string>;
  droneRepoById: Record<string, string>;
  draftRepoLabel: string;
  chatNodeStateById: Record<
    string,
    {
      statusOk: boolean;
      statusError: string | null;
      hubPhase?: DroneSummary['hubPhase'];
      hubMessage?: DroneSummary['hubMessage'];
      busy: boolean;
      unreadAgentMessage: boolean;
    }
  >;
  onActivateChatFromCanvas: (droneId: string, chatName: string) => void;
  onSendCanvasPrompt: (
    targets: Array<{ droneId: string; chatName: string }>,
    prompt: string,
  ) => Promise<{ ok: boolean; error?: string | null }>;
  onCreateCanvasDroneFromDraft: (payload: {
    draftNodeId: string;
    prompt: string;
    label: string;
    overrides: {
      agentKey: string;
      model: string;
      repoPath: string;
      group: string;
      pullHostBranchBeforeCreate: boolean;
    };
  }) => Promise<{ ok: boolean; droneId?: string; droneName?: string; error?: string | null }>;
  onRenameCanvasChat: (
    droneId: string,
    chatName: string,
    newName: string,
  ) => Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onDeleteCanvasChat: (
    droneId: string,
    chatName: string,
  ) => Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }>;
  canvasSpawnAgentMenuEntries: UiMenuSelectEntry[];
  canvasSpawnAgentKey: string;
  onCanvasSpawnAgentKeyChange: (next: string) => void;
  onOpenCanvasCustomAgentModal: () => void;
  canvasSpawnAgentConfig: ChatAgentConfig;
  canvasSpawnModel: string;
  onCanvasSpawnModelChange: (next: string) => void;
  canvasCreateRepoMenuEntries: UiMenuSelectEntry[];
  canvasCreateRepoPath: string;
  onCanvasCreateRepoPathChange: (next: string) => void;
  canvasCreateGroup: string;
  onCanvasCreateGroupChange: (next: string) => void;
  canvasPullHostBranchBeforeCreate: boolean;
  onCanvasPullHostBranchBeforeCreateChange: (next: boolean) => void;
  currentDroneId: string | null;
  currentCanvasChatNodeId: string | null;
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
  onOpenFileInEditor: (entry: DroneFsEntry) => void;
  onOpenPullRequestInChanges: (paneKey: 'top' | 'bottom' | 'single', pullRequest: RepoPullRequestSummary) => void;
  onRevealChangesFileInFiles: (paneKey: 'top' | 'bottom' | 'single', repoRelativePath: string) => void;
  onOpenChangesFileInEditor: (repoRelativePath: string) => void;
};

export function RightPanelTabContent({
  drone,
  tab,
  paneKey,
  selectedChat,
  orderedCanvasChatNodeIds,
  droneNameById,
  droneRepoById,
  draftRepoLabel,
  chatNodeStateById,
  onActivateChatFromCanvas,
  onSendCanvasPrompt,
  onCreateCanvasDroneFromDraft,
  onRenameCanvasChat,
  onDeleteCanvasChat,
  canvasSpawnAgentMenuEntries,
  canvasSpawnAgentKey,
  onCanvasSpawnAgentKeyChange,
  onOpenCanvasCustomAgentModal,
  canvasSpawnAgentConfig,
  canvasSpawnModel,
  onCanvasSpawnModelChange,
  canvasCreateRepoMenuEntries,
  canvasCreateRepoPath,
  onCanvasCreateRepoPathChange,
  canvasCreateGroup,
  onCanvasCreateGroupChange,
  canvasPullHostBranchBeforeCreate,
  onCanvasPullHostBranchBeforeCreateChange,
  currentDroneId,
  currentCanvasChatNodeId,
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
  onOpenFileInEditor,
  onOpenPullRequestInChanges,
  onRevealChangesFileInFiles,
  onOpenChangesFileInEditor,
}: RightPanelTabContentProps) {
  const disabled = isDroneStartingOrSeeding(drone.hubPhase);
  const chatName = selectedChat || 'default';
  const isCurrent = Boolean(currentDroneId && String(currentDroneId) === String(drone.id));

  switch (tab) {
    case 'canvas':
      return (
        <DroneCanvasDock
          droneNameById={droneNameById}
          sidebarOrderedChatNodeIds={orderedCanvasChatNodeIds}
          sidebarSelectedChatNodeId={currentCanvasChatNodeId}
          droneRepoById={droneRepoById}
          draftRepoLabel={draftRepoLabel}
          chatNodeStateById={chatNodeStateById}
          onActivateChat={onActivateChatFromCanvas}
          onSendCanvasPrompt={onSendCanvasPrompt}
          onCreateCanvasDroneFromDraft={onCreateCanvasDroneFromDraft}
          onRenameChat={onRenameCanvasChat}
          onDeleteChat={onDeleteCanvasChat}
          spawnAgentMenuEntries={canvasSpawnAgentMenuEntries}
          spawnAgentKey={canvasSpawnAgentKey}
          onSpawnAgentKeyChange={onCanvasSpawnAgentKeyChange}
          onOpenCustomAgentModal={onOpenCanvasCustomAgentModal}
          spawnAgentConfig={canvasSpawnAgentConfig}
          spawnModel={canvasSpawnModel}
          onSpawnModelChange={onCanvasSpawnModelChange}
          createRepoMenuEntries={canvasCreateRepoMenuEntries}
          createRepoPath={canvasCreateRepoPath}
          onCreateRepoPathChange={onCanvasCreateRepoPathChange}
          createGroup={canvasCreateGroup}
          onCreateGroupChange={onCanvasCreateGroupChange}
          pullHostBranchBeforeCreate={canvasPullHostBranchBeforeCreate}
          onPullHostBranchBeforeCreateChange={onCanvasPullHostBranchBeforeCreateChange}
        />
      );

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
          portRows={portRows}
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
          portReachabilityByHostPort={currentPortReachability}
          portsLoading={portsLoading}
          portsError={isCurrent ? portsErrorUi : portsError}
        />
      );

    case 'changes':
      return (
        <DroneChangesDock
          key={`${paneKey}-changes`}
          droneId={drone.id}
          repoAttached={drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim())}
          repoPath={drone.repoPath}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
          onRevealFileInFiles={(repoRelativePath) => onRevealChangesFileInFiles(paneKey, repoRelativePath)}
          onOpenFileInEditor={onOpenChangesFileInEditor}
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
