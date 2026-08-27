export function readChatReconciliationEntry(
  opts: { droneId: string; chatName: string },
  deps: {
    readChatMetadataFromStore: (opts: { droneId: string; chatName: string }) => any;
    readChatRowsFromStore: (opts: {
      droneId: string;
      chatName: string;
      indexes: number[];
      includePending: boolean;
    }) => any;
  },
): any | null {
  const storedMetadata = deps.readChatMetadataFromStore(opts);
  if (!storedMetadata?.available || !storedMetadata.chat) return null;

  const rows = deps.readChatRowsFromStore({
    ...opts,
    indexes: [],
    includePending: true,
  });
  if (!rows?.available) return null;

  return {
    ...storedMetadata.chat,
    pendingPrompts: rows.pending,
    // Reconciliation only checks whether its pending prompt IDs already have
    // turns. Avoid parsing unrelated transcript history every cycle.
    turns: rows.pendingTurns,
  };
}
