/**
 * The organized drone board: every chat placed for the user instead of where it was dropped, so the board fits the
 * pane: its view is fixed, never zoomed or panned. Each chat without a parent starts a tree; its clones and the chats
 * it created go to its right, siblings stacked below. Trees fill columns, as many as give the largest zoom at which
 * everything fits.
 * Pure, so positions are worked out on every change and never stored.
 */

export type OrganizedCard = {
  nodeId: string;
  /** As drawn. */
  width: number;
  /** The chat it was cloned from, or else the chat that created it; null starts a tree. */
  parentNodeId?: string | null;
};

export type OrganizedLayoutOptions = {
  cardHeight: number;
  /** Between one row's cards and the next. */
  rowGap: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Room kept free along the view's bottom edge, for what floats there (the canvas composer). */
  bottomInset?: number;
  /** Never zoomed in past this, so a board of two chats does not show them huge. */
  maxScale?: number;
};

export type OrganizedRect = { x: number; y: number; width: number; height: number };

export type OrganizedLayout = {
  /** Top-left corner of each card, in the space cards are drawn in. */
  positions: Record<string, { x: number; y: number }>;
  /** Each card as drawn. */
  cardRects: Record<string, OrganizedRect>;
  /** Each card with everything to its right that came from it; a tree's whole column for a card that starts one. */
  subtreeRects: Record<string, OrganizedRect>;
  /** The card each card hangs from, null for one that starts a tree: only cards with the same parent swap places. */
  parentOf: Record<string, string | null>;
  /** The cards in the order they were given. */
  order: string[];
  /** Room between two subtrees one above the other: a drop line goes in its middle. */
  rowGap: number;
  width: number;
  height: number;
  /** The view that shows all of it. */
  view: { panX: number; panY: number; scale: number };
};

/** Between a card and its children's column: room for the arrow. */
export const ORGANIZED_COLUMN_GAP_PX = 44;
/** Between the columns trees are packed into. */
const BLOCK_GAP_X_PX = 64;
/** Extra room between one tree and the next below it, so trees read apart. */
const BLOCK_GAP_Y_EXTRA_PX = 10;
const VIEW_PADDING_PX = 28;

type Block = {
  ids: string[];
  /** Position of each card inside the block. */
  local: Record<string, { x: number; y: number }>;
  /** Each card's subtree inside the block. */
  localRects: Record<string, OrganizedRect>;
  width: number;
  height: number;
};

/** Each card's parent, dropping parents that are not on the board and links that would make a loop. */
function resolveParents(cards: readonly OrganizedCard[]): Map<string, string> {
  const ids = new Set(cards.map((card) => card.nodeId));
  const raw = new Map<string, string>();
  for (const card of cards) {
    const parent = card.parentNodeId ?? null;
    if (parent && parent !== card.nodeId && ids.has(parent)) raw.set(card.nodeId, parent);
  }
  const out = new Map<string, string>();
  for (const card of cards) {
    const parent = raw.get(card.nodeId);
    if (!parent) continue;
    // Walk up: reaching the card again means a loop, which leaves this card a root. A loop further up is left to the
    // cards in it, and this card still hangs from its parent.
    const seen = new Set([card.nodeId]);
    let at: string | undefined = parent;
    let loop = false;
    while (at) {
      if (at === card.nodeId) { loop = true; break; }
      if (seen.has(at)) break;
      seen.add(at);
      at = raw.get(at);
    }
    if (!loop) out.set(card.nodeId, parent);
  }
  return out;
}

