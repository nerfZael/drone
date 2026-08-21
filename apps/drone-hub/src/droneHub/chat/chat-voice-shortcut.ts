export const CHAT_VOICE_SHORTCUT_DOUBLE_TAP_MS = 400;

export function isChatVoiceShortcutDoubleTap(
  previousTimestamp: number,
  currentTimestamp: number,
): boolean {
  const elapsed = currentTimestamp - previousTimestamp;
  return (
    previousTimestamp > 0 &&
    elapsed >= 0 &&
    elapsed <= CHAT_VOICE_SHORTCUT_DOUBLE_TAP_MS
  );
}
