import React from 'react';
import { profileStorageKey } from '../../profile-storage';
import {
  browserMicrophoneCoordinator,
  type BrowserMicrophoneOwner,
} from '../chat/browser-microphone-coordinator';
import {
  type ContinuousChatVoiceStatus,
  useContinuousChatVoice,
} from '../chat/use-continuous-chat-voice';
import { formatFileDictationLine } from './file-dictation-text';

const TIMESTAMPS_STORAGE_KEY = profileStorageKey('droneHub.fileDictationTimestamps');

export type FileDictationTarget = {
  droneId: string;
  droneName: string;
  path: string;
  name: string;
  appendLine(line: string): Promise<boolean>;
  open(): void;
};

type FileDictationContextValue = {
  status: ContinuousChatVoiceStatus;
  pendingCount: number;
  durationMillis: number;
  saving: boolean;
  saved: boolean;
  error: string;
  microphoneOwner: BrowserMicrophoneOwner | null;
  target: FileDictationTarget | null;
  timestampsEnabled: boolean;
  start(target: FileDictationTarget): Promise<boolean>;
  toggle(): Promise<boolean>;
  finish(): Promise<void>;
  togglePause(): Promise<void>;
  toggleTimestamps(): void;
  openTarget(): void;
};

const FileDictationContext = React.createContext<FileDictationContextValue | null>(null);

function storedTimestampsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(TIMESTAMPS_STORAGE_KEY) === 'true';
}

export function fileDictationTargetKey(target: Pick<FileDictationTarget, 'droneId' | 'path'>): string {
  return `${target.droneId}\0${target.path}`;
}

export function FileDictationProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<FileDictationTarget | null>(null);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [timestampsEnabled, setTimestampsEnabled] = React.useState(storedTimestampsEnabled);
  const targetRef = React.useRef<FileDictationTarget | null>(null);
  const lastTargetRef = React.useRef<FileDictationTarget | null>(null);
  const timestampsEnabledRef = React.useRef(timestampsEnabled);
  timestampsEnabledRef.current = timestampsEnabled;
  const microphoneOwner = React.useSyncExternalStore(
    browserMicrophoneCoordinator.subscribe,
    browserMicrophoneCoordinator.getSnapshot,
    browserMicrophoneCoordinator.getSnapshot,
  );

  const onTranscript = React.useCallback(
    async (text: string, _deliveryId: string, route: string | null): Promise<boolean> => {
      const currentTarget = targetRef.current;
      if (!currentTarget || route !== fileDictationTargetKey(currentTarget)) return false;
      const line = formatFileDictationLine(
        text,
        timestampsEnabledRef.current ? new Date() : null,
      );
      if (!line) return true;
      setSaving(true);
      try {
        const saved = await currentTarget.appendLine(line);
        if (!saved) {
          throw new Error(`The dictated thought could not be saved to ${currentTarget.name}.`);
        }
        setSaved(true);
        return true;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const {
    status,
    pendingCount,
    durationMillis,
    getStatus,
    start: startVoice,
    stop: stopVoice,
    togglePause,
  } = useContinuousChatVoice({
    resetKey: 'global-file-dictation',
    onTranscript,
    onError: setError,
    routeKey: () => {
      const currentTarget = targetRef.current;
      return currentTarget ? fileDictationTargetKey(currentTarget) : null;
    },
    shouldCapture: () => targetRef.current !== null,
    microphoneOwner: 'file-dictation',
  });

  const start = React.useCallback(
    async (nextTarget: FileDictationTarget): Promise<boolean> => {
      if (getStatus() !== 'idle') return false;
      setError('');
      setSaved(false);
      targetRef.current = nextTarget;
      setTarget(nextTarget);
      const started = await startVoice();
      if (!started) {
        targetRef.current = null;
        setTarget(null);
      } else {
        lastTargetRef.current = nextTarget;
      }
      return started;
    },
    [getStatus, startVoice],
  );

  const finish = React.useCallback(async () => {
    await stopVoice();
    if (getStatus() !== 'idle') return;
    targetRef.current = null;
    setTarget(null);
    setSaving(false);
  }, [getStatus, stopVoice]);

  const toggleTimestamps = React.useCallback(() => {
    setTimestampsEnabled((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TIMESTAMPS_STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const toggle = React.useCallback(async (): Promise<boolean> => {
    if (getStatus() !== 'idle' || targetRef.current) {
      await finish();
      return true;
    }
    const previousTarget = lastTargetRef.current;
    if (!previousTarget) return false;
    return await start(previousTarget);
  }, [finish, getStatus, start]);

  const openTarget = React.useCallback(() => {
    targetRef.current?.open();
  }, []);

  const value = React.useMemo<FileDictationContextValue>(
    () => ({
      status,
      pendingCount,
      durationMillis,
      saving,
      saved,
      error,
      microphoneOwner,
      target,
      timestampsEnabled,
      start,
      toggle,
      finish,
      togglePause,
      toggleTimestamps,
      openTarget,
    }),
    [
      error,
      finish,
      microphoneOwner,
      openTarget,
      saved,
      saving,
      start,
      target,
      timestampsEnabled,
      toggle,
      toggleTimestamps,
      durationMillis,
      pendingCount,
      status,
      togglePause,
    ],
  );

  return <FileDictationContext.Provider value={value}>{children}</FileDictationContext.Provider>;
}

export function useFileDictation(): FileDictationContextValue | null {
  return React.useContext(FileDictationContext);
}

export function fileDictationStatusLabel(
  status: ContinuousChatVoiceStatus,
  pendingCount: number,
  saving: boolean,
  saved: boolean,
): string {
  if (saving) return 'Saving…';
  if (status === 'starting') return 'Starting…';
  if (status === 'speech') return 'Speech detected';
  if (status === 'thought-pause') return 'Waiting for end of thought';
  if (status === 'paused') return `Paused${pendingCount ? ` · ${pendingCount} pending` : ''}`;
  if (status === 'recovering') return 'Reconnecting…';
  if (status === 'stopping') return `Finishing${pendingCount ? ` · ${pendingCount} pending` : ''}…`;
  if (status === 'error') return 'Needs attention';
  if (pendingCount) return `${pendingCount} pending`;
  if (saved) return 'Saved';
  return 'Listening';
}
