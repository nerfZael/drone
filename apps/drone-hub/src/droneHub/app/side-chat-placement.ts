export type WorkspaceRect = { x: number; y: number; width: number; height: number };

/** Prefer free space beside chats; when full, cascade with visible title bars. */
export function placeSideChat(
  workspace: { width: number; height: number },
  occupied: WorkspaceRect[],
  count: number,
  preferredSize?: { width: number; height: number },
): WorkspaceRect {
  const width = Math.min(preferredSize?.width ?? 320, Math.max(1, workspace.width));
  const height = Math.min(
    Math.max(1, workspace.height),
    preferredSize?.height ?? Math.max(440, 2 * Math.round(workspace.height / 4)),
  );
  const maxX = Math.max(0, workspace.width - width);
  const maxY = Math.max(0, workspace.height - height);
  const xs = new Set([
    maxX,
    0,
    ...occupied.flatMap((rect) => [rect.x + rect.width + 8, rect.x - width - 8]),
  ]);
  const ys = new Set([
    0,
    maxY,
    ...occupied.flatMap((rect) => [rect.y, rect.y + rect.height + 8, rect.y - height - 8]),
  ]);
  for (const y of ys)
    for (const x of xs) {
      if (x < 0 || x > maxX || y < 0 || y > maxY) continue;
      const candidate = { x, y, width, height };
      if (occupied.every((rect) => !overlaps(candidate, rect))) return candidate;
    }
  const columns = Math.ceil(maxX / 28) + 1;
  const rows = Math.ceil(maxY / 28) + 1;
  let fallback: WorkspaceRect | undefined;
  for (let offset = 0; offset < columns * rows; offset++) {
    const index = (count + offset) % (columns * rows);
    const column = index % columns;
    const row = (Math.floor(index / columns) + column) % rows;
    const candidate = {
      x: Math.max(0, maxX - column * 28),
      y: Math.min(maxY, row * 28),
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

function overlaps(a: WorkspaceRect, b: WorkspaceRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
