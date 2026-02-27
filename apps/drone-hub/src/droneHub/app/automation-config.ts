export const AUTOMATION_RUNS_MIN = 1;
export const AUTOMATION_RUNS_MAX = 20;
export const AUTOMATION_RUNS_DEFAULT = 5;
export const AUTOMATION_SLEEP_AMOUNT_MIN = 0;
export const AUTOMATION_SLEEP_AMOUNT_MAX = 1_000_000;
export const AUTOMATION_SLEEP_AMOUNT_DEFAULT = 0;
export const AUTOMATION_SLEEP_UNIT_DEFAULT = 'seconds';
export const AUTOMATION_STOP_PHRASE_MAX_CHARS = 320;
export const AUTOMATION_STOP_PHRASE_CASE_SENSITIVE_DEFAULT = false;
export const AUTOMATION_LABEL_MAX_CHARS = 72;
export const AUTOMATION_PROMPT_MAX_CHARS = 8_000;
export const AUTOMATION_ON_FAILURE_PROMPT_MAX_CHARS = 8_000;
export const AUTOMATION_MAX_ITEMS = 40;

export type AutomationSleepUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export type AutomationConfig = {
  id: string;
  label: string;
  prompt: string;
  onFailurePrompt: string;
  runs: number;
  sleepAmount: number;
  sleepUnit: AutomationSleepUnit;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
};

function hasOwn(obj: object, key: keyof AutomationConfig): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function makeAutomationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeAutomationRuns(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return AUTOMATION_RUNS_DEFAULT;
  return Math.max(AUTOMATION_RUNS_MIN, Math.min(AUTOMATION_RUNS_MAX, Math.round(n)));
}

export function normalizeAutomationSleepAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return AUTOMATION_SLEEP_AMOUNT_DEFAULT;
  return Math.max(AUTOMATION_SLEEP_AMOUNT_MIN, Math.min(AUTOMATION_SLEEP_AMOUNT_MAX, Math.round(n)));
}

export function normalizeAutomationSleepUnit(value: unknown): AutomationSleepUnit {
  const unit = String(value ?? '').trim().toLowerCase();
  if (unit === 'minutes' || unit === 'hours' || unit === 'days') return unit;
  return 'seconds';
}

export function normalizeAutomationStopPhrase(value: unknown): string {
  return String(value ?? '').trim().slice(0, AUTOMATION_STOP_PHRASE_MAX_CHARS);
}

export function normalizeAutomationStopPhraseCaseSensitive(value: unknown): boolean {
  return value === true;
}

export function normalizeAutomationLabel(value: unknown): string {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  return raw.slice(0, AUTOMATION_LABEL_MAX_CHARS);
}

export function normalizeAutomationPrompt(value: unknown): string {
  return String(value ?? '').slice(0, AUTOMATION_PROMPT_MAX_CHARS);
}

export function normalizeAutomationOnFailurePrompt(value: unknown): string {
  return String(value ?? '').slice(0, AUTOMATION_ON_FAILURE_PROMPT_MAX_CHARS);
}

const AUTOMATION_SLEEP_SECONDS_PER_UNIT: Record<AutomationSleepUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
};

export function automationSleepSecondsFromConfig(seed: Pick<AutomationConfig, 'sleepAmount' | 'sleepUnit'>): number {
  const amount = normalizeAutomationSleepAmount(seed.sleepAmount);
  const unit = normalizeAutomationSleepUnit(seed.sleepUnit);
  return amount * AUTOMATION_SLEEP_SECONDS_PER_UNIT[unit];
}

export function formatAutomationSleepInterval(seed: Pick<AutomationConfig, 'sleepAmount' | 'sleepUnit'>): string {
  const amount = normalizeAutomationSleepAmount(seed.sleepAmount);
  const unit = normalizeAutomationSleepUnit(seed.sleepUnit);
  if (amount <= 0) return 'No delay';
  const singular =
    unit === 'seconds' ? 'second'
    : unit === 'minutes' ? 'minute'
    : unit === 'hours' ? 'hour'
    : 'day';
  return `${amount} ${amount === 1 ? singular : unit}`;
}

export function createAutomationConfig(seed?: Partial<AutomationConfig>): AutomationConfig {
  return {
    id: String(seed?.id ?? '').trim() || makeAutomationId(),
    label: normalizeAutomationLabel(seed?.label ?? ''),
    prompt: normalizeAutomationPrompt(seed?.prompt ?? ''),
    onFailurePrompt: normalizeAutomationOnFailurePrompt(seed?.onFailurePrompt ?? ''),
    runs: normalizeAutomationRuns(seed?.runs),
    sleepAmount: normalizeAutomationSleepAmount(seed?.sleepAmount),
    sleepUnit: normalizeAutomationSleepUnit(seed?.sleepUnit ?? AUTOMATION_SLEEP_UNIT_DEFAULT),
    stopPhrase: normalizeAutomationStopPhrase(seed?.stopPhrase),
    stopPhraseCaseSensitive: normalizeAutomationStopPhraseCaseSensitive(
      seed?.stopPhraseCaseSensitive ?? AUTOMATION_STOP_PHRASE_CASE_SENSITIVE_DEFAULT,
    ),
  };
}

export function patchAutomationConfig(current: AutomationConfig, patch: Partial<AutomationConfig>): AutomationConfig {
  return {
    ...current,
    ...(hasOwn(patch, 'label') ? { label: normalizeAutomationLabel(patch.label) } : {}),
    ...(hasOwn(patch, 'prompt') ? { prompt: normalizeAutomationPrompt(patch.prompt) } : {}),
    ...(hasOwn(patch, 'onFailurePrompt')
      ? { onFailurePrompt: normalizeAutomationOnFailurePrompt(patch.onFailurePrompt) }
      : {}),
    ...(hasOwn(patch, 'runs') ? { runs: normalizeAutomationRuns(patch.runs) } : {}),
    ...(hasOwn(patch, 'sleepAmount') ? { sleepAmount: normalizeAutomationSleepAmount(patch.sleepAmount) } : {}),
    ...(hasOwn(patch, 'sleepUnit') ? { sleepUnit: normalizeAutomationSleepUnit(patch.sleepUnit) } : {}),
    ...(hasOwn(patch, 'stopPhrase') ? { stopPhrase: normalizeAutomationStopPhrase(patch.stopPhrase) } : {}),
    ...(hasOwn(patch, 'stopPhraseCaseSensitive')
      ? { stopPhraseCaseSensitive: normalizeAutomationStopPhraseCaseSensitive(patch.stopPhraseCaseSensitive) }
      : {}),
  };
}

export function automationConfigsEqual(a: AutomationConfig, b: AutomationConfig): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.prompt === b.prompt &&
    a.onFailurePrompt === b.onFailurePrompt &&
    a.runs === b.runs &&
    a.sleepAmount === b.sleepAmount &&
    a.sleepUnit === b.sleepUnit &&
    a.stopPhrase === b.stopPhrase &&
    a.stopPhraseCaseSensitive === b.stopPhraseCaseSensitive
  );
}

export function normalizeAutomationConfigs(value: unknown): AutomationConfig[] {
  const list = Array.isArray(value) ? value : [];
  const out: AutomationConfig[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const normalized = createAutomationConfig(item && typeof item === 'object' ? (item as Partial<AutomationConfig>) : undefined);
    if (!normalized.id || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
    if (out.length >= AUTOMATION_MAX_ITEMS) break;
  }
  return out;
}
