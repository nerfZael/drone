import type { RightPanelTab } from './app-config';

export type LockedPreviewHostPane = 'single' | 'top' | 'bottom';

export function resolvePreviewHostPane(args: {
  previewVisible: boolean;
  rightPanelSplit: boolean;
  rightPanelTab: RightPanelTab;
  rightPanelBottomTab: RightPanelTab;
}): LockedPreviewHostPane | null {
  const { previewVisible, rightPanelSplit, rightPanelTab, rightPanelBottomTab } = args;
  if (!previewVisible) return null;
  if (!rightPanelSplit) return rightPanelTab === 'preview' ? 'single' : null;
  if (rightPanelTab === 'preview') return 'top';
  if (rightPanelBottomTab === 'preview') return 'bottom';
  return null;
}
