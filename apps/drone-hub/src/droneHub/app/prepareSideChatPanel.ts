import type { IDockviewPanel } from 'dockview';

/** Display a new/restored chat without changing the workspace's active group or keyboard focus. */
export function prepareSideChatPanel(panel: IDockviewPanel): void {
  if (!panel.group.activePanel) {
    // `inactive` on addPanel skips BOTH group activation and selecting its
    // content. Select only within the group, or Dockview shows its watermark.
    panel.group.model.openPanel(panel, { skipSetGroupActive: true });
  }
  const handle = panel.group.element.querySelector<HTMLElement>('.dv-void-container');
  handle?.setAttribute('title', 'Drag to move the floating window. Shift-drag to dock it.');
}
