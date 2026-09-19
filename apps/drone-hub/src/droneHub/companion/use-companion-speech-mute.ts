import React from 'react';
import type { SpeechSettingsResponse } from '../app/settings-types';
import { requestJson } from '../http';
import { applySpeechPlaybackSettings, getSpeechMuted, subscribeSpeechMuted } from '../media/speech-playback';

/**
 * Companion's speaker button. It is the Hub's own Speech "muted" setting, so the speak tool is told
 * about it and Settings stays in step; Companion's Live voice follows it too. Cue sounds do not.
 */
/** Apply a settings response only if it really is one; anything else (an error page, a proxy's answer) is ignored. */
function applySpeech(data: Partial<SpeechSettingsResponse> | null | undefined): SpeechSettingsResponse['speech'] | null {
  const speech = data?.speech;
  if (!speech || typeof speech.muted !== 'boolean') return null;
  applySpeechPlaybackSettings(speech);
  return speech;
}

export function useCompanionSpeechMute(active: boolean) {
  const muted = React.useSyncExternalStore(subscribeSpeechMuted, getSpeechMuted, () => false);
  const [busy, setBusy] = React.useState(false);
  // Nothing else loads the setting at startup, so the button would otherwise show a guess.
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    requestJson<SpeechSettingsResponse>('/api/settings/speech').then(data => { if (!cancelled) applySpeech(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [active]);
  const toggle = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // Silence or sound right away; the saved setting confirms it, or puts it back if saving failed.
    const next = !getSpeechMuted();
    try {
      const current = applySpeech(await requestJson<SpeechSettingsResponse>('/api/settings/speech'));
      if (!current) throw new Error('Speech settings are unavailable.');
      applySpeechPlaybackSettings({ ...current, muted: next });
      const { enabled, volume, voice } = current;
      applySpeech(await requestJson<SpeechSettingsResponse>('/api/settings/speech', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled, muted: next, volume, voice }),
      }));
    } catch {
      try { applySpeech(await requestJson<SpeechSettingsResponse>('/api/settings/speech')); } catch { /* Keep what is shown. */ }
    } finally { setBusy(false); }
  }, [busy]);
  return { muted, busy, toggle };
}
