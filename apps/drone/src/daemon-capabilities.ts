export const CODEX_ROOT_THREAD_RECOVERY_CAPABILITY = 'codex-root-thread-recovery-v1';
export const CODEX_SKILL_USE_TRACKING_CAPABILITY = 'codex-skill-use-tracking-v1';

export const DRONE_DAEMON_CAPABILITIES = [
  'workspace-v1',
  'managed-state-v1',
  'codex-app-server-v1',
  CODEX_ROOT_THREAD_RECOVERY_CAPABILITY,
  CODEX_SKILL_USE_TRACKING_CAPABILITY,
] as const;
