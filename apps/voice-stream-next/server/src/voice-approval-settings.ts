export type VoiceApprovalSettings = {
  triggerPhrase: string;
  unlockPhrase: string;
  shutdownPhrase: string;
  lockCode: string;
  minDigits: number;
  maxDigits: number;
  stableMs: number;
  collectTimeoutMs: number;
  duplicateCooldownMs: number;
  finalizeCheckIntervalMs: number;
  postPromptCommandSuppressionMs: number;
};

export type VoiceApprovalSettingsLimits = {
  triggerPhraseMaxChars: number;
  phraseMaxChars: number;
  minDigitsMin: number;
  minDigitsMax: number;
  maxDigitsMin: number;
  maxDigitsMax: number;
  stableMsMin: number;
  stableMsMax: number;
  collectTimeoutMsMin: number;
  collectTimeoutMsMax: number;
  duplicateCooldownMsMin: number;
  duplicateCooldownMsMax: number;
  finalizeCheckIntervalMsMin: number;
  finalizeCheckIntervalMsMax: number;
  postPromptCommandSuppressionMsMin: number;
  postPromptCommandSuppressionMsMax: number;
};

export const VOICE_APPROVAL_SETTINGS_DEFAULT: VoiceApprovalSettings = {
  triggerPhrase: 'approval code',
  unlockPhrase: 'wake up now',
  shutdownPhrase: 'shut down completely',
  lockCode: '4321',
  minDigits: 4,
  maxDigits: 8,
  stableMs: 900,
  collectTimeoutMs: 5_000,
  duplicateCooldownMs: 4_000,
  finalizeCheckIntervalMs: 250,
  postPromptCommandSuppressionMs: 1_800,
};

export const VOICE_APPROVAL_SETTINGS_LIMITS: VoiceApprovalSettingsLimits = {
  triggerPhraseMaxChars: 64,
  phraseMaxChars: 128,
  minDigitsMin: 1,
  minDigitsMax: 8,
  maxDigitsMin: 1,
  maxDigitsMax: 12,
  stableMsMin: 250,
  stableMsMax: 3_000,
  collectTimeoutMsMin: 1_000,
  collectTimeoutMsMax: 15_000,
  duplicateCooldownMsMin: 0,
  duplicateCooldownMsMax: 15_000,
  finalizeCheckIntervalMsMin: 100,
  finalizeCheckIntervalMsMax: 1_000,
  postPromptCommandSuppressionMsMin: 0,
  postPromptCommandSuppressionMsMax: 5_000,
};

function normalizePhrase(raw: unknown, maxChars: number): string {
  const text = typeof raw === 'string'
    ? raw.toLowerCase().trim().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (!text) return '';
  return text.length > maxChars ? text.slice(0, maxChars).trim() : text;
}

function phraseWordCount(phrase: string): number {
  return phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean).length;
}

function normalizeTriggerPhrase(raw: unknown): string {
  return normalizePhrase(raw, VOICE_APPROVAL_SETTINGS_LIMITS.triggerPhraseMaxChars);
}

function normalizeCode(raw: unknown): string {
  const text = typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(/\D/g, '') : '';
  if (!text) return '';
  return text.slice(0, VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMax);
}

function parseIntegerInRange(raw: unknown, min: number, max: number): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const next = Math.floor(value);
  if (next < min || next > max) return null;
  return next;
}

