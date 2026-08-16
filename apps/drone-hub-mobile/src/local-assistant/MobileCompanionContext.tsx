import React from 'react';
import * as Crypto from 'expo-crypto';
import { COMPANION_CAPABILITY, isGranted, type CapabilityEvent } from '@drone/device-protocol';
import {
  reduceCompanionToolActivity,
  type CompanionBrowserToolName,
  type CompanionClientTelemetry,
  type CompanionStatus,
  type CompanionTextSnapshot,
  type CompanionToolActivity,
} from '@drone/assistant-chat';

import { useMesh } from '../mesh/MeshContext';
import { useSharedMobileChatVoiceRecorder } from './MobileChatVoiceRecorderContext';

export type MobileCompanionEditorTarget = {
  id: string;
  isEligible(): boolean;
  read(): CompanionTextSnapshot;
  apply(baseRevision: string, content: string): { ok: true; revision: string };
};

export type MobileCompanionWorkspaceTarget = {
  targetDeviceId: string;
  targetName: string;
  reachable: boolean;
  getAppContext(): Record<string, unknown>;
  readComposer(): CompanionTextSnapshot;
  applyComposer(
    targetId: string,
    baseRevision: string,
    content: string,
  ): { ok: true; revision: string };
  prepareDroneDraft(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  highlightDrones(args: Record<string, unknown>): Record<string, unknown>;
};

type MobileCompanionContextValue = {
  status: CompanionStatus;
  error: string;
  reply: string;
  transcript: string;
  durationMillis: number;
  startedAt: number | null;
  endedAt: number | null;
  activity: CompanionToolActivity[];
  available: boolean;
  unavailableReason: string;
  toggle(): Promise<void>;
  close(): Promise<void>;
  registerWorkspaceTarget(target: MobileCompanionWorkspaceTarget): () => void;
  registerEditorTarget(target: MobileCompanionEditorTarget): () => void;
};

const MobileCompanionContext = React.createContext<MobileCompanionContextValue | null>(null);

function newRunId(): string {
  return Crypto.randomUUID();
}

export function MobileCompanionProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const voice = useSharedMobileChatVoiceRecorder();
  const workspaceTargetRef = React.useRef<MobileCompanionWorkspaceTarget | null>(null);
  const editorTargetsRef = React.useRef(new Map<string, MobileCompanionEditorTarget>());
  const focusedEditorIdRef = React.useRef<string | null>(null);
  const [targetRevision, setTargetRevision] = React.useState(0);
  const [status, setStatus] = React.useState<CompanionStatus>('idle');
  const [error, setError] = React.useState('');
  const [reply, setReply] = React.useState('');
  const [transcript, setTranscript] = React.useState('');
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [endedAt, setEndedAt] = React.useState<number | null>(null);
  const [activity, setActivity] = React.useState<CompanionToolActivity[]>([]);
  const statusRef = React.useRef<CompanionStatus>('idle');
  const runIdRef = React.useRef('');
  const runTargetDeviceIdRef = React.useRef('');
  const generationRef = React.useRef(0);

  const setStatusValue = React.useCallback((next: CompanionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const registerWorkspaceTarget = React.useCallback((target: MobileCompanionWorkspaceTarget) => {
    workspaceTargetRef.current = target;
    setTargetRevision((value) => value + 1);
    return () => {
      if (workspaceTargetRef.current !== target) return;
      workspaceTargetRef.current = null;
      setTargetRevision((value) => value + 1);
    };
  }, []);

  const registerEditorTarget = React.useCallback((target: MobileCompanionEditorTarget) => {
    editorTargetsRef.current.set(target.id, target);
    focusedEditorIdRef.current = target.id;
    return () => {
      if (editorTargetsRef.current.get(target.id) !== target) return;
      editorTargetsRef.current.delete(target.id);
      if (focusedEditorIdRef.current === target.id) focusedEditorIdRef.current = null;
    };
  }, []);

  const target = workspaceTargetRef.current;
  const targetCapability = target
    ? mesh.profile?.capabilitiesByDevice[target.targetDeviceId]?.find(
        (capability) =>
          capability.id === COMPANION_CAPABILITY.id &&
          capability.version === COMPANION_CAPABILITY.version,
      )
    : undefined;
  const selfDevice = mesh.devices.find((device) => device.id === mesh.identity?.id);
  const hasOperations = COMPANION_CAPABILITY.operations.every((operation) =>
    targetCapability?.operations.includes(operation),
  );
  const hasGrant = Boolean(
    selfDevice &&
    COMPANION_CAPABILITY.operations.every((operation) =>
      isGranted(
        selfDevice.grants,
        COMPANION_CAPABILITY.id,
        COMPANION_CAPABILITY.version,
        operation,
      ),
    ),
  );
  const available = Boolean(target && target.reachable && hasOperations && hasGrant);
  const unavailableReason = !target
    ? 'Open Drone Hub before starting Companion.'
    : !target.reachable
      ? `${target.targetName} is offline.`
      : !hasOperations
        ? `${target.targetName} does not support mobile Companion yet.`
        : !hasGrant
          ? `Allow Companion for this phone in ${target.targetName} device settings.`
          : '';
  void targetRevision;

  const erase = React.useCallback(() => {
    runIdRef.current = '';
    runTargetDeviceIdRef.current = '';
    setError('');
    setReply('');
    setTranscript('');
    setActivity([]);
    setStartedAt(null);
    setEndedAt(null);
    setStatusValue('idle');
  }, [setStatusValue]);

  const resolveEditor = React.useCallback(() => {
    const focused = focusedEditorIdRef.current
      ? editorTargetsRef.current.get(focusedEditorIdRef.current)
      : null;
    if (focused?.isEligible()) return focused;
    const eligible = [...editorTargetsRef.current.values()].filter((item) => item.isEligible());
    if (eligible.length === 0) throw new Error('NO_OPEN_FILE');
    return eligible[eligible.length - 1]!;
  }, []);

  const executeMobileTool = React.useCallback(
    async (tool: CompanionBrowserToolName, args: Record<string, unknown>) => {
      const activeTarget = workspaceTargetRef.current;
      if (!activeTarget) throw new Error('NO_ACTIVE_MOBILE_CONTEXT');
      if (activeTarget.targetDeviceId !== runTargetDeviceIdRef.current) {
        throw new Error('STALE_MOBILE_CONTEXT');
      }
      if (tool === 'get_app_context') return activeTarget.getAppContext();
      if (tool === 'read_active_composer') return activeTarget.readComposer();
      if (tool === 'apply_composer_patch') {
        return activeTarget.applyComposer(
          String(args.targetId ?? ''),
          String(args.baseRevision ?? ''),
          String(args.content ?? ''),
        );
      }
      if (tool === 'read_open_file') return resolveEditor().read();
      if (tool === 'apply_editor_patch') {
        const targetId = String(args.targetId ?? '');
        const editor = resolveEditor();
        if (editor.id !== targetId) throw new Error('STALE_EDITOR_TARGET');
        return editor.apply(String(args.baseRevision ?? ''), String(args.content ?? ''));
      }
      if (tool === 'prepare_drone_draft') return await activeTarget.prepareDroneDraft(args);
      if (tool === 'highlight_drones') return activeTarget.highlightDrones(args);
      throw new Error(`Unsupported Companion mobile tool: ${tool}`);
    },
    [resolveEditor],
  );

  const close = React.useCallback(async () => {
    generationRef.current += 1;
    const runId = runIdRef.current;
    const targetDeviceId = runTargetDeviceIdRef.current;
    runIdRef.current = '';
    runTargetDeviceIdRef.current = '';
    if (runId && targetDeviceId) {
      void mesh
        .request(targetDeviceId, COMPANION_CAPABILITY.id, 'run.cancel', { runId })
        .catch(() => undefined);
    }
    await voice.discardRecording();
    erase();
  }, [erase, mesh.request, voice.discardRecording]);

  React.useEffect(() => {
    const runTargetDeviceId = runTargetDeviceIdRef.current;
    if (!runTargetDeviceId) return;
    const activeTarget = workspaceTargetRef.current;
    if (
      !activeTarget ||
      activeTarget.targetDeviceId !== runTargetDeviceId ||
      !activeTarget.reachable ||
      !hasOperations ||
      !hasGrant
    ) {
      void close();
    }
  }, [close, hasGrant, hasOperations, targetRevision]);

  const run = React.useCallback(
    async (
      prompt: string,
      telemetry?: CompanionClientTelemetry,
      requestedMessageId?: string,
    ) => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt) return;
      const activeTarget = workspaceTargetRef.current;
      if (!activeTarget) {
        setError('Open Drone Hub before starting Companion.');
        setStatusValue('error');
        return;
      }
      const runId = runIdRef.current || newRunId();
      const messageId = requestedMessageId || newRunId();
      const generation = generationRef.current;
      runIdRef.current = runId;
      runTargetDeviceIdRef.current = activeTarget.targetDeviceId;
      setTranscript(cleanPrompt);
      setStartedAt((current) => current ?? Date.now());
      setEndedAt(null);
      setError('');
      setStatusValue('working');
      try {
        await mesh.request(activeTarget.targetDeviceId, COMPANION_CAPABILITY.id, 'run.start', {
          runId,
          messageId,
          prompt: cleanPrompt,
          telemetry,
        });
      } catch (nextError: any) {
        if (generationRef.current !== generation) return;
        setError(String(nextError?.message ?? nextError ?? 'Companion could not start.'));
        setEndedAt(Date.now());
        setStatusValue('error');
      }
    },
    [mesh.request, setStatusValue],
  );

  const toggle = React.useCallback(async () => {
    if (voice.status === 'starting' || voice.status === 'transcribing') return;
    if (voice.status === 'recording') {
      const generation = generationRef.current;
      const messageId = newRunId();
      const audioDurationMs = voice.durationMillis;
      const transcriptionStartedAt = performance.now();
      const text = await voice.stopRecordingForTranscript();
      const transcriptionMs = Math.max(0, performance.now() - transcriptionStartedAt);
      if (generationRef.current !== generation) return;
      if (!text.trim()) {
        const voiceError = voice.getError();
        if (voiceError) {
          setError(voiceError);
          if (!runIdRef.current) setStatusValue('error');
        }
        return;
      }
      await run(
        text,
        { version: 1, transcriptionMs, audioDurationMs },
        messageId,
      );
      return;
    }
    if (statusRef.current === 'cancelled' || statusRef.current === 'error') await close();
    const activeTarget = workspaceTargetRef.current;
    if (!activeTarget || !activeTarget.reachable) {
      setError(unavailableReason || 'Companion is unavailable.');
      setStatusValue('error');
      return;
    }
    if (!available) {
      setError(unavailableReason);
      setStatusValue('error');
      return;
    }
    if (voice.microphoneOwner || voice.status !== 'idle') {
      setError(
        voice.microphoneOwner === 'continuous'
          ? 'Continuous voice is already using the microphone.'
          : 'A voice message is already using the microphone.',
      );
      setStatusValue('error');
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    runTargetDeviceIdRef.current = activeTarget.targetDeviceId;
    voice.setError('');
    setError('');
    const started = await voice.startRecording('companion');
    if (generationRef.current !== generation) return;
    if (!started) {
      setError(
        voice.getError() || 'The microphone could not start. Check microphone and Groq settings.',
      );
      if (!runIdRef.current) setStatusValue('error');
    }
  }, [available, close, erase, run, setStatusValue, unavailableReason, voice]);

  React.useEffect(() => {
    if (
      !voice.error.trim() ||
      !['starting', 'recording', 'stopped', 'transcribing'].includes(voice.status)
    ) {
      return;
    }
    setError(voice.error);
    if (!runIdRef.current) setStatusValue('error');
  }, [setStatusValue, voice.error, voice.status]);

  React.useEffect(() => {
    const onRunEvent = (event: CapabilityEvent) => {
      const payload = event.payload ?? {};
      const runId = String(payload.runId ?? '');
      if (
        !runId ||
        runId !== runIdRef.current ||
        event.sourceDeviceId !== runTargetDeviceIdRef.current
      ) {
        return;
      }
      const generation = generationRef.current;
      const type = String(payload.type ?? '');
      if (type === 'tool_call') {
        const callGeneration = Number(payload.generation);
        void executeMobileTool(payload.tool as CompanionBrowserToolName, payload.args ?? {})
          .then((result) =>
            mesh.request(event.sourceDeviceId, COMPANION_CAPABILITY.id, 'tool.result', {
              runId,
              generation: callGeneration,
              callId: payload.callId,
              ok: true,
              result,
            }),
          )
          .catch((toolError) =>
            mesh
              .request(event.sourceDeviceId, COMPANION_CAPABILITY.id, 'tool.result', {
                runId,
                generation: callGeneration,
                callId: payload.callId,
                ok: false,
                error: toolError instanceof Error ? toolError.message : String(toolError),
              })
              .catch(() => undefined),
          );
        return;
      }
      if (type === 'activity') {
        setActivity((current) => reduceCompanionToolActivity(current, payload.event ?? {}));
        return;
      }
      if (type === 'reply') setReply(String(payload.reply ?? ''));
      if (type === 'status' && payload.status === 'completed') {
        setEndedAt(Date.now());
        setStatusValue('completed');
      } else if (type === 'status' && payload.status === 'cancelled') {
        runIdRef.current = '';
        runTargetDeviceIdRef.current = '';
        setEndedAt(Date.now());
        setStatusValue('cancelled');
      } else if (type === 'error' && generationRef.current === generation) {
        setError(String(payload.error ?? 'Companion failed.'));
        setEndedAt(Date.now());
        setStatusValue('error');
      }
    };
    return mesh.subscribe(COMPANION_CAPABILITY.id, 'run.event', onRunEvent);
  }, [executeMobileTool, mesh.request, mesh.subscribe, setStatusValue]);

  React.useEffect(() => {
    const active = status === 'working';
    mesh.setBackgroundActivityRequired(active);
    return () => {
      if (active) mesh.setBackgroundActivityRequired(false);
    };
  }, [mesh.setBackgroundActivityRequired, status]);

  React.useEffect(
    () => () => {
      generationRef.current += 1;
      const runId = runIdRef.current;
      const targetDeviceId = runTargetDeviceIdRef.current;
      if (runId && targetDeviceId) {
        void mesh
          .request(targetDeviceId, COMPANION_CAPABILITY.id, 'run.cancel', { runId })
          .catch(() => undefined);
      }
      void voice.discardRecording();
    },
    [mesh.request, voice.discardRecording],
  );

  const effectiveStatus: CompanionStatus =
    voice.status === 'paused'
      ? 'recording'
      : voice.status === 'stopped'
        ? 'transcribing'
      : voice.status !== 'idle'
        ? voice.status
        : status;

  const value = React.useMemo<MobileCompanionContextValue>(
    () => ({
      status: effectiveStatus,
      error,
      reply,
      transcript,
      durationMillis: voice.durationMillis,
      startedAt,
      endedAt,
      activity,
      available,
      unavailableReason,
      toggle,
      close,
      registerWorkspaceTarget,
      registerEditorTarget,
    }),
    [
      activity,
      available,
      close,
      endedAt,
      error,
      effectiveStatus,
      registerEditorTarget,
      registerWorkspaceTarget,
      reply,
      startedAt,
      toggle,
      transcript,
      unavailableReason,
      voice.durationMillis,
    ],
  );

  return (
    <MobileCompanionContext.Provider value={value}>{children}</MobileCompanionContext.Provider>
  );
}

export function useMobileCompanion(): MobileCompanionContextValue {
  const value = React.useContext(MobileCompanionContext);
  if (!value) throw new Error('useMobileCompanion must be used inside MobileCompanionProvider');
  return value;
}
