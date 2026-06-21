const LOCAL_VOICE_CUE_TONES = {
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
  clipboard_recording_start: [
    { frequencyHz: 360, durationMs: 55 },
    { frequencyHz: 540, durationMs: 70 },
    { frequencyHz: 720, durationMs: 95 },
  ],
  clipboard_transcription_success: [
    { frequencyHz: 640, durationMs: 55 },
    { frequencyHz: 820, durationMs: 70 },
    { frequencyHz: 1040, durationMs: 120 },
  ],
  recording_pause: [
    { frequencyHz: 440, durationMs: 65 },
    { frequencyHz: 0, durationMs: 35 },
    { frequencyHz: 330, durationMs: 95 },
  ],
  recording_resume: [
    { frequencyHz: 330, durationMs: 55 },
    { frequencyHz: 440, durationMs: 70 },
    { frequencyHz: 560, durationMs: 85 },
  ],
};

const LOCAL_VOICE_CUE_GAINS = {
  stop_button: 0.0715,
  clipboard_transcription_success: 0.0845,
};
const DEFAULT_LOCAL_VOICE_CUE_GAIN = 0.22;

let lastPlayedCue = '';
let lastPlayedAt = 0;

function playLocalVoiceCue(cue) {
  if (!LOCAL_VOICE_CUE_TONES[cue]) return;
  const now = Date.now();
  if (cue === lastPlayedCue && now - lastPlayedAt < 250) return;
  lastPlayedCue = cue;
  lastPlayedAt = now;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const context = new AudioContextClass();
    const sinkId = String(window.voiceStreamPreferredOutputDeviceId || '');
    if (sinkId && typeof context.setSinkId === 'function') {
      void context.setSinkId(sinkId).catch(() => {});
    }
    let cursor = context.currentTime + 0.01;
    const gain = context.createGain();
    gain.gain.value = LOCAL_VOICE_CUE_GAINS[cue] ?? DEFAULT_LOCAL_VOICE_CUE_GAIN;
    gain.connect(context.destination);

    for (const tone of LOCAL_VOICE_CUE_TONES[cue]) {
      const durationSec = tone.durationMs / 1000;
      if (tone.frequencyHz > 0) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const fadeSec = Math.min(durationSec / 3, 0.01);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(tone.frequencyHz, cursor);
        envelope.gain.setValueAtTime(0.0001, cursor);
        envelope.gain.linearRampToValueAtTime(1, cursor + fadeSec);
        envelope.gain.setValueAtTime(1, Math.max(cursor + fadeSec, cursor + durationSec - fadeSec));
        envelope.gain.linearRampToValueAtTime(0.0001, cursor + durationSec);
        oscillator.connect(envelope);
        envelope.connect(gain);
        oscillator.start(cursor);
        oscillator.stop(cursor + durationSec);
      }
      cursor += durationSec;
    }

    void context.resume().catch(() => {});
    window.setTimeout(() => {
      void context.close().catch(() => {});
    }, Math.ceil((cursor - context.currentTime) * 1000) + 120);
  } catch {
    // Cue playback is best-effort.
  }
}
