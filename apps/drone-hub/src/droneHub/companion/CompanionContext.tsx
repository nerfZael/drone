import React from 'react';
import { useContinuousDictation } from '../chat/ContinuousDictationContext';
import { useChatVoiceRecorder } from '../chat/use-chat-voice-recorder';
import { useCompanionTargets } from './CompanionTargetsContext';
import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import {
  COMPANION_APP_CONTEXT_EVENT,
  COMPANION_HIGHLIGHT_DRONES_EVENT,
  COMPANION_PREPARE_DRAFT_EVENT,
  COMPANION_TOGGLE_EVENT,
  requestCompanionBrowserAction,
} from './companion-browser-events';

export type CompanionStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'transcribing'
  | 'working'
  | 'completed'
  | 'cancelled'
  | 'error';

export type CompanionToolActivity = {
  callId: string;
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  status: 'running' | 'completed' | 'failed';
};

type CompanionContextValue = {
  status: CompanionStatus;
  error: string;
  reply: string;
  transcript: string;
  durationMillis: number;
  startedAt: number | null;
  endedAt: number | null;
  activity: CompanionToolActivity[];
  toggle(): Promise<void>;
  close(): Promise<void>;
};

const CompanionContext = React.createContext<CompanionContextValue | null>(null);
const COMPANION_CONNECTION_TIMEOUT_MS = 10_000;

function newRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `companion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const continuousDictation = useContinuousDictation();
  const editorTargets = useCompanionTargets();
  const [status, setStatus] = React.useState<CompanionStatus>('idle');
  const [error, setError] = React.useState('');
  const [reply, setReply] = React.useState('');
  const [transcript, setTranscript] = React.useState('');
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [endedAt, setEndedAt] = React.useState<number | null>(null);
  const [activity, setActivity] = React.useState<CompanionToolActivity[]>([]);
  const statusRef = React.useRef<CompanionStatus>('idle');
  const socketRef = React.useRef<WebSocket | null>(null);
  const runIdRef = React.useRef('');
  const generationRef = React.useRef(0);

  const setStatusValue = React.useCallback((next: CompanionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const onVoiceError = React.useCallback((message: string) => {
    if (!message.trim()) return;
    setError(message);
    setStatusValue('error');
  }, [setStatusValue]);
  const voice = useChatVoiceRecorder({ onError: onVoiceError, microphoneOwner: 'companion' });

  const erase = React.useCallback(() => {
    setError('');
    setReply('');
    setTranscript('');
    setActivity([]);
    setStartedAt(null);
    setEndedAt(null);
    setStatusValue('idle');
  }, [setStatusValue]);

  const close = React.useCallback(async () => {
    generationRef.current += 1;
    const socket = socketRef.current;
    socketRef.current = null;
    const runId = runIdRef.current;
    runIdRef.current = '';
    if (socket?.readyState === WebSocket.OPEN && runId) {
      socket.send(JSON.stringify({ type: 'cancel_run', runId }));
    }
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
    await voice.discardRecording();
    erase();
  }, [erase, voice.discardRecording]);

  const executeBrowserTool = React.useCallback(async (tool: string, args: Record<string, unknown>) => {
    if (tool === 'get_app_context') {
      return await requestCompanionBrowserAction(COMPANION_APP_CONTEXT_EVENT, args);
    }
    if (tool === 'read_active_composer') {
      if (!continuousDictation) throw new Error('NO_ACTIVE_COMPOSER');
      return continuousDictation.readActiveComposer();
    }
    if (tool === 'apply_composer_patch') {
      if (!continuousDictation) throw new Error('NO_ACTIVE_COMPOSER');
      return continuousDictation.applyComposer(
        String(args.targetId ?? ''),
        String(args.baseRevision ?? ''),
        String(args.content ?? ''),
      );
    }
    if (tool === 'read_open_file') {
      if (!editorTargets) throw new Error('NO_OPEN_FILE');
      return editorTargets.readOpenFile();
    }
    if (tool === 'apply_editor_patch') {
      if (!editorTargets) throw new Error('NO_OPEN_FILE');
      return editorTargets.applyEditor(
        String(args.targetId ?? ''),
        String(args.baseRevision ?? ''),
        String(args.content ?? ''),
      );
    }
    if (tool === 'prepare_drone_draft') {
      return await requestCompanionBrowserAction(COMPANION_PREPARE_DRAFT_EVENT, args);
    }
    if (tool === 'highlight_drones') {
      return await requestCompanionBrowserAction(COMPANION_HIGHLIGHT_DRONES_EVENT, args);
    }
    throw new Error(`Unsupported Companion browser tool: ${tool}`);
  }, [continuousDictation, editorTargets]);

  const run = React.useCallback(async (prompt: string) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      erase();
      return;
    }
    const runId = newRunId();
    const localGeneration = generationRef.current + 1;
    generationRef.current = localGeneration;
    runIdRef.current = runId;
    setTranscript(cleanPrompt);
    setStartedAt(Date.now());
    setEndedAt(null);
    setActivity([]);
    setStatusValue('working');
    let socket: WebSocket;
    try {
      socket = new WebSocket(buildDirectApiWebSocketUrl('/api/companion/stream'));
    } catch (socketError) {
      setError(socketError instanceof Error ? socketError.message : 'Companion could not connect to Drone Hub.');
      setEndedAt(Date.now());
      setStatusValue('error');
      return;
    }
    socketRef.current = socket;
    let connectionTimer: number | null = window.setTimeout(() => {
      if (generationRef.current !== localGeneration || socket.readyState === WebSocket.OPEN) return;
      setError('Companion could not connect to Drone Hub.');
      setEndedAt(Date.now());
      setStatusValue('error');
      if (socketRef.current === socket) socketRef.current = null;
      try {
        socket.close();
      } catch {
        // The browser may reject closing a socket that has not started connecting.
      }
    }, COMPANION_CONNECTION_TIMEOUT_MS);
    const clearConnectionTimer = () => {
      if (connectionTimer == null) return;
      window.clearTimeout(connectionTimer);
      connectionTimer = null;
    };
    const finishSocket = () => {
      clearConnectionTimer();
      if (socketRef.current === socket) socketRef.current = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    };
    socket.onopen = () => {
      clearConnectionTimer();
      if (
        generationRef.current !== localGeneration ||
        socketRef.current !== socket ||
        statusRef.current !== 'working'
      ) {
        finishSocket();
        return;
      }
      socket.send(JSON.stringify({ type: 'start_run', runId, prompt: cleanPrompt }));
    };
    socket.onmessage = (event) => {
      if (generationRef.current !== localGeneration || typeof event.data !== 'string') return;
      let message: any;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.runId && message.runId !== runId) return;
      if (message.type === 'tool_call') {
        const messageGeneration = Number(message.generation);
        void executeBrowserTool(String(message.tool ?? ''), message.args ?? {}).then((result) => {
          if (generationRef.current !== localGeneration || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: 'tool_result', runId, generation: messageGeneration, callId: message.callId, ok: true, result }));
        }).catch((toolError) => {
          if (generationRef.current !== localGeneration || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: 'tool_result', runId, generation: messageGeneration, callId: message.callId, ok: false, error: toolError instanceof Error ? toolError.message : String(toolError) }));
        });
        return;
      }
      if (message.type === 'activity') {
        const runtimeEvent = message.event ?? {};
        const type = String(runtimeEvent.type ?? '');
        if (type === 'tool_call_started') {
          setActivity((current) => {
            const callId = String(runtimeEvent.callId);
            if (current.some((item) => item.callId === callId)) return current;
            return [...current, { callId, tool: String(runtimeEvent.tool), args: runtimeEvent.args, status: 'running' }];
          });
        } else if (type === 'tool_call_completed' || type === 'tool_call_failed') {
          setActivity((current) => {
            const callId = String(runtimeEvent.callId);
            const status = type === 'tool_call_completed' ? 'completed' : 'failed';
            const existing = current.find((item) => item.callId === callId);
            if (!existing) {
              return [...current, {
                callId,
                tool: String(runtimeEvent.tool ?? 'tool'),
                args: runtimeEvent.args,
                result: runtimeEvent.result,
                error: runtimeEvent.error,
                status,
              }];
            }
            return current.map((item) => item.callId === callId
              ? { ...item, status, result: runtimeEvent.result, error: runtimeEvent.error }
              : item);
          });
        }
        return;
      }
      if (message.type === 'reply') setReply(String(message.reply ?? ''));
      if (message.type === 'status' && message.status === 'completed') {
        setEndedAt(Date.now());
        setStatusValue('completed');
        finishSocket();
      } else if (message.type === 'status' && message.status === 'cancelled') {
        setEndedAt(Date.now());
        setStatusValue('cancelled');
        finishSocket();
      } else if (message.type === 'error') {
        setError(String(message.error ?? 'Companion failed.'));
        setEndedAt(Date.now());
        setStatusValue('error');
        finishSocket();
      }
    };
    socket.onerror = () => {
      if (
        generationRef.current !== localGeneration ||
        ['completed', 'cancelled', 'error', 'idle'].includes(statusRef.current)
      ) return;
      setError('Companion could not connect to Drone Hub.');
      setEndedAt(Date.now());
      setStatusValue('error');
      finishSocket();
    };
    socket.onclose = () => {
      clearConnectionTimer();
      if (socketRef.current === socket) socketRef.current = null;
      if (generationRef.current !== localGeneration || ['completed', 'cancelled', 'error', 'idle'].includes(statusRef.current)) return;
      setError('Companion disconnected before the run finished.');
      setEndedAt(Date.now());
      setStatusValue('error');
    };
  }, [erase, executeBrowserTool, setStatusValue]);

  const toggle = React.useCallback(async () => {
    const current = statusRef.current;
    if (current === 'starting' || current === 'transcribing' || current === 'working') return;
    if (current === 'recording') {
      const stopGeneration = generationRef.current;
      setStatusValue('transcribing');
      const text = await voice.stopRecordingForTranscript();
      if (generationRef.current !== stopGeneration) return;
      if (statusRef.current === 'error') return;
      await run(text);
      return;
    }
    if (current !== 'idle') await close();
    setStatusValue('starting');
    const started = await voice.startRecording();
    if (started) setStatusValue('recording');
    else if (statusRef.current !== 'error') erase();
  }, [close, erase, run, setStatusValue, voice.startRecording, voice.stopRecordingForTranscript]);

  const toggleRef = React.useRef(toggle);
  toggleRef.current = toggle;
  React.useEffect(() => {
    const onToggle = () => void toggleRef.current();
    window.addEventListener(COMPANION_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(COMPANION_TOGGLE_EVENT, onToggle);
  }, []);
  React.useEffect(() => () => {
    generationRef.current += 1;
    socketRef.current?.close();
    void voice.discardRecording();
  }, [voice.discardRecording]);

  const value = React.useMemo<CompanionContextValue>(() => ({
    status,
    error,
    reply,
    transcript,
    durationMillis: voice.durationMillis,
    startedAt,
    endedAt,
    activity,
    toggle,
    close,
  }), [activity, close, endedAt, error, reply, startedAt, status, toggle, transcript, voice.durationMillis]);

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue | null {
  return React.useContext(CompanionContext);
}
