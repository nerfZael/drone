import type { SerializedDockview } from 'dockview';
import { requestJsonWithTimeout } from '../http';
import { workspacePresetTarget } from './workspace-preset-target';

export async function executeWorkspacePreset(action: string, droneId: string | undefined, isCurrent: () => boolean = () => true): Promise<void> {
  const target = workspacePresetTarget(droneId);
  if (!target) throw new Error('Select an available desktop drone workspace.');
  const slot = action.slice(-1);
  if (action.startsWith('saveLayout')) {
    const layout = target.capture();
    await requestJsonWithTimeout(`/api/window-layout-presets/${slot}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout }) }, 15_000);
  } else {
    const { presets } = await requestJsonWithTimeout<{ presets: Record<string, SerializedDockview> }>('/api/window-layout-presets', undefined, 15_000);
    const layout = presets[slot];
    if (!layout) throw new Error(`Slot ${slot} is empty. Use Q, then ${slot}, to save a preset.`);
    const currentTarget = workspacePresetTarget(droneId);
    if (!isCurrent() || currentTarget?.identity !== target.identity) throw new Error('The workspace changed. Open the action dialog again.');
    currentTarget.restore(layout);
  }
}
