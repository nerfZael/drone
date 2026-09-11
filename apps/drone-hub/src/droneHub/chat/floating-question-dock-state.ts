/**
 * Expand/collapse bookkeeping for the question dock in a small chat window.
 *
 * The dock opens on its own when a questionnaire arrives, stays closed once
 * the user closes it for that questionnaire, and closes again when the
 * questionnaire is answered. Pure so the rules are testable without React.
 */
export type QuestionDockState = {
  expanded: boolean;
  /** Pending questionnaire ids the dock last knew about. */
  known: readonly string[];
  /** Questionnaires the user closed the dock on; they do not reopen it. */
  dismissed: readonly string[];
};

export const INITIAL_QUESTION_DOCK_STATE: QuestionDockState = { expanded: false, known: [], dismissed: [] };

/** Reconcile with the current pending questionnaire ids. */
export function syncQuestionDock(state: QuestionDockState, pendingIds: readonly string[]): QuestionDockState {
  const known = new Set(state.known);
  const arrived = pendingIds.filter((id) => !known.has(id));
  const dismissed = state.dismissed.filter((id) => pendingIds.includes(id));
  let expanded = state.expanded;
  if (pendingIds.length === 0) expanded = false;
  else if (arrived.some((id) => !dismissed.includes(id))) expanded = true;
  if (
    expanded === state.expanded &&
    known.size === pendingIds.length && pendingIds.every((id) => known.has(id)) &&
    dismissed.length === state.dismissed.length
  ) return state;
  return { expanded, known: [...pendingIds], dismissed };
}

export function openQuestionDock(state: QuestionDockState): QuestionDockState {
  return state.expanded ? state : { ...state, expanded: true };
}

/** The user closed the dock: remember the current questionnaires so they do not reopen it. */
export function closeQuestionDock(state: QuestionDockState): QuestionDockState {
  return { ...state, expanded: false, dismissed: [...new Set([...state.dismissed, ...state.known])] };
}
