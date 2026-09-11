import type { IDockviewPanel } from 'dockview';

/** A hidden tab has its own constraints; its active sibling's constraints do not apply. */
export function workspacePanelConstraints(panel: Pick<IDockviewPanel, 'minimumWidth' | 'minimumHeight' | 'maximumWidth' | 'maximumHeight'>) {
  return {
    minimumWidth: Math.max(0, panel.minimumWidth ?? 100),
    minimumHeight: Math.max(0, panel.minimumHeight ?? 100),
    ...(Number.isFinite(panel.maximumWidth) ? { maximumWidth: panel.maximumWidth } : {}),
    ...(Number.isFinite(panel.maximumHeight) ? { maximumHeight: panel.maximumHeight } : {}),
  };
}
