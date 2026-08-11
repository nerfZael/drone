/** A command which has been shown locally but has not been acknowledged yet. */
export type SidebarOptimisticJournalEntry<TCommand> = {
  id: string;
  command: TCommand;
};

/**
 * A small, framework-independent optimistic state journal.
 *
 * `confirmed` is always a server snapshot. The visible value is obtained by
 * replaying `pending` in order, so rejecting one command cannot roll back a
 * newer command or an unrelated local change.
 */
export type SidebarOptimisticJournal<TState, TCommand> = {
  confirmed: TState;
  pending: SidebarOptimisticJournalEntry<TCommand>[];
};

export function createSidebarOptimisticJournal<TState, TCommand>(
  confirmed: TState,
): SidebarOptimisticJournal<TState, TCommand> {
  return { confirmed, pending: [] };
}

export function appendSidebarOptimisticCommand<TState, TCommand>(
  journal: SidebarOptimisticJournal<TState, TCommand>,
  entry: SidebarOptimisticJournalEntry<TCommand>,
): SidebarOptimisticJournal<TState, TCommand> {
  return {
    ...journal,
    pending: [...journal.pending.filter((item) => item.id !== entry.id), entry],
  };
}

export function replaceSidebarConfirmedState<TState, TCommand>(
  journal: SidebarOptimisticJournal<TState, TCommand>,
  confirmed: TState,
): SidebarOptimisticJournal<TState, TCommand> {
  return { confirmed, pending: journal.pending };
}

export function settleSidebarOptimisticCommand<TState, TCommand>(
  journal: SidebarOptimisticJournal<TState, TCommand>,
  id: string,
  confirmed?: TState,
): SidebarOptimisticJournal<TState, TCommand> {
  return {
    confirmed: confirmed === undefined ? journal.confirmed : confirmed,
    pending: journal.pending.filter((entry) => entry.id !== id),
  };
}

export function sidebarOptimisticJournalValue<TState, TCommand>(
  journal: SidebarOptimisticJournal<TState, TCommand>,
  apply: (state: TState, command: TCommand) => TState,
): TState {
  return journal.pending.reduce(
    (state, entry) => apply(state, entry.command),
    journal.confirmed,
  );
}

