import React from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorBanner } from '../components/Ui';
import { colors } from '../theme';
import { useMobileCompanion } from './MobileCompanionContext';
import { usePhoneAssistantRequest } from './PhoneAssistantContext';
import { phoneAssistant } from './mobile-phone-assistant';
import { usePhoneAssistantLaunch } from './use-phone-assistant-launch';

export function PhoneAssistantScreen() {
  const requestId = usePhoneAssistantRequest();
  const companion = useMobileCompanion();
  const [laidOutRequest, setLaidOutRequest] = React.useState('');
  const launch = usePhoneAssistantLaunch({ requestId, rendered: laidOutRequest === requestId, available: companion.available,
    start: companion.startAssistantVoice });
  const [actionError, setActionError] = React.useState('');
  const dismiss = async () => {
    launch.cancel();
    await companion.close();
    await phoneAssistant?.dismiss(requestId);
  };
  const dismissRef = React.useRef(dismiss); dismissRef.current = dismiss;
  React.useEffect(() => setActionError(''), [requestId]);
  React.useEffect(() => {
    if (!requestId) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      void dismissRef.current().catch(() => setActionError('Could not close Companion. Try End again.'));
      return true;
    });
    return () => listener.remove();
  }, [requestId]);
  if (!requestId) return null;
  const active = companion.live.status === 'connecting' || companion.live.status === 'listening';
  const error = actionError || launch.error || companion.live.error || companion.error;
  return <SafeAreaView key={requestId} style={styles.screen} onLayout={() => setLaidOutRequest(requestId)}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Companion</Text>
      <Text style={styles.status}>{launch.pending ? 'Starting Live…' : active ?
        (companion.live.capturing ? 'Listening' : 'Connecting…') : companion.live.status === 'paused' ? 'Paused' : 'Ready'}</Text>
      {launch.pending || companion.live.status === 'connecting' ? <ActivityIndicator color={colors.accent} /> : null}
      {companion.live.targetName ? <Text style={styles.copy}>{companion.live.targetName}</Text> : null}
      {companion.live.captions ? <Text numberOfLines={8} style={styles.copy}>{companion.live.captions}</Text> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {!launch.pending ? <Button onPress={() => {
        setActionError('');
        if (active) companion.live.pause();
        else void launch.retry().catch(() => setActionError('Could not retry Companion. Hold the side button again.'));
      }}>{active ? 'Pause' : error ? 'Retry' : 'Resume'}</Button> : null}
      <Button tone="quiet" onPress={() => void dismiss().catch(() => setActionError('Could not close Companion. Try End again.'))}>End</Button>
      <Button tone="quiet" onPress={() => {
        launch.cancel();
        void phoneAssistant?.openApp(requestId).catch(() => setActionError('Unlock your phone to open Drone Hub.'));
      }}>Open Drone Hub</Button>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 18 },
  title: { fontSize: 30, fontWeight: '700', color: colors.textStrong, textAlign: 'center' },
  status: { fontSize: 18, color: colors.accent, textAlign: 'center' },
  copy: { fontSize: 15, lineHeight: 22, color: colors.textSecondary, textAlign: 'center' },
});
