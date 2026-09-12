import type { ChatWorkspaceAccess, ChatWorkspaceCatalog, ChatWorkspaceOption } from '@drone/assistant-chat';

export type MobileCompanionCurrentWorkspace = ChatWorkspaceCatalog & {
  target: ChatWorkspaceOption;
  droneId: string;
};

export type MobileCompanionCurrentWorkspaceState = {
  supported: boolean;
  droneId: string;
  loading: boolean;
  busy: boolean;
  error: string;
  current: MobileCompanionCurrentWorkspace | null;
};

/** Mirrors desktop's "Allow Read" control: read access plus making it the default workspace. */
export function resolveMobileCompanionCurrentWorkspaceAccess(state: MobileCompanionCurrentWorkspaceState): {
  label: string;
  detail: string;
  enabled: boolean;
  granted: boolean;
} {
  const selected = state.current?.access.targets.find((target) => target.id === state.current?.target.id);
  const isDefault = Boolean(state.current) && state.current?.access.defaultTargetId === state.current?.target.id;
  const granted = Boolean(selected?.read && isDefault);
  if (!state.supported) {
    return { label: 'Allow read of current workspace', detail: 'Update the Hub to allow the current workspace from your phone.', enabled: false, granted: false };
  }
  if (!state.droneId) {
    return { label: 'Allow read of current workspace', detail: 'Open a drone for workspace access.', enabled: false, granted: false };
  }
  if (state.busy) return { label: 'Saving workspace access…', detail: '', enabled: false, granted };
  if (state.loading && !state.current) return { label: 'Loading workspace…', detail: '', enabled: false, granted: false };
  if (!state.current) {
    return { label: 'Workspace unavailable', detail: state.error || 'Retry', enabled: Boolean(state.error), granted: false };
  }
  const name = state.current.target.name;
  const detail = state.error || [state.current.target.deviceName, state.current.target.path].filter(Boolean).join(' · ');
  if (granted) return { label: `Read enabled · ${name}`, detail, enabled: false, granted: true };
  if (selected?.read) return { label: `Use workspace · ${name}`, detail, enabled: true, granted: false };
  return { label: `Allow read · ${name}`, detail, enabled: true, granted: false };
}

/** The access to save when granting read access to the current workspace. */
export function grantMobileCompanionCurrentWorkspaceRead(current: MobileCompanionCurrentWorkspace): ChatWorkspaceAccess {
  const selected = current.access.targets.find((target) => target.id === current.target.id);
  return {
    targets: selected
      ? current.access.targets
      : [...current.access.targets, { ...current.target, read: true, write: false, execute: false }],
    defaultTargetId: current.target.id,
  };
}
