import React from 'react';
import type { TerminalPaneSessionsState } from '../terminal/terminal-tabs-state';
import type { ChatAgentConfig } from '../../domain';
import {
  UiPaneState,
  UiPanel,
  UiToolbarButton,
  type UiMenuSelectEntry,
} from '../../ui/components';
import type {
  DroneFsEntry,
  DronePortMapping,
  RepoPullRequestSummary,
  DroneSummary,
  PortReachabilityByHostPort,
} from '../types';
import type { DroneOpenedFileState, DroneOpenedFileTabState } from '../files/opened-file-types';
import { DroneFilesDock } from '../files/DroneFilesDock';
import { DronePullRequestsDock } from '../pullRequests/DronePullRequestsDock';
import type { QuickOpenFile, QuickOpenRecentFile } from '../files/quick-open-state';
import { WhiteboardDock } from '../whiteboard/WhiteboardDock';
import {
  RIGHT_PANEL_TAB_LABELS,
  repoUnavailableReasonForRuntime,
  type RightPanelTab,
} from './app-config';
import { AsyncPaneBoundary, type PaneModuleLoader } from './AsyncPaneBoundary';
import { DroneEditorDock } from './DroneEditorDock';
import { DroneEditorWorkspace } from './DroneEditorWorkspace';
import { isDroneStartingOrSeeding } from './helpers';

const loadDroneCanvasDock = async () => (await import('../canvas/DroneCanvasDock')).DroneCanvasDock;
const loadDroneChangesDock = async () => (await import('../changes/DroneChangesDock')).DroneChangesDock;
const loadDroneChangeRequestsDock = async () =>
  (await import('../changeRequests/DroneChangeRequestsDock')).DroneChangeRequestsDock;
const loadDroneEnvDock = async () => (await import('../env/DroneEnvDock')).DroneEnvDock;
const loadDroneLinksDock = async () => (await import('../overview/DroneLinksDock')).DroneLinksDock;
const loadDronePreviewDock = async () => (await import('../overview/DronePreviewDock')).DronePreviewDock;
const loadDroneTerminalDock = async () => (await import('../terminal/DroneTerminalDock')).DroneTerminalDock;
const loadDroneWorkflowsDock = async () => (await import('../workflows/DroneWorkflowsDock')).DroneWorkflowsDock;

export function RightPanelPaneLoadingFallback({ tab }: { tab: RightPanelTab }) {
  const label = RIGHT_PANEL_TAB_LABELS[tab] ?? 'Pane';
  const loadingLabel = tab === 'env' ? 'environment' : label.toLowerCase();
  return (
    <UiPanel flush surface="alternate" className="h-full w-full">
      <UiPaneState kind="loading" title={`Loading ${loadingLabel}…`} />
    </UiPanel>
  );
}

export function RightPanelPaneLoadError({
  tab,
  message,
  onRetry,
}: {
  tab: RightPanelTab;
  message: string;
  onRetry: () => void;
}) {
  const label = RIGHT_PANEL_TAB_LABELS[tab] ?? 'Pane';
  return (
    <UiPanel flush surface="alternate" className="h-full w-full">
      <UiPaneState
        kind="error"
        title={`${label} failed to load`}
        description={message}
        action={
          <UiToolbarButton tone="danger" onClick={onRetry}>
            Retry
          </UiToolbarButton>
        }
      />
    </UiPanel>
  );
}

