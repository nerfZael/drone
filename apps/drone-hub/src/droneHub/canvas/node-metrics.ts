import { parseCanvasChatNodeId } from '../app/app-config';

export const NODE_HEIGHT_PX = 54;
export const CHAT_NODE_HEIGHT_PX = 38;
export const NODE_MIN_WIDTH_PX = 96;
const NODE_MAX_WIDTH_PX = 560;
const NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX = 7.2;
const NODE_SECONDARY_TEXT_WIDTH_ESTIMATE_PX = 5.8;
const NODE_HORIZONTAL_PADDING_PX = 24;

export function getNodeHeightPx(nodeIdRaw: string): number {
  return parseCanvasChatNodeId(nodeIdRaw) ? CHAT_NODE_HEIGHT_PX : NODE_HEIGHT_PX;
}

export function getNodeWidthPx(labelRaw: string, secondaryLabelRaw?: string): number {
  const primaryLabel = String(labelRaw ?? '').trim();
  const secondaryLabel = String(secondaryLabelRaw ?? '').trim();
  const primaryWidth = Math.ceil(primaryLabel.length * NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX);
  const secondaryWidth = Math.ceil(secondaryLabel.length * NODE_SECONDARY_TEXT_WIDTH_ESTIMATE_PX);
  const contentWidth = Math.max(primaryWidth, secondaryWidth);
  return Math.max(
    NODE_MIN_WIDTH_PX,
    Math.min(NODE_MAX_WIDTH_PX, contentWidth + NODE_HORIZONTAL_PADDING_PX),
  );
}
