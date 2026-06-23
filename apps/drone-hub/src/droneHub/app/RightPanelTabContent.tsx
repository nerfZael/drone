import React from 'react';
import type { TerminalPaneSessionsState } from '../terminal/terminal-tabs-state';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import type {
  DroneFsEntry,
  DronePortMapping,
  RepoPullRequestSummary,
  DroneSummary,
  PortReachabilityByHostPort,
} from '../types';
import type { DroneOpenedFileState, DroneOpenedFileTabState } from '../files/opened-file-types';
import {
  RIGHT_PANEL_TAB_LABELS,
  RIGHT_PANEL_TABS,
  repoUnavailableReasonForRuntime,
  type RightPanelTab,
} from './app-config';
import { isDroneStartingOrSeeding } from './helpers';

const LazyAssistantDock = React.lazy(async () => ({
  default: (await import('../assistant/AssistantDock')).AssistantDock,
}));
const LazyDroneCanvasDock = React.lazy(async () => ({
  default: (await import('../canvas/DroneCanvasDock')).DroneCanvasDock,
}));
const LazyDroneChangesDock = React.lazy(async () => ({
  default: (await import('../changes/DroneChangesDock')).DroneChangesDock,
}));
const LazyDroneEnvDock = React.lazy(async () => ({
  default: (await import('../env/DroneEnvDock')).DroneEnvDock,
}));
const LazyDroneFleetDock = React.lazy(async () => ({
  default: (await import('../fleet/DroneFleetDock')).DroneFleetDock,
}));
const LazyDroneFilesDock = React.lazy(async () => ({
  default: (await import('../files/DroneFilesDock')).DroneFilesDock,
}));
const LazyOpenedDroneFilePanel = React.lazy(async () => ({
  default: (await import('../files/OpenedDroneFilePanel')).OpenedDroneFilePanel,
}));
const LazyDroneLinksDock = React.lazy(async () => ({
  default: (await import('../overview/DroneLinksDock')).DroneLinksDock,
}));
const LazyDronePreviewDock = React.lazy(async () => ({
  default: (await import('../overview/DronePreviewDock')).DronePreviewDock,
}));
const LazyDronePullRequestsDock = React.lazy(async () => ({
  default: (await import('../pullRequests/DronePullRequestsDock')).DronePullRequestsDock,
}));
const LazyDroneTerminalDock = React.lazy(async () => ({
  default: (await import('../terminal/DroneTerminalDock')).DroneTerminalDock,
}));

export const LAZY_RIGHT_PANEL_TABS: ReadonlySet<RightPanelTab> = new Set(RIGHT_PANEL_TABS);

export function isRightPanelTabLazyLoaded(tab: RightPanelTab): boolean {
  return LAZY_RIGHT_PANEL_TABS.has(tab);
}

export function RightPanelPaneLoadingFallback({ tab }: { tab: RightPanelTab }) {
  const label = RIGHT_PANEL_TAB_LABELS[tab] ?? 'Pane';
  const loadingLabel = label === 'ENV' ? 'environment' : label.toLowerCase();
  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex items-start px-2.5 py-2">
      <div className="w-full rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[12px] text-[var(--muted)]">
        <div className="text-[11px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          {label}
        </div>
        <div className="mt-1" aria-live="polite">
          Loading {loadingLabel}...
        </div>
      </div>
    </div>
  );
}

