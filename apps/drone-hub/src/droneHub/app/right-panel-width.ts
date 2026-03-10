import { RIGHT_PANEL_DEFAULT_WIDTH_PX, RIGHT_PANEL_MIN_WIDTH_PX, viewportWidthPx } from './app-config';

export type RightPanelWidthMode = 'custom' | 'full' | 'two-thirds' | 'one-third';

const RIGHT_PANEL_MODE_RATIOS: Record<Exclude<RightPanelWidthMode, 'custom'>, number> = {
  full: 1,
  'two-thirds': 2 / 3,
  'one-third': 1 / 3,
};

const RIGHT_PANEL_SHORTCUT_MODE_ORDER: Array<Exclude<RightPanelWidthMode, 'custom'>> = ['full', 'two-thirds', 'one-third'];
const RIGHT_PANEL_VISIBLE_MAX_RATIO = 2 / 3;
const RIGHT_PANEL_PRESET_MATCH_TOLERANCE_PX = 2;

function normalizeAvailableWidth(availableWidth: number): number {
  return Number.isFinite(availableWidth) && availableWidth > 0 ? Math.floor(availableWidth) : viewportWidthPx();
}

export function rightPanelMaxWidthPx(availableWidth: number): number {
  return Math.max(RIGHT_PANEL_MIN_WIDTH_PX, normalizeAvailableWidth(availableWidth));
}

export function rightPanelVisibleMaxWidthPx(availableWidth: number): number {
  const maxWidth = rightPanelMaxWidthPx(availableWidth);
  return Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.min(maxWidth, Math.round(maxWidth * RIGHT_PANEL_VISIBLE_MAX_RATIO)));
}

export function clampCustomRightPanelWidthPx(width: number, availableWidth: number = viewportWidthPx()): number {
  const safe = Number.isFinite(width) ? width : RIGHT_PANEL_DEFAULT_WIDTH_PX;
  return Math.min(rightPanelVisibleMaxWidthPx(availableWidth), Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.round(safe)));
}

export function resolveRightPanelWidthPx(
  mode: RightPanelWidthMode,
  customWidth: number,
  availableWidth: number = viewportWidthPx(),
): number {
  const maxWidth = rightPanelMaxWidthPx(availableWidth);
  if (mode === 'custom') return clampCustomRightPanelWidthPx(customWidth, availableWidth);
  return Math.max(
    RIGHT_PANEL_MIN_WIDTH_PX,
    Math.min(maxWidth, Math.round(maxWidth * RIGHT_PANEL_MODE_RATIOS[mode])),
  );
}

export function resolveRightPanelWidthModeFromWidth(
  width: number,
  availableWidth: number = viewportWidthPx(),
): RightPanelWidthMode {
  const safeWidth = Math.max(
    RIGHT_PANEL_MIN_WIDTH_PX,
    Math.min(rightPanelMaxWidthPx(availableWidth), Math.round(Number.isFinite(width) ? width : RIGHT_PANEL_DEFAULT_WIDTH_PX)),
  );
  for (const mode of RIGHT_PANEL_SHORTCUT_MODE_ORDER) {
    const presetWidth = resolveRightPanelWidthPx(mode, RIGHT_PANEL_DEFAULT_WIDTH_PX, availableWidth);
    if (Math.abs(presetWidth - safeWidth) <= RIGHT_PANEL_PRESET_MATCH_TOLERANCE_PX) return mode;
  }
  return 'custom';
}

export function resolveNextRightPanelShortcutWidth(currentWidth: number, availableWidth: number): number {
  const candidates = RIGHT_PANEL_SHORTCUT_MODE_ORDER
    .map((mode) => resolveRightPanelWidthPx(mode, RIGHT_PANEL_DEFAULT_WIDTH_PX, availableWidth))
    .filter((width, index, list) => list.indexOf(width) === index);
  if (candidates.length === 0) return resolveRightPanelWidthPx('full', RIGHT_PANEL_DEFAULT_WIDTH_PX, availableWidth);
  const currentIndex = candidates.findIndex((candidate) => Math.abs(candidate - currentWidth) <= RIGHT_PANEL_PRESET_MATCH_TOLERANCE_PX);
  if (currentIndex < 0) return candidates[0];
  return candidates[(currentIndex + 1) % candidates.length];
}
