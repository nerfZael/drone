export const COMPANION_APP_CONTEXT_EVENT = 'drone-hub:companion-app-context';
export const COMPANION_PREPARE_DRAFT_EVENT = 'drone-hub:companion-prepare-draft';
export const COMPANION_HIGHLIGHT_DRONES_EVENT = 'drone-hub:companion-highlight-drones';
export const COMPANION_TOGGLE_EVENT = 'drone-hub:companion-toggle';

export type CompanionBrowserEventDetail<T = unknown> = {
  args: Record<string, unknown>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export function requestCompanionBrowserAction<T>(
  eventName: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const event = new CustomEvent<CompanionBrowserEventDetail<T>>(eventName, {
      detail: { args, resolve, reject },
      cancelable: true,
    });
    if (!window.dispatchEvent(event)) return;
    window.setTimeout(() => reject(new Error('Companion browser action is unavailable.')), 0);
  });
}

export function requestCompanionToggle(): void {
  window.dispatchEvent(new Event(COMPANION_TOGGLE_EVENT));
}
