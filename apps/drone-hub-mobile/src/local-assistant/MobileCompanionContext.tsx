import React from 'react';
import * as Crypto from 'expo-crypto';
import { COMPANION_CAPABILITY, isGranted } from '@drone/device-protocol';
import {
  CompanionClientController,
  executeCompanionBrowserTool,
  type CompanionBrowserToolName,
  type CompanionBrowserWorkspace,
  type CompanionClientTelemetry,
  type CompanionStatus,
  type CompanionTextSnapshot,
  type CompanionToolActivity,
} from '@drone/assistant-chat';

import { useMesh } from '../mesh/MeshContext';
import { useSharedMobileChatVoiceRecorder } from './MobileChatVoiceRecorderContext';
import { createMobileCompanionTransport } from './mobile-companion-transport';

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
  openDroneChat(args: Record<string, unknown>): Promise<Record<string, unknown>>;
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

export function MobileCompanionProvider({ children }: { children: React.ReactNode }) {
  const mesh = useMesh();
  const voice = useSharedMobileChatVoiceRecorder();
  const controllerRef = React.useRef<CompanionClientController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CompanionClientController({ createId: Crypto.randomUUID });
  }
  const controller = controllerRef.current;
  const state = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const workspaceTargetRef = React.useRef<MobileCompanionWorkspaceTarget | null>(null);
  const editorTargetsRef = React.useRef(new Map<string, MobileCompanionEditorTarget>());
  const focusedEditorIdRef = React.useRef<string | null>(null);
  const activeTargetDeviceIdRef = React.useRef('');
  const [targetRevision, setTargetRevision] = React.useState(0);

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
    async (
      expectedTargetDeviceId: string,
      tool: CompanionBrowserToolName,
      args: Record<string, unknown>,
    ) => {
      const resolveTarget = () => {
        const activeTarget = workspaceTargetRef.current;
        if (!activeTarget) throw new Error('NO_ACTIVE_MOBILE_CONTEXT');
        if (activeTarget.targetDeviceId !== expectedTargetDeviceId) {
          throw new Error('STALE_MOBILE_CONTEXT');
        }
        return activeTarget;
      };
      const workspace: CompanionBrowserWorkspace = {
        getAppContext: () => resolveTarget().getAppContext(),
        readActiveComposer: () => resolveTarget().readComposer(),
        applyComposer: (...input) => resolveTarget().applyComposer(...input),
        readOpenFile: () => resolveEditor().read(),
        applyEditor: (targetId, baseRevision, content) => {
          const editor = resolveEditor();
          if (editor.id !== targetId) throw new Error('STALE_EDITOR_TARGET');
          return editor.apply(baseRevision, content);
        },
        prepareDroneDraft: (input) => resolveTarget().prepareDroneDraft(input),
        openDroneChat: (input) => resolveTarget().openDroneChat(input),
        highlightDrones: (input) => resolveTarget().highlightDrones(input),
      };
      return await executeCompanionBrowserTool(workspace, tool, args);
    },
    [resolveEditor],
  );

  const close = React.useCallback(async () => {
    activeTargetDeviceIdRef.current = '';
    await controller.close();
    await voice.discardRecording();
  }, [controller, voice.discardRecording]);

  React.useEffect(() => {
    const activeTargetDeviceId = activeTargetDeviceIdRef.current;
    if (!activeTargetDeviceId) return;
    const activeTarget = workspaceTargetRef.current;
    if (
      !activeTarget ||
      activeTarget.targetDeviceId !== activeTargetDeviceId ||
      !activeTarget.reachable ||
      !hasOperations ||
      !hasGrant
    ) {
      void close();
    }
  }, [close, hasGrant, hasOperations, targetRevision]);

  const run = React.useCallback(
    async (prompt: string, telemetry?: CompanionClientTelemetry, requestedMessageId?: string) => {
      const activeTarget = workspaceTargetRef.current;
      if (!activeTarget) {
        controller.fail('Open Drone Hub before starting Companion.');
        return;
      }
      if (
        controller.hasSession() &&
        activeTargetDeviceIdRef.current !== activeTarget.targetDeviceId
      ) {
        await close();
      }
      activeTargetDeviceIdRef.current = activeTarget.targetDeviceId;
      await controller.submitPrompt({
        prompt,
        telemetry,
        messageId: requestedMessageId,
        createTransport: () =>
          createMobileCompanionTransport({
            targetDeviceId: activeTarget.targetDeviceId,
            request: mesh.request,
            subscribe: mesh.subscribe,
          }),
        executeTool: (tool, args) => executeMobileTool(activeTarget.targetDeviceId, tool, args),
      });
    },
    [close, controller, executeMobileTool, mesh.request, mesh.subscribe],
  );

  const toggle = React.useCallback(async () => {
    if (voice.status === 'starting' || voice.status === 'transcribing') return;
    if (voice.status === 'recording') {
      const token = controller.getToken();
      const messageId = Crypto.randomUUID();
      const audioDurationMs = voice.durationMillis;
      const transcriptionStartedAt = performance.now();
      const text = await voice.stopRecordingForTranscript();
      const transcriptionMs = Math.max(0, performance.now() - transcriptionStartedAt);
      if (!controller.isCurrent(token)) return;
      if (!text.trim()) {
        controller.reportVoiceError(voice.getError());
        return;
      }
      await run(text, { version: 1, transcriptionMs, audioDurationMs }, messageId);
      return;
    }
    const status = controller.getSnapshot().status;
    if (status === 'cancelled' || status === 'error') await close();
    const activeTarget = workspaceTargetRef.current;
    if (!activeTarget || !activeTarget.reachable || !available) {
      controller.fail(unavailableReason || 'Companion is unavailable.');
      return;
    }
    if (voice.microphoneOwner || voice.status !== 'idle') {
      controller.fail(
        voice.microphoneOwner === 'continuous'
          ? 'Continuous voice is already using the microphone.'
          : 'A voice message is already using the microphone.',
      );
      return;
    }
    activeTargetDeviceIdRef.current = activeTarget.targetDeviceId;
    voice.setError('');
    const token = controller.getToken();
    const started = await voice.startRecording('companion');
    if (!controller.isCurrent(token)) return;
    if (!started) {
      controller.reportVoiceError(
        voice.getError() || 'The microphone could not start. Check microphone and Groq settings.',
      );
    }
  }, [available, close, controller, run, unavailableReason, voice]);

  React.useEffect(() => {
    if (
      !voice.error.trim() ||
      !['starting', 'recording', 'stopped', 'transcribing'].includes(voice.status)
    ) {
      return;
    }
    controller.reportVoiceError(voice.error);
  }, [controller, voice.error, voice.status]);

  React.useEffect(() => {
    if (state.status === 'cancelled' || state.status === 'error' || state.status === 'idle') {
      activeTargetDeviceIdRef.current = '';
    }
    const active = state.status === 'working';
    mesh.setBackgroundActivityRequired(active);
    return () => {
      if (active) mesh.setBackgroundActivityRequired(false);
    };
  }, [mesh.setBackgroundActivityRequired, state.status]);

  React.useEffect(
    () => () => {
      void controller.close();
      void voice.discardRecording();
    },
    [controller, voice.discardRecording],
  );

  const effectiveStatus: CompanionStatus =
    voice.status === 'paused'
      ? 'recording'
      : voice.status === 'stopped'
        ? 'transcribing'
        : voice.status !== 'idle'
          ? voice.status
          : state.status;

  const value = React.useMemo<MobileCompanionContextValue>(
    () => ({
      ...state,
      status: effectiveStatus,
      durationMillis: voice.durationMillis,
      available,
      unavailableReason,
      toggle,
      close,
      registerWorkspaceTarget,
      registerEditorTarget,
    }),
    [
      available,
      close,
      effectiveStatus,
      registerEditorTarget,
      registerWorkspaceTarget,
      state,
      toggle,
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