function buildBlock(rootId: string, childrenOf: Map<string, string[]>, widthOf: Map<string, number>, pitch: number, cardHeight: number): Block {
  const ids: string[] = [];
  const rowOf: Record<string, number> = {};
  const depthOf: Record<string, number> = {};
  const span: Record<string, { rows: number; deepest: number }> = {};
  const columnWidth: number[] = [];
  // Rows a card's subtree takes: its first child shares its row, each next child starts below the one before.
  const place = (id: string, row: number, depth: number): number => {
    ids.push(id);
    rowOf[id] = row;
    depthOf[id] = depth;
    columnWidth[depth] = Math.max(columnWidth[depth] ?? 0, widthOf.get(id) ?? 0);
    let rows = 0;
    let deepest = depth;
    for (const child of childrenOf.get(id) ?? []) {
      rows += place(child, row + rows, depth + 1);
      deepest = Math.max(deepest, span[child]!.deepest);
    }
    span[id] = { rows: Math.max(1, rows), deepest };
    return span[id]!.rows;
  };
  const rows = place(rootId, 0, 0);
  const columnX: number[] = [];
  let x = 0;
  for (let depth = 0; depth < columnWidth.length; depth += 1) {
    columnX[depth] = x;
    x += columnWidth[depth]! + ORGANIZED_COLUMN_GAP_PX;
  }
  const local: Block['local'] = {};
  const localRects: Block['localRects'] = {};
  for (const id of ids) {
    local[id] = { x: columnX[depthOf[id]!]!, y: rowOf[id]! * pitch };
    const { rows: spanRows, deepest } = span[id]!;
    localRects[id] = {
      ...local[id]!,
      width: columnX[deepest]! + columnWidth[deepest]! - local[id]!.x,
      height: (spanRows - 1) * pitch + cardHeight,
    };
  }
  return { ids, local, localRects, width: x - ORGANIZED_COLUMN_GAP_PX, height: (rows - 1) * pitch + cardHeight };
}

type Packing = { columns: Block[][]; columnWidths: number[]; width: number; height: number };

/** Trees in order, top to bottom and then across, into columns about `target` tall. */
function pack(blocks: readonly Block[], target: number, gapY: number): Packing {
  const columns: Block[][] = [];
  let column: Block[] = [];
  let columnHeight = 0;
  for (const block of blocks) {
    if (column.length > 0 && columnHeight + gapY + block.height > target) {
      columns.push(column);
      column = [];
      columnHeight = 0;
    }
    columnHeight += (column.length > 0 ? gapY : 0) + block.height;
    column.push(block);
  }
  if (column.length > 0) columns.push(column);
  const columnWidths = columns.map((items) => Math.max(...items.map((block) => block.width)));
  const heights = columns.map((items) => items.reduce((sum, block) => sum + block.height, 0) + (items.length - 1) * gapY);
  return {
    columns,
    columnWidths,
    width: columnWidths.reduce((sum, width) => sum + width, 0) + (columns.length - 1) * BLOCK_GAP_X_PX,
    height: Math.max(0, ...heights),
  };
}

