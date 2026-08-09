export type HubApplicationEvent = {
  type: 'ui-preferences.changed';
  notificationMode: 'default' | 'sidebar-snapshot';
};

export class HubApplicationEvents {
  private readonly listeners = new Set<(event: HubApplicationEvent) => void | Promise<void>>();

  subscribe(listener: (event: HubApplicationEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(event: HubApplicationEvent): Promise<void> {
    await Promise.all([...this.listeners].map(async (listener) => await listener(event)));
  }
}
