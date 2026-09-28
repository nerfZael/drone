import { parseCanvasChatNodeId } from '../app/app-config';

export const NODE_HEIGHT_PX = 44;
export const CHAT_NODE_HEIGHT_PX = 38;
export const NODE_MIN_WIDTH_PX = 64;
/** A drone card's runtime icon and its gap to the title. */
export const DRONE_NODE_CHROME_WIDTH_PX = 20;
const NODE_MAX_WIDTH_PX = 560;
const NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX = 7.2;
const NODE_HORIZONTAL_PADDING_PX = 24;
// Sub-pixel rounding between the probe and the card.
const NODE_LABEL_MEASURE_SLACK_PX = 2;

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
  const measured = label ? measureNodeLabelPx(label) : null;
  const estimatedTextWidth = Math.max(1, measured ?? label.length * NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX);
  const available = nodeWidthPx - NODE_DENSE_HORIZONTAL_PADDING_PX - NODE_BORDER_PX;
  return Math.max(1, Math.min(NODE_MAX_LABEL_TEXT_BOOST, available / estimatedTextWidth));
}

// The card title's classes, so a hidden probe renders the label in whatever font the theme uses.
const NODE_LABEL_PROBE_CLASS = 'text-12-5 font-[var(--weight-semibold)]';
let labelProbe: HTMLSpanElement | null = null;
let labelProbeFont = '';
let labelProbeFontCheckedAt = 0;
const measuredLabelWidthByKey = new Map<string, number>();

/** Rendered width of a card title, or null where nothing lays out text (tests, SSR). */
function measureNodeLabelPx(label: string): number | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!labelProbe || !labelProbe.isConnected) {
    labelProbe = document.createElement('span');
    labelProbe.className = NODE_LABEL_PROBE_CLASS;
    labelProbe.setAttribute('aria-hidden', 'true');
    Object.assign(labelProbe.style, {
      position: 'absolute', left: '-10000px', top: '0', visibility: 'hidden', whiteSpace: 'pre', pointerEvents: 'none',
    });
    document.body.appendChild(labelProbe);
  }
  // Widths are recomputed on every drag frame: re-read the theme's font at most once a second.
  const now = Date.now();
  if (now - labelProbeFontCheckedAt > 1000) {
    labelProbeFontCheckedAt = now;
    const style = labelProbe.ownerDocument.defaultView?.getComputedStyle(labelProbe);
    const font = style ? `${style.fontWeight} ${style.fontSize} ${style.fontFamily}` : '';
    if (font !== labelProbeFont) {
      labelProbeFont = font;
      measuredLabelWidthByKey.clear();
    }
  }
  const cached = measuredLabelWidthByKey.get(label);
  if (cached !== undefined) return cached;
  labelProbe.textContent = label;
  const width = labelProbe.getBoundingClientRect().width;
  if (!(width > 0)) return null;
  measuredLabelWidthByKey.set(label, width);
  return width;
}

/** A card title's rendered width at the compact card's size, or its estimate where nothing can be measured. */
export function nodeLabelWidthPx(labelRaw: string): number {
  const label = String(labelRaw ?? '').trim();
  const measured = label ? measureNodeLabelPx(label) : null;
  return measured !== null ? measured + NODE_LABEL_MEASURE_SLACK_PX : label.length * NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX;
}

/**
 * Card width that fits the whole label. `chromeWidthPx` is what else shares the row
 * (a drone card's runtime icon), so it never squeezes the title.
 */
export function getNodeWidthPx(labelRaw: string, chromeWidthPx = 0): number {
  const label = String(labelRaw ?? '').trim();
  // The per-character estimate runs wide for most fonts; it is only for when nothing can be measured.
  const measured = label ? measureNodeLabelPx(label) : null;
  const textWidth = measured !== null ? measured + NODE_LABEL_MEASURE_SLACK_PX : label.length * NODE_PRIMARY_TEXT_WIDTH_ESTIMATE_PX;
  const contentWidth = Math.ceil(textWidth) + chromeWidthPx;
  return Math.max(
    NODE_MIN_WIDTH_PX,
    Math.min(NODE_MAX_WIDTH_PX, contentWidth + NODE_HORIZONTAL_PADDING_PX),
  );
}
