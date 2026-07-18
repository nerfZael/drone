import React from 'react';
import { useMobileChatVoiceRecorder } from './use-mobile-chat-voice-recorder';

type MobileChatVoiceRecorderContextValue = ReturnType<typeof useMobileChatVoiceRecorder> & {
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
};

const MobileChatVoiceRecorderContext =
  React.createContext<MobileChatVoiceRecorderContextValue | null>(null);

/**
 * Owns the phone's single voice recording session above app navigation so a
 * recording is not tied to the lifetime of any particular message composer.
 */
export function MobileChatVoiceRecorderProvider({ children }: { children: React.ReactNode }) {
  const [error, setError] = React.useState('');
  const handleError = React.useCallback((message: string) => setError(message.trim()), []);
  const recorder = useMobileChatVoiceRecorder({ onError: handleError });
  const value = React.useMemo(() => ({ ...recorder, error, setError }), [error, recorder]);

  return (
    <MobileChatVoiceRecorderContext.Provider value={value}>
      {children}
    </MobileChatVoiceRecorderContext.Provider>
  );
}

export function useSharedMobileChatVoiceRecorder(): MobileChatVoiceRecorderContextValue {
  const value = React.useContext(MobileChatVoiceRecorderContext);
  if (!value) {
    throw new Error(
      'useSharedMobileChatVoiceRecorder must be used inside MobileChatVoiceRecorderProvider',
    );
  }
  return value;
}
