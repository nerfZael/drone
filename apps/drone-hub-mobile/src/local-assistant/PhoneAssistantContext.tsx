import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../components/Ui';
import { colors } from '../theme';
import { phoneAssistant } from './mobile-phone-assistant';

const PhoneAssistantContext = React.createContext('');
export const usePhoneAssistantRequest = () => React.useContext(PhoneAssistantContext);

export function PhoneAssistantProvider({ children }: { children: React.ReactNode }) {
  // Hold the first app render until the native launch is known; cold launches must not show chats.
  const [requestId, setRequestId] = React.useState<string | null>(phoneAssistant ? null : '');
  const [failed, setFailed] = React.useState(false);
  const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    if (!phoneAssistant) return;
    setFailed(false);
    let active = true;
    let receivedEvent = false;
    const listener = phoneAssistant.addListener('launchChanged', (launch) => {
      receivedEvent = true;
      if (active) { setFailed(false); setRequestId(launch.requestId); }
    });
    void phoneAssistant.getLaunch().then((launch) => {
      if (active && !receivedEvent) setRequestId(launch.requestId);
    }).catch(() => { if (active && !receivedEvent) setFailed(true); });
    return () => { active = false; listener.remove(); };
  }, [attempt]);
  if (failed) return <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.background }}>
    <Text style={{ color: colors.text }}>Could not open Drone Hub. Try again.</Text>
    <Button onPress={retry}>Retry</Button>
  </View>;
  if (requestId === null) return null;
  return <PhoneAssistantContext.Provider value={requestId}>{children}</PhoneAssistantContext.Provider>;
}
