export class AgentFollowupCoordinator {
  private readonly autoContinueMessages = new Set<string>();
  private readonly autoContinueChats = new Set<string>();
  private readonly copilotMessages = new Set<string>();

  isAutoContinueChatActive(chatLockId: string): boolean {
    return this.autoContinueChats.has(chatLockId);
  }

  startAutoContinue(sourceMessageId: string, chatLockId: string): boolean {
    if (
      !sourceMessageId ||
      !chatLockId ||
      this.autoContinueMessages.has(sourceMessageId) ||
      this.autoContinueChats.has(chatLockId)
    ) {
      return false;
    }
    this.autoContinueMessages.add(sourceMessageId);
    this.autoContinueChats.add(chatLockId);
    return true;
  }

  finishAutoContinue(sourceMessageId: string, chatLockId: string): void {
    this.autoContinueMessages.delete(sourceMessageId);
    this.autoContinueChats.delete(chatLockId);
  }

  startCopilot(sourceMessageId: string): boolean {
    if (!sourceMessageId || this.copilotMessages.has(sourceMessageId)) return false;
    this.copilotMessages.add(sourceMessageId);
    return true;
  }

  finishCopilot(sourceMessageId: string): void {
    this.copilotMessages.delete(sourceMessageId);
  }

  clear(): void {
    this.autoContinueMessages.clear();
    this.autoContinueChats.clear();
    this.copilotMessages.clear();
  }
}
