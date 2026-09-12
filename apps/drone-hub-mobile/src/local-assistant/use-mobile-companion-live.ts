import React from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { CompanionLiveConversation, connectCompanionLiveReplies, type CompanionClientController } from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';
import { MobileCompanionLiveConnection } from './MobileCompanionLiveConnection';
import { openMobileLiveAudio, prepareMobileLiveAudio } from './openMobileLiveAudio';
import { openMobileLiveControls, type MobileLiveControls, type LiveMediaAction } from './mobile-live-controls';
import type { MobileMicrophoneCoordinator } from './mobile-microphone-coordinator';

type State = { hasStarted: boolean; capturing: boolean; status: 'idle' | 'connecting' | 'listening' | 'paused' | 'error'; error: string; captions: string;
  backendModel: string; targetDeviceId: string; targetName: string; muted: boolean; queued: number };
type Session = { connection: MobileCompanionLiveConnection; conversation: CompanionLiveConversation; abort: AbortController; replies?: ReturnType<typeof connectCompanionLiveReplies>; muted: boolean };
type Target = { id: string; name: string; run: (prompt: string, signal: AbortSignal) => Promise<string> };

export function useMobileCompanionLive(microphoneCoordinator: MobileMicrophoneCoordinator, controller?: CompanionClientController) {
  const mesh = useMesh();
  const [state, setState] = React.useState<State>(EMPTY);
  const active = React.useRef<Session | null>(null);
  const preparing = React.useRef<AbortController | null>(null);
  const preparingReplies = React.useRef<ReturnType<typeof connectCompanionLiveReplies> | null>(null);
  const controls = React.useRef<MobileLiveControls | null>(null);
  const target = React.useRef<Target | null>(null);
  const cleanup = React.useRef<Promise<void>>(Promise.resolve());
  const pendingSetup = React.useRef<Promise<void>>(Promise.resolve());
  const mediaAction = React.useRef<(action: LiveMediaAction) => void>(() => {});

  const endConnection = React.useCallback(() => {
    preparing.current?.abort(); preparing.current = null;
    preparingReplies.current?.stop(); preparingReplies.current = null;
    const session = active.current; active.current = null;
    session?.replies?.stop();
    session?.abort.abort(); session?.conversation.stop();
    const released = session?.connection.close(); // Close GPT-Live immediately, before cues or native cleanup.
    cleanup.current = Promise.all([cleanup.current, pendingSetup.current, released]).then(() => undefined);
  }, []);
  const stop = React.useCallback(() => {
    endConnection(); target.current = null;
    const old = controls.current; controls.current = null;
    cleanup.current = cleanup.current.then(async () => {
      if (!old) return;
      await old.release();
    }).catch(() => undefined);
    setState((value) => ({ ...value, status: 'idle', capturing: false, error: '', queued: 0, muted: false }));
  }, [endConnection]);
  const pause = React.useCallback(() => {
    if (!target.current || (!active.current && !preparing.current)) return;
    endConnection();
    const current = controls.current;
    // Native control registration stays alive; the microphone and billable session do not.
    void current?.update('paused').catch(() => {
      if (controls.current === current && !active.current && !preparing.current) stop();
    });
    setState((value) => ({ ...value, status: 'paused', capturing: false, muted: false, queued: 0 }));
  }, [endConnection, stop]);
  const reset = React.useCallback(() => { stop(); setState(EMPTY); }, [stop]);
  React.useEffect(() => () => stop(), [stop]);

  const start = React.useCallback(async (targetDeviceId: string, targetName: string,
    runBackend: Target['run']) => {
    if (active.current || preparing.current) return;
    // Only a previously armed media session may restart from the lock screen.
    if (!controls.current && AppState.currentState !== 'active') return;
    const preparation = new AbortController(); preparing.current = preparation;
    const previousCleanup = cleanup.current;
    let setupSettled!: () => void;
    pendingSetup.current = new Promise((resolve) => { setupSettled = resolve; });
    setState({ ...EMPTY, hasStarted: true, status: 'connecting', targetDeviceId, targetName });
    let session!: Session;
    // Observe immediately: the backend can finish while previous audio is releasing
    // or native microphone setup is still pending. Flush only after Live is ready.
    const replies = controller ? connectCompanionLiveReplies(controller, {
      deliverBackendReply: (reply) => session.conversation.deliverBackendReply(reply),
    }) : undefined;
    preparingReplies.current = replies ?? null;
    try {
      await previousCleanup;
      if (preparation.signal.aborted) return;
      if (microphoneCoordinator.getSnapshot()) throw new Error('Another voice feature is using the microphone. Stop it before starting Live.');
      if (!controls.current) {
        await prepareMobileLiveAudio();
        if (preparation.signal.aborted) return;
        const opened = await openMobileLiveControls((action) => mediaAction.current(action));
        if (preparation.signal.aborted) { await opened.release(); return; }
        controls.current = opened;
      }
      target.current = { id: targetDeviceId, name: targetName, run: runBackend };
      const currentControls = controls.current;
      const update = (patch: Partial<State>) => {
        if (active.current === session) setState((value) => ({ ...value, ...patch }));
      };
      const connection = new MobileCompanionLiveConnection({
        targetDeviceId, sessionId: Crypto.randomUUID(), microphoneCoordinator,
        request: mesh.request, subscribe: mesh.subscribe, openLiveAudio: mesh.openLiveAudio,
        openAudio: (callbacks) => openMobileLiveAudio(callbacks, () => {
          if (active.current === session) stop();
        }, { backgroundAlreadyStarted: true, onCaptureStopped: () => currentControls.cue('stopped') }),
        onEvent: (event) => { if (active.current === session) session.conversation.receive(event); },
        onCapturing: () => {
          if (active.current !== session) return;
          update({ capturing: true });
          const failed = () => { if (active.current === session) stop(); };
          void currentControls.update('recording').catch(failed);
          // The recorder is already buffering when the start cue sounds, so
          // speech right after the cue is never lost while Live connects.
          void currentControls.cue('recording').catch(failed);
        },
        onReady: (backendModel) => {
          if (active.current !== session) return;
          session.replies?.ready();
          update({ status: 'listening', backendModel });
        },
        onError: (error) => {
          if (active.current !== session) return;
          stop(); setState((value) => ({ ...value, status: 'error', error }));
        },
      });
      const conversation = new CompanionLiveConversation({
        externalBackendReplies: Boolean(controller),
        runBackend: (prompt) => runBackend(prompt, session.abort.signal),
        send: (event) => connection.send(event),
        onTranscript: (rows) => update({ captions: rows.map((row) => `${row.role === 'user' ? 'You' : 'Companion'}: ${row.text}`).join('\n') }),
        onQueue: (queued) => update({ queued }),
      });
      session = { connection, conversation, abort: new AbortController(), muted: false };
      session.replies = replies;
      preparingReplies.current = null;
      active.current = session;
      setupSettled();
      void currentControls.update('connecting').catch(() => { if (active.current === session) stop(); });
      await connection.start();
    } catch (error) {
      if (!preparation.signal.aborted) {
        stop(); setState((value) => ({ ...value, status: 'error',
          error: error instanceof Error ? error.message : 'Could not prepare the microphone.' }));
      }
    } finally { setupSettled(); if (preparing.current === preparation) preparing.current = null; }
  }, [mesh.request, mesh.subscribe, mesh.openLiveAudio, microphoneCoordinator, controller, stop]);
  const resume = React.useCallback(async () => {
    const previous = target.current;
    if (previous) await start(previous.id, previous.name, previous.run);
  }, [start]);
  mediaAction.current = (action) => {
    if (action === 'play') void resume();
    else if (action === 'pause') pause();
    else if (action === 'stop') stop();
  };
  const toggleMute = React.useCallback(() => {
    const session = active.current;
    if (!session) return;
    session.muted = !session.muted; session.connection.mute(session.muted);
    setState((value) => ({ ...value, muted: session.muted }));
  }, []);
  return { ...state, start, stop, reset, pause, resume, toggleMute };
}

const EMPTY: State = { hasStarted: false, status: 'idle', capturing: false, error: '', captions: '', backendModel: '', targetDeviceId: '', targetName: '', muted: false, queued: 0 };
