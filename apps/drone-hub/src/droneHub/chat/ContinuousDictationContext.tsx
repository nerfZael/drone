import React from 'react';
import type { CompanionTextSnapshot } from '@drone/assistant-chat';
import type { ContinuousChatVoiceStatus } from './use-continuous-chat-voice';
import { useContinuousChatVoice } from './use-continuous-chat-voice';
import {
  browserMicrophoneCoordinator,
  type BrowserMicrophoneOwner,
} from './browser-microphone-coordinator';
import { createContinuousDictationToggle } from './create-continuous-dictation-toggle';
import { useActiveComposer } from './ActiveComposerContext';

export type ContinuousDictationComposerSnapshot = CompanionTextSnapshot;

type ContinuousDictationContextValue = {
  status: ContinuousChatVoiceStatus;
  pendingCount: number;
  error: string;
  microphoneOwner: BrowserMicrophoneOwner | null;
  toggle(): Promise<void>;
};

const ContinuousDictationContext =
  React.createContext<ContinuousDictationContextValue | null>(null);

export function ContinuousDictationProvider({ children }: { children: React.ReactNode }) {
  const activeComposer = useActiveComposer();
  const activeComposerIdRef = React.useRef(activeComposer.activeComposerId);
  activeComposerIdRef.current = activeComposer.activeComposerId;
  const [error, setError] = React.useState('');
  const discardPendingRef = React.useRef<() => void>(() => undefined);
  const microphoneOwner = React.useSyncExternalStore(
    browserMicrophoneCoordinator.subscribe,
    browserMicrophoneCoordinator.getSnapshot,
    browserMicrophoneCoordinator.getSnapshot,
  );

  const onTranscript = React.useCallback(
    async (text: string, _deliveryId: string, route: string | null): Promise<boolean> => {
      if (!route || route !== activeComposerIdRef.current) return true;
      const cleanText = text.trim();
      if (!cleanText) return true;
      activeComposer.appendTranscript(route, cleanText);
      return true;
    },
    [activeComposer.appendTranscript],
  );

  const {
    status,
    pendingCount,
    start,
    stop,
    cancel,
    getStatus,
    discardPending,
  } = useContinuousChatVoice({
    resetKey: 'global-continuous-dictation',
    onTranscript,
    onError: setError,
    routeKey: activeComposer.ensureTargetId,
    shouldCapture: () => activeComposer.ensureTargetId() !== null,
    microphoneOwner: 'continuous-dictation',
  });
  discardPendingRef.current = discardPending;
  React.useEffect(() => discardPending(), [activeComposer.activeComposerId, discardPending]);
  const voiceControlsRef = React.useRef({ getStatus, start, stop, cancel });
  voiceControlsRef.current = { getStatus, start, stop, cancel };
  const toggleControllerRef = React.useRef<ReturnType<
    typeof createContinuousDictationToggle
  > | null>(null);
  if (!toggleControllerRef.current) {
    toggleControllerRef.current = createContinuousDictationToggle({
      getStatus: () => voiceControlsRef.current.getStatus(),
      start: () => voiceControlsRef.current.start(),
      stop: () => voiceControlsRef.current.stop(),
      cancel: () => {
        void voiceControlsRef.current.cancel();
      },
      onStartIntent: () => discardPendingRef.current(),
    });
  }
  toggleControllerRef.current.sync(status !== 'idle');
  React.useEffect(() => {
    const controller = toggleControllerRef.current;
    controller?.activate();
    return () => controller?.deactivate();
  }, []);

  const toggle = React.useCallback(async () => {
    setError('');
    activeComposer.ensureTargetId();
    await toggleControllerRef.current?.toggle();
  }, [activeComposer.ensureTargetId]);

  const value = React.useMemo<ContinuousDictationContextValue>(
    () => ({
      status,
      pendingCount,
      error,
      microphoneOwner,
      toggle,
    }),
    [
      error,
      microphoneOwner,
      pendingCount,
      status,
      toggle,
    ],
  );

  return (
    <ContinuousDictationContext.Provider value={value}>
      {children}
    </ContinuousDictationContext.Provider>
  );
}

export function useContinuousDictation(): ContinuousDictationContextValue | null {
  return React.useContext(ContinuousDictationContext);
}

export function continuousDictationStatusLabel(
  status: ContinuousChatVoiceStatus,
  pendingCount: number,
): string {
  if (status === 'starting') return 'Starting continuous dictation…';
  if (status === 'speech') return 'Continuous dictation · speech detected';
  if (status === 'thought-pause') return 'Continuous dictation · waiting for pause';
  if (status === 'paused') return 'Continuous dictation paused';
  if (status === 'recovering') return 'Continuous dictation reconnecting…';
  if (status === 'stopping') return 'Stopping continuous dictation…';
  if (status === 'error') return 'Continuous dictation needs attention';
  if (status === 'listening') {
    return `Continuous dictation listening${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  }
  return 'Start continuous dictation';
}
