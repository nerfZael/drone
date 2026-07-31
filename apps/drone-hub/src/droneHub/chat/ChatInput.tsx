import React from 'react';
import {
  CHAT_ATTACHMENT_POLICY,
  validateChatAttachments,
  type ChatAttachmentValidationIssue,
} from '@drone/assistant-chat';
import { ChatComposerContext, type ChatComposerContextConfig } from './ChatComposerContext';
import { ChatComposerControls, type ChatComposerControlsConfig } from './ChatComposerControls';
import { chatResponseStopVisible } from './chat-response-stop-visible';
import {
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
import {
  chatSendShortcut,
  type ChatMessageDeliveryMode,
} from './chat-send-shortcuts';

const CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX = 36;
const CHAT_INPUT_TEXTAREA_MAX_HEIGHT_PX = 160;

function attachmentPolicyError(
  issue: ChatAttachmentValidationIssue,
  kind: 'image' | 'file' | 'text',
): string {
  if (issue.code === 'too_many_attachments') {
    return `Too many attachments. Max is ${CHAT_ATTACHMENT_POLICY.maxCount}.`;
  }
  if (issue.code === 'attachment_too_large') {
    const label = kind === 'text' ? 'Pasted text' : kind === 'file' ? 'File' : 'Image';
    const subject = kind === 'text' ? 'attachment' : kind;
    return `${label} too large (${formatBytes(issue.actual)}). Max per ${subject} is ${formatBytes(CHAT_ATTACHMENT_POLICY.maxBytesEach)}.`;
  }
  if (issue.code === 'attachments_too_large') {
    return `Attachments too large in total. Max total is ${formatBytes(CHAT_ATTACHMENT_POLICY.maxBytesTotal)}.`;
  }
  if (issue.code === 'invalid_mime') return 'One of the selected files has an invalid type.';
  return `One of the selected ${kind === 'image' ? 'images' : 'files'} is empty or unreadable.`;
}

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
  deliveryMode: ChatMessageDeliveryMode;
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
  composerStatus?: React.ReactNode;
  composerFooter?: React.ReactNode;
  alwaysExpanded?: boolean;
  allowSendWhileWaiting?: boolean;
  onSend: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onSendInNewChat?: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onPublish?: () => Promise<boolean> | boolean;
  publishing?: boolean;
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
  composerStatus,
  composerFooter,
  alwaysExpanded = false,
  allowSendWhileWaiting = false,
  onSend,
  onSendInNewChat,
  onPublish,
  publishing = false,
  onStop,
  stopping = false,
}: ChatInputProps) {
  const [uncontrolledDraft, setUncontrolledDraft] = React.useState('');
  const [attachments, setAttachments] = React.useState<DraftChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [voiceActionInFlight, setVoiceActionInFlight] = React.useState(false);
  const [composerFocused, setComposerFocused] = React.useState(false);
  const [compactVoiceRecording, setCompactVoiceRecording] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const voiceActionInFlightRef = React.useRef(false);
  const voiceActionTokenRef = React.useRef(0);
  const controlledDraftEnabled = typeof draftValue === 'string' && typeof onDraftValueChange === 'function';
  const draft = controlledDraftEnabled ? draftValue : uncontrolledDraft;
  const draftRef = React.useRef(draft);
  const attachmentsRef = React.useRef(attachments);
  const composerLocked = Boolean(disabled);
  const attachmentControlsLocked = composerLocked || sending;

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
    setComposerFocused(false);
    setCompactVoiceRecording(false);
    // Revoke any preview object URLs.
    setAttachments((prev) => {
      revokeDraftImagePreviewUrls(prev);
      return [];
    });
  }, [controlledDraftEnabled, resetKey]);

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

  const voiceRecordingActive = voiceRecordingStatus !== 'idle';
  const showStopAction = chatResponseStopVisible({
    waiting,
    hasStopAction: typeof onStop === 'function',
    voiceRecordingActive,
  });
  const showSeparateStopAction = showStopAction && allowSendWhileWaiting;
  const hasModeHint = modeHint.trim().length > 0;
  const voiceRecordingCanPauseOrStop = voiceRecordingStatus === 'recording' || voiceRecordingStatus === 'paused';
  const voiceRecordButtonDisabled =
    composerLocked ||
    sending ||
    voiceActionInFlight;
  const voicePauseButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const voiceStopButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const trimmed = draft.trim();
  const sendDisabled = sending || composerLocked || voiceActionInFlight || (trimmed.length === 0 && attachments.length === 0 && !voiceRecordingActive);
  const composerExpanded =
    alwaysExpanded ||
    composerFocused ||
    trimmed.length > 0 ||
    attachments.length > 0 ||
    Boolean(composerContext) ||
    Boolean(promptError || attachmentError) ||
    sending ||
    (voiceRecordingActive && !compactVoiceRecording);
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
    voiceActionTokenRef.current += 1;
    voiceActionInFlightRef.current = false;
    setVoiceActionInFlight(false);
    void discardVoiceRecording();
  }, [discardVoiceRecording, resetKey]);

  React.useEffect(() => {
    if (!voiceRecordingActive) return;
    if (!composerLocked) return;
    voiceActionTokenRef.current += 1;
    voiceActionInFlightRef.current = false;
    setVoiceActionInFlight(false);
    void discardVoiceRecording();
  }, [composerLocked, discardVoiceRecording, voiceRecordingActive]);

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

      for (const f of list) {
        if (!f) continue;
        const image = isLikelyImageFile(f);
        if (attachmentMode === 'images' && !image) {
          setAttachmentError('Only image files can be attached.');
          continue;
        }
        const size = Number((f as any).size ?? 0);
        const mime = mimeForChatAttachmentFile(f);
        const name = String((f as any).name ?? '').trim() || `attachment-${next.length + 1}`;
        const policy = validateChatAttachments([
          ...next.map(({ name, mime, size }) => ({ name, mime, size })),
          { name, mime, size },
        ]);
        if (!policy.ok) {
          setAttachmentError(
            attachmentPolicyError(policy.issue, attachmentMode === 'files' ? 'file' : 'image'),
          );
          if (
            policy.issue.code === 'too_many_attachments' ||
            policy.issue.code === 'attachments_too_large'
          ) {
            break;
          }
          continue;
        }
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
      const textCount = prev.filter((attachment) => attachment.kind === 'text').length;
      const name = makePastedTextAttachmentName(textCount);
      const policy = validateChatAttachments([
        ...prev.map(({ name, mime, size }) => ({ name, mime, size })),
        { name, mime: 'text/plain', size },
      ]);
      if (!policy.ok) {
        setAttachmentError(attachmentPolicyError(policy.issue, 'text'));
        return prev;
      }
      return [
        ...prev,
        {
          kind: 'text',
          id: makeDraftImageAttachmentId(),
          text,
          name,
          mime: 'text/plain',
          size,
          disposition: 'artifact',
        },
      ];
    });
  }

  async function submitPromptSnapshot(
    prompt: string,
    snapshotAttachments: DraftChatAttachment[],
    context: ChatSendContext,
    submit: ChatInputProps['onSend'] = onSend,
  ) {
    if (!prompt && snapshotAttachments.length === 0) return;
    setDraft('');
    setAttachments([]);
    setAttachmentError(null);
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

    const ok = await submit({ prompt, attachments: encoded }, context);
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

  const sendNow = (
    context: ChatSendContext,
    submit: ChatInputProps['onSend'] = onSend,
  ) => {
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
        await submitPromptSnapshot(prompt, snapshotAttachments, context, submit);
      } finally {
        endVoiceAction(actionToken);
      }
    })();
  };

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
              <div className="text-[var(--text-10)] uppercase tracking-wide text-[var(--muted-dim)]">
                {attachments.length} attachment{attachments.length === 1 ? '' : 's'} attached
                {imageAttachmentCount > 0 ? ` • ${imageAttachmentCount} image${imageAttachmentCount === 1 ? '' : 's'}` : ''}
                {textAttachmentCount > 0 ? ` • ${textAttachmentCount} text attachment${textAttachmentCount === 1 ? '' : 's'}` : ''}
                {fileAttachmentCount > 0 ? ` • ${fileAttachmentCount} file${fileAttachmentCount === 1 ? '' : 's'}` : ''}
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
                  <button
                    type="button"
                    data-chat-composer-collapsed-action="true"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => sendNow({ trigger: 'button', deliveryMode: 'asap' })}
                    disabled={sendDisabled}
                    className="inline-flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                    title={voiceActionInFlight ? sendButtonLabel : 'Transcribe and send recording'}
                    aria-label={voiceActionInFlight ? sendButtonLabel : 'Transcribe and send recording'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 19V5" />
                      <path d="m5 12 7-7 7 7" />
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
                const shortcutAction = chatSendShortcut({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  altKey: event.altKey,
                  hasContent:
                    Boolean(draftRef.current.trim()) ||
                    attachmentsRef.current.length > 0 ||
                    voiceRecordingActive,
                });
                if (!shortcutAction) return;
                if (shortcutAction === 'new-chat' && !onSendInNewChat) return;
                event.preventDefault();
                if (shortcutAction === 'new-chat') {
                  sendNow(
                    { trigger: 'keyboard', deliveryMode: 'asap' },
                    onSendInNewChat!,
                  );
                  return;
                }
                sendNow({ trigger: 'keyboard', deliveryMode: shortcutAction });
              }}
              rows={1}
              placeholder="Ask the agent"
              className={`min-w-[11.25rem] max-h-[8.25rem] flex-1 resize-none border-0 bg-transparent text-[var(--chat-text-size)] leading-[1.25rem] text-[var(--chat-composer-fg)] caret-[var(--cursor)] placeholder:text-[var(--chat-composer-placeholder)] focus:outline-none ${
                composerExpanded ? 'min-h-[2.75rem] px-0 pb-0 pt-3' : 'min-h-[3.125rem] px-[.6875rem] pb-[.6875rem] pt-[.9375rem]'
              }`}
              disabled={composerLocked || voiceRecordingActive}
              autoFocus={Boolean(autoFocus)}
              aria-label={`Message ${droneName}`}
              aria-keyshortcuts={
                onSendInNewChat ? 'Enter Tab Control+Enter Meta+Enter' : 'Enter Tab'
              }
            />
            {!composerExpanded ? (
              <>
                {!voiceRecordingActive && composerStatus ? (
                  <div
                    data-chat-composer-collapsed-action="true"
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {composerStatus}
                  </div>
                ) : null}
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

              {!voiceRecordingActive ? composerStatus : null}

              {!voiceRecordingActive ? <ChatComposerControls config={composerControls} /> : null}

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
                sendNow({ trigger: 'button', deliveryMode: 'asap' });
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
              title={
                showStopAction && !showSeparateStopAction
                  ? 'Stop response'
                  : onSendInNewChat
                    ? 'Send ASAP (Enter). Queue with Tab. Send in a new chat with Ctrl/Command+Enter.'
                    : 'Send ASAP (Enter). Queue with Tab.'
              }
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
          {hasModeHint && (
            <div
              className="px-4 pb-2 text-[var(--text-10)] text-[var(--muted-dim)] tracking-wide uppercase"
            >
              {modeHint}
            </div>
          )}
        </div>
        {composerFooter ? <div className="mt-2">{composerFooter}</div> : null}
      </div>
    </div>
  );
}