export function layoutOrganizedBoard(cards: readonly OrganizedCard[], options: OrganizedLayoutOptions): OrganizedLayout {
  const maxScale = options.maxScale ?? 1;
  const viewWidth = Math.max(1, options.viewportWidth - VIEW_PADDING_PX * 2);
  const bottomInset = Math.max(0, options.bottomInset ?? 0);
  const viewHeight = Math.max(1, options.viewportHeight - bottomInset - VIEW_PADDING_PX * 2);
  if (cards.length === 0) {
    return {
      positions: {}, cardRects: {}, subtreeRects: {}, parentOf: {}, order: [], rowGap: options.rowGap, width: 0, height: 0,
      view: { panX: VIEW_PADDING_PX, panY: VIEW_PADDING_PX, scale: maxScale },
    };
  }
  const pitch = options.cardHeight + options.rowGap;
  const gapY = options.rowGap + BLOCK_GAP_Y_EXTRA_PX;
  const parents = resolveParents(cards);
  const childrenOf = new Map<string, string[]>();
  const widthOf = new Map<string, number>();
  for (const card of cards) {
    widthOf.set(card.nodeId, card.width);
    const parent = parents.get(card.nodeId);
    if (parent) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(card.nodeId);
  }
  const blocks = cards
    .filter((card) => !parents.has(card.nodeId))
    .map((card) => buildBlock(card.nodeId, childrenOf, widthOf, pitch, options.cardHeight));

  // One column per tree at most; every count of columns is tried for the largest zoom that shows everything. Each
  // count gets the shortest columns that hold the trees in that many: a target of an even share can spill into one
  // more column, which would skip that count.
  const total = blocks.reduce((sum, block) => sum + block.height, 0) + (blocks.length - 1) * gapY;
  const tallest = Math.max(...blocks.map((block) => block.height));
  const packings: Packing[] = [];
  for (let count = 1; count <= blocks.length; count += 1) {
    let low = Math.max(tallest, total / count);
    let high = total;
    let packing = pack(blocks, low, gapY);
    if (packing.columns.length > count) {
      packing = pack(blocks, high, gapY);
      for (let step = 0; step < 24 && high - low > 1; step += 1) {
        const middle = (low + high) / 2;
        const candidate = pack(blocks, middle, gapY);
        if (candidate.columns.length <= count) {
          high = middle;
          packing = candidate;
        } else {
          low = middle;
        }
      }
    }
    if (packings.some((other) => other.columns.length === packing.columns.length)) continue;
    packings.push(packing);
  }
  const fitScale = (packing: Packing) => Math.min(maxScale, viewWidth / packing.width, viewHeight / packing.height);
  let best = packings[0]!;
  for (const packing of packings) {
    // Fewer columns win a tie: the board reads down before it reads across.
    if (fitScale(packing) > fitScale(best) + 1e-6) best = packing;
  }
  const scale = fitScale(best);

  const positions: OrganizedLayout['positions'] = {};
  const subtreeRects: OrganizedLayout['subtreeRects'] = {};
  let x = 0;
  best.columns.forEach((column, index) => {
    let y = 0;
    for (const block of column) {
      for (const id of block.ids) {
        positions[id] = { x: x + block.local[id]!.x, y: y + block.local[id]!.y };
        const rect = block.localRects[id]!;
        subtreeRects[id] = { ...rect, x: x + rect.x, y: y + rect.y };
      }
      // A tree takes its column's width: a drop beside a narrow tree still lands next to it.
      subtreeRects[block.ids[0]!]!.width = best.columnWidths[index]!;
      y += block.height + gapY;
    }
    x += best.columnWidths[index]! + BLOCK_GAP_X_PX;
  });
  const parentOf = Object.fromEntries(cards.map((card) => [card.nodeId, parents.get(card.nodeId) ?? null]));
  const cardRects = Object.fromEntries(Object.entries(positions).map(([id, at]) => [
    id, { ...at, width: widthOf.get(id) ?? 0, height: options.cardHeight },
  ]));
  const panX = Math.round((options.viewportWidth - best.width * scale) / 2);
  const panY = Math.round((options.viewportHeight - bottomInset - best.height * scale) / 2);
  return {
    positions, cardRects, subtreeRects, parentOf, order: cards.map((card) => card.nodeId), rowGap: options.rowGap,
    width: best.width, height: best.height, view: { panX: Math.max(VIEW_PADDING_PX, panX), panY, scale },
  };
}

export type OrganizedDropSlot = { targetId: string; placement: 'before' | 'after' };

/**
 * Where a card dropped at `point` (in the space cards are drawn in) would go: before or after another card with the
 * same parent, beside its whole subtree. Null over no such card, or where the card already is.
 */
export function organizedDropSlot(layout: OrganizedLayout, movedId: string, point: { x: number; y: number }): OrganizedDropSlot | null {
  if (!(movedId in layout.parentOf)) return null;
  const parent = layout.parentOf[movedId];
  const siblings = layout.order.filter((id) => layout.parentOf[id] === parent);
  // Half the gap above and below each subtree, so the space between two of them belongs to one or the other.
  const reach = layout.rowGap / 2 + (parent === null ? BLOCK_GAP_Y_EXTRA_PX / 2 : 0);
  for (const targetId of siblings) {
    if (targetId === movedId) continue;
    const rect = layout.subtreeRects[targetId];
    if (!rect) continue;
    if (point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y - reach || point.y > rect.y + rect.height + reach) continue;
    return slotIfItMoves(layout, movedId, targetId, point.y < rect.y + rect.height / 2 ? 'before' : 'after');
  }
  return null;
}

