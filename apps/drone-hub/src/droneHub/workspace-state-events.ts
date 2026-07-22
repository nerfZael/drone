export const DRONE_WORKSPACE_STATE_DISPOSE_EVENT = 'dronehub:workspace-state-dispose';

export function disposeDroneWorkspaceState(droneIdRaw: string): void {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, { detail: { droneId } }));
}

export function disposedDroneIdFromEvent(event: Event): string {
  return String((event as CustomEvent<{ droneId?: string }>).detail?.droneId ?? '').trim();
}
