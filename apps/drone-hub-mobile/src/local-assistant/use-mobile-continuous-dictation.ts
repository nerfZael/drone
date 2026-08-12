import React from 'react';
import { MobileContinuousDictationBuffer } from './mobile-continuous-dictation';
import type { useMobileContinuousVoice } from './use-mobile-continuous-voice';

type MobileContinuousVoice = ReturnType<typeof useMobileContinuousVoice>;

export function useMobileContinuousDictation(continuousVoice: MobileContinuousVoice) {
  const [targetKey, setTargetKey] = React.useState<string | null>(null);
  const bufferRef = React.useRef(new MobileContinuousDictationBuffer());
  const startVoice = continuousVoice.start;
  const stopVoice = continuousVoice.stop;
  const cancelVoice = continuousVoice.cancel;

  const syncBuffer = React.useCallback(() => {
    const snapshot = bufferRef.current.snapshot();
    setTargetKey(snapshot.targetKey);
  }, []);

  const previousVoiceActiveRef = React.useRef(continuousVoice.status !== 'idle');
  React.useEffect(() => {
    const voiceActive = continuousVoice.status !== 'idle';
    const voiceJustStopped = previousVoiceActiveRef.current && !voiceActive;
    previousVoiceActiveRef.current = voiceActive;
    const snapshot = bufferRef.current.snapshot();
    if (voiceJustStopped && snapshot.targetKey) {
      bufferRef.current.discard(snapshot.targetKey);
      syncBuffer();
    }
  }, [continuousVoice.status, syncBuffer]);

  const discard = React.useCallback(
    (expectedTargetKey?: string) => {
      if (bufferRef.current.discard(expectedTargetKey)) syncBuffer();
    },
    [syncBuffer],
  );

  const start = React.useCallback(
    async (nextTargetKey: string, onTranscript: (text: string) => void): Promise<boolean> => {
      const normalizedTargetKey = nextTargetKey.trim();
      if (!normalizedTargetKey) return false;
      const generation = bufferRef.current.begin(normalizedTargetKey);
      syncBuffer();
      const started = await startVoice({
        targetKey: normalizedTargetKey,
        onTranscript: async (text, deliveryId) => {
          if (
            bufferRef.current.append(generation, normalizedTargetKey, {
              id: deliveryId,
              text,
            })
          ) {
            onTranscript(text);
          }
          return true;
        },
      });
      if (!started && bufferRef.current.isCurrent(generation, normalizedTargetKey)) {
        bufferRef.current.discard(normalizedTargetKey);
        syncBuffer();
      }
      return started;
    },
    [startVoice, syncBuffer],
  );

  const finish = React.useCallback(
    async () => {
      const stoppingTargetKey = bufferRef.current.snapshot().targetKey;
      const finished = await stopVoice();
      const snapshot = bufferRef.current.snapshot();
      if (finished && stoppingTargetKey && snapshot.targetKey === stoppingTargetKey) {
        bufferRef.current.discard(stoppingTargetKey);
        syncBuffer();
      }
      return finished;
    },
    [stopVoice, syncBuffer],
  );

  const cancel = React.useCallback(async () => {
    discard();
    await cancelVoice();
  }, [cancelVoice, discard]);

  return React.useMemo(
    () => ({
      targetKey,
      start,
      finish,
      cancel,
      discard,
    }),
    [cancel, discard, finish, start, targetKey],
  );
}