/** The slot, unless it leaves the card where it is. */
function slotIfItMoves(layout: OrganizedLayout, movedId: string, targetId: string, placement: 'before' | 'after'): OrganizedDropSlot | null {
  const parent = layout.parentOf[movedId];
  if (layout.parentOf[targetId] !== parent || targetId === movedId) return null;
  const siblings = layout.order.filter((id) => layout.parentOf[id] === parent);
  const without = siblings.filter((id) => id !== movedId);
  without.splice(without.indexOf(targetId) + (placement === 'after' ? 1 : 0), 0, movedId);
  return without.every((id, at) => id === siblings[at]) ? null : { targetId, placement };
}

export type OrganizedDrop = { kind: 'slot'; slot: OrganizedDropSlot } | { kind: 'fold'; targetId: string };

/** The cards that go with `ids` when they move: each, and everything that came from it. */
export function organizedCardsWith(layout: OrganizedLayout, ids: readonly string[]): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of layout.order) {
      const parent = layout.parentOf[id];
      if (parent && out.has(parent) && !out.has(id)) {
        out.add(id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * What a drop of `movedIds` at `point` does: the middle of another card folds them into it; its top edge, or the
 * bottom edge of a card whose subtree is one row tall, puts one card before or after it, as does the gap between two
 * cards. A card is never folded into one that came from it, since those go with it.
 */
export function organizedDropAt(layout: OrganizedLayout, movedIds: readonly string[], point: { x: number; y: number }): OrganizedDrop | null {
  const carried = organizedCardsWith(layout, movedIds);
  const single = movedIds.length === 1 ? movedIds[0]! : null;
  for (const id of layout.order) {
    const rect = layout.cardRects[id];
    if (!rect || point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height) continue;
    if (carried.has(id)) return null;
    const edge = (point.y - rect.y) / rect.height;
    // Below a subtree one row tall the card's bottom edge is the subtree's, so a slot after it lands there.
    const leaf = layout.subtreeRects[id]?.height === rect.height;
    const placement = edge < 0.25 ? 'before' : edge > 0.75 && leaf ? 'after' : null;
    if (single && placement && layout.parentOf[id] === layout.parentOf[single]) {
      const slot = slotIfItMoves(layout, single, id, placement);
      // Where it already is: nothing, rather than a fold the pointer did not aim at.
      return slot ? { kind: 'slot', slot } : null;
    }
    return { kind: 'fold', targetId: id };
  }
  const slot = single ? organizedDropSlot(layout, single, point) : null;
  return slot ? { kind: 'slot', slot } : null;
}

/** The line that shows a slot: across the target's subtree, in the middle of the gap on the slot's side. */
export function organizedDropLine(layout: OrganizedLayout, slot: OrganizedDropSlot): { x: number; y: number; width: number } | null {
  const rect = layout.subtreeRects[slot.targetId];
  if (!rect) return null;
  // Trees sit a little further apart than the rows inside one.
  const gap = layout.rowGap + (layout.parentOf[slot.targetId] === null ? BLOCK_GAP_Y_EXTRA_PX : 0);
  return { x: rect.x, y: slot.placement === 'before' ? rect.y - gap / 2 : rect.y + rect.height + gap / 2, width: rect.width };
}

/** Squares a card shows before the rest become "+N". */
export const SIDE_CHAT_SQUARES_SHOWN = 8;
const SQUARE_PX = 10;
const SQUARE_GAP_PX = 3;
const SQUARES_LEAD_PX = 8;
const SQUARES_MORE_PX = 24;

/** What a card's squares add to its width. */
export function sideChatSquaresWidthPx(count: number): number {
  if (count <= 0) return 0;
  const shown = Math.min(count, SIDE_CHAT_SQUARES_SHOWN);
  return SQUARES_LEAD_PX + shown * SQUARE_PX + (shown - 1) * SQUARE_GAP_PX + (count > shown ? SQUARES_MORE_PX : 0);
}
