import React from 'react';
import { AppState, Text } from 'react-native';
import { Button, ErrorBanner } from '../components/Ui';
import { colors } from '../theme';
import { phoneAssistant, type PhoneAssistantStatus } from './mobile-phone-assistant';
import { prepareMobileLiveAudio } from './openMobileLiveAudio';

export function PhoneAssistantSettings() {
  const [status, setStatus] = React.useState<PhoneAssistantStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [statusError, setStatusError] = React.useState('');
  React.useEffect(() => {
    if (!phoneAssistant) return;
    let mounted = true;
    const refresh = () => void phoneAssistant!.getStatus().then((value) => {
      if (mounted) { setStatus(value); setStatusError(''); }
    }).catch(() => { if (mounted) setStatusError('Could not read Android assistant settings.'); });
    refresh();
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { mounted = false; listener.remove(); };
  }, []);
  const displayedError = error || statusError;
  if (!status?.supported) return displayedError ? <ErrorBanner message={displayedError} /> : null;
  return <>
    <Button tone="quiet" loading={busy} disabled={busy} onPress={() => {
      setBusy(true); setError('');
      void (async () => {
        // Grant audio permissions while unlocked, before a later lock-screen invocation.
        if (!status.selected) await prepareMobileLiveAudio();
        await phoneAssistant!.requestRole();
      })().catch((next: unknown) => setError(next instanceof Error ? next.message : 'Could not open assistant settings.'))
        .finally(() => setBusy(false));
    }}>{status.selected ? 'Change phone assistant' : 'Use Companion as phone assistant'}</Button>
    {status.selected ? <Button tone="quiet" disabled={busy} onPress={() => {
      setBusy(true); setError('');
      void prepareMobileLiveAudio()
        .catch((next: unknown) => setError(next instanceof Error ? next.message : 'Could not set up voice access.'))
        .finally(() => setBusy(false));
    }}>Set up voice access</Button> : null}
    <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
      {status.selected ? 'Companion is your phone assistant. ' : 'Choose Drone Hub Mobile / Companion in Android’s assistant picker. '}
      Hold the side button to start Live with the Hub selected in Drone Hub, including while locked. Enable Live voice below first.
      {'\n'}On Samsung, set Settings → Advanced features → Side button → Long press to Digital assistant if needed.
      {'\n'}Companion can hear and act on requests while locked. Opening the full app requires unlocking.
    </Text>
    {displayedError ? <ErrorBanner message={displayedError} /> : null}
  </>;
}
