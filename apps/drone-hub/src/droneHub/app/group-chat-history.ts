export type GroupChatScrollAnchor = {
  scrollHeight: number;
  scrollTop: number;
};

export function groupChatTailHasOlder(
  transcriptTotal: number | null,
  loadedCount: number,
  tailLimit: number,
): boolean {
  if (transcriptTotal != null) return transcriptTotal > loadedCount;
  return loadedCount >= tailLimit;
}

export function groupChatScrollTopAfterPrepend(
  anchor: GroupChatScrollAnchor,
  nextScrollHeight: number,
): number {
  return anchor.scrollTop + Math.max(0, nextScrollHeight - anchor.scrollHeight);
}
