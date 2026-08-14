export type ChatComposerEditorModeTarget = {
  id: string;
  primary: boolean;
  isEligible: () => boolean;
  toggle: () => void;
};

const targets = new Map<string, ChatComposerEditorModeTarget>();
let currentTargetId: string | null = null;

export function selectChatComposerEditorModeTarget(
  candidates: readonly ChatComposerEditorModeTarget[],
  currentId: string | null,
): ChatComposerEditorModeTarget | null {
  const eligible = candidates.filter((candidate) => candidate.isEligible());
  return (
    eligible.find((candidate) => candidate.id === currentId) ??
    eligible.find((candidate) => candidate.primary) ??
    (eligible.length === 1 ? eligible[0] : null) ??
    null
  );
}

export function registerChatComposerEditorModeTarget(
  target: ChatComposerEditorModeTarget,
): () => void {
  targets.set(target.id, target);
  return () => {
    if (targets.get(target.id) !== target) return;
    targets.delete(target.id);
    if (currentTargetId === target.id) currentTargetId = null;
  };
}

export function markCurrentChatComposerEditorModeTarget(id: string): void {
  currentTargetId = id;
}

export function toggleCurrentChatComposerEditorMode(): boolean {
  const target = selectChatComposerEditorModeTarget(Array.from(targets.values()), currentTargetId);
  if (!target) return false;
  currentTargetId = target.id;
  target.toggle();
  return true;
}
