export type BrowserMicrophoneOwner =
  | 'voice-message'
  | 'continuous-steering'
  | 'continuous-dictation'
  | 'file-dictation';

export type BrowserMicrophoneLease = {
  owner: BrowserMicrophoneOwner;
  release(): void;
};

class BrowserMicrophoneCoordinator {
  private activeLease: { owner: BrowserMicrophoneOwner; token: symbol } | null = null;
  private listeners = new Set<() => void>();

  readonly getSnapshot = (): BrowserMicrophoneOwner | null => this.activeLease?.owner ?? null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  acquire(owner: BrowserMicrophoneOwner): BrowserMicrophoneLease | null {
    if (this.activeLease) return null;
    const token = Symbol(owner);
    this.activeLease = { owner, token };
    this.emit();
    return {
      owner,
      release: () => {
        if (this.activeLease?.token !== token) return;
        this.activeLease = null;
        this.emit();
      },
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const browserMicrophoneCoordinator = new BrowserMicrophoneCoordinator();

export function browserMicrophoneOwnerLabel(owner: BrowserMicrophoneOwner): string {
  if (owner === 'continuous-dictation') return 'Continuous dictation';
  if (owner === 'continuous-steering') return 'Continuous voice steering';
  if (owner === 'file-dictation') return 'File dictation';
  return 'A voice message';
}
