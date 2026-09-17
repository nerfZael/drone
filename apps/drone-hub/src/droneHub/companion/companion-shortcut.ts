export const COMPANION_SHORTCUT_DOUBLE_TAP_MS = 400;
export const COMPANION_SHORTCUT_PAUSE_MS = 300;
export const COMPANION_SHORTCUT_CANCEL_MS = 800;
export const COMPANION_SHORTCUT_RESET_MS = 1_300;

export type CompanionShortcutDurations = { pauseMs: number; cancelMs: number; resetMs: number };
export const DEFAULT_COMPANION_SHORTCUT_DURATIONS: CompanionShortcutDurations = {
  pauseMs: COMPANION_SHORTCUT_PAUSE_MS,
  cancelMs: COMPANION_SHORTCUT_CANCEL_MS,
  resetMs: COMPANION_SHORTCUT_RESET_MS,
};

export function validCompanionShortcutDurations(value: unknown): value is CompanionShortcutDurations {
  if (!value || typeof value !== 'object') return false;
  const { pauseMs, cancelMs, resetMs } = value as CompanionShortcutDurations;
  return [pauseMs, cancelMs, resetMs].every(ms => Number.isInteger(ms) && ms >= 200 && ms <= 10_000) &&
    cancelMs - pauseMs >= 200 && resetMs - cancelMs >= 200;
}

export function normalizeCompanionShortcutDurations(value: unknown): CompanionShortcutDurations {
  if (!validCompanionShortcutDurations(value)) return { ...DEFAULT_COMPANION_SHORTCUT_DURATIONS };
  return { pauseMs: value.pauseMs, cancelMs: value.cancelMs, resetMs: value.resetMs };
}

export type CompanionShortcutEvent = {
  phase: 'down' | 'up' | 'cancel';
  heldMs?: number;
};
export type CompanionRecordingGesture = 'tap' | 'pause' | 'cancel' | 'reset';
export type CompanionHoldAction = 'pause' | 'resume' | 'cancel' | 'close' | 'reset';

export function companionRecordingGesture(
  heldMs: number,
  durations: CompanionShortcutDurations = DEFAULT_COMPANION_SHORTCUT_DURATIONS,
): CompanionRecordingGesture {
  if (heldMs >= durations.resetMs) return 'reset';
  if (heldMs >= durations.cancelMs) return 'cancel';
  if (heldMs >= durations.pauseMs) return 'pause';
  return 'tap';
}

export function companionHoldAction(gesture: Exclude<CompanionRecordingGesture, 'tap'>, status: string): CompanionHoldAction | null {
  if (gesture === 'reset') return 'reset';
  if (gesture === 'cancel') return ['starting', 'recording', 'paused'].includes(status) ? 'cancel' : 'close';
  return status === 'recording' ? 'pause' : status === 'paused' ? 'resume' : null;
}

/** Snapshots durations at keydown. Holds preview; only release performs an action. */
export class CompanionShortcutPress {
  private press: { at: number; durations: CompanionShortcutDurations; release: (gesture: CompanionRecordingGesture) => void } | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly now = () => performance.now()) {}

  down(
    release: (gesture: CompanionRecordingGesture) => void,
    preview: (gesture: Exclude<CompanionRecordingGesture, 'tap'>) => void,
    durations = DEFAULT_COMPANION_SHORTCUT_DURATIONS,
  ): void {
    if (this.press) return;
    const snapshot = normalizeCompanionShortcutDurations(durations);
    this.press = { at: this.now(), release, durations: snapshot };
    this.timers = [
      setTimeout(() => preview('pause'), snapshot.pauseMs),
      setTimeout(() => preview('cancel'), snapshot.cancelMs),
      setTimeout(() => preview('reset'), snapshot.resetMs),
    ];
  }

  up(heldMs?: number): void {
    const press = this.press;
    this.cancel();
    if (press) press.release(companionRecordingGesture(heldMs ?? this.now() - press.at, press.durations));
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
