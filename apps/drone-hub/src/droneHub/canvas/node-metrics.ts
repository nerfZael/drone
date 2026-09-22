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

// Zoomed out, a chat node keeps its footprint but gives its label the slack the width estimate
// and the padding leave over: tighter side padding and text sized up to fill the remaining width.
const NODE_DENSE_HORIZONTAL_PADDING_PX = 16;
const NODE_BORDER_PX = 2;
export const NODE_MAX_LABEL_TEXT_BOOST = 1.3;

export function getChatLabelTextBoost(labelRaw: string, nodeWidthPx: number): number {
  const label = String(labelRaw ?? '').trim();
  const estimatedTextWidth = Math.max(1, label.length * NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX);
  const available = nodeWidthPx - NODE_DENSE_HORIZONTAL_PADDING_PX - NODE_BORDER_PX;
  return Math.max(1, Math.min(NODE_MAX_LABEL_TEXT_BOOST, available / estimatedTextWidth));
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