function PaneModule<T extends React.ComponentType<any>>({
  tab,
  load,
  children,
}: {
  tab: RightPanelTab;
  load: PaneModuleLoader<T>;
  children: (Component: T) => React.ReactNode;
}) {
  const label = RIGHT_PANEL_TAB_LABELS[tab] ?? 'Pane';
  return (
    <AsyncPaneBoundary
      tab={tab}
      label={label}
      load={load}
      loadingFallback={<RightPanelPaneLoadingFallback tab={tab} />}
      errorFallback={(message, retry) => <RightPanelPaneLoadError tab={tab} message={message} onRetry={retry} />}
    >
      {children}
    </AsyncPaneBoundary>
  );
}

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
  droneById: Record<string, DroneSummary>;
  droneNameById: Record<string, string>;
  droneRepoById: Record<string, string>;
  fleetParentIdByDroneId: Record<string, string>;
  fleetAssignedIdsByDroneId: Record<string, string[]>;
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
      lastAgentSnippet: string | null;
    }
  >;
  onActivateChatFromCanvas: (droneId: string, chatName: string) => void;
  onAssignCanvasDronesToOwner: (
    ownerDroneId: string,
    targetDroneIds: string[],
  ) => Promise<{ ok: boolean; error?: string | null }>;
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
  onCloneCanvasDrone: (
    drone: DroneSummary,
  ) => Promise<{ ok: boolean; droneId?: string; droneName?: string }> | { ok: boolean; droneId?: string; droneName?: string };
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
  currentDroneId: string | null;
  currentCanvasChatNodeId: string | null;
  defaultFsPathForCurrentDrone: string;
  terminalSessionsState: TerminalPaneSessionsState;
  onEnsureTerminalSessions: (droneId: string, paneKey: 'top' | 'bottom' | 'single', cwd: string) => void;
  onCreateTerminalSession: (droneId: string, paneKey: 'top' | 'bottom' | 'single', cwd: string) => void;
  onActivateTerminalSession: (droneId: string, paneKey: 'top' | 'bottom' | 'single', sessionId: string) => void;
  onResolveTerminalSessionName: (
    droneId: string,
    paneKey: 'top' | 'bottom' | 'single',
    sessionId: string,
    sessionName: string,
  ) => void;
  onCloseTerminalSession: (droneId: string, paneKey: 'top' | 'bottom' | 'single', sessionId: string) => void;
  uiDroneName: (nameRaw: string) => string;
  currentFsPath: string;
  fsEntries: DroneFsEntry[];
  fsLoading: boolean;
  fsError: string | null;
  fsErrorUi: string | null;
  filesPane: PaneReadinessState;
  setCurrentFsPath: (nextPath: string) => void;
  refreshFsList: () => void;
  onRefreshOpenedEditorFile: () => void;
  onReloadOpenedEditorFileFromDisk: () => void;
  onOverwriteOpenedEditorFile: () => Promise<boolean>;
  selectedPreviewPort: DronePortMapping | null;
  currentPortReachability: PortReachabilityByHostPort;
  portsLoading: boolean;
  portsError: string | null;
  portsErrorUi: string | null;
  portsPane: PaneReadinessState;
  selectedPreviewDefaultUrl: string | null;
  selectedPreviewUrlOverride: string | null;
  setSelectedPreviewUrlOverride: (nextUrl: string | null) => void;
  previewLocked: boolean;
  onTogglePreviewLocked: () => void;
  agentLabel: string;
  portRows: DronePortMapping[];
  onOpenFileInEditor: (entry: DroneFsEntry) => void;
  onOpenFileInPanel: (entry: DroneFsEntry) => boolean;
  onOpenFileTargetInEditor: (next: { path: string; name: string; line?: number | null; column?: number | null }) => void;
  openedFile: DroneOpenedFileState;
  quickOpen: {
    open: boolean;
    query: string;
    files: QuickOpenFile[];
    recentFiles: QuickOpenRecentFile[];
    loading: boolean;
    error: string | null;
    canGoBack: boolean;
    canGoForward: boolean;
    onQueryChange: (next: string) => void;
    onClose: () => void;
    onOpenFile: (next: { path: string; name: string; line?: number | null; column?: number | null }) => void;
    onGoBack: () => void;
    onGoForward: () => void;
  };
  openedFileTabs: DroneOpenedFileTabState[];
  activeOpenedFileTabId: string | null;
  onOpenedEditorFileContentChange: (next: string) => void;
  onSaveOpenedEditorFile: (contentOverride?: string) => Promise<boolean>;
  onCloseOpenedEditorFile: (tabId?: string | null) => void;
  onConfirmCloseOpenedEditorFilesForPaths: (paths: string[], actionLabel?: string) => boolean;
  onCloseOpenedEditorFilesForPaths: (paths: string[]) => void;
  onRemapOpenedEditorFilesForPathChange: (sourcePath: string, targetPath: string) => void;
  onActivateOpenedEditorFileTab: (tabId: string) => void;
  onReorderOpenedEditorFileTabs: (fromTabId: string, toTabId: string) => void;
  onOpenPullRequest: (paneKey: 'top' | 'bottom' | 'single', pullRequest: RepoPullRequestSummary) => void;
  onRevealChangesFileInFiles: (paneKey: 'top' | 'bottom' | 'single', repoRelativePath: string) => void;
  onOpenChangesFileInEditor: (repoRelativePath: string) => void;
};

