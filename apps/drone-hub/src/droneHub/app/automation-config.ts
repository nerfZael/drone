export const AUTOMATION_RUNS_MIN = 1;
export const AUTOMATION_RUNS_MAX = 20;
export const AUTOMATION_RUNS_DEFAULT = 5;
export const AUTOMATION_LABEL_MAX_CHARS = 72;
export const AUTOMATION_PROMPT_MAX_CHARS = 8_000;
export const AUTOMATION_ON_FAILURE_PROMPT_MAX_CHARS = 8_000;
export const AUTOMATION_MAX_ITEMS = 40;

export type AutomationConfig = {
  id: string;
  label: string;
  prompt: string;
  onFailurePrompt: string;
  runs: number;
};

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

export function createAutomationConfig(seed?: Partial<AutomationConfig>): AutomationConfig {
  return {
    id: String(seed?.id ?? '').trim() || makeAutomationId(),
    label: normalizeAutomationLabel(seed?.label ?? ''),
    prompt: normalizeAutomationPrompt(seed?.prompt ?? ''),
    onFailurePrompt: normalizeAutomationOnFailurePrompt(seed?.onFailurePrompt ?? ''),
    runs: normalizeAutomationRuns(seed?.runs),
  };
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
