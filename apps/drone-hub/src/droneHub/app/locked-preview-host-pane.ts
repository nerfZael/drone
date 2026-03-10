import type { RightPanelTab } from './app-config';

export type LockedPreviewHostPane = 'single' | 'top' | 'bottom';

export function resolveLockedPreviewHostPane(args: {
  previewLocked: boolean;
  rightPanelSplit: boolean;
  rightPanelTab: RightPanelTab;
  rightPanelBottomTab: RightPanelTab;
}): LockedPreviewHostPane | null {
  const { previewLocked, rightPanelSplit, rightPanelTab, rightPanelBottomTab } = args;
  if (!previewLocked) return null;
  if (!rightPanelSplit) return rightPanelTab === 'preview' ? 'single' : null;
  if (rightPanelTab === 'preview') return 'top';
  if (rightPanelBottomTab === 'preview') return 'bottom';
  return null;
}
