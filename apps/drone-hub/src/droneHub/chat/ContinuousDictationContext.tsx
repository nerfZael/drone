import React from 'react';
import type { ContinuousChatVoiceStatus } from './use-continuous-chat-voice';
import { useContinuousChatVoice } from './use-continuous-chat-voice';
import {
  browserMicrophoneCoordinator,
  type BrowserMicrophoneOwner,
} from './browser-microphone-coordinator';
import { createContinuousDictationToggle } from './create-continuous-dictation-toggle';

export type ContinuousDictationComposerSnapshot = {
  targetId: string;
  path: string;
  content: string;
  revision: string;
  mode: 'edit' | 'read-only';
};

type ContinuousDictationComposer = {
  id: string;
  isEligible(): boolean;
  isReadable?(): boolean;
  appendTranscript(text: string): void;
  readSnapshot?(): ContinuousDictationComposerSnapshot;
  applyContent?(baseRevision: string, content: string): { ok: true; revision: string };
};

type ContinuousDictationContextValue = {
  status: ContinuousChatVoiceStatus;
  pendingCount: number;
  error: string;
  microphoneOwner: BrowserMicrophoneOwner | null;
  activeComposerId: string | null;
  registerComposer(composer: ContinuousDictationComposer): () => void;
  focusComposer(id: string): void;
  readActiveComposer(): ContinuousDictationComposerSnapshot;
  applyComposer(targetId: string, baseRevision: string, content: string): { ok: true; revision: string };
  toggle(): Promise<void>;
};

const ContinuousDictationContext =
  React.createContext<ContinuousDictationContextValue | null>(null);

export function ContinuousDictationProvider({ children }: { children: React.ReactNode }) {
  const [activeComposerId, setActiveComposerId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const composersRef = React.useRef(new Map<string, ContinuousDictationComposer>());
  const activeComposerIdRef = React.useRef<string | null>(null);
  const discardPendingRef = React.useRef<() => void>(() => undefined);
  const microphoneOwner = React.useSyncExternalStore(
    browserMicrophoneCoordinator.subscribe,
    browserMicrophoneCoordinator.getSnapshot,
    browserMicrophoneCoordinator.getSnapshot,
  );

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
      discardPendingRef.current();
    },
    [],
  );

  const ensureTargetId = React.useCallback((): string | null => {
    const nextTarget = resolveTargetId();
    if (nextTarget !== activeComposerIdRef.current) changeTarget(nextTarget);
    return nextTarget;
  }, [changeTarget, resolveTargetId]);

  const onTranscript = React.useCallback(
    async (text: string, _deliveryId: string, route: string | null): Promise<boolean> => {
      if (!route || route !== activeComposerIdRef.current) return true;
      const composer = composersRef.current.get(route);
      if (!composer?.isEligible()) {
        ensureTargetId();
        return true;
      }
      const cleanText = text.trim();
      if (!cleanText) return true;
      composer.appendTranscript(cleanText);
      return true;
    },
    [ensureTargetId],
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
    routeKey: ensureTargetId,
    shouldCapture: () => ensureTargetId() !== null,
    microphoneOwner: 'continuous-dictation',
  });
  discardPendingRef.current = discardPending;
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

  const resolveReadableComposer = React.useCallback(() => {
    const activeId = activeComposerIdRef.current;
    const active = activeId ? composersRef.current.get(activeId) : null;
    if (active?.readSnapshot && (active.isReadable?.() ?? active.isEligible())) return active;
    const candidates = [...composersRef.current.values()].filter(
      (composer) => composer.readSnapshot && (composer.isReadable?.() ?? composer.isEligible()),
    );
    const composer = candidates[candidates.length - 1];
    if (!composer) throw new Error('NO_ACTIVE_COMPOSER');
    return composer;
  }, []);

  const readActiveComposer = React.useCallback(
    () => resolveReadableComposer().readSnapshot!(),
    [resolveReadableComposer],
  );

  const applyComposer = React.useCallback(
    (targetId: string, baseRevision: string, content: string) => {
      const composer = composersRef.current.get(targetId);
      if (!composer?.applyContent || !(composer.isReadable?.() ?? composer.isEligible())) {
        throw new Error('COMPOSER_NOT_AVAILABLE');
      }
      return composer.applyContent(baseRevision, content);
    },
    [],
  );

  const toggle = React.useCallback(async () => {
    setError('');
    ensureTargetId();
    await toggleControllerRef.current?.toggle();
  }, [ensureTargetId]);

  const value = React.useMemo<ContinuousDictationContextValue>(
    () => ({
      status,
      pendingCount,
      error,
      microphoneOwner,
      activeComposerId,
      registerComposer,
      focusComposer,
      readActiveComposer,
      applyComposer,
      toggle,
    }),
    [
      activeComposerId,
      error,
      applyComposer,
      focusComposer,
      microphoneOwner,
      pendingCount,
      registerComposer,
      readActiveComposer,
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
