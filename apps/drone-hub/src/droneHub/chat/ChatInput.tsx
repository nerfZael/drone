import React from 'react';
import {
  AUTOMATION_RUNS_DEFAULT,
  AUTOMATION_RUNS_MAX,
  AUTOMATION_RUNS_MIN,
  AUTOMATION_SLEEP_AMOUNT_DEFAULT,
  AUTOMATION_SLEEP_AMOUNT_MAX,
  AUTOMATION_SLEEP_AMOUNT_MIN,
  AUTOMATION_SLEEP_UNIT_DEFAULT,
  formatAutomationSleepInterval,
  normalizeAutomationRuns,
  normalizeAutomationSleepAmount,
  type AutomationSleepUnit,
} from '../app/automation-config';
import { CHAT_DRAFT_AUTOMATION_STOP_PHRASE_DEFAULT } from '../app/chat-draft-automation';
import { AutomationRunnerPanel } from './AutomationRunnerPanel';
import { ChatComposerContext, type ChatComposerContextConfig } from './ChatComposerContext';
import { ChatComposerControls, type ChatComposerControlsConfig } from './ChatComposerControls';
import {
  CHAT_INPUT_MAX_BYTES_EACH,
  CHAT_INPUT_MAX_BYTES_TOTAL,
  CHAT_INPUT_MAX_IMAGES,
  CHAT_INPUT_PASTE_TEXT_AS_ATTACHMENT_MIN_CHARS,
  blobToBase64,
  fileToBase64,
  filesFromClipboardData,
  formatBytes,
  imageFilesFromClipboardData,
  isLikelyImageFile,
  makeDraftImageAttachmentId,
  mimeForChatAttachmentFile,
  revokeDraftImagePreviewUrls,
  textByteLength,
  type DraftChatAttachment,
} from './chat-input-attachments';
import { mergeDraftWithVoiceTranscript, useChatVoiceRecorder } from './use-chat-voice-recorder';

const CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX = 36;
const CHAT_INPUT_TEXTAREA_MAX_HEIGHT_PX = 160;

export type ChatAttachmentPayload = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
  disposition?: 'artifact' | 'prompt';
};

export type ChatImageAttachmentPayload = ChatAttachmentPayload;

export type ChatSendPayload = {
  prompt: string;
  attachments: ChatAttachmentPayload[];
};

export type ChatSendContext = {
  trigger: 'button' | 'keyboard';
  modifierKey: boolean;
};

export type ChatDraftAutomationPayload = ChatSendPayload & {
  runs: number;
  sleepAmount: number;
  sleepUnit: AutomationSleepUnit;
};

export type ChatInputAutomationAction = {
  id: string;
  label: string;
  onSelect: () => void;
  onSelectWithRuns?: (runs: number) => void;
  title?: string;
  disabled?: boolean;
  statusText?: string;
  defaultRuns?: number;
  minRuns?: number;
  maxRuns?: number;
  sleepBetweenRunsLabel?: string;
};

export type ChatInputProps = {
  resetKey: string;
  droneName: string;
  draftValue?: string;
  onDraftValueChange?: (next: string) => void;
  promptError: string | null;
  sending: boolean;
  waiting: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  focusTargetId?: string;
  modeHint?: string;
  attachmentsEnabled?: boolean;
  attachmentMode?: 'images' | 'files';
  composerContext?: ChatComposerContextConfig;
  composerControls?: ChatComposerControlsConfig;
  automationActions?: ChatInputAutomationAction[];
  automationMenuLabel?: string;
  allowSendWhileWaiting?: boolean;
  onSend: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onPublish?: () => Promise<boolean> | boolean;
  publishing?: boolean;
  onSendAutomation?: (payload: ChatDraftAutomationPayload) => Promise<boolean>;
  onStop?: () => Promise<void> | void;
  stopping?: boolean;
};

