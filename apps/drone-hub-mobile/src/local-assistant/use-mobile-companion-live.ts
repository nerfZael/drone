import React from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { CompanionLiveConversation } from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';
import { MobileCompanionLiveConnection } from './MobileCompanionLiveConnection';
import { openMobileLiveAudio } from './openMobileLiveAudio';
import type { MobileMicrophoneCoordinator } from './mobile-microphone-coordinator';

type State = { status: 'idle' | 'connecting' | 'listening' | 'error'; error: string; captions: string;
  backendModel: string; targetDeviceId: string; targetName: string; muted: boolean; queued: number };
type Session = { connection: MobileCompanionLiveConnection; conversation: CompanionLiveConversation; abort: AbortController; muted: boolean };

export function useMobileCompanionLive(microphoneCoordinator: MobileMicrophoneCoordinator) {
  const mesh = useMesh();
  const [state, setState] = React.useState<State>(EMPTY);
  const active = React.useRef<Session | null>(null);
  const stop = React.useCallback(() => {
    const session = active.current;
    active.current = null;
    session?.abort.abort(); session?.conversation.stop(); session?.connection.close();
    setState((value) => ({ ...value, status: 'idle', error: '', queued: 0, muted: false }));
  }, []);
  const reset = React.useCallback(() => { stop(); setState(EMPTY); }, [stop]);
  React.useEffect(() => {
    const listener = AppState.addEventListener('change', (status) => { if (status === 'background') stop(); });
    return () => { listener.remove(); stop(); };
  }, [stop]);
  const start = React.useCallback(async (targetDeviceId: string, targetName: string,
    runBackend: (prompt: string, signal: AbortSignal) => Promise<string>) => {
    if (active.current || AppState.currentState !== 'active') return;
    setState({ ...EMPTY, status: 'connecting', targetDeviceId, targetName });
    let session!: Session;
    const update = (patch: Partial<State>) => {
      if (active.current === session) setState((value) => ({ ...value, ...patch }));
    };
    const connection = new MobileCompanionLiveConnection({
      targetDeviceId, sessionId: Crypto.randomUUID(), microphoneCoordinator,
      request: mesh.request, subscribe: mesh.subscribe, openAudio: openMobileLiveAudio,
      onEvent: (event) => { if (active.current === session) session.conversation.receive(event); },
      onReady: (backendModel) => update({ status: 'listening', backendModel }),
      onError: (error) => {
        if (active.current !== session) return;
        session.abort.abort(); session.conversation.stop();
        update({ status: 'error', error, queued: 0 });
        active.current = null;
      },
    });
    const conversation = new CompanionLiveConversation({
      runBackend: (prompt) => runBackend(prompt, session.abort.signal),
      send: (event) => connection.send(event),
      onTranscript: (rows) => update({ captions: rows.map((row) => `${row.role === 'user' ? 'You' : 'Companion'}: ${row.text}`).join('\n') }),
      onQueue: (queued) => update({ queued }),
    });
    session = { connection, conversation, abort: new AbortController(), muted: false };
    active.current = session;
    await connection.start();
  }, [mesh.request, mesh.subscribe, microphoneCoordinator]);
  const toggleMute = React.useCallback(() => {
    const session = active.current;
    if (!session) return;
    session.muted = !session.muted;
    session.connection.mute(session.muted);
    setState((value) => ({ ...value, muted: session.muted }));
  }, []);
  return { ...state, start, stop, reset, toggleMute };
}

const EMPTY: State = { status: 'idle', error: '', captions: '', backendModel: '', targetDeviceId: '', targetName: '', muted: false, queued: 0 };
