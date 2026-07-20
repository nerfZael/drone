export class AgentFollowupCoordinator {
  private readonly copilotMessages = new Set<string>();

  startCopilot(sourceMessageId: string): boolean {
    if (!sourceMessageId || this.copilotMessages.has(sourceMessageId)) return false;
    this.copilotMessages.add(sourceMessageId);
    return true;
  }

  finishCopilot(sourceMessageId: string): void {
    this.copilotMessages.delete(sourceMessageId);
  }

  clear(): void {
    this.copilotMessages.clear();
  }
}