export function ChatInput({
  resetKey,
  droneName,
  draftValue,
  onDraftValueChange,
  promptError,
  sending,
  waiting,
  disabled,
  autoFocus,
  focusTargetId,
  modeHint = '',
  attachmentsEnabled,
  attachmentMode = 'images',
  composerContext,
  composerControls,
  automationActions,
  automationMenuLabel = 'Automations',
  allowSendWhileWaiting = false,
  onSend,
  onPublish,
  publishing = false,
  onSendAutomation,
  onStop,
  stopping = false,
}: ChatInputProps) {
  const [uncontrolledDraft, setUncontrolledDraft] = React.useState('');
  const [attachments, setAttachments] = React.useState<DraftChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [automationPanelOpen, setAutomationPanelOpen] = React.useState(false);
  const [selectedAutomationActionId, setSelectedAutomationActionId] = React.useState('');
  const [automationRunsDraft, setAutomationRunsDraft] = React.useState('');
  const [draftAutomationEnabled, setDraftAutomationEnabled] = React.useState(false);
  const [voiceActionInFlight, setVoiceActionInFlight] = React.useState(false);
  const [draftAutomationRunsDraft, setDraftAutomationRunsDraft] = React.useState(String(AUTOMATION_RUNS_DEFAULT));
  const [draftAutomationSleepAmountDraft, setDraftAutomationSleepAmountDraft] =
    React.useState(String(AUTOMATION_SLEEP_AMOUNT_DEFAULT));
  const [draftAutomationSleepUnit, setDraftAutomationSleepUnit] =
    React.useState<AutomationSleepUnit>(AUTOMATION_SLEEP_UNIT_DEFAULT);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const automationPanelRef = React.useRef<HTMLDivElement | null>(null);
  const voiceActionInFlightRef = React.useRef(false);
  const voiceActionTokenRef = React.useRef(0);
  const controlledDraftEnabled = typeof draftValue === 'string' && typeof onDraftValueChange === 'function';
  const draft = controlledDraftEnabled ? draftValue : uncontrolledDraft;
  const draftRef = React.useRef(draft);
  const attachmentsRef = React.useRef(attachments);
  const availableAutomationActions = React.useMemo(
    () =>
      (Array.isArray(automationActions) ? automationActions : []).filter(
        (action) => String(action?.id ?? '').trim().length > 0 && String(action?.label ?? '').trim().length > 0,
      ),
    [automationActions],
  );
  const composerLocked = Boolean(disabled);
  const attachmentControlsLocked = composerLocked || sending;
  const selectedAutomationAction = React.useMemo(
    () =>
      availableAutomationActions.find((action) => action.id === selectedAutomationActionId) ??
      availableAutomationActions[0] ??
      null,
    [availableAutomationActions, selectedAutomationActionId],
  );

  const attachmentsOn = attachmentsEnabled !== false;
  const imageAttachmentCount = React.useMemo(
    () => attachments.filter((attachment) => attachment.kind === 'image').length,
    [attachments],
  );
  const textAttachmentCount = React.useMemo(
    () => attachments.filter((attachment) => attachment.kind === 'text').length,
    [attachments],
  );
  const fileAttachmentCount = React.useMemo(
    () => attachments.filter((attachment) => attachment.kind === 'file').length,
    [attachments],
  );
  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const setDraft = React.useCallback(
    (next: React.SetStateAction<string>) => {
      const resolved = typeof next === 'function' ? (next as (prev: string) => string)(draftRef.current) : next;
      if (controlledDraftEnabled) {
        onDraftValueChange?.(resolved);
        return;
      }
      setUncontrolledDraft(resolved);
    },
    [controlledDraftEnabled, onDraftValueChange],
  );

  const {
    status: voiceRecordingStatus,
    startRecording: startVoiceRecording,
    toggleRecordingPause: toggleVoiceRecordingPause,
    discardRecording: discardVoiceRecording,
    stopRecordingForTranscript: stopVoiceRecordingForTranscript,
  } = useChatVoiceRecorder({
    onError: React.useCallback((message) => {
      setAttachmentError(message.trim() ? message : null);
    }, []),
  });

  const resizeTextarea = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(
      CHAT_INPUT_TEXTAREA_MAX_HEIGHT_PX,
      Math.max(CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX, el.scrollHeight),
    );
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > CHAT_INPUT_TEXTAREA_MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, []);

  React.useEffect(() => {
    if (!controlledDraftEnabled) setUncontrolledDraft('');
    setAttachmentError(null);
    setAutomationPanelOpen(false);
    setSelectedAutomationActionId('');
    setAutomationRunsDraft('');
    setDraftAutomationEnabled(false);
    setDraftAutomationRunsDraft(String(AUTOMATION_RUNS_DEFAULT));
    setDraftAutomationSleepAmountDraft(String(AUTOMATION_SLEEP_AMOUNT_DEFAULT));
    setDraftAutomationSleepUnit(AUTOMATION_SLEEP_UNIT_DEFAULT);
    // Revoke any preview object URLs.
    setAttachments((prev) => {
      revokeDraftImagePreviewUrls(prev);
      return [];
    });
  }, [controlledDraftEnabled, resetKey]);

  React.useEffect(() => {
    if (availableAutomationActions.length === 0) {
      setSelectedAutomationActionId('');
      return;
    }
    const existing = availableAutomationActions.some(
      (action) => action.id === selectedAutomationActionId,
    );
    if (existing) return;
    setSelectedAutomationActionId(availableAutomationActions[0].id);
  }, [availableAutomationActions, selectedAutomationActionId]);

  React.useEffect(() => {
    const action = selectedAutomationAction;
    if (!action || typeof action.defaultRuns !== 'number') return;
    const current = Number(automationRunsDraft);
    if (Number.isFinite(current) && current > 0) return;
    setAutomationRunsDraft(String(action.defaultRuns));
  }, [automationRunsDraft, selectedAutomationAction]);

  React.useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus, resetKey]);

  React.useEffect(() => {
    resizeTextarea();
  }, [draft, resetKey, resizeTextarea]);

  React.useEffect(() => {
    if (!automationPanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (automationPanelRef.current && automationPanelRef.current.contains(target)) return;
      setAutomationPanelOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [automationPanelOpen]);

  const showStopAction = waiting && typeof onStop === 'function';
  const showSeparateStopAction = showStopAction && allowSendWhileWaiting;
  const hasModeHint = modeHint.trim().length > 0;
  const supportsDraftAutomation = typeof onSendAutomation === 'function';
  const draftAutomationActive = draftAutomationEnabled && supportsDraftAutomation;
  const voiceRecordingActive = voiceRecordingStatus !== 'idle';
  const voiceRecordingCanPauseOrStop = voiceRecordingStatus === 'recording' || voiceRecordingStatus === 'paused';
  const voiceRecordButtonDisabled = composerLocked || sending || showStopAction || voiceActionInFlight;
  const voicePauseButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const voiceStopButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const trimmed = draft.trim();
  const sendDisabled = sending || composerLocked || voiceActionInFlight || (trimmed.length === 0 && attachments.length === 0 && !voiceRecordingActive);

  React.useEffect(() => {
    if (supportsDraftAutomation || !draftAutomationEnabled) return;
    setDraftAutomationEnabled(false);
  }, [draftAutomationEnabled, supportsDraftAutomation]);

  React.useEffect(() => {
    voiceActionTokenRef.current += 1;
    voiceActionInFlightRef.current = false;
    setVoiceActionInFlight(false);
    void discardVoiceRecording();
  }, [discardVoiceRecording, resetKey]);

  React.useEffect(() => {
    if (!voiceRecordingActive) return;
    if (!composerLocked && !showStopAction) return;
    voiceActionTokenRef.current += 1;
    voiceActionInFlightRef.current = false;
    setVoiceActionInFlight(false);
    void discardVoiceRecording();
  }, [composerLocked, discardVoiceRecording, showStopAction, voiceRecordingActive]);

  function openPicker() {
    if (!attachmentsOn) return;
    if (attachmentControlsLocked) return;
    fileInputRef.current?.click();
  }

  function removeAttachment(id: string) {
    setAttachmentError(null);
    setAttachments((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx < 0) return prev;
      const next = prev.slice();
      const [removed] = next.splice(idx, 1);
      if (removed) revokeDraftImagePreviewUrls([removed]);
      return next;
    });
  }

  function makePastedTextAttachmentName(existingCount: number): string {
    return existingCount <= 0 ? 'pasted-text.txt' : `pasted-text-${existingCount + 1}.txt`;
  }

  function addFiles(
    files: File[] | FileList | null | undefined,
    options: { source?: 'file' | 'paste' } = {},
  ) {
    if (!attachmentsOn) return;
    if (!files) return;
    const list: File[] = Array.isArray(files) ? files : Array.from(files);
    if (list.length === 0) return;

    setAttachmentError(null);
    setAttachments((prev) => {
      const next = prev.slice();
      let total = next.reduce((sum, a) => sum + (Number(a?.size) || 0), 0);

      for (const f of list) {
        if (!f) continue;
        const image = isLikelyImageFile(f);
        if (attachmentMode === 'images' && !image) {
          setAttachmentError('Only image files can be attached.');
          continue;
        }
        const size = Number((f as any).size ?? 0);
        if (!Number.isFinite(size) || size <= 0) {
          setAttachmentError(`One of the selected ${attachmentMode === 'files' ? 'files' : 'images'} is empty or unreadable.`);
          continue;
        }
        if (size > CHAT_INPUT_MAX_BYTES_EACH) {
          setAttachmentError(
            `${attachmentMode === 'files' ? 'File' : 'Image'} too large (${formatBytes(size)}). Max per ${attachmentMode === 'files' ? 'file' : 'image'} is ${formatBytes(CHAT_INPUT_MAX_BYTES_EACH)}.`,
          );
          continue;
        }
        if (next.length >= CHAT_INPUT_MAX_IMAGES) {
          setAttachmentError(`Too many attachments. Max is ${CHAT_INPUT_MAX_IMAGES}.`);
          break;
        }
        if (total + size > CHAT_INPUT_MAX_BYTES_TOTAL) {
          setAttachmentError(
            `Attachments too large in total. Max total is ${formatBytes(CHAT_INPUT_MAX_BYTES_TOTAL)}.`,
          );
          break;
        }

        const mime = mimeForChatAttachmentFile(f);
        const name = String((f as any).name ?? '').trim() || `attachment-${next.length + 1}`;
        const disposition = options.source === 'paste' && image ? 'prompt' : 'artifact';
        if (image) {
          const previewUrl = URL.createObjectURL(f);
          next.push({
            kind: 'image',
            id: makeDraftImageAttachmentId(),
            file: f,
            name,
            mime,
            size: Math.floor(size),
            previewUrl,
            disposition,
          });
        } else {
          next.push({
            kind: 'file',
            id: makeDraftImageAttachmentId(),
            file: f,
            name,
            mime,
            size: Math.floor(size),
            disposition,
          });
        }
        total += size;
      }

      return next;
    });
  }

  function addPastedTextAttachment(textRaw: string) {
    if (!attachmentsOn) return;
    const text = String(textRaw ?? '');
    if (!text) return;
    const size = textByteLength(text);
    setAttachmentError(null);
    setAttachments((prev) => {
      const total = prev.reduce((sum, attachment) => sum + (Number(attachment.size) || 0), 0);
      if (prev.length >= CHAT_INPUT_MAX_IMAGES) {
        setAttachmentError(`Too many attachments. Max is ${CHAT_INPUT_MAX_IMAGES}.`);
        return prev;
      }
      if (size > CHAT_INPUT_MAX_BYTES_EACH) {
        setAttachmentError(`Pasted text too large (${formatBytes(size)}). Max per attachment is ${formatBytes(CHAT_INPUT_MAX_BYTES_EACH)}.`);
        return prev;
      }
      if (total + size > CHAT_INPUT_MAX_BYTES_TOTAL) {
        setAttachmentError(`Attachments too large in total. Max total is ${formatBytes(CHAT_INPUT_MAX_BYTES_TOTAL)}.`);
        return prev;
      }
      const textCount = prev.filter((attachment) => attachment.kind === 'text').length;
      return [
        ...prev,
        {
          kind: 'text',
          id: makeDraftImageAttachmentId(),
          text,
          name: makePastedTextAttachmentName(textCount),
          mime: 'text/plain',
          size,
          disposition: 'artifact',
        },
      ];
    });
  }

  async function submitPromptSnapshot(prompt: string, snapshotAttachments: DraftChatAttachment[], context: ChatSendContext) {
    if (!prompt && snapshotAttachments.length === 0) return;
    if (draftAutomationActive && snapshotAttachments.length > 0) {
      setAttachmentError('Recurring chat automations do not support attachments yet.');
      return;
    }
    setDraft('');
    setAttachments([]);
    setAttachmentError(null);
    if (draftAutomationActive && onSendAutomation) {
      const ok = await onSendAutomation({
        prompt,
        attachments: [],
        runs: normalizeAutomationRuns(draftAutomationRunsDraft),
        sleepAmount: normalizeAutomationSleepAmount(draftAutomationSleepAmountDraft),
        sleepUnit: draftAutomationSleepUnit,
      });
      if (!ok) {
        setDraft((cur) => (cur.trim().length === 0 ? prompt : cur));
        setAttachments((cur) => (cur.length === 0 ? snapshotAttachments : cur));
      }
      return;
    }
    let encoded: ChatAttachmentPayload[] = [];
    try {
      encoded = await Promise.all(
        snapshotAttachments.map(async (a) =>
          a.kind === 'image'
            ? {
                name: a.name,
                mime: a.mime,
                size: a.size,
                dataBase64: await fileToBase64(a.file),
                disposition: a.disposition,
              }
            : a.kind === 'text'
              ? {
                name: a.name,
                mime: a.mime,
                size: a.size,
                dataBase64: await blobToBase64(new Blob([a.text], { type: a.mime })),
                disposition: a.disposition,
              }
              : {
                  name: a.name,
                  mime: a.mime,
                  size: a.size,
                  dataBase64: await fileToBase64(a.file),
                  disposition: a.disposition,
                },
        ),
      );
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setAttachmentError(`Failed to read attachment: ${msg}`);
      // Restore state (best-effort).
      setDraft((cur) => (cur.trim().length === 0 ? prompt : cur));
      setAttachments((cur) => (cur.length === 0 ? snapshotAttachments : cur));
      return;
    }

    const ok = await onSend({ prompt, attachments: encoded }, context);
    if (!ok) {
      // Don't clobber any new text the user started typing.
      setDraft((cur) => (cur.trim().length === 0 ? prompt : cur));
      setAttachments((cur) => (cur.length === 0 ? snapshotAttachments : cur));
    } else {
      // Sent: revoke preview URLs for the snapshot attachments.
      revokeDraftImagePreviewUrls(snapshotAttachments);
    }
  }

  function beginVoiceAction(): number | null {
    if (voiceActionInFlightRef.current) return null;
    const token = voiceActionTokenRef.current + 1;
    voiceActionTokenRef.current = token;
    voiceActionInFlightRef.current = true;
    setVoiceActionInFlight(true);
    return token;
  }

  function endVoiceAction(token: number) {
    if (voiceActionTokenRef.current !== token) return;
    voiceActionInFlightRef.current = false;
    setVoiceActionInFlight(false);
  }

  async function stopVoiceRecordingAndAppendDraft(actionToken: number): Promise<string | null> {
    const transcript = await stopVoiceRecordingForTranscript();
    if (voiceActionTokenRef.current !== actionToken) return null;
    if (!transcript) return draftRef.current;
    const nextDraft = mergeDraftWithVoiceTranscript(draftRef.current, transcript);
    setDraft(nextDraft);
    return nextDraft;
  }

  async function stopVoiceRecordingAndFillDraft() {
    const actionToken = beginVoiceAction();
    if (actionToken == null) return;
    try {
      const before = draftRef.current;
      const nextDraft = await stopVoiceRecordingAndAppendDraft(actionToken);
      if (nextDraft == null) return;
      if (nextDraft === before) {
        setAttachmentError((current) => current || 'No speech detected.');
      } else {
        window.requestAnimationFrame(() => textareaRef.current?.focus());
      }
    } finally {
      endVoiceAction(actionToken);
    }
  }

  const sendNow = (context: ChatSendContext) => {
    if (sending || composerLocked) return;
    const actionToken = beginVoiceAction();
    if (actionToken == null) return;
    void (async () => {
      try {
        const promptDraft = voiceRecordingActive ? await stopVoiceRecordingAndAppendDraft(actionToken) : draftRef.current;
        if (promptDraft == null) return;
        const snapshotAttachments = attachmentsRef.current.slice();
        const prompt = promptDraft.trim();
        if (voiceRecordingActive && !prompt && snapshotAttachments.length === 0) {
          setAttachmentError((current) => current || 'No speech detected.');
          return;
        }
        await submitPromptSnapshot(prompt, snapshotAttachments, context);
      } finally {
        endVoiceAction(actionToken);
      }
    })();
  };

  const selectedAutomationActionDisabled = React.useMemo(() => {
    if (!selectedAutomationAction) return true;
    return Boolean(disabled) || Boolean(selectedAutomationAction.disabled);
  }, [disabled, selectedAutomationAction]);

  const selectedAutomationRuns = React.useMemo(() => {
    const action = selectedAutomationAction;
    if (!action || !action.onSelectWithRuns) return null;
    const min = typeof action.minRuns === 'number' ? Math.max(1, Math.round(action.minRuns)) : 1;
    const maxRaw = typeof action.maxRuns === 'number' ? Math.round(action.maxRuns) : min;
    const max = Math.max(min, maxRaw);
    const fallback = typeof action.defaultRuns === 'number' ? Math.max(min, Math.min(max, Math.round(action.defaultRuns))) : min;
    const parsed = Number(automationRunsDraft);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }, [automationRunsDraft, selectedAutomationAction]);

  const triggerSelectedAutomationAction = React.useCallback(() => {
    const action = selectedAutomationAction;
    if (!action) return;
    if (selectedAutomationActionDisabled) return;
    if (action.onSelectWithRuns) {
      action.onSelectWithRuns(selectedAutomationRuns ?? action.defaultRuns ?? 1);
      return;
    }
    action.onSelect();
  }, [selectedAutomationAction, selectedAutomationActionDisabled, selectedAutomationRuns]);

  const draftAutomationRuns = React.useMemo(
    () => normalizeAutomationRuns(draftAutomationRunsDraft),
    [draftAutomationRunsDraft],
  );
  const draftAutomationSleepAmount = React.useMemo(
    () => normalizeAutomationSleepAmount(draftAutomationSleepAmountDraft),
    [draftAutomationSleepAmountDraft],
  );
  const draftAutomationSleepLabel = React.useMemo(
    () =>
      formatAutomationSleepInterval({
        sleepAmount: draftAutomationSleepAmount,
        sleepUnit: draftAutomationSleepUnit,
      }),
    [draftAutomationSleepAmount, draftAutomationSleepUnit],
  );
  const sendButtonLabel =
    showStopAction && !showSeparateStopAction
      ? stopping
        ? 'Stopping...'
        : 'Stop'
      : voiceActionInFlight
        ? voiceRecordingStatus === 'transcribing'
          ? 'Transcribing...'
          : 'Sending...'
        : sending
          ? 'Sending...'
          : waiting && !allowSendWhileWaiting
            ? 'Waiting...'
            : draftAutomationActive
              ? 'Start loop'
              : 'Send';

  return (
    <div
      data-onboarding-id="chat.input"
      className="flex-shrink-0 px-5 pt-2 pb-5 bg-transparent"
      onDragEnter={(e) => {
        if (!attachmentsOn) return;
        if (attachmentControlsLocked) return;
        if (e.dataTransfer?.types?.includes?.('Files')) setDragActive(true);
      }}
      onDragOver={(e) => {
        if (!attachmentsOn) return;
        if (attachmentControlsLocked) return;
        e.preventDefault();
      }}
      onDragLeave={() => {
        if (!attachmentsOn) return;
        setDragActive(false);
      }}
      onDrop={(e) => {
        if (!attachmentsOn) return;
        if (attachmentControlsLocked) return;
        e.preventDefault();
        setDragActive(false);
        addFiles(e.dataTransfer?.files ?? null, { source: 'file' });
      }}
    >
      <div className="max-w-[1170px] mx-auto">
        {(promptError || attachmentError) && (
          <div className="mb-2 text-[11px] text-[var(--red)] px-1" title={promptError || attachmentError || undefined}>
            {promptError || attachmentError}
          </div>
        )}
        <div
          ref={automationPanelRef}
          className={`relative rounded-lg border bg-[var(--panel-alt)] shadow-[0_0_40px_rgba(0,0,0,.2),0_0_80px_rgba(0,0,0,.1)] ${
            dragActive ? 'border-[var(--accent)]' : 'border-[var(--border)]'
          }`}
        >
          {/* Top accent line */}
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-[var(--user-muted)] to-transparent opacity-25" />
          <ChatComposerContext config={composerContext} />
          {attachmentsOn && attachments.length > 0 && (
            <div className="px-3 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="text-[10px] text-[var(--muted-dim)] tracking-wide uppercase"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {attachments.length} attachment{attachments.length === 1 ? '' : 's'} attached
                  {imageAttachmentCount > 0 ? ` • ${imageAttachmentCount} image${imageAttachmentCount === 1 ? '' : 's'}` : ''}
                  {textAttachmentCount > 0 ? ` • ${textAttachmentCount} text attachment${textAttachmentCount === 1 ? '' : 's'}` : ''}
                  {fileAttachmentCount > 0 ? ` • ${fileAttachmentCount} file${fileAttachmentCount === 1 ? '' : 's'}` : ''}
                </div>
                <button
                  type="button"
                  onClick={() => openPicker()}
                  disabled={attachmentControlsLocked}
                  className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded border transition-all ${
                    attachmentControlsLocked
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title={attachmentMode === 'files' ? 'Attach more files' : 'Attach more images'}
                >
                  Add
                </button>
              </div>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {attachments.map((a) => (
                  <div key={a.id} className="relative flex-shrink-0">
                    {a.kind === 'image' ? (
                      <img
                        src={a.previewUrl}
                        alt={a.name}
                        className="w-14 h-14 object-cover rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)]"
                      />
                    ) : (
                      <div className="w-[180px] min-h-[56px] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-2 py-1.5">
                        <div
                          className="text-[9px] uppercase tracking-wide text-[var(--muted-dim)]"
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          {a.kind === 'text' ? 'Text attachment' : 'File attachment'}
                        </div>
                        <div className="mt-1 truncate text-[10px] text-[var(--fg-secondary)]">{a.name}</div>
                        <div className="mt-0.5 text-[9px] text-[var(--muted-dim)]">{formatBytes(a.size)}</div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      disabled={attachmentControlsLocked}
                      className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border text-[10px] font-bold flex items-center justify-center transition-all ${
                        attachmentControlsLocked
                          ? 'opacity-40 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'bg-[var(--panel-raised)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--red)] hover:border-[var(--red)]'
                      }`}
                      title={`Remove ${a.kind} attachment`}
                      aria-label={`Remove ${a.kind} attachment`}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 p-3 sm:flex-nowrap">
            {attachmentsOn && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={attachmentMode === 'images' ? 'image/*' : undefined}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.currentTarget.files, { source: 'file' });
                    // allow re-selecting same file
                    e.currentTarget.value = '';
                  }}
                  disabled={attachmentControlsLocked}
                />
                <button
                  type="button"
                  onClick={() => openPicker()}
                  disabled={attachmentControlsLocked}
                  className={`inline-flex items-center justify-center w-[44px] h-[44px] rounded-md border transition-all ${
                    attachmentControlsLocked
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'
                  }`}
                  title={attachmentMode === 'files' ? 'Attach files (paste or drag and drop also works)' : 'Attach images (paste or drag and drop also works)'}
                  aria-label={attachmentMode === 'files' ? 'Attach files' : 'Attach images'}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.5 5.5h3" />
                    <path d="M8 4v3" />
                    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                  </svg>
                </button>
              </>
            )}
            {voiceRecordingStatus === 'idle' ? (
              <button
                type="button"
                onClick={() => void startVoiceRecording()}
                disabled={voiceRecordButtonDisabled}
                className={`inline-flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-md border transition-all ${
                  voiceRecordButtonDisabled
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'
                }`}
                title="Record voice message"
                aria-label="Record voice message"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <path d="M12 18v3" />
                  <path d="M8 21h8" />
                </svg>
              </button>
            ) : (
              <div className="flex h-[44px] flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void discardVoiceRecording()}
                  disabled={voiceRecordingStatus === 'transcribing' || voiceActionInFlight}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all ${
                    voiceRecordingStatus === 'transcribing' || voiceActionInFlight
                      ? 'opacity-40 cursor-not-allowed border-[rgba(248,113,113,.18)] bg-[rgba(248,113,113,.05)] text-[rgba(252,165,165,.55)]'
                      : 'border-[rgba(248,113,113,.45)] bg-[rgba(248,113,113,.10)] text-[#fca5a5] hover:bg-[rgba(248,113,113,.16)]'
                  }`}
                  title="Discard recording"
                  aria-label="Discard recording"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => toggleVoiceRecordingPause()}
                  disabled={voicePauseButtonDisabled}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all ${
                    voicePauseButtonDisabled
                      ? 'opacity-40 cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                      : voiceRecordingStatus === 'paused'
                        ? 'border-[rgba(167,139,250,.38)] bg-[rgba(167,139,250,.10)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.16)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]'
                  }`}
                  title={voiceRecordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
                  aria-label={voiceRecordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
                >
                  {voiceRecordingStatus === 'paused' ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 5v14l11-7Z" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 5v14" />
                      <path d="M15 5v14" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void stopVoiceRecordingAndFillDraft()}
                  disabled={voiceStopButtonDisabled}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all ${
                    voiceStopButtonDisabled
                      ? 'opacity-40 cursor-not-allowed border-[rgba(74,222,128,.16)] bg-[rgba(74,222,128,.04)] text-[rgba(74,222,128,.55)]'
                      : 'border-[rgba(74,222,128,.28)] bg-[rgba(74,222,128,.08)] text-[var(--green)] hover:bg-[rgba(74,222,128,.13)]'
                  }`}
                  title="Stop recording and transcribe"
                  aria-label="Stop recording and transcribe"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 7h10v10H7Z" />
                  </svg>
                </button>
              </div>
            )}
            <textarea
              ref={textareaRef}
              data-chat-input-focus-id={focusTargetId || undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                const files = attachmentMode === 'files'
                  ? filesFromClipboardData(e.clipboardData)
                  : imageFilesFromClipboardData(e.clipboardData);
                if (attachmentsOn && !attachmentControlsLocked && files.length > 0) {
                  e.preventDefault();
                  addFiles(files, { source: 'paste' });
                  return;
                }
                const pastedText = String(e.clipboardData?.getData('text/plain') ?? '');
                if (
                  attachmentsOn &&
                  !attachmentControlsLocked &&
                  pastedText.length >= CHAT_INPUT_PASTE_TEXT_AS_ATTACHMENT_MIN_CHARS
                ) {
                  e.preventDefault();
                  addPastedTextAttachment(pastedText);
                }
              }}
              onKeyDown={(e) => {
                if ((e.nativeEvent as any)?.isComposing) return;
                if (e.key === 'Escape') {
                  e.currentTarget.blur();
                  return;
                }
                const modifierKey = e.ctrlKey || e.metaKey;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendNow({ trigger: 'keyboard', modifierKey });
                }
              }}
              rows={1}
              placeholder="Message..."
              className="min-w-[180px] flex-1 resize-none rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 py-2 text-[13px] leading-[1.35] text-[var(--fg)] placeholder:text-[11px] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--user-muted)] transition-colors"
              style={{ minHeight: CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX }}
              disabled={composerLocked}
              autoFocus={Boolean(autoFocus)}
              aria-label={`Message ${droneName}`}
            />
            <ChatComposerControls config={composerControls} />
            {supportsDraftAutomation && (
              <button
                type="button"
                onClick={() => {
                  setAttachmentError(null);
                  setDraftAutomationEnabled((enabled) => {
                    const next = !enabled;
                    if (next) setAutomationPanelOpen(false);
                    return next;
                  });
                }}
                disabled={Boolean(disabled)}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                  Boolean(disabled)
                    ? 'opacity-40 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                    : draftAutomationActive
                      ? 'bg-[rgba(255,255,255,.06)] border-[var(--accent-muted)] text-[var(--accent)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Send this draft as a repeating automation"
              >
                Repeat
                <span className="text-[9px] text-[var(--muted-dim)]">{draftAutomationActive ? 'On' : 'Off'}</span>
              </button>
            )}
            {availableAutomationActions.length > 0 && (
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setAutomationPanelOpen((open) => !open)}
                  disabled={Boolean(disabled)}
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                    Boolean(disabled)
                      ? 'opacity-40 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title={automationMenuLabel}
                >
                  {automationMenuLabel}
                  <svg
                    className={`transition-transform ${automationPanelOpen ? 'rotate-180' : ''}`}
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M4.427 6.573a.25.25 0 01.177-.073h6.792a.25.25 0 01.177.427l-3.396 3.396a.25.25 0 01-.354 0L4.427 7a.25.25 0 010-.354z" />
                  </svg>
                </button>
              </div>
            )}
            {onPublish ? (
              <button
                type="button"
                onClick={() => {
                  void onPublish();
                }}
                disabled={Boolean(disabled) || publishing}
                className={`inline-flex h-9 items-center justify-center rounded-md border px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  Boolean(disabled) || publishing
                    ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--panel-raised)] text-[var(--muted)] opacity-40'
                    : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Publish this draft and send queued messages"
              >
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            ) : null}
            {showSeparateStopAction ? (
              <button
                type="button"
                onClick={() => void onStop?.()}
                disabled={stopping}
                className="inline-flex h-9 items-center justify-center rounded-md border border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--red)] hover:bg-[rgba(255,90,90,.14)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ fontFamily: 'var(--display)' }}
              >
                {stopping ? 'Stopping...' : 'Stop'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (showStopAction && !showSeparateStopAction) {
                  void onStop?.();
                  return;
                }
                sendNow({ trigger: 'button', modifierKey: false });
              }}
              disabled={showStopAction && !showSeparateStopAction ? stopping : sendDisabled}
              className={`inline-flex items-center justify-center h-9 min-w-[80px] px-4 rounded-md text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                showStopAction && !showSeparateStopAction
                  ? stopping
                    ? 'opacity-50 cursor-not-allowed bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)]'
                    : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.35)] text-[var(--red)] hover:bg-[rgba(255,90,90,.14)]'
                  : sendDisabled
                    ? 'opacity-40 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                    : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title={showStopAction && !showSeparateStopAction ? 'Stop response' : 'Send'}
            >
              {sendButtonLabel}
            </button>
          </div>
          {draftAutomationActive && (
            <div className="px-3 pb-3">
              <div className="rounded-md border border-[var(--accent-muted)] bg-[rgba(255,255,255,.03)] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    className="text-[9px] uppercase tracking-[0.08em] text-[var(--accent)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Repeat This Message
                  </div>
                  <div className="text-[10px] text-[var(--muted-dim)]">
                    Stops on <code>{CHAT_DRAFT_AUTOMATION_STOP_PHRASE_DEFAULT}</code>. No final message.
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Count</span>
                    <input
                      type="number"
                      min={AUTOMATION_RUNS_MIN}
                      max={AUTOMATION_RUNS_MAX}
                      step={1}
                      value={draftAutomationRunsDraft}
                      onChange={(e) => setDraftAutomationRunsDraft(e.target.value)}
                      className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_120px_minmax(0,1fr)]">
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Every</span>
                      <input
                        type="number"
                        min={AUTOMATION_SLEEP_AMOUNT_MIN}
                        max={AUTOMATION_SLEEP_AMOUNT_MAX}
                        step={1}
                        value={draftAutomationSleepAmountDraft}
                        onChange={(e) => setDraftAutomationSleepAmountDraft(e.target.value)}
                        className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Unit</span>
                      <select
                        value={draftAutomationSleepUnit}
                        onChange={(e) => setDraftAutomationSleepUnit(e.target.value as AutomationSleepUnit)}
                        className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                      >
                        <option value="seconds">Seconds</option>
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </label>
                    <div className="flex items-end">
                      <div className="h-9 w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 text-[10px] text-[var(--muted-dim)] flex items-center">
                        {draftAutomationRuns} send{draftAutomationRuns === 1 ? '' : 's'} with {draftAutomationSleepLabel.toLowerCase()} between runs
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <AutomationRunnerPanel
            open={automationPanelOpen}
            actions={availableAutomationActions}
            selectedAction={selectedAutomationAction}
            selectedActionId={selectedAutomationAction?.id ?? ''}
            onSelectActionId={(nextId) => {
              setSelectedAutomationActionId(nextId);
              const nextAction = availableAutomationActions.find((action) => action.id === nextId) ?? null;
              if (nextAction && typeof nextAction.defaultRuns === 'number') {
                setAutomationRunsDraft(String(nextAction.defaultRuns));
              }
            }}
            runsDraft={automationRunsDraft}
            onRunsDraftChange={setAutomationRunsDraft}
            selectedRuns={selectedAutomationRuns}
            selectedActionDisabled={selectedAutomationActionDisabled}
            controlsDisabled={Boolean(disabled)}
            onTriggerAction={triggerSelectedAutomationAction}
          />
          {hasModeHint && (
            <div
              className="px-4 pb-2 text-[10px] text-[var(--muted-dim)] tracking-wide uppercase"
              style={{ fontFamily: 'var(--display)' }}
            >
              {modeHint}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
