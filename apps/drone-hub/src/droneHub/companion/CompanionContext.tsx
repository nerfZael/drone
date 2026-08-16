import React from 'react';
import {
  CompanionClientController,
  executeCompanionBrowserTool,
  type CompanionBrowserToolName,
  type CompanionClientTelemetry,
  type CompanionStatus,
  type CompanionToolActivity,
} from '@drone/assistant-chat';

import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import { useChatVoiceRecorder } from '../chat/use-chat-voice-recorder';
import { shouldCancelCompanionRecordingWithEscape } from './companion-shortcut';
import { createCompanionWebSocketTransport } from './companion-websocket-transport';
import { useCompanionWorkspace } from './CompanionWorkspaceContext';

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

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `companion-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const workspace = useCompanionWorkspace();
  const controllerRef = React.useRef<CompanionClientController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CompanionClientController({ createId: newId });
  }
  const controller = controllerRef.current;
  const state = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const onVoiceError = React.useCallback(
    (message: string) => controller.reportVoiceError(message),
    [controller],
  );
  const voice = useChatVoiceRecorder({ onError: onVoiceError, microphoneOwner: 'companion' });
  const voiceStatusRef = React.useRef(voice.status);
  const discardVoiceRecordingRef = React.useRef(voice.discardRecording);
  voiceStatusRef.current = voice.status;
  discardVoiceRecordingRef.current = voice.discardRecording;

  const close = React.useCallback(async () => {
    await controller.close();
    await voice.discardRecording();
  }, [controller, voice.discardRecording]);

  React.useLayoutEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (
        !shouldCancelCompanionRecordingWithEscape({
          key: event.key,
          repeat: event.repeat,
          isComposing: event.isComposing,
          voiceStatus: voiceStatusRef.current,
        })
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void discardVoiceRecordingRef.current();
    };
    window.addEventListener('keydown', cancelOnEscape, { capture: true });
    return () => window.removeEventListener('keydown', cancelOnEscape, { capture: true });
  }, []);

  const executeBrowserTool = React.useCallback(
    async (tool: CompanionBrowserToolName, args: Record<string, unknown>) => {
      if (!workspace) {
        if (tool === 'read_active_composer' || tool === 'apply_composer_patch') {
          throw new Error('NO_ACTIVE_COMPOSER');
        }
        if (tool === 'read_open_file' || tool === 'apply_editor_patch') {
          throw new Error('NO_OPEN_FILE');
        }
        throw new Error('NO_ACTIVE_WORKSPACE');
      }
      return await executeCompanionBrowserTool(workspace, tool, args);
    },
    [workspace],
  );

  const run = React.useCallback(
    async (prompt: string, telemetry?: CompanionClientTelemetry, requestedMessageId?: string) => {
      await controller.submitPrompt({
        prompt,
        telemetry,
        messageId: requestedMessageId,
        createTransport: () =>
          createCompanionWebSocketTransport(buildDirectApiWebSocketUrl('/api/companion/stream')),
        executeTool: executeBrowserTool,
      });
    },
    [controller, executeBrowserTool],
  );

  const toggle = React.useCallback(async () => {
    if (voice.status === 'starting' || voice.status === 'transcribing') return;
    if (voice.status === 'recording') {
      const token = controller.getToken();
      const messageId = newId();
      const audioDurationMs = voice.durationMillis;
      const transcriptionStartedAt = performance.now();
      const text = await voice.stopRecordingForTranscript({ telemetryId: messageId });
      const transcriptionMs = Math.max(0, performance.now() - transcriptionStartedAt);
      if (!controller.isCurrent(token) || controller.getSnapshot().status === 'error') return;
      await run(text, { version: 1, transcriptionMs, audioDurationMs }, messageId);
      return;
    }
    const status = controller.getSnapshot().status;
    if (status === 'cancelled' || status === 'error') await close();
    const started = await voice.startRecording();
    if (!started && controller.getSnapshot().status !== 'error') controller.resetIfNoSession();
  }, [close, controller, run, voice]);

  React.useEffect(
    () => () => {
      void controller.close();
      void voice.discardRecording();
    },
    [controller, voice.discardRecording],
  );

  const effectiveStatus: CompanionStatus =
    voice.status === 'paused' ? 'recording' : voice.status !== 'idle' ? voice.status : state.status;

  const value = React.useMemo<CompanionContextValue>(
    () => ({
      ...state,
      status: effectiveStatus,
      durationMillis: voice.durationMillis,
      toggle,
      close,
    }),
    [close, effectiveStatus, state, toggle, voice.durationMillis],
  );

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue | null {
  return React.useContext(CompanionContext);
}