export function RightPanelTabContent({
  drone,
  tab,
  paneKey,
  selectedChat,
  orderedCanvasChatNodeIds,
  droneById,
  droneNameById,
  droneRepoById,
  fleetParentIdByDroneId,
  fleetAssignedIdsByDroneId,
  draftRepoLabel,
  chatNodeStateById,
  onActivateChatFromCanvas,
  onAssignCanvasDronesToOwner,
  onSendCanvasPrompt,
  onCreateCanvasDroneFromDraft,
  onRenameCanvasChat,
  onDeleteCanvasChat,
  onCloneCanvasDrone,
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
  currentDroneId,
  currentCanvasChatNodeId,
  defaultFsPathForCurrentDrone,
  terminalSessionsState,
  onEnsureTerminalSessions,
  onCreateTerminalSession,
  onActivateTerminalSession,
  onResolveTerminalSessionName,
  onCloseTerminalSession,
  uiDroneName,
  currentFsPath,
  fsEntries,
  fsLoading,
  fsError,
  fsErrorUi,
  filesPane,
  setCurrentFsPath,
  refreshFsList,
  onRefreshOpenedEditorFile,
  onReloadOpenedEditorFileFromDisk,
  onOverwriteOpenedEditorFile,
  selectedPreviewPort,
  currentPortReachability,
  portsLoading,
  portsError,
  portsErrorUi,
  portsPane,
  selectedPreviewDefaultUrl,
  selectedPreviewUrlOverride,
  setSelectedPreviewUrlOverride,
  previewLocked,
  onTogglePreviewLocked,
  agentLabel,
  portRows,
  onOpenFileInEditor,
  onOpenFileInPanel,
  onOpenFileTargetInEditor,
  openedFile,
  quickOpen,
  openedFileTabs,
  activeOpenedFileTabId,
  onOpenedEditorFileContentChange,
  onSaveOpenedEditorFile,
  onCloseOpenedEditorFile,
  onConfirmCloseOpenedEditorFilesForPaths,
  onCloseOpenedEditorFilesForPaths,
  onRemapOpenedEditorFilesForPathChange,
  onActivateOpenedEditorFileTab,
  onReorderOpenedEditorFileTabs,
  onOpenPullRequest,
  onRevealChangesFileInFiles,
  onOpenChangesFileInEditor,
}: RightPanelTabContentProps) {
  const disabled = isDroneStartingOrSeeding(drone.hubPhase);
  const repoFeaturesEnabled = Boolean(drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim()));
  const repoUnavailableReason = repoUnavailableReasonForRuntime(drone.runtime);
  const chatName = selectedChat || 'default';
  const isCurrent = Boolean(currentDroneId && String(currentDroneId) === String(drone.id));
  const renderFileExplorer = (explorerZoom: number) => (
    <DroneFilesDock
      key={`${paneKey}-file-explorer`}
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
      onOpenPath={setCurrentFsPath}
      onRefresh={refreshFsList}
      onRefreshOpenedFile={onRefreshOpenedEditorFile}
      onOpenFile={onOpenFileInEditor}
      onOpenFileInPanel={onOpenFileInPanel}
      onCloseOpenedFile={onCloseOpenedEditorFile}
      onConfirmCloseOpenedFilesForPaths={onConfirmCloseOpenedEditorFilesForPaths}
      onCloseOpenedFilesForPaths={onCloseOpenedEditorFilesForPaths}
      onRemapOpenedFilesForPathChange={onRemapOpenedEditorFilesForPathChange}
      openedFile={openedFile}
      zoom={explorerZoom}
    />
  );
  const fileEditor = (
    <DroneEditorDock
      droneId={drone.id}
      openedFile={openedFile}
      quickOpen={quickOpen}
      openedFileTabs={openedFileTabs}
      activeOpenedFileTabId={activeOpenedFileTabId}
      onOpenedEditorFileContentChange={onOpenedEditorFileContentChange}
      onSaveOpenedEditorFile={onSaveOpenedEditorFile}
      onReloadOpenedEditorFileFromDisk={onReloadOpenedEditorFileFromDisk}
      onOverwriteOpenedEditorFile={onOverwriteOpenedEditorFile}
      onCloseOpenedEditorFile={onCloseOpenedEditorFile}
      onActivateOpenedEditorFileTab={onActivateOpenedEditorFileTab}
      onReorderOpenedEditorFileTabs={onReorderOpenedEditorFileTabs}
      onOpenFileTargetInEditor={onOpenFileTargetInEditor}
    />
  );

  switch (tab) {
    case 'workflows':
      return (
        <PaneModule tab={tab} load={loadDroneWorkflowsDock}>
          {(DroneWorkflowsDock) => (
            <DroneWorkflowsDock
              droneId={drone.id}
              disabled={disabled}
              onOpenChat={onActivateChatFromCanvas}
            />
          )}
        </PaneModule>
      );

    case 'canvas':
      return (
        <PaneModule tab={tab} load={loadDroneCanvasDock}>
          {(DroneCanvasDock) => (
            <DroneCanvasDock
              droneById={droneById}
              droneNameById={droneNameById}
              sidebarOrderedChatNodeIds={orderedCanvasChatNodeIds}
              sidebarSelectedChatNodeId={currentCanvasChatNodeId}
              droneRepoById={droneRepoById}
              fleetParentIdByDroneId={fleetParentIdByDroneId}
              fleetAssignedIdsByDroneId={fleetAssignedIdsByDroneId}
              draftRepoLabel={draftRepoLabel}
              chatNodeStateById={chatNodeStateById}
              onActivateChat={onActivateChatFromCanvas}
              onAssignDronesToOwner={onAssignCanvasDronesToOwner}
              onSendCanvasPrompt={onSendCanvasPrompt}
              onCreateCanvasDroneFromDraft={onCreateCanvasDroneFromDraft}
              onRenameChat={onRenameCanvasChat}
              onDeleteChat={onDeleteCanvasChat}
              onCloneDrone={onCloneCanvasDrone}
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
            />
          )}
        </PaneModule>
      );

    case 'whiteboard':
      return <WhiteboardDock droneId={drone.id} />;

    case 'terminal':
      return (
        <PaneModule tab={tab} load={loadDroneTerminalDock}>
          {(DroneTerminalDock) => (
            <DroneTerminalDock
              key={`${paneKey}-terminal`}
              droneId={drone.id}
              droneName={drone.name}
              chatName={chatName}
              defaultCwd={defaultFsPathForCurrentDrone}
              paneKey={paneKey}
              sessionsState={terminalSessionsState}
              onEnsureSessions={onEnsureTerminalSessions}
              onCreateSession={onCreateTerminalSession}
              onActivateSession={onActivateTerminalSession}
              onResolveSessionName={onResolveTerminalSessionName}
              onCloseSession={onCloseTerminalSession}
              disabled={disabled}
              hubPhase={drone.hubPhase}
              hubMessage={drone.hubMessage}
            />
          )}
        </PaneModule>
      );

    case 'env':
      return (
        <PaneModule tab={tab} load={loadDroneEnvDock}>
          {(DroneEnvDock) => (
            <DroneEnvDock
              droneId={drone.id}
              droneName={drone.name}
              disabled={disabled}
              hubPhase={drone.hubPhase}
              hubMessage={drone.hubMessage}
            />
          )}
        </PaneModule>
      );

    case 'editor':
      return (
        <DroneEditorWorkspace explorer={renderFileExplorer} editor={fileEditor} />
      );

    case 'preview':
      return (
        <PaneModule tab={tab} load={loadDronePreviewDock}>
          {(DronePreviewDock) => (
            <DronePreviewDock
              key={`${paneKey}-preview`}
              droneId={drone.id}
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
              locked={previewLocked}
              onToggleLocked={onTogglePreviewLocked}
              agentLabel={agentLabel}
              chatName={chatName}
            />
          )}
        </PaneModule>
      );

    case 'links':
      return (
        <PaneModule tab={tab} load={loadDroneLinksDock}>
          {(DroneLinksDock) => (
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
          )}
        </PaneModule>
      );

    case 'changes':
      return (
        <PaneModule tab={tab} load={loadDroneChangesDock}>
          {(DroneChangesDock) => (
            <DroneChangesDock
              key={`${paneKey}-${drone.id}-changes`}
              droneId={drone.id}
              repoAttached={repoFeaturesEnabled}
              repoPath={drone.repoPath}
              repoUnavailableReason={repoUnavailableReason}
              fixedContextMode="branch"
              acceptHistoricalRunChanges
              disabled={disabled}
              hubPhase={drone.hubPhase}
              hubMessage={drone.hubMessage}
              onRevealFileInFiles={(repoRelativePath) => onRevealChangesFileInFiles(paneKey, repoRelativePath)}
              onOpenFileInEditor={onOpenChangesFileInEditor}
            />
          )}
        </PaneModule>
      );

    case 'requests':
      return (
        <PaneModule tab={tab} load={loadDroneChangeRequestsDock}>
          {(DroneChangeRequestsDock) => (
            <DroneChangeRequestsDock
              key={`${paneKey}-${drone.id}-requests`}
              droneId={drone.id}
              chatName={chatName}
              repoAttached={repoFeaturesEnabled}
              repoPath={drone.repoPath}
              disabled={disabled}
              onRevealFileInFiles={(repoRelativePath) => onRevealChangesFileInFiles(paneKey, repoRelativePath)}
              onOpenFileInEditor={onOpenChangesFileInEditor}
            />
          )}
        </PaneModule>
      );

    case 'prs':
      return (
        <DronePullRequestsDock
          key={`${paneKey}-${drone.id}-prs`}
          droneId={drone.id}
          droneName={drone.name}
          repoAttached={repoFeaturesEnabled}
          repoPath={drone.repoPath}
          repoUnavailableReason={repoUnavailableReason}
          disabled={disabled}
          hubPhase={drone.hubPhase}
          hubMessage={drone.hubMessage}
          onOpenPullRequest={(pullRequest) => onOpenPullRequest(paneKey, pullRequest)}
          onRevealFileInFiles={(repoRelativePath) => onRevealChangesFileInFiles(paneKey, repoRelativePath)}
          onOpenFileInEditor={onOpenChangesFileInEditor}
        />
      );

    default:
      return null;
  }
}
