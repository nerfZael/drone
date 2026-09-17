import type { CompanionHoldAction } from './companion-shortcut';

type Cue = 'start' | 'send' | CompanionHoldAction;

const notes: Record<Cue, number[]> = {
  start: [520, 780],
  send: [980],
  pause: [440, 440],
  resume: [440, 660],
  cancel: [520, 330],
  close: [660, 440, 220],
  reset: [660, 880, 660],
};

let context: AudioContext | null = null;

// Called from the keyboard gesture as well as after microphone startup, so
// browsers can unlock audio before getUserMedia resolves.
export function prepareCompanionRecordingCues(): void {
  try {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    if (!context || context.state === 'closed') context = new window.AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => {});
  } catch { /* An unavailable cue must never block the shortcut. */ }
}

export function playCompanionRecordingCue(cue: Cue): void {
  prepareCompanionRecordingCues();
  if (!context || context.state !== 'running') return;
  try {
    const audio = context;
    notes[cue].forEach((frequency, index) => {
      const start = audio.currentTime + index * 0.09;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.07);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + 0.08);
    });
  } catch { /* Recording remains usable without sound. */ }
}
