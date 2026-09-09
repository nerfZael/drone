import { profileStorageKey } from '../../profile-storage';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';
import type { WorkspaceRect } from './side-chat-placement';

type SideChatWorkspaceState = {
  previousMainChat: string;
  floatingBounds: Record<string, WorkspaceRect>;
};

function storageKey(droneId: string): string {
  return profileStorageKey(`droneHub.sideChatWorkspace.${encodeURIComponent(droneId)}`);
}

export function parseSideChatWorkspaceState(raw: string | null): SideChatWorkspaceState {
  const state: SideChatWorkspaceState = { previousMainChat: 'default', floatingBounds: {} };
  try {
    const value = JSON.parse(raw ?? 'null');
    if (typeof value?.previousMainChat === 'string' && value.previousMainChat.trim()) {
      state.previousMainChat = value.previousMainChat;
    }
    for (const [name, rect] of Object.entries(value?.floatingBounds ?? {})) {
      const bounds = rect as WorkspaceRect;
      if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0) {
        Object.defineProperty(state.floatingBounds, name, { value: bounds, enumerable: true, configurable: true, writable: true });
      }
    }
  } catch {
    // Old or damaged preferences must not prevent opening a chat.
  }
  return state;
}

export function readSideChatWorkspaceState(droneId: string): SideChatWorkspaceState {
  try {
    return parseSideChatWorkspaceState(localStorage.getItem(storageKey(droneId)));
  } catch {
    return parseSideChatWorkspaceState(null);
  }
}

export function saveSideChatWorkspaceState(droneId: string, update: Partial<SideChatWorkspaceState>): void {
  try {
    const previous = readSideChatWorkspaceState(droneId);
    localStorage.setItem(storageKey(droneId), JSON.stringify({
      ...previous,
      ...update,
      floatingBounds: { ...previous.floatingBounds, ...update.floatingBounds },
    }));
  } catch {
    // The workspace remains usable when storage is unavailable.
  }
}

export function renameSideChatWorkspaceChat(droneId: string, oldName: string, newName: string): void {
  if (oldName === newName) return;
  const state = readSideChatWorkspaceState(droneId);
  if (state.previousMainChat === oldName) state.previousMainChat = newName;
  if (Object.prototype.hasOwnProperty.call(state.floatingBounds, oldName)) {
    state.floatingBounds = { ...state.floatingBounds, [newName]: state.floatingBounds[oldName] };
    delete state.floatingBounds[oldName];
  }
  try { localStorage.setItem(storageKey(droneId), JSON.stringify(state)); } catch { /* Optional preferences. */ }
}

export function measureSideChatBounds(group: Element, workspace: Element): WorkspaceRect {
  const rootRect = workspace.getBoundingClientRect();
  // The group sits inside the floating frame's border. Saving the inner
  // group would shrink and shift the window on every round trip.
  const frame = group.closest('.dv-resize-container') ?? group;
  const rect = frame.getBoundingClientRect();
  return { x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height };
}

export function restoreSideChatBounds(bounds: WorkspaceRect, workspace: { width: number; height: number }): WorkspaceRect {
  const width = Math.min(bounds.width, Math.max(1, workspace.width));
  const height = Math.min(bounds.height, Math.max(1, workspace.height));
  return {
    x: Math.max(0, Math.min(bounds.x, workspace.width - width)),
    y: Math.max(0, Math.min(bounds.y, workspace.height - height)),
    width,
    height,
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (!droneId) return;
    try {
      localStorage.removeItem(storageKey(droneId));
    } catch {
      // Ignore preference cleanup failures.
    }
  });
}
