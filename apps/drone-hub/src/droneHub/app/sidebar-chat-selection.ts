export function selectSidebarChatNodes(args: {
  currentNodeIds: readonly string[];
  orderedNodeIds: readonly string[];
  nodeId: string;
  anchorNodeId?: string | null;
  additive?: boolean;
  range?: boolean;
}): string[] {
  const nodeId = String(args.nodeId ?? '').trim();
  if (!nodeId) return [...args.currentNodeIds];
  const current = [...new Set(args.currentNodeIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (args.range && args.anchorNodeId) {
    const start = args.orderedNodeIds.indexOf(args.anchorNodeId);
    const end = args.orderedNodeIds.indexOf(nodeId);
    if (start >= 0 && end >= 0) {
      const range = args.orderedNodeIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      return args.additive ? [...new Set([...current, ...range])] : range;
    }
  }
  if (args.additive) {
    return current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : [...current, nodeId];
  }
  return [nodeId];
}
