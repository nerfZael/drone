import { RIGHT_PANEL_MIN_WIDTH_PX } from './app-config';

export function resolveNextRightPanelShortcutWidth(currentWidth: number, maxWidth: number): number {
  const safeMax = Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.round(Number.isFinite(maxWidth) ? maxWidth : RIGHT_PANEL_MIN_WIDTH_PX));
  const candidates = [1, 2 / 3, 1 / 3]
    .map((ratio) => Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.min(safeMax, Math.round(safeMax * ratio))))
    .filter((width, index, list) => list.indexOf(width) === index);
  if (candidates.length === 0) return safeMax;
  const safeCurrent = Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.min(safeMax, Math.round(Number.isFinite(currentWidth) ? currentWidth : safeMax)));
  const currentIndex = candidates.findIndex((candidate) => Math.abs(candidate - safeCurrent) <= 2);
  if (currentIndex < 0) return candidates[0];
  return candidates[(currentIndex + 1) % candidates.length];
}
