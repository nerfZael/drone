export const COMPANION_SHORTCUT_DOUBLE_TAP_MS = 400;
export const COMPANION_SHORTCUT_CANCEL_MS = 600;
export const COMPANION_SHORTCUT_RESET_MS = 1_500;

export type CompanionShortcutEvent = {
  phase: 'down' | 'up' | 'cancel';
  heldMs?: number;
};

export function companionRecordingGesture(heldMs: number): 'tap' | 'cancel' | 'reset' {
  if (heldMs >= COMPANION_SHORTCUT_RESET_MS) return 'reset';
  if (heldMs >= COMPANION_SHORTCUT_CANCEL_MS) return 'cancel';
  return 'tap';
}

/** Holds only preview an action. Nothing is submitted or discarded until release. */
export class CompanionShortcutPress {
  private press: { at: number; release: (gesture: 'tap' | 'cancel' | 'reset') => void } | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly now = () => performance.now()) {}

  down(release: (gesture: 'tap' | 'cancel' | 'reset') => void, preview: (gesture: 'cancel' | 'reset') => void): void {
    if (this.press) return;
    this.press = { at: this.now(), release };
    this.timers = [
      setTimeout(() => preview('cancel'), COMPANION_SHORTCUT_CANCEL_MS),
      setTimeout(() => preview('reset'), COMPANION_SHORTCUT_RESET_MS),
    ];
  }

  up(heldMs?: number): void {
    const press = this.press;
    this.cancel();
    if (press) press.release(companionRecordingGesture(heldMs ?? this.now() - press.at));
  }

  cancel(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.press = null;
  }
}

export function shouldConsumeCompanionProposalShortcut({
  matched,
  shortcutKey,
  canApply,
}: {
  matched: boolean;
  shortcutKey: string | null | undefined;
  canApply: boolean;
}): boolean {
  if (!matched) return false;
  return canApply || shortcutKey === 'capslock';
}

type CompanionRecordingEscapeInput = {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  voiceStatus: string;
};

export function shouldCancelCompanionRecordingWithEscape({
  key,
  repeat,
  isComposing,
  voiceStatus,
}: CompanionRecordingEscapeInput): boolean {
  return (
    key === 'Escape' &&
    !repeat &&
    !isComposing &&
    (voiceStatus === 'starting' || voiceStatus === 'recording' || voiceStatus === 'paused')
  );
}

export function isCompanionShortcutDoubleTap(
  previousTimestamp: number,
  currentTimestamp: number,
): boolean {
  const elapsed = currentTimestamp - previousTimestamp;
  return previousTimestamp > 0 && elapsed >= 0 && elapsed <= COMPANION_SHORTCUT_DOUBLE_TAP_MS;
}

export function companionProposalShortcutGesture(
  previousTimestamp: number,
  currentTimestamp: number,
): 'schedule-apply' | 'toggle-auto-approve' {
  return isCompanionShortcutDoubleTap(previousTimestamp, currentTimestamp)
    ? 'toggle-auto-approve'
    : 'schedule-apply';
}
