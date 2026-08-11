import React from 'react';
import type { ContinuousChatVoiceStatus } from './use-continuous-chat-voice';
import { useContinuousChatVoice } from './use-continuous-chat-voice';
import {
  browserMicrophoneCoordinator,
  type BrowserMicrophoneOwner,
} from './browser-microphone-coordinator';

type ContinuousDictationLine = {
  id: string;
  text: string;
};

export type ContinuousDictationShadowSnapshot = {
  targetId: string;
  lines: ContinuousDictationLine[];
};

type ContinuousDictationComposer = {
  id: string;
  isEligible(): boolean;
};

type ContinuousDictationContextValue = {
  status: ContinuousChatVoiceStatus;
  pendingCount: number;
  error: string;
  microphoneOwner: BrowserMicrophoneOwner | null;
  activeComposerId: string | null;
  shadowText: string;
  registerComposer(composer: ContinuousDictationComposer): () => void;
  focusComposer(id: string): void;
  consumeShadow(id: string): string;
  takeShadowSnapshot(id: string): ContinuousDictationShadowSnapshot | null;
  restoreShadowSnapshot(snapshot: ContinuousDictationShadowSnapshot): void;
  toggle(): Promise<void>;
};

const ContinuousDictationContext =
  React.createContext<ContinuousDictationContextValue | null>(null);

export function ContinuousDictationProvider({ children }: { children: React.ReactNode }) {
  const [activeComposerId, setActiveComposerId] = React.useState<string | null>(null);
  const [shadowLines, setShadowLines] = React.useState<ContinuousDictationLine[]>([]);
  const [error, setError] = React.useState('');
  const composersRef = React.useRef(new Map<string, ContinuousDictationComposer>());
  const activeComposerIdRef = React.useRef<string | null>(null);
  const shadowLinesRef = React.useRef<ContinuousDictationLine[]>([]);
  const discardPendingRef = React.useRef<() => void>(() => undefined);
  const microphoneOwner = React.useSyncExternalStore(
    browserMicrophoneCoordinator.subscribe,
    browserMicrophoneCoordinator.getSnapshot,
    browserMicrophoneCoordinator.getSnapshot,
  );

  const replaceShadowLines = React.useCallback((lines: ContinuousDictationLine[]) => {
    shadowLinesRef.current = lines;
    setShadowLines(lines);
  }, []);

  const resolveTargetId = React.useCallback((): string | null => {
    const activeId = activeComposerIdRef.current;
    const active = activeId ? composersRef.current.get(activeId) : null;
    if (active?.isEligible()) return active.id;
    for (const composer of composersRef.current.values()) {
      if (composer.isEligible()) return composer.id;
    }
    return null;
  }, []);

  const changeTarget = React.useCallback(
    (nextId: string | null) => {
      const normalized = nextId && composersRef.current.get(nextId)?.isEligible() ? nextId : null;
      if (activeComposerIdRef.current === normalized) return;
      activeComposerIdRef.current = normalized;
      setActiveComposerId(normalized);
      replaceShadowLines([]);
      discardPendingRef.current();
    },
    [replaceShadowLines],
  );

  const ensureTargetId = React.useCallback((): string | null => {
    const nextTarget = resolveTargetId();
    if (nextTarget !== activeComposerIdRef.current) changeTarget(nextTarget);
    return nextTarget;
  }, [changeTarget, resolveTargetId]);

  const onTranscript = React.useCallback(
    async (text: string, deliveryId: string, route: string | null): Promise<boolean> => {
      if (!route || route !== activeComposerIdRef.current) return true;
      const composer = composersRef.current.get(route);
      if (!composer?.isEligible()) {
        ensureTargetId();
        return true;
      }
      const cleanText = text.trim();
      if (!cleanText) return true;
      const next = [...shadowLinesRef.current, { id: deliveryId, text: cleanText }];
      replaceShadowLines(next);
      return true;
    },
    [ensureTargetId, replaceShadowLines],
  );

  const continuousVoice = useContinuousChatVoice({
    resetKey: 'global-continuous-dictation',
    onTranscript,
    onError: setError,
    routeKey: ensureTargetId,
    shouldCapture: () => ensureTargetId() !== null,
    microphoneOwner: 'continuous-dictation',
  });
  discardPendingRef.current = continuousVoice.discardPending;
  const continuousStatus = continuousVoice.status;
  const continuousPendingCount = continuousVoice.pendingCount;
  const startContinuousVoice = continuousVoice.start;
  const stopContinuousVoice = continuousVoice.stop;
  const cancelContinuousVoice = continuousVoice.cancel;

  const registerComposer = React.useCallback(
    (composer: ContinuousDictationComposer) => {
      composersRef.current.set(composer.id, composer);
      ensureTargetId();
      return () => {
        if (composersRef.current.get(composer.id) !== composer) return;
        composersRef.current.delete(composer.id);
        if (activeComposerIdRef.current === composer.id) ensureTargetId();
      };
    },
    [ensureTargetId],
  );

  const focusComposer = React.useCallback(
    (id: string) => {
      const composer = composersRef.current.get(id);
      if (composer?.isEligible()) changeTarget(id);
    },
    [changeTarget],
  );

  const consumeShadow = React.useCallback(
    (id: string): string => {
      if (id !== activeComposerIdRef.current || shadowLinesRef.current.length === 0) return '';
      const text = shadowLinesRef.current.map((line) => line.text).join('\n');
      replaceShadowLines([]);
      return text;
    },
    [replaceShadowLines],
  );

  const takeShadowSnapshot = React.useCallback(
    (id: string): ContinuousDictationShadowSnapshot | null => {
      if (id !== activeComposerIdRef.current || shadowLinesRef.current.length === 0) return null;
      const snapshot = { targetId: id, lines: shadowLinesRef.current.slice() };
      replaceShadowLines([]);
      return snapshot;
    },
    [replaceShadowLines],
  );

  const restoreShadowSnapshot = React.useCallback(
    (snapshot: ContinuousDictationShadowSnapshot) => {
      if (snapshot.targetId !== activeComposerIdRef.current) return;
      const composer = composersRef.current.get(snapshot.targetId);
      if (!composer?.isEligible()) return;
      const restoredIds = new Set(snapshot.lines.map((line) => line.id));
      replaceShadowLines([
        ...snapshot.lines,
        ...shadowLinesRef.current.filter((line) => !restoredIds.has(line.id)),
      ]);
    },
    [replaceShadowLines],
  );

  const toggle = React.useCallback(async () => {
    setError('');
    if (continuousStatus === 'idle') {
      changeTarget(resolveTargetId());
      await startContinuousVoice();
      return;
    }
    if (continuousStatus === 'error') {
      await cancelContinuousVoice();
      return;
    }
    await stopContinuousVoice();
  }, [
    cancelContinuousVoice,
    changeTarget,
    continuousStatus,
    resolveTargetId,
    startContinuousVoice,
    stopContinuousVoice,
  ]);

  const shadowText = shadowLines.map((line) => line.text).join('\n');
  const value = React.useMemo<ContinuousDictationContextValue>(
    () => ({
      status: continuousStatus,
      pendingCount: continuousPendingCount,
      error,
      microphoneOwner,
      activeComposerId,
      shadowText,
      registerComposer,
      focusComposer,
      consumeShadow,
      takeShadowSnapshot,
      restoreShadowSnapshot,
      toggle,
    }),
    [
      activeComposerId,
      consumeShadow,
      continuousPendingCount,
      continuousStatus,
      error,
      focusComposer,
      microphoneOwner,
      registerComposer,
      restoreShadowSnapshot,
      shadowText,
      takeShadowSnapshot,
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
