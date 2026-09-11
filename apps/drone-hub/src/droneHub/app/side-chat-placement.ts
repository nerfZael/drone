export type WorkspaceRect = { x: number; y: number; width: number; height: number };

const GAP = 8;
const CASCADE_STEP = 28;

/**
 * Fill columns from the right edge, each from the bottom up: the first window
 * sits in the bottom-right corner, the next above it while there is room, then
 * a new column to the left starts at the bottom again. When nothing fits,
 * cascade with visible title bars.
 */
export function placeSideChat(
  workspace: { width: number; height: number },
  occupied: WorkspaceRect[],
  count: number,
  preferredSize?: { width: number; height: number },
): WorkspaceRect {
  const width = Math.min(preferredSize?.width ?? 320, Math.max(1, workspace.width));
  const height = Math.min(
    Math.max(1, workspace.height),
    preferredSize?.height ?? Math.max(220, Math.round(workspace.height / 4)),
  );
  const maxX = Math.max(0, workspace.width - width);
  const maxY = Math.max(0, workspace.height - height);
  // Windows the user moved or resized break the grid; also try the slots
  // directly beside them so new windows pack against them.
  const xs = descending(
    [...steps(maxX, width + GAP), 0, ...occupied.flatMap((rect) => [rect.x - width - GAP, rect.x + rect.width + GAP])],
    maxX,
  );
  const ys = descending(
    [...steps(maxY, height + GAP), 0, ...occupied.flatMap((rect) => [rect.y - height - GAP, rect.y + rect.height + GAP])],
    maxY,
  );
  for (const x of xs)
    for (const y of ys) {
      const candidate = { x, y, width, height };
      if (occupied.every((rect) => !overlaps(candidate, rect))) return candidate;
    }
  const columns = Math.ceil(maxX / CASCADE_STEP) + 1;
  const rows = Math.ceil(maxY / CASCADE_STEP) + 1;
  let fallback: WorkspaceRect | undefined;
  for (let offset = 0; offset < columns * rows; offset++) {
    const index = (count + offset) % (columns * rows);
    const column = index % columns;
    const row = (Math.floor(index / columns) + column) % rows;
    const candidate = {
      x: Math.max(0, maxX - column * CASCADE_STEP),
      y: Math.min(maxY, row * CASCADE_STEP),
      width,
      height,
    };
    fallback ??= candidate;
    // Counts can be reused after deletion; also avoid windows the user moved
    // into the next cascade position. Allow smaller offsets on narrow screens.
    if (
      occupied.every(
        (rect) => Math.abs(rect.x - candidate.x) > 1 || Math.abs(rect.y - candidate.y) > 1,
      )
    ) {
      return candidate;
    }
  }
  return fallback!;
}

/** `max`, then every `step` back toward zero. */
function steps(max: number, step: number): number[] {
  const values: number[] = [];
  for (let value = max; value >= 0; value -= step) values.push(value);
  return values;
}

function descending(values: number[], max: number): number[] {
  return [...new Set(values.filter((value) => value >= 0 && value <= max))].sort((a, b) => b - a);
}

function overlaps(a: WorkspaceRect, b: WorkspaceRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
