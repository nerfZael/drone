import { TerminalRouteService } from '../terminal-route-service';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type TerminalDependencyName =
  | 'HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES'
  | 'HUB_WEB_TERMINAL_MAX_BYTES'
  | 'HUB_WEB_TERMINAL_MAX_TAIL_LINES'
  | 'buildContainerManagedEnvLines'
  | 'buildDockerExecShellCommand'
  | 'buildDockerExecTmuxAttachCommand'
  | 'buildEnvExportLines'
  | 'clampIntParam'
  | 'defaultDaemonReadyTimeoutMs'
  | 'droneRuntime'
  | 'droneTerminalInput'
  | 'droneTerminalOutput'
  | 'dvmExec'
  | 'dvmSessionRead'
  | 'dvmSessionStart'
  | 'dvmSessionType'
  | 'ensureChatEntry'
  | 'ensureHubChatSessionRunning'
  | 'ensureHubSessionRunning'
  | 'isSafeTmuxSessionName'
  | 'isStaleDockerExecErrorMessage'
  | 'loadRegistry'
  | 'normalizeChatName'
  | 'normalizeDroneIdentity'
  | 'normalizeDroneUiCwdForRuntime'
  | 'parseOptionalNonNegativeInt'
  | 'procStart'
  | 'procStop'
  | 'resolveChatTmuxCommand'
  | 'resolveContainerManagedEnvVars'
  | 'resolveDroneDaemonClientForEntry'
  | 'resolveDroneEnvironmentConfig'
  | 'resolveDroneOrRespond'
  | 'resolveHostTerminalShellCommand'
  | 'resolveHubAgentCommand'
  | 'resolveHubTerminalShellCommand'
  | 'spawnTerminalWithBash'
  | 'syncMcpServersForDrone'
  | 'syncRepoAgentsInstructionsForDrone'
  | 'syncSkillLibraryForDrone'
  | 'upgradeDroneDaemonInContainer'
  | 'waitForDroneDaemonReady'
  | 'withLockedDroneContainer';

export type TerminalRouteDependencies = LegacyRouteDependencyContract<TerminalDependencyName>;

export function createTerminalRouteHandler(deps: TerminalRouteDependencies): LegacyRouteHandler {
  return new TerminalRouteService(deps).handle;
}
