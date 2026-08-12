import React from 'react';
import {
  MobileContinuousDictationBuffer,
  mobileContinuousDictationText,
  type MobileContinuousDictationLine,
  type MobileContinuousDictationSnapshot,
} from './mobile-continuous-dictation';
import type { useMobileContinuousVoice } from './use-mobile-continuous-voice';

type MobileContinuousVoice = ReturnType<typeof useMobileContinuousVoice>;

export function useMobileContinuousDictation(continuousVoice: MobileContinuousVoice) {
  const [targetKey, setTargetKey] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<MobileContinuousDictationLine[]>([]);
  const bufferRef = React.useRef(new MobileContinuousDictationBuffer());
  const startVoice = continuousVoice.start;
  const stopVoice = continuousVoice.stop;
  const cancelVoice = continuousVoice.cancel;

  const syncBuffer = React.useCallback(() => {
    const snapshot = bufferRef.current.snapshot();
    setTargetKey(snapshot.targetKey);
    setLines(snapshot.lines);
  }, []);

  const previousVoiceActiveRef = React.useRef(continuousVoice.status !== 'idle');
  React.useEffect(() => {
    const voiceActive = continuousVoice.status !== 'idle';
    const voiceJustStopped = previousVoiceActiveRef.current && !voiceActive;
    previousVoiceActiveRef.current = voiceActive;
    const snapshot = bufferRef.current.snapshot();
    if (voiceJustStopped && snapshot.targetKey && snapshot.lines.length === 0) {
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
    async (nextTargetKey: string): Promise<boolean> => {
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
            syncBuffer();
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

  const stop = React.useCallback(async () => {
    const stoppingTargetKey = bufferRef.current.snapshot().targetKey;
    await stopVoice();
    const snapshot = bufferRef.current.snapshot();
    if (stoppingTargetKey && snapshot.targetKey === stoppingTargetKey && !snapshot.lines.length) {
      bufferRef.current.discard(stoppingTargetKey);
      syncBuffer();
    }
  }, [stopVoice, syncBuffer]);

  const cancel = React.useCallback(async () => {
    discard();
    await cancelVoice();
  }, [cancelVoice, discard]);

  const takeSnapshot = React.useCallback(
    (expectedTargetKey: string): MobileContinuousDictationSnapshot | null => {
      const snapshot = bufferRef.current.takeSnapshot(expectedTargetKey);
      syncBuffer();
      return snapshot;
    },
    [syncBuffer],
  );

  const restoreSnapshot = React.useCallback(
    (snapshot: MobileContinuousDictationSnapshot) => {
      if (bufferRef.current.restoreSnapshot(snapshot)) syncBuffer();
    },
    [syncBuffer],
  );

  return React.useMemo(
    () => ({
      targetKey,
      text: mobileContinuousDictationText(lines),
      start,
      stop,
      cancel,
      discard,
      takeSnapshot,
      restoreSnapshot,
    }),
    [cancel, discard, lines, restoreSnapshot, start, stop, takeSnapshot, targetKey],
  );
}
