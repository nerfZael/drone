import React from 'react';
import {
  mergeMobileDraftWithContinuousDictation,
  mobileContinuousDictationText,
  resolveMobileContinuousDictationNavigationAction,
  type MobileContinuousVoiceMode,
} from './mobile-continuous-dictation';
import { resolveMobileComposerContinuousVoiceState } from './resolve-mobile-composer-continuous-voice-state';
import type { useMobileContinuousDictation } from './use-mobile-continuous-dictation';
import type { useMobileContinuousVoice } from './use-mobile-continuous-voice';

type MobileContinuousDictation = ReturnType<typeof useMobileContinuousDictation>;
type MobileContinuousVoice = ReturnType<typeof useMobileContinuousVoice>;

export type MobileComposerSend = (
  promptOverride?: string,
  deliveryMode?: 'queue' | 'asap',
  promptId?: string,
  preserveComposer?: boolean,
) => void | boolean | Promise<void | boolean>;

export function useMobileComposerContinuousVoice({
  targetKey,
  valueRef,
  onChangeText,
  onSend,
  onError,
  startBlocked,
  continuousVoice,
  continuousDictation,
}: {
  targetKey: string;
  valueRef: { current: string };
  onChangeText(value: string): void;
  onSend: MobileComposerSend;
  onError(message: string): void;
  startBlocked: boolean;
  continuousVoice: MobileContinuousVoice;
  continuousDictation: MobileContinuousDictation;
}) {
  const [actionInFlight, setActionInFlight] = React.useState(false);
  const actionInFlightRef = React.useRef(false);
  const cancelInFlightRef = React.useRef(false);
  const state = resolveMobileComposerContinuousVoiceState({
    targetKey,
    voiceTargetKey: continuousVoice.targetKey,
    voiceStatus: continuousVoice.status,
    pendingCount: continuousVoice.pendingCount,
    durationMillis: continuousVoice.durationMillis,
    dictationTargetKey: continuousDictation.targetKey,
    dictationText: continuousDictation.text,
  });
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const lifecycleRef = React.useRef({
    targetKey,
    voiceTargetKey: continuousVoice.targetKey,
    voiceStatus: continuousVoice.status,
    dictationTargetKey: continuousDictation.targetKey,
  });
  lifecycleRef.current = {
    targetKey,
    voiceTargetKey: continuousVoice.targetKey,
    voiceStatus: continuousVoice.status,
    dictationTargetKey: continuousDictation.targetKey,
  };

  const actionsRef = React.useRef({
    cancelVoice: continuousVoice.cancel,
    clearError: () => onError(''),
    discardDictation: continuousDictation.discard,
    stopVoice: continuousVoice.stop,
  });
  actionsRef.current = {
    cancelVoice: continuousVoice.cancel,
    clearError: () => onError(''),
    discardDictation: continuousDictation.discard,
    stopVoice: continuousVoice.stop,
  };

  // Mobile composer drafts intentionally do not survive navigation. Dictation
  // is discarded, while steering gets a chance to deliver its final thought.
  const leaveTarget = React.useCallback(
    async (previousTargetKey: string, nextTargetKey: string) => {
      const current = lifecycleRef.current;
      const action = resolveMobileContinuousDictationNavigationAction({
        previousTargetKey,
        nextTargetKey,
        dictationTargetKey: current.dictationTargetKey,
        continuousVoiceTargetKey: current.voiceTargetKey,
        continuousVoiceIdle: current.voiceStatus === 'idle',
      });
      const controls = actionsRef.current;
      controls.clearError();
      if (action.discardDictation) controls.discardDictation(previousTargetKey);
      if (action.voiceAction === 'cancel') {
        await controls.cancelVoice();
      } else if (action.voiceAction === 'stop' && !(await controls.stopVoice())) {
        await controls.cancelVoice();
      }
    },
    [],
  );

  const previousTargetRef = React.useRef(targetKey);
  React.useEffect(() => {
    const previousTargetKey = previousTargetRef.current;
    previousTargetRef.current = targetKey;
    if (!previousTargetKey || previousTargetKey === targetKey) return;
    void leaveTarget(previousTargetKey, targetKey);
  }, [leaveTarget, targetKey]);
  const mountedTargetRef = React.useRef(targetKey);
  mountedTargetRef.current = targetKey;
  React.useEffect(
    () => () => {
      const currentTargetKey = mountedTargetRef.current;
      if (currentTargetKey) void leaveTarget(currentTargetKey, '');
    },
    [leaveTarget],
  );

  const runExclusive = React.useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      if (actionInFlightRef.current) return false;
      actionInFlightRef.current = true;
      setActionInFlight(true);
      try {
        await action();
        return true;
      } catch (error: any) {
        onError(error?.message ?? String(error));
        return false;
      } finally {
        actionInFlightRef.current = false;
        setActionInFlight(false);
      }
    },
    [onError],
  );

  const start = React.useCallback(
    async (mode: MobileContinuousVoiceMode): Promise<boolean> => {
      if (startBlocked || stateRef.current.elsewhere) return false;
      let started = false;
      const ran = await runExclusive(async () => {
        if (!targetKey) throw new Error('Continuous voice requires a target chat.');
        if (mode === 'dictation') {
          started = await continuousDictation.start(targetKey);
          return;
        }
        continuousDictation.discard(targetKey);
        started = await continuousVoice.start({
          targetKey,
          onTranscript: async (text, deliveryId) =>
            (await onSend(text, 'asap', deliveryId, true)) !== false,
        });
      });
      return ran && started;
    },
    [
      continuousDictation.discard,
      continuousDictation.start,
      continuousVoice.start,
      onSend,
      runExclusive,
      startBlocked,
      targetKey,
    ],
  );

  const materializeDictation = React.useCallback((): string => {
    const snapshot = continuousDictation.takeSnapshot(targetKey);
    if (!snapshot) return valueRef.current;
    const nextValue = mergeMobileDraftWithContinuousDictation(
      valueRef.current,
      mobileContinuousDictationText(snapshot.lines),
    );
    valueRef.current = nextValue;
    onChangeText(nextValue);
    return nextValue;
  }, [continuousDictation.takeSnapshot, onChangeText, targetKey, valueRef]);

  const editDictation = React.useCallback(async (): Promise<boolean> => {
    if (stateRef.current.kind !== 'dictation') return false;
    return await runExclusive(async () => {
      if (stateRef.current.owned) await continuousDictation.finishOrDiscardPending();
      materializeDictation();
    });
  }, [continuousDictation.finishOrDiscardPending, materializeDictation, runExclusive]);

  const finish = React.useCallback(async () => {
    if (!stateRef.current.owned) return false;
    return await runExclusive(async () => {
      if (stateRef.current.mode === 'dictation') {
        await continuousDictation.finish();
      } else {
        await continuousVoice.stop();
      }
    });
  }, [continuousDictation.finish, continuousVoice.stop, runExclusive]);

  const togglePause = React.useCallback(async () => {
    if (!stateRef.current.owned) return false;
    return await runExclusive(continuousVoice.togglePause);
  }, [continuousVoice.togglePause, runExclusive]);

  const cancel = React.useCallback(async () => {
    if (cancelInFlightRef.current) return false;
    cancelInFlightRef.current = true;
    // Cancellation may interrupt startup, so it cannot wait for the ordinary
    // exclusive action guard to be released.
    const ownsAction = !actionInFlightRef.current;
    if (ownsAction) {
      actionInFlightRef.current = true;
      setActionInFlight(true);
    }
    try {
      onError('');
      if (stateRef.current.mode === 'dictation') {
        await continuousDictation.cancel();
      } else {
        await continuousVoice.cancel();
      }
      return true;
    } catch (error: any) {
      onError(error?.message ?? String(error));
      return false;
    } finally {
      cancelInFlightRef.current = false;
      if (ownsAction) {
        actionInFlightRef.current = false;
        setActionInFlight(false);
      }
    }
  }, [continuousDictation.cancel, continuousVoice.cancel, onError]);

  const sendDictation = React.useCallback(async (): Promise<boolean> => {
    if (stateRef.current.kind !== 'dictation') return false;
    await runExclusive(async () => {
      if (stateRef.current.owned && !(await continuousDictation.finish())) return;
      // Materialize first so the parent composer owns failed-send recovery and
      // there is only one copy of the draft to restore.
      const nextValue = materializeDictation();
      onError('');
      await onSend(nextValue.trim() || undefined);
    });
    return true;
  }, [continuousDictation.finish, materializeDictation, onError, onSend, runExclusive]);

  return {
    state,
    actionInFlight,
    startBlocked: startBlocked || state.elsewhere || actionInFlight,
    start,
    editDictation,
    finish,
    togglePause,
    cancel,
    sendDictation,
  };
}
