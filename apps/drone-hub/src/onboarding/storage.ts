export type OnboardingDismissals = Record<string, number>;

const STORAGE_KEY = 'droneHub.onboarding.dismissals';

function coerceDismissals(raw: unknown): OnboardingDismissals {
  if (!raw || typeof raw !== 'object') return {};
  const out: OnboardingDismissals = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k ?? '').trim();
    const num = typeof v === 'number' ? v : Number(v);
    if (!key || !Number.isFinite(num) || num <= 0) continue;
    out[key] = num;
  }
  return out;
}

export function readOnboardingDismissals(): OnboardingDismissals {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return coerceDismissals(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeOnboardingDismissals(next: OnboardingDismissals): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function isOnboardingStepDismissed(dismissals: OnboardingDismissals, stepId: string, stepVersion: number): boolean {
  const key = String(stepId ?? '').trim();
  const v = Number(stepVersion);
  if (!key || !Number.isFinite(v) || v <= 0) return true;
  return (dismissals[key] ?? 0) >= v;
}

export function dismissOnboardingStep(
  dismissals: OnboardingDismissals,
  stepId: string,
  stepVersion: number,
): OnboardingDismissals {
  const key = String(stepId ?? '').trim();
  const v = Number(stepVersion);
  if (!key || !Number.isFinite(v) || v <= 0) return dismissals;
  if ((dismissals[key] ?? 0) >= v) return dismissals;
  return { ...dismissals, [key]: v };
}

