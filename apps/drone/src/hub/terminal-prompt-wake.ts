export function createTerminalPromptWakeHandler(deps: {
  normalizeDroneId: (value: string) => string;
  normalizeChatName: (value: string) => string;
  findChatNamesForPrompt: (droneId: string, promptId: string) => Promise<string[]>;
  enqueueReconcile: (droneId: string, chatName: string) => void;
  enqueuePromptPump: (droneId: string, chatName: string) => void;
}) {
  return async (droneIdRaw: string, promptIdRaw: string): Promise<void> => {
    const droneId = deps.normalizeDroneId(droneIdRaw);
    const promptId = String(promptIdRaw ?? '').trim();
    if (!droneId || !promptId) return;

    const chatNames = new Set(
      (await deps.findChatNamesForPrompt(droneId, promptId))
        .map((chatName) => deps.normalizeChatName(chatName))
        .filter(Boolean),
    );
    for (const chatName of chatNames) {
      deps.enqueueReconcile(droneId, chatName);
      deps.enqueuePromptPump(droneId, chatName);
    }
  };
}
