export const VOICE_INPUT_SILENCE_MILLIS_MIN = 250;
export const VOICE_INPUT_SILENCE_MILLIS_MAX = 10_000;

export function normalizeVoiceInputSilenceMillis(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return rounded >= VOICE_INPUT_SILENCE_MILLIS_MIN &&
    rounded <= VOICE_INPUT_SILENCE_MILLIS_MAX
    ? rounded
    : fallback;
}
