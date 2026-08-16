import React from 'react';
import {
  reduceCompanionToolActivity,
  type CompanionBrowserToolName,
  type CompanionClientTelemetry,
  type CompanionServerMessage,
  type CompanionStatus,
  type CompanionToolActivity,
} from '@drone/assistant-chat';
import { useChatVoiceRecorder } from '../chat/use-chat-voice-recorder';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';
import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import { shouldCancelCompanionRecordingWithEscape } from './companion-shortcut';

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
  const workspace = useCompanionWorkspace();
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
  const pendingPromptsRef = React.useRef<Array<{
    prompt: string;
    messageId: string;
    telemetry?: CompanionClientTelemetry;
  }>>([]);
  const generationRef = React.useRef(0);

  const setStatusValue = React.useCallback((next: CompanionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const onVoiceError = React.useCallback((message: string) => {
    if (!message.trim()) return;
    setError(message);
    if (!runIdRef.current) setStatusValue('error');
  }, [setStatusValue]);
  const voice = useChatVoiceRecorder({ onError: onVoiceError, microphoneOwner: 'companion' });
  const voiceStatusRef = React.useRef(voice.status);
  const discardVoiceRecordingRef = React.useRef(voice.discardRecording);
  voiceStatusRef.current = voice.status;
  discardVoiceRecordingRef.current = voice.discardRecording;

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
    pendingPromptsRef.current = [];
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

  React.useLayoutEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (!shouldCancelCompanionRecordingWithEscape({
        key: event.key,
        repeat: event.repeat,
        isComposing: event.isComposing,
        voiceStatus: voiceStatusRef.current,
      })) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void discardVoiceRecordingRef.current();
    };
    window.addEventListener('keydown', cancelOnEscape, { capture: true });
    return () => window.removeEventListener('keydown', cancelOnEscape, { capture: true });
  }, []);

  const executeBrowserTool = React.useCallback(async (tool: CompanionBrowserToolName, args: Record<string, unknown>) => {
    if (tool === 'get_app_context') {
      if (!workspace) throw new Error('NO_ACTIVE_WORKSPACE');
      return workspace.getAppContext();
    }
    if (tool === 'read_active_composer') {
      if (!workspace) throw new Error('NO_ACTIVE_COMPOSER');
      return workspace.readActiveComposer();
    }
    if (tool === 'apply_composer_patch') {
      if (!workspace) throw new Error('NO_ACTIVE_COMPOSER');
      return workspace.applyComposer(
        String(args.targetId ?? ''),
        String(args.baseRevision ?? ''),
        String(args.content ?? ''),
      );
    }
    if (tool === 'read_open_file') {
      if (!workspace) throw new Error('NO_OPEN_FILE');
      return workspace.readOpenFile();
    }
    if (tool === 'apply_editor_patch') {
      if (!workspace) throw new Error('NO_OPEN_FILE');
      return workspace.applyEditor(
        String(args.targetId ?? ''),
        String(args.baseRevision ?? ''),
        String(args.content ?? ''),
      );
    }
    if (tool === 'prepare_drone_draft') {
      if (!workspace) throw new Error('NO_ACTIVE_WORKSPACE');
      return await workspace.prepareDroneDraft(args);
    }
    if (tool === 'open_drone_chat') {
      if (!workspace) throw new Error('NO_ACTIVE_WORKSPACE');
      return await workspace.openDroneChat(args);
    }
    if (tool === 'highlight_drones') {
      if (!workspace) throw new Error('NO_ACTIVE_WORKSPACE');
      return await workspace.highlightDrones(args);
    }
    throw new Error(`Unsupported Companion browser tool: ${tool}`);
  }, [workspace]);

  const run = React.useCallback(async (
    prompt: string,
    telemetry?: CompanionClientTelemetry,
    requestedMessageId?: string,
  ) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;
    const runId = runIdRef.current || newRunId();
    const messageId = requestedMessageId || newRunId();
    runIdRef.current = runId;
    setTranscript(cleanPrompt);
    setStartedAt((current) => current ?? Date.now());
    setEndedAt(null);
    setError('');
    setStatusValue('working');
    const existingSocket = socketRef.current;
    if (existingSocket?.readyState === WebSocket.OPEN) {
      existingSocket.send(
        JSON.stringify({
          type: 'start_run',
          runId,
          messageId,
          prompt: cleanPrompt,
          telemetry: { ...telemetry, version: 1, connectionMs: 0, connectionReused: true },
        }),
      );
      return;
    }
    pendingPromptsRef.current.push({ prompt: cleanPrompt, messageId, telemetry });
    if (existingSocket?.readyState === WebSocket.CONNECTING) return;

    const localGeneration = generationRef.current + 1;
    generationRef.current = localGeneration;
    let socket: WebSocket;
    const connectionStartedAt = performance.now();
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
      const connectionMs = Math.max(0, performance.now() - connectionStartedAt);
      const pendingPrompts = pendingPromptsRef.current.splice(0);
      for (const pendingPrompt of pendingPrompts) {
        socket.send(
          JSON.stringify({
            type: 'start_run',
            runId,
            messageId: pendingPrompt.messageId,
            prompt: pendingPrompt.prompt,
            telemetry: {
              ...pendingPrompt.telemetry,
              version: 1,
              connectionMs,
              connectionReused: false,
            },
          }),
        );
      }
    };
    socket.onmessage = (event) => {
      if (generationRef.current !== localGeneration || typeof event.data !== 'string') return;
      let message: CompanionServerMessage;
      try {
        message = JSON.parse(event.data) as CompanionServerMessage;
      } catch {
        return;
      }
      if (message.runId && message.runId !== runId) return;
      if (message.type === 'tool_call') {
        const messageGeneration = Number(message.generation);
        void executeBrowserTool(message.tool, message.args ?? {}).then((result) => {
          if (generationRef.current !== localGeneration || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: 'tool_result', runId, generation: messageGeneration, callId: message.callId, ok: true, result }));
        }).catch((toolError) => {
          if (generationRef.current !== localGeneration || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: 'tool_result', runId, generation: messageGeneration, callId: message.callId, ok: false, error: toolError instanceof Error ? toolError.message : String(toolError) }));
        });
        return;
      }
      if (message.type === 'activity') {
        setActivity((current) => reduceCompanionToolActivity(current, message.event));
        return;
      }
      if (message.type === 'reply') setReply(String(message.reply ?? ''));
      if (message.type === 'status' && message.status === 'completed') {
        setEndedAt(Date.now());
        setStatusValue('completed');
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
  }, [executeBrowserTool, setStatusValue]);

  const toggle = React.useCallback(async () => {
    if (voice.status === 'starting' || voice.status === 'transcribing') return;
    if (voice.status === 'recording') {
      const stopGeneration = generationRef.current;
      const messageId = newRunId();
      const audioDurationMs = voice.durationMillis;
      const transcriptionStartedAt = performance.now();
      const text = await voice.stopRecordingForTranscript({ telemetryId: messageId });
      const transcriptionMs = Math.max(0, performance.now() - transcriptionStartedAt);
      if (generationRef.current !== stopGeneration) return;
      if (statusRef.current === 'error') return;
      await run(
        text,
        { version: 1, transcriptionMs, audioDurationMs },
        messageId,
      );
      return;
    }
    if (statusRef.current === 'cancelled' || statusRef.current === 'error') await close();
    const started = await voice.startRecording();
    if (!started && statusRef.current !== 'error' && !runIdRef.current) erase();
  }, [
    close,
    erase,
    run,
    voice.durationMillis,
    voice.startRecording,
    voice.status,
    voice.stopRecordingForTranscript,
  ]);

  React.useEffect(() => () => {
    generationRef.current += 1;
    socketRef.current?.close();
    void voice.discardRecording();
  }, [voice.discardRecording]);

  const effectiveStatus: CompanionStatus =
    voice.status === 'paused'
      ? 'recording'
      : voice.status !== 'idle'
        ? voice.status
        : status;

  const value = React.useMemo<CompanionContextValue>(() => ({
    status: effectiveStatus,
    error,
    reply,
    transcript,
    durationMillis: voice.durationMillis,
    startedAt,
    endedAt,
    activity,
    toggle,
    close,
  }), [activity, close, effectiveStatus, endedAt, error, reply, startedAt, toggle, transcript, voice.durationMillis]);

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue | null {
  return React.useContext(CompanionContext);
}