function LazyPane({ tab, children }: { tab: RightPanelTab; children: React.ReactNode }) {
  return <React.Suspense fallback={<RightPanelPaneLoadingFallback tab={tab} />}>{children}</React.Suspense>;
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
  canvasPullHostBranchBeforeCreate: boolean;
  onCanvasPullHostBranchBeforeCreateChange: (next: boolean) => void;
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
  fsExplorerView: 'list' | 'thumb';
  setFsExplorerView: React.Dispatch<React.SetStateAction<'list' | 'thumb'>>;
  setCurrentFsPath: (nextPath: string) => void;
  refreshFsList: () => void;
  onRefreshOpenedEditorFile: () => void;
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
  openedFileTabs: DroneOpenedFileTabState[];
  activeOpenedFileTabId: string | null;
  onOpenedEditorFileContentChange: (next: string) => void;
  onSaveOpenedEditorFile: (contentOverride?: string) => Promise<boolean>;
  onCloseOpenedEditorFile: (tabId?: string | null) => void;
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
  canvasPullHostBranchBeforeCreate,
  onCanvasPullHostBranchBeforeCreateChange,
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
  fsExplorerView,
  setFsExplorerView,
  setCurrentFsPath,
  refreshFsList,
  onRefreshOpenedEditorFile,
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
  openedFileTabs,
  activeOpenedFileTabId,
  onOpenedEditorFileContentChange,
  onSaveOpenedEditorFile,
  onCloseOpenedEditorFile,
  onActivateOpenedEditorFileTab,
  onReorderOpenedEditorFileTabs,
  onOpenPullRequest,
  onRevealChangesFileInFiles,
  onOpenChangesFileInEditor,
}: RightPanelTabContentProps) {
  if (tab === 'assistant') {
    return (
      <LazyPane tab={tab}>
        <LazyAssistantDock />
      </LazyPane>
    );
  }

  const disabled = isDroneStartingOrSeeding(drone.hubPhase);
  const repoFeaturesEnabled = Boolean(drone.repoAttached ?? Boolean(String(drone.repoPath ?? '').trim()));
  const repoUnavailableReason = repoUnavailableReasonForRuntime(drone.runtime);
  const chatName = selectedChat || 'default';
  const isCurrent = Boolean(currentDroneId && String(currentDroneId) === String(drone.id));

  switch (tab) {
    case 'canvas':
      return (
        <LazyPane tab={tab}>
          <LazyDroneCanvasDock
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
            pullHostBranchBeforeCreate={canvasPullHostBranchBeforeCreate}
            onPullHostBranchBeforeCreateChange={onCanvasPullHostBranchBeforeCreateChange}
          />
        </LazyPane>
      );

    case 'terminal':
      return (
        <LazyPane tab={tab}>
          <LazyDroneTerminalDock
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
        </LazyPane>
      );

    case 'env':
      return (
        <LazyPane tab={tab}>
          <LazyDroneEnvDock
            droneId={drone.id}
            droneName={drone.name}
            disabled={disabled}
            hubPhase={drone.hubPhase}
            hubMessage={drone.hubMessage}
          />
        </LazyPane>
      );

    case 'fleet':
      return (
        <LazyPane tab={tab}>
          <LazyDroneFleetDock
            droneId={drone.id}
            droneName={drone.name}
            disabled={disabled}
            hubPhase={drone.hubPhase}
            hubMessage={drone.hubMessage}
          />
        </LazyPane>
      );

    case 'files':
      return (
        <LazyPane tab={tab}>
          <LazyDroneFilesDock
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
            onRefreshOpenedFile={onRefreshOpenedEditorFile}
            onOpenFile={onOpenFileInEditor}
            onOpenFileInPanel={onOpenFileInPanel}
            openedFile={openedFile}
          />
        </LazyPane>
      );

    case 'editor':
      return (
        <LazyPane tab={tab}>
          <div className="h-full min-h-0 overflow-hidden bg-[var(--panel-alt)]">
            {openedFile.path ? (
              <LazyOpenedDroneFilePanel
                droneId={drone.id}
                file={openedFile}
                fileTabs={openedFileTabs}
                activeTabId={activeOpenedFileTabId}
                onFileContentChange={onOpenedEditorFileContentChange}
                onSaveFile={onSaveOpenedEditorFile}
                onCloseFile={onCloseOpenedEditorFile}
                onActivateFileTab={onActivateOpenedEditorFileTab}
                onReorderFileTabs={onReorderOpenedEditorFileTabs}
                onOpenResolvedFile={onOpenFileTargetInEditor}
              />
            ) : (
              <div className="h-full flex items-center justify-center px-4 text-center text-[12px] text-[var(--muted)]">
                Open a file from Files, Changes, PRs, or a chat reference.
              </div>
            )}
          </div>
        </LazyPane>
      );

    case 'preview':
      return (
        <LazyPane tab={tab}>
          <LazyDronePreviewDock
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
            locked={previewLocked}
            onToggleLocked={onTogglePreviewLocked}
          />
        </LazyPane>
      );

    case 'links':
      return (
        <LazyPane tab={tab}>
          <LazyDroneLinksDock
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
        </LazyPane>
      );

    case 'changes':
      return (
        <LazyPane tab={tab}>
          <LazyDroneChangesDock
            key={`${paneKey}-${drone.id}-changes`}
            droneId={drone.id}
            repoAttached={repoFeaturesEnabled}
            repoPath={drone.repoPath}
            repoUnavailableReason={repoUnavailableReason}
            fixedContextMode="branch"
            disabled={disabled}
            hubPhase={drone.hubPhase}
            hubMessage={drone.hubMessage}
            onRevealFileInFiles={(repoRelativePath) => onRevealChangesFileInFiles(paneKey, repoRelativePath)}
            onOpenFileInEditor={onOpenChangesFileInEditor}
          />
        </LazyPane>
      );

    case 'prs':
      return (
        <LazyPane tab={tab}>
          <LazyDronePullRequestsDock
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
        </LazyPane>
      );

    default:
      return null;
  }
}
