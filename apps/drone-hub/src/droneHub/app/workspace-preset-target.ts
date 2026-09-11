import type { SerializedDockview } from 'dockview';

type PresetTarget = { identity: object; closeDockedWindows(): void; capture(): SerializedDockview; restore(layout: SerializedDockview): void };
const targets = new Map<string, PresetTarget>();

export function registerWorkspacePresetTarget(droneId: string, target: PresetTarget): () => void {
  targets.set(droneId, target);
  return () => { if (targets.get(droneId) === target) targets.delete(droneId); };
}

export function workspacePresetTarget(droneId: string | undefined): PresetTarget | undefined {
  return droneId ? targets.get(droneId) : undefined;
}
