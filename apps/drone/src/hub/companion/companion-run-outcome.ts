import type { BlipRuntimeEvent } from '@blip/core';

type Observe = (event: BlipRuntimeEvent) => Promise<void> | void;

/** Blip can resolve prompt() after an error event. Completion of the promise is not success. */
export async function runCompanionPrompt(
  provider: string,
  prompt: (observe: Observe) => Promise<void>,
  onEvent: Observe,
): Promise<void> {
  let failure: Error | undefined;
  await prompt(event => {
    if (event.type === 'session_finished') {
      if (event.status === 'error') failure = new Error(`${provider}: ${event.error?.trim() || 'The backend run failed without an error description.'}`);
      else if (event.status === 'cancelled') failure = new Error('Companion run cancelled');
    }
    return onEvent(event);
  });
  if (failure) throw failure;
}
