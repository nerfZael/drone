import React from 'react';
import { useMesh } from '../mesh/MeshContext';
import { useMobileChatVoiceRecorder } from './use-mobile-chat-voice-recorder';
import { useMobileContinuousVoice } from './use-mobile-continuous-voice';

type MobileChatVoiceRecorderContextValue = ReturnType<typeof useMobileChatVoiceRecorder> & {
  continuousVoice: ReturnType<typeof useMobileContinuousVoice>;
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
  const mesh = useMesh();
  const [error, setError] = React.useState('');
  const handleError = React.useCallback((message: string) => setError(message.trim()), []);
  const recorder = useMobileChatVoiceRecorder({ onError: handleError });
  const continuousVoice = useMobileContinuousVoice({
    onError: handleError,
    onBackgroundActivityChange: mesh.setBackgroundActivityRequired,
  });
  const value = React.useMemo(
    () => ({ ...recorder, continuousVoice, error, setError }),
    [continuousVoice, error, recorder],
  );

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
