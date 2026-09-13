import React from 'react';
import { AppState } from 'react-native';
import { phoneAssistant } from './mobile-phone-assistant';

/** A button press waits for hydration, but can never start the microphone after dismissal. */
export function usePhoneAssistantLaunch({ requestId, rendered, available, start }: {
  requestId: string;
  rendered: boolean;
  available: boolean;
  start(signal: AbortSignal): Promise<void>;
}) {
  const latest = React.useRef({ available, start });
  latest.current = { available, start };
  const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const cancel = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    if (!requestId || !rendered || !phoneAssistant) return;
    const abort = new AbortController();
    let started = false;
    let checking = false;
    let visible = false;
    let hasBeenActive = AppState.currentState === 'active';
    let done = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = () => { clearInterval(interval); clearTimeout(deadline); };
    setError(''); setPending(true);
    const end = () => {
      abort.abort(); done = true;
      clearTimers();
      setPending(false);
    };
    cancel.current = end;
    const fail = (message: string) => { if (!abort.signal.aborted) { end(); setError(message); } };
    const tick = async () => {
      if (!visible || done || started || checking || !latest.current.available || AppState.currentState !== 'active') return;
      checking = true;
      try {
        if (!await phoneAssistant!.canStart(requestId) || abort.signal.aborted) return;
        if (!await phoneAssistant!.hasPermissions()) {
          fail('Open Drone Hub and use the phone assistant setup button to allow microphone and headset access.');
          return;
        }
        if (abort.signal.aborted || AppState.currentState !== 'active' || !await phoneAssistant!.canStart(requestId)) return;
        if (abort.signal.aborted) return;
        if (!await phoneAssistant!.claimStart(requestId)) {
          done = true; clearTimers(); setPending(false); return;
        }
        if (abort.signal.aborted) return;
        started = true;
        await latest.current.start(abort.signal);
        if (!abort.signal.aborted) { done = true; clearTimers(); setPending(false); }
      } catch (next) {
        if (!abort.signal.aborted) fail(next instanceof Error ? next.message : 'Companion could not start.');
      } finally { checking = false; }
    };
    // The shell's dialogs have unmounted by this effect. Native now permits the voice screen over keyguard.
    void phoneAssistant.ready(requestId).then((ready) => {
      if (abort.signal.aborted) return;
      visible = ready;
      if (ready) void tick();
      else fail('This assistant request has ended. Hold the side button to try again.');
    }).catch(() => fail('Could not open the assistant screen.'));
    interval = setInterval(() => void tick(), 200);
    deadline = setTimeout(() => {
      if (!done) fail('Companion could not connect. Check your selected Hub and try again.');
    }, 30_000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && (visible || hasBeenActive) && !done) fail('Startup cancelled. Tap Retry to start Companion.');
      else if (state === 'active') { hasBeenActive = true; void tick(); }
    });
    return () => {
      end(); listener.remove();
      cancel.current = () => {};
    };
  }, [requestId, rendered, attempt]);
  return { error, pending, retry: async () => {
    if (await phoneAssistant?.retry(requestId)) retry();
    else setError('This assistant request has ended. Hold the side button to try again.');
  }, cancel: () => cancel.current() };
}