export function parseVoiceApprovalSettings(raw: unknown): VoiceApprovalSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const triggerPhrase = normalizeTriggerPhrase(value.triggerPhrase);
  const unlockPhrase = normalizePhrase(
    value.unlockPhrase ?? value.unlockCode,
    VOICE_APPROVAL_SETTINGS_LIMITS.phraseMaxChars,
  );
  const shutdownPhrase = normalizePhrase(
    value.shutdownPhrase ?? value.lockedOffCode ?? value.offCode ?? value.offPhrase,
    VOICE_APPROVAL_SETTINGS_LIMITS.phraseMaxChars,
  );
  const lockCode = normalizeCode(value.lockCode);
  const minDigits = parseIntegerInRange(value.minDigits, VOICE_APPROVAL_SETTINGS_LIMITS.minDigitsMin, VOICE_APPROVAL_SETTINGS_LIMITS.minDigitsMax);
  const maxDigits = parseIntegerInRange(value.maxDigits, VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMin, VOICE_APPROVAL_SETTINGS_LIMITS.maxDigitsMax);
  const stableMs = parseIntegerInRange(value.stableMs, VOICE_APPROVAL_SETTINGS_LIMITS.stableMsMin, VOICE_APPROVAL_SETTINGS_LIMITS.stableMsMax);
  const collectTimeoutMs = parseIntegerInRange(
    value.collectTimeoutMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.collectTimeoutMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.collectTimeoutMsMax,
  );
  const duplicateCooldownMs = parseIntegerInRange(
    value.duplicateCooldownMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.duplicateCooldownMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.duplicateCooldownMsMax,
  );
  const finalizeCheckIntervalMs = parseIntegerInRange(
    value.finalizeCheckIntervalMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.finalizeCheckIntervalMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.finalizeCheckIntervalMsMax,
  );
  const postPromptCommandSuppressionMs = parseIntegerInRange(
    value.postPromptCommandSuppressionMs ?? VOICE_APPROVAL_SETTINGS_DEFAULT.postPromptCommandSuppressionMs,
    VOICE_APPROVAL_SETTINGS_LIMITS.postPromptCommandSuppressionMsMin,
    VOICE_APPROVAL_SETTINGS_LIMITS.postPromptCommandSuppressionMsMax,
  );
  if (
    !triggerPhrase ||
    !unlockPhrase ||
    !shutdownPhrase ||
    !lockCode ||
    minDigits == null ||
    maxDigits == null ||
    stableMs == null ||
    collectTimeoutMs == null ||
    duplicateCooldownMs == null ||
    finalizeCheckIntervalMs == null ||
    postPromptCommandSuppressionMs == null
  ) {
    return null;
  }
  if (maxDigits < minDigits) return null;
  if (phraseWordCount(unlockPhrase) < 2 || phraseWordCount(shutdownPhrase) < 2) return null;
  if (lockCode.length > maxDigits) return null;
  const distinctPhrases = new Set([triggerPhrase.toLowerCase(), unlockPhrase.toLowerCase(), shutdownPhrase.toLowerCase()]);
  if (distinctPhrases.size !== 3) return null;
  return {
    triggerPhrase,
    unlockPhrase,
    shutdownPhrase,
    lockCode,
    minDigits,
    maxDigits,
    stableMs,
    collectTimeoutMs,
    duplicateCooldownMs,
    finalizeCheckIntervalMs,
    postPromptCommandSuppressionMs,
  };
}

export function voiceApprovalSettingsResponse(
  settings: VoiceApprovalSettings & { updatedAt: string; speechPlaybackTarget?: string },
  options: { assistantProfiles?: unknown[] } = {},
) {
  return {
    ok: true as const,
    settings: {
      triggerPhrase: settings.triggerPhrase,
      unlockPhrase: settings.unlockPhrase,
      shutdownPhrase: settings.shutdownPhrase,
      lockCode: settings.lockCode,
      minDigits: settings.minDigits,
      maxDigits: settings.maxDigits,
      stableMs: settings.stableMs,
      collectTimeoutMs: settings.collectTimeoutMs,
      duplicateCooldownMs: settings.duplicateCooldownMs,
      finalizeCheckIntervalMs: settings.finalizeCheckIntervalMs,
      postPromptCommandSuppressionMs: settings.postPromptCommandSuppressionMs,
      speechPlaybackTarget: settings.speechPlaybackTarget ?? 'auto',
      updatedAt: settings.updatedAt,
      assistantProfiles: options.assistantProfiles ?? [],
    },
    defaults: VOICE_APPROVAL_SETTINGS_DEFAULT,
    limits: VOICE_APPROVAL_SETTINGS_LIMITS,
    assistantProfiles: options.assistantProfiles ?? [],
  };
}

export function approvalRecognizerOptions(settings: VoiceApprovalSettings) {
  return {
    triggerPhrase: settings.triggerPhrase,
    minDigits: settings.minDigits,
    maxDigits: settings.maxDigits,
    stableMs: settings.stableMs,
    collectTimeoutMs: settings.collectTimeoutMs,
    duplicateCooldownMs: settings.duplicateCooldownMs,
    finalizeCheckIntervalMs: settings.finalizeCheckIntervalMs,
  };
}
