import { writeOnboardingDismissals } from './storage';

export const GUIDED_ONBOARDING_REPLAY_EVENT = 'droneHub.onboarding.guided.replay';

/**
 * Clear onboarding dismissals and deterministically re-open the first step.
 *
 * Note: the GuidedOnboarding component listens for this event and will open
 * step 0 even if its target isn't currently present (it will center).
 */
export function requestGuidedOnboardingReplay(): void {
  // Reset storage first so step 0 is eligible again.
  writeOnboardingDismissals({});
  try {
    window.dispatchEvent(new CustomEvent(GUIDED_ONBOARDING_REPLAY_EVENT));
  } catch {
    // ignore
  }
}

/**
 * Clear onboarding dismissals without opening the tour.
 */
export function resetGuidedOnboardingDismissals(): void {
  writeOnboardingDismissals({});
}

