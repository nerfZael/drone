export type DesktopVoiceMode = 'off' | 'awake' | 'sleeping' | 'recording' | 'transcribing' | 'error';
export type DesktopVoiceClipboardMode = 'idle' | 'recording' | 'transcribing' | 'error';

export type DesktopVoiceCue = 'start_button' | 'stop_button' | 'unlock' | 'sleeping_off' | 'wake' | 'sleep' | 'status';

export const DESKTOP_VOICE_CODES = {
  unlock: '1234',
  lock: '4321',
  lockedOff: '0000',
} as const;

export const DESKTOP_VOICE_CUE_TONES: Record<DesktopVoiceCue, Array<{ frequencyHz: number; durationMs: number }>> = {
  start_button: [
    { frequencyHz: 420, durationMs: 70 },
    { frequencyHz: 640, durationMs: 120 },
  ],
  stop_button: [
    { frequencyHz: 520, durationMs: 70 },
    { frequencyHz: 260, durationMs: 150 },
  ],
  unlock: [
    { frequencyHz: 360, durationMs: 70 },
    { frequencyHz: 560, durationMs: 80 },
    { frequencyHz: 820, durationMs: 130 },
  ],
  sleeping_off: [
    { frequencyHz: 460, durationMs: 120 },
    { frequencyHz: 0, durationMs: 50 },
    { frequencyHz: 330, durationMs: 150 },
    { frequencyHz: 220, durationMs: 230 },
  ],
  wake: [
    { frequencyHz: 620, durationMs: 80 },
    { frequencyHz: 880, durationMs: 130 },
  ],
  sleep: [
    { frequencyHz: 760, durationMs: 90 },
    { frequencyHz: 420, durationMs: 160 },
  ],
  status: [
    { frequencyHz: 520, durationMs: 70 },
    { frequencyHz: 0, durationMs: 45 },
    { frequencyHz: 520, durationMs: 70 },
    { frequencyHz: 0, durationMs: 45 },
    { frequencyHz: 700, durationMs: 90 },
  ],
};
