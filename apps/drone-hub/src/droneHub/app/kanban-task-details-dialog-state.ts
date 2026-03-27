export const KANBAN_TASK_UNTITLED_FALLBACK = 'Untitled task';
const KANBAN_TASK_TITLE_MAX_CHARS = 240;

export function normalizeKanbanTaskTitleDraft(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const collapsed = (firstLine || text).replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, KANBAN_TASK_TITLE_MAX_CHARS);
}

export function resolveCommittedKanbanTaskTitle(draftTitle: unknown, previousTitle?: unknown): string {
  const normalizedDraft = normalizeKanbanTaskTitleDraft(draftTitle);
  if (normalizedDraft) return normalizedDraft;
  const normalizedPrevious = normalizeKanbanTaskTitleDraft(previousTitle);
  return normalizedPrevious || KANBAN_TASK_UNTITLED_FALLBACK;
}
