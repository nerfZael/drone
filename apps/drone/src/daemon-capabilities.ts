export const CODEX_ROOT_THREAD_RECOVERY_CAPABILITY = 'codex-root-thread-recovery-v1';
export const CODEX_SKILL_USE_TRACKING_CAPABILITY = 'codex-skill-use-tracking-v1';
export const WORKSPACE_FILE_EVENTS_CAPABILITY = 'workspace-file-events-v1';
export const WORKSPACE_DIRECTORY_EVENTS_CAPABILITY = 'workspace-directory-events-v1';
export const WORKSPACE_REPO_EVENTS_CAPABILITY = 'workspace-repo-events-v1';

export const DRONE_DAEMON_CAPABILITIES = [
  'workspace-v1',
  'terminal-control-v1',
  'managed-state-v1',
  'codex-app-server-v1',
  CODEX_ROOT_THREAD_RECOVERY_CAPABILITY,
  CODEX_SKILL_USE_TRACKING_CAPABILITY,
  WORKSPACE_FILE_EVENTS_CAPABILITY,
  WORKSPACE_DIRECTORY_EVENTS_CAPABILITY,
  WORKSPACE_REPO_EVENTS_CAPABILITY,
] as const;
