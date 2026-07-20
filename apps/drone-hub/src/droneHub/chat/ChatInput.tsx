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
import {
  formatChatVoiceDuration,
  mergeDraftWithVoiceTranscript,
  useChatVoiceRecorder,
} from './use-chat-voice-recorder';

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
  const [composerFocused, setComposerFocused] = React.useState(false);
  const [compactVoiceRecording, setCompactVoiceRecording] = React.useState(false);
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
    durationMillis: voiceRecordingDurationMillis,
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
    setComposerFocused(false);
    setCompactVoiceRecording(false);
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
  const voiceRecordButtonDisabled =
    composerLocked ||
    sending ||
    (showStopAction && !allowSendWhileWaiting) ||
    voiceActionInFlight;
  const voicePauseButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const voiceStopButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const trimmed = draft.trim();
  const sendDisabled = sending || composerLocked || voiceActionInFlight || (trimmed.length === 0 && attachments.length === 0 && !voiceRecordingActive);
  const composerExpanded =
    composerFocused ||
    trimmed.length > 0 ||
    attachments.length > 0 ||
    Boolean(composerContext) ||
    Boolean(promptError || attachmentError) ||
    sending ||
    (voiceRecordingActive && !compactVoiceRecording) ||
    draftAutomationActive ||
    automationPanelOpen;
  const voiceRecordingLabel =
    voiceRecordingStatus === 'starting'
      ? 'Starting…'
      : voiceRecordingStatus === 'recording'
        ? 'Recording'
        : voiceRecordingStatus === 'paused'
          ? 'Paused'
          : voiceRecordingStatus === 'transcribing'
            ? 'Transcribing…'
            : '';
  const voiceRecordingDuration = formatChatVoiceDuration(voiceRecordingDurationMillis);

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

  React.useEffect(() => {
    if (voiceRecordingActive) return;
    setCompactVoiceRecording(false);
  }, [voiceRecordingActive]);

  const previousWaitingRef = React.useRef(waiting);
  React.useEffect(() => {
    const startedWaiting = waiting && !previousWaitingRef.current;
    previousWaitingRef.current = waiting;
    if (!startedWaiting || draftRef.current.trim() || attachmentsRef.current.length > 0) return;
    textareaRef.current?.blur();
    setComposerFocused(false);
  }, [waiting]);

  function openPicker() {
    if (!attachmentsOn) return;
    if (attachmentControlsLocked) return;
    fileInputRef.current?.click();
  }

  async function beginVoiceRecordingFromComposer(compact: boolean) {
    if (compact) {
      setComposerFocused(false);
      setCompactVoiceRecording(true);
    } else {
      setCompactVoiceRecording(false);
    }
    const started = await startVoiceRecording();
    if (!started) setCompactVoiceRecording(false);
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
      className="flex-shrink-0 bg-[var(--chat-background)] px-[.5625rem] pb-[.75rem] pt-[.375rem] [font-family:var(--chat-composer-font)]"
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
      <div className="mx-auto max-w-[73.125rem]">
        {(promptError || attachmentError) && (
          <div className="mb-2 text-[var(--text-11)] text-[var(--red)] px-1" title={promptError || attachmentError || undefined}>
            {promptError || attachmentError}
          </div>
        )}
        <div
          ref={automationPanelRef}
          data-chat-composer-expanded={composerExpanded ? 'true' : 'false'}
          onFocusCapture={(event) => {
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest('[data-chat-composer-collapsed-action="true"]')
            ) return;
            setComposerFocused(true);
          }}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
            setComposerFocused(false);
          }}
          className={`relative min-h-[3.25rem] overflow-visible rounded-[var(--chat-composer-radius)] border bg-[var(--chat-composer-surface)] shadow-[var(--chat-composer-shadow)] transition-colors ${
            dragActive ? 'border-[var(--accent)]' : 'border-[var(--chat-composer-border)]'
          } ${composerExpanded ? 'border-[var(--chat-composer-focus-border)]' : ''}`}
        >
          <ChatComposerContext config={composerContext} />
          {attachmentsOn && attachments.length > 0 && (
            <div className="px-3 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="text-[var(--text-10)] text-[var(--muted-dim)] tracking-wide uppercase"
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
                  className={`text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase px-2 py-1 rounded border transition-all ${
                    attachmentControlsLocked
                      ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
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
                        className="w-14 h-14 object-cover rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)]"
                      />
                    ) : (
                      <div className="min-h-[3.5rem] w-[11.25rem] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5">
                        <div
                          className="text-[var(--text-9)] uppercase tracking-wide text-[var(--muted-dim)]"
                        >
                          {a.kind === 'text' ? 'Text attachment' : 'File attachment'}
                        </div>
                        <div className="mt-1 truncate text-[var(--text-10)] text-[var(--fg-secondary)]">{a.name}</div>
                        <div className="mt-0.5 text-[var(--text-9)] text-[var(--muted-dim)]">{formatBytes(a.size)}</div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      disabled={attachmentControlsLocked}
                      className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border text-[var(--text-10)] font-[var(--weight-bold)] flex items-center justify-center transition-all ${
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

          {attachmentsOn ? (
            <input
              ref={fileInputRef}
              type="file"
              accept={attachmentMode === 'images' ? 'image/*' : undefined}
              multiple
              className="hidden"
              onChange={(event) => {
                addFiles(event.currentTarget.files, { source: 'file' });
                event.currentTarget.value = '';
              }}
              disabled={attachmentControlsLocked}
            />
          ) : null}

          <div className={`relative flex items-center ${composerExpanded ? 'px-4' : 'min-h-[3.125rem] px-[.5625rem]'}`}>
            {!composerExpanded && compactVoiceRecording && voiceRecordingActive ? (
              <>
                <button
                  type="button"
                  data-chat-composer-collapsed-action="true"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void discardVoiceRecording()}
                  disabled={voiceRecordingStatus === 'transcribing' || voiceActionInFlight}
                  className="inline-flex h-[2.125rem] w-[2.125rem] flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Discard recording"
                  aria-label="Discard recording"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-[.4375rem] px-3 text-[.625rem] font-medium tracking-[.015625rem]">
                  <span
                    className={`h-[.4375rem] w-[.4375rem] flex-shrink-0 rounded-full ${
                      voiceRecordingStatus === 'paused'
                        ? 'bg-[var(--yellow)]'
                        : voiceRecordingStatus === 'transcribing'
                          ? 'bg-[var(--accent)]'
                          : 'bg-[var(--red)]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate text-[var(--accent)]" aria-live="polite">{voiceRecordingLabel}</span>
                  <span className="flex-shrink-0 font-mono text-[.6875rem] font-normal tabular-nums tracking-normal text-[var(--chat-composer-fg)]" aria-label={`${voiceRecordingDuration} elapsed`}>
                    {voiceRecordingDuration}
                  </span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-[.4375rem]">
                  <button
                    type="button"
                    data-chat-composer-collapsed-action="true"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggleVoiceRecordingPause()}
                    disabled={voicePauseButtonDisabled}
                    className={`inline-flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-[var(--chat-composer-control-radius)] border transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 ${
                      voiceRecordingStatus === 'paused'
                        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)]'
                    }`}
                    title={voiceRecordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
                    aria-label={voiceRecordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
                  >
                    {voiceRecordingStatus === 'paused' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                        <path d="M8 5v14l11-7Z" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M9 5v14" />
                        <path d="M15 5v14" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    data-chat-composer-collapsed-action="true"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void stopVoiceRecordingAndFillDraft()}
                    disabled={voiceStopButtonDisabled}
                    className="inline-flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Stop recording and transcribe"
                    aria-label="Stop recording and transcribe"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="1" />
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <>
            {!composerExpanded && attachmentsOn ? (
              <button
                type="button"
                data-chat-composer-collapsed-action="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openPicker}
                disabled={attachmentControlsLocked}
                className="inline-flex h-[2.125rem] w-[2.125rem] flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] text-[var(--chat-composer-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                title={attachmentMode === 'files' ? 'Attach files' : 'Attach images'}
                aria-label={attachmentMode === 'files' ? 'Attach files' : 'Attach images'}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            ) : null}
            <textarea
              ref={textareaRef}
              data-chat-input-focus-id={focusTargetId || undefined}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const files = attachmentMode === 'files'
                  ? filesFromClipboardData(event.clipboardData)
                  : imageFilesFromClipboardData(event.clipboardData);
                if (attachmentsOn && !attachmentControlsLocked && files.length > 0) {
                  event.preventDefault();
                  addFiles(files, { source: 'paste' });
                  return;
                }
                const pastedText = String(event.clipboardData?.getData('text/plain') ?? '');
                if (
                  attachmentsOn &&
                  !attachmentControlsLocked &&
                  pastedText.length >= CHAT_INPUT_PASTE_TEXT_AS_ATTACHMENT_MIN_CHARS
                ) {
                  event.preventDefault();
                  addPastedTextAttachment(pastedText);
                }
              }}
              onKeyDown={(event) => {
                if ((event.nativeEvent as any)?.isComposing) return;
                if (event.key === 'Escape') {
                  event.currentTarget.blur();
                  return;
                }
                const modifierKey = event.ctrlKey || event.metaKey;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendNow({ trigger: 'keyboard', modifierKey });
                }
              }}
              rows={1}
              placeholder="Ask the agent"
              className={`min-w-[11.25rem] max-h-[8.25rem] flex-1 resize-none border-0 bg-transparent text-[var(--chat-text-size)] leading-[1.25rem] text-[var(--chat-composer-fg)] caret-[var(--accent)] placeholder:text-[var(--chat-composer-placeholder)] focus:outline-none ${
                composerExpanded ? 'min-h-[2.75rem] px-0 pb-0 pt-3' : 'min-h-[3.125rem] px-[.6875rem] pb-[.6875rem] pt-[.9375rem]'
              }`}
              disabled={composerLocked || voiceRecordingActive}
              autoFocus={Boolean(autoFocus)}
              aria-label={`Message ${droneName}`}
            />
            {!composerExpanded ? (
              <>
                <button
                  type="button"
                  data-chat-composer-collapsed-action="true"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    textareaRef.current?.blur();
                    void beginVoiceRecordingFromComposer(true);
                  }}
                  disabled={voiceRecordButtonDisabled}
                  className="inline-flex h-[2.125rem] w-[2.125rem] flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] text-[var(--chat-composer-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Record voice message"
                  aria-label="Record voice message"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3" />
                  </svg>
                </button>
                {showStopAction ? (
                  <button
                    type="button"
                    data-chat-composer-collapsed-action="true"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void onStop?.()}
                    disabled={stopping}
                    className="inline-flex h-[2.125rem] w-[2.125rem] flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
                    title={stopping ? 'Stopping response' : 'Stop response'}
                    aria-label={stopping ? 'Stopping response' : 'Stop response'}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="1" />
                    </svg>
                  </button>
                ) : null}
              </>
            ) : null}
              </>
            )}
          </div>

          {voiceRecordingActive && composerExpanded ? (
            <div className="flex items-center gap-[.4375rem] px-3 pb-2 pt-[.3125rem] text-[.625rem] font-medium tracking-[.015625rem]">
              <span
                className={`h-[.4375rem] w-[.4375rem] rounded-full ${
                  voiceRecordingStatus === 'paused'
                    ? 'bg-[var(--yellow)]'
                    : voiceRecordingStatus === 'transcribing'
                      ? 'bg-[var(--accent)]'
                      : 'bg-[var(--red)]'
                }`}
                aria-hidden="true"
              />
              <span className="text-[var(--accent)]" aria-live="polite">{voiceRecordingLabel}</span>
              <span className="font-mono text-[.6875rem] font-normal tabular-nums tracking-normal text-[var(--chat-composer-fg)]" aria-label={`${voiceRecordingDuration} elapsed`}>
                {voiceRecordingDuration}
              </span>
            </div>
          ) : null}

          {composerExpanded ? (
            <div className="flex min-h-[2.9375rem] flex-wrap items-center gap-[.4375rem] px-[.5625rem] pb-[.5625rem]">
              {voiceRecordingActive ? (
                <button
                  type="button"
                  onClick={() => void discardVoiceRecording()}
                  disabled={voiceRecordingStatus === 'transcribing' || voiceActionInFlight}
                  className="inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-[.5rem] border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Discard recording"
                  aria-label="Discard recording"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
              ) : attachmentsOn ? (
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={attachmentControlsLocked}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                  title={attachmentMode === 'files' ? 'Attach files' : 'Attach images'}
                  aria-label={attachmentMode === 'files' ? 'Attach files' : 'Attach images'}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              ) : null}

              <div className="min-w-2 flex-1" />

              {!voiceRecordingActive ? <ChatComposerControls config={composerControls} /> : null}

              {!voiceRecordingActive && supportsDraftAutomation ? (
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
                className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--chat-composer-control-radius)] border px-3 text-[.625rem] font-medium tracking-wide uppercase transition-opacity ${
                  Boolean(disabled)
                    ? 'cursor-not-allowed border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)] opacity-40'
                    : draftAutomationActive
                      ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)] hover:opacity-70'
                }`}
                title="Send this draft as a repeating automation"
              >
                Repeat
                <span className="text-[var(--text-9)] text-[var(--muted-dim)]">{draftAutomationActive ? 'On' : 'Off'}</span>
              </button>
              ) : null}
              {!voiceRecordingActive && availableAutomationActions.length > 0 ? (
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setAutomationPanelOpen((open) => !open)}
                  disabled={Boolean(disabled)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--chat-composer-control-radius)] border px-3 text-[.625rem] font-medium tracking-wide uppercase transition-opacity ${
                    Boolean(disabled)
                      ? 'cursor-not-allowed border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)] opacity-40'
                      : 'border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)] hover:opacity-70'
                  }`}
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
              ) : null}
              {!voiceRecordingActive && onPublish ? (
              <button
                type="button"
                onClick={() => {
                  void onPublish();
                }}
                disabled={Boolean(disabled) || publishing}
                className={`inline-flex h-8 items-center justify-center rounded-[var(--chat-composer-control-radius)] border px-3 text-[.625rem] font-medium uppercase tracking-wide transition-opacity ${
                  Boolean(disabled) || publishing
                    ? 'cursor-not-allowed border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] opacity-40'
                    : 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:opacity-70'
                }`}
                title="Publish this draft and send queued messages"
              >
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
              ) : null}

              {voiceRecordingActive ? (
                <>
                  <button
                    type="button"
                    onClick={() => toggleVoiceRecordingPause()}
                    disabled={voicePauseButtonDisabled}
                    className={`inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-[.5rem] border transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 ${
                      voiceRecordingStatus === 'paused'
                        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)]'
                    }`}
                    title={voiceRecordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
                    aria-label={voiceRecordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
                  >
                    {voiceRecordingStatus === 'paused' ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                        <path d="M8 5v14l11-7Z" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M9 5v14" />
                        <path d="M15 5v14" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopVoiceRecordingAndFillDraft()}
                    disabled={voiceStopButtonDisabled}
                    className="inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-[.5rem] border border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Stop recording and transcribe"
                    aria-label="Stop recording and transcribe"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="1" />
                    </svg>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    textareaRef.current?.blur();
                    void beginVoiceRecordingFromComposer(false);
                  }}
                  disabled={voiceRecordButtonDisabled}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Record voice message"
                  aria-label="Record voice message"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3" />
                  </svg>
                </button>
              )}

              {showSeparateStopAction ? (
              <button
                type="button"
                onClick={() => void onStop?.()}
                disabled={stopping}
                className="inline-flex h-8 items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 text-[.625rem] font-medium uppercase tracking-wide text-[var(--red)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
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
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--chat-composer-control-radius)] border transition-opacity hover:opacity-70 ${
                showStopAction && !showSeparateStopAction
                  ? stopping
                    ? 'opacity-50 cursor-not-allowed bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)]'
                    : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                  : sendDisabled
                    ? 'cursor-not-allowed border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] opacity-40'
                    : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
              }`}
              title={showStopAction && !showSeparateStopAction ? 'Stop response' : 'Send'}
              aria-label={sendButtonLabel}
            >
                {showStopAction && !showSeparateStopAction ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="1" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                )}
              </button>
            </div>
          ) : null}
          {draftAutomationActive && (
            <div className="px-3 pb-3">
              <div className="rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--surface-soft)] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    className="text-[var(--text-9)] uppercase tracking-[0.08em] text-[var(--accent)]"
                  >
                    Repeat This Message
                  </div>
                  <div className="text-[var(--text-10)] text-[var(--muted-dim)]">
                    Stops on <code>{CHAT_DRAFT_AUTOMATION_STOP_PHRASE_DEFAULT}</code>. No final message.
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
                  <label className="flex flex-col gap-1">
                    <span className="text-[var(--text-9)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Count</span>
                    <input
                      type="number"
                      min={AUTOMATION_RUNS_MIN}
                      max={AUTOMATION_RUNS_MAX}
                      step={1}
                      value={draftAutomationRunsDraft}
                      onChange={(e) => setDraftAutomationRunsDraft(e.target.value)}
                      className="h-[var(--control-height)] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-[var(--text-12)] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_120px_minmax(0,1fr)]">
                    <label className="flex flex-col gap-1">
                      <span className="text-[var(--text-9)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Every</span>
                      <input
                        type="number"
                        min={AUTOMATION_SLEEP_AMOUNT_MIN}
                        max={AUTOMATION_SLEEP_AMOUNT_MAX}
                        step={1}
                        value={draftAutomationSleepAmountDraft}
                        onChange={(e) => setDraftAutomationSleepAmountDraft(e.target.value)}
                        className="h-[var(--control-height)] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-[var(--text-12)] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[var(--text-9)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Unit</span>
                      <select
                        value={draftAutomationSleepUnit}
                        onChange={(e) => setDraftAutomationSleepUnit(e.target.value as AutomationSleepUnit)}
                        className="h-[var(--control-height)] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-[var(--text-12)] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                      >
                        <option value="seconds">Seconds</option>
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </label>
                    <div className="flex items-end">
                      <div className="h-[var(--control-height)] w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-10)] text-[var(--muted-dim)] flex items-center">
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
              className="px-4 pb-2 text-[var(--text-10)] text-[var(--muted-dim)] tracking-wide uppercase"
            >
              {modeHint}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
