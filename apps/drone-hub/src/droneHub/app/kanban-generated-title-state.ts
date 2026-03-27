type ShouldApplySuggestedKanbanTitleArgs = {
  pendingProvisionalTitle?: unknown;
  provisionalTitle?: unknown;
  currentTitle?: unknown;
};

export function shouldApplySuggestedKanbanTitle({
  pendingProvisionalTitle,
  provisionalTitle,
  currentTitle,
}: ShouldApplySuggestedKanbanTitleArgs): boolean {
  const pending = String(pendingProvisionalTitle ?? '');
  const provisional = String(provisionalTitle ?? '');
  if (!pending || !provisional || pending !== provisional) return false;
  const current = String(currentTitle ?? '');
  return !current.trim() || current === provisional;
}
