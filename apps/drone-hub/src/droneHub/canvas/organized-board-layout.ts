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

export type OrganizedLayout = {
  /** Top-left corner of each card, in the space cards are drawn in. */
  positions: Record<string, { x: number; y: number }>;
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
    // Walk up: reaching the card again means a loop, which leaves this card a root.
    const seen = new Set([card.nodeId]);
    let at: string | undefined = parent;
    let loop = false;
    while (at) {
      if (seen.has(at)) { loop = true; break; }
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
  const columnWidth: number[] = [];
  // Rows a card's subtree takes: its first child shares its row, each next child starts below the one before.
  const place = (id: string, row: number, depth: number): number => {
    ids.push(id);
    rowOf[id] = row;
    depthOf[id] = depth;
    columnWidth[depth] = Math.max(columnWidth[depth] ?? 0, widthOf.get(id) ?? 0);
    let rows = 0;
    for (const child of childrenOf.get(id) ?? []) rows += place(child, row + rows, depth + 1);
    return Math.max(1, rows);
  };
  const rows = place(rootId, 0, 0);
  const columnX: number[] = [];
  let x = 0;
  for (let depth = 0; depth < columnWidth.length; depth += 1) {
    columnX[depth] = x;
    x += columnWidth[depth]! + ORGANIZED_COLUMN_GAP_PX;
  }
  const local: Block['local'] = {};
  for (const id of ids) local[id] = { x: columnX[depthOf[id]!]!, y: rowOf[id]! * pitch };
  return { ids, local, width: x - ORGANIZED_COLUMN_GAP_PX, height: (rows - 1) * pitch + cardHeight };
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
    return { positions: {}, width: 0, height: 0, view: { panX: VIEW_PADDING_PX, panY: VIEW_PADDING_PX, scale: maxScale } };
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
  let x = 0;
  best.columns.forEach((column, index) => {
    let y = 0;
    for (const block of column) {
      for (const id of block.ids) positions[id] = { x: x + block.local[id]!.x, y: y + block.local[id]!.y };
      y += block.height + gapY;
    }
    x += best.columnWidths[index]! + BLOCK_GAP_X_PX;
  });
  const panX = Math.round((options.viewportWidth - best.width * scale) / 2);
  const panY = Math.round((options.viewportHeight - bottomInset - best.height * scale) / 2);
  return { positions, width: best.width, height: best.height, view: { panX: Math.max(VIEW_PADDING_PX, panX), panY, scale } };
}

export type SideChatSquare = {
  chatName: string;
  /** The chat it was made from, which may itself be a side chat. */
  sourceChatName: string;
};

/**
 * Side chats as squares on the card of the chat they started from. A side chat of a side chat goes on the same card,
 * as the composer's chips do; one whose source is gone has no card to go on.
 */
export function sideChatSquaresByChat(
  sideChats: ReadonlyArray<{ name: string; sourceChatName?: string; createdAt?: string }> | undefined,
  chatNames: ReadonlySet<string>,
): Record<string, SideChatSquare[]> {
  const list = [...(sideChats ?? [])].sort((a, b) => (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0));
  const sourceOf = new Map(list.map((chat) => [chat.name, String(chat.sourceChatName ?? '').trim()]));
  const out: Record<string, SideChatSquare[]> = {};
  for (const chat of list) {
    let at = sourceOf.get(chat.name) ?? '';
    const seen = new Set([chat.name]);
    while (at && sourceOf.has(at) && !seen.has(at)) {
      seen.add(at);
      at = sourceOf.get(at) ?? '';
    }
    if (!at || !chatNames.has(at)) continue;
    (out[at] ??= []).push({ chatName: chat.name, sourceChatName: sourceOf.get(chat.name) ?? at });
  }
  return out;
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
