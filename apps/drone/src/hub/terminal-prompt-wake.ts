type PendingPromptRef = { id?: unknown };

export function createTerminalPromptWakeHandler(deps: {
  normalizeDroneId: (value: string) => string;
  normalizeChatName: (value: string) => string;
  listChatNames: (droneId: string) => Promise<string[]>;
  readPendingPrompts: (droneId: string, chatName: string) => Promise<PendingPromptRef[]>;
  enqueueReconcile: (droneId: string, chatName: string) => void;
  enqueuePromptPump: (droneId: string, chatName: string) => void;
}) {
  return async (droneIdRaw: string, promptIdRaw: string): Promise<void> => {
    const droneId = deps.normalizeDroneId(droneIdRaw);
    const promptId = String(promptIdRaw ?? '').trim();
    if (!droneId || !promptId) return;

    const chatNames = new Set(
      (await deps.listChatNames(droneId))
        .map((chatName) => deps.normalizeChatName(chatName))
        .filter(Boolean),
    );
    for (const chatName of chatNames) {
      const pending = await deps.readPendingPrompts(droneId, chatName);
      if (!pending.some((item) => String(item?.id ?? '').trim() === promptId)) continue;
      deps.enqueueReconcile(droneId, chatName);
      deps.enqueuePromptPump(droneId, chatName);
    }
  };
}
