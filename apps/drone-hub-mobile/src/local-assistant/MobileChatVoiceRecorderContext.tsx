import React from 'react';
import { useMesh } from '../mesh/MeshContext';
import { useMobileChatVoiceRecorder } from './use-mobile-chat-voice-recorder';
import { useMobileContinuousDictation } from './use-mobile-continuous-dictation';
import { useMobileContinuousVoice } from './use-mobile-continuous-voice';
import { MobileMicrophoneCoordinator } from './mobile-microphone-coordinator';
import {
  resolveMobileVoiceSession,
  type MobileVoiceSession,
} from './mobile-voice-session';

type MobileChatVoiceRecorderContextValue = {
  session: MobileVoiceSession;
  getSession(): MobileVoiceSession;
  continuousVoice: ReturnType<typeof useMobileContinuousVoice>;
  continuousDictation: ReturnType<typeof useMobileContinuousDictation>;
  error: string;
  getError(): string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  startVoiceMessageRecording(): Promise<boolean>;
  startCompanionRecording(): Promise<boolean>;
  toggleRecordingPause(): void;
  discardRecording(): Promise<void>;
  stopRecordingForTranscript(): Promise<string>;
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
  const session = resolveMobileVoiceSession({
    recordingOwner: recorder.sessionOwner,
    recordingStatus: recorder.status,
    recordingDurationMillis: recorder.durationMillis,
    continuousStatus: continuousVoice.status,
    continuousTargetKey: continuousVoice.targetKey,
    continuousDictationTargetKey: continuousDictation.targetKey,
    continuousPendingCount: continuousVoice.pendingCount,
    continuousDurationMillis: continuousVoice.durationMillis,
    microphoneAvailable: microphoneOwner === null,
  });
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const getSession = React.useCallback(() => sessionRef.current, []);
  const getError = React.useCallback(() => errorRef.current, []);
  const startVoiceMessageRecording = React.useCallback(
    () => recorder.startRecording('single-shot'),
    [recorder.startRecording],
  );
  const startCompanionRecording = React.useCallback(
    () => recorder.startRecording('companion'),
    [recorder.startRecording],
  );
  const value: MobileChatVoiceRecorderContextValue = {
    session,
    getSession,
    continuousVoice,
    continuousDictation,
    error,
    getError,
    setError: setSharedError,
    startVoiceMessageRecording,
    startCompanionRecording,
    toggleRecordingPause: recorder.toggleRecordingPause,
    discardRecording: recorder.discardRecording,
    stopRecordingForTranscript: recorder.stopRecordingForTranscript,
  };

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
