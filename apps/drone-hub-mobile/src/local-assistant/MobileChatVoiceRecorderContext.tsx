import React from 'react';
import { useMesh } from '../mesh/MeshContext';
import { useMobileChatVoiceRecorder } from './use-mobile-chat-voice-recorder';
import { useMobileContinuousDictation } from './use-mobile-continuous-dictation';
import { useMobileContinuousVoice } from './use-mobile-continuous-voice';
import {
  MobileMicrophoneCoordinator,
  type MobileMicrophoneOwner,
} from './mobile-microphone-coordinator';

type MobileChatVoiceRecorderContextValue = ReturnType<typeof useMobileChatVoiceRecorder> & {
  continuousVoice: ReturnType<typeof useMobileContinuousVoice>;
  continuousDictation: ReturnType<typeof useMobileContinuousDictation>;
  microphoneOwner: MobileMicrophoneOwner | null;
  error: string;
  getError(): string;
  setError: React.Dispatch<React.SetStateAction<string>>;
};

const MobileChatVoiceRecorderContext =
  React.createContext<MobileChatVoiceRecorderContextValue | null>(null);

/**
 * Owns the phone's single voice recording engine above app navigation. Each
 * composer still decides whether its active session should stop when it leaves.
 */
export function MobileChatVoiceRecorderProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const [error, setError] = React.useState('');
  const errorRef = React.useRef('');
  const [microphoneCoordinator] = React.useState(() => new MobileMicrophoneCoordinator());
  const microphoneOwner = React.useSyncExternalStore(
    microphoneCoordinator.subscribe,
    microphoneCoordinator.getSnapshot,
    microphoneCoordinator.getSnapshot,
  );
  const handleError = React.useCallback((message: string) => {
    const next = message.trim();
    errorRef.current = next;
    setError(next);
  }, []);
  const setSharedError = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (update) => {
      setError((current) => {
        const next = (typeof update === 'function' ? update(current) : update).trim();
        errorRef.current = next;
        return next;
      });
    },
    [],
  );
  const recorder = useMobileChatVoiceRecorder({
    microphoneCoordinator,
    onError: handleError,
  });
  const continuousVoice = useMobileContinuousVoice({
    microphoneCoordinator,
    onError: handleError,
    onBackgroundActivityChange: mesh.setBackgroundActivityRequired,
  });
  const continuousDictation = useMobileContinuousDictation(continuousVoice);
  const value = React.useMemo(
    () => ({
      ...recorder,
      continuousVoice,
      continuousDictation,
      error,
      getError: () => errorRef.current,
      microphoneOwner,
      setError: setSharedError,
    }),
    [continuousDictation, continuousVoice, error, microphoneOwner, recorder, setSharedError],
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
