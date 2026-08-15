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
  insertVoiceTranscriptAtSelection,
  useChatVoiceRecorder,
} from './use-chat-voice-recorder';
import {
  continuousVoiceStatusLabel,
  useContinuousChatVoice,
} from './use-continuous-chat-voice';
import {
  ChatComposerEditor,
  type ChatComposerEditorHandle,
  type ChatComposerSelection,
} from './ChatComposerEditor';
import {
  DEFAULT_CHAT_MESSAGE_DELIVERY_MODE,
  chatSendShortcut,
  type ChatMessageDeliveryMode,
} from './chat-send-shortcuts';
import {
  restoreChatComposerDraftSnapshot,
  takeChatComposerDraftSnapshot,
  type ChatComposerDraftSnapshot,
} from './chat-composer-draft';
import {
  useContinuousDictation,
  type ContinuousDictationComposerSnapshot,
} from './ContinuousDictationContext';
import { useActiveComposer } from './ActiveComposerContext';
import { mergeDraftWithContinuousDictation } from './continuous-dictation-draft';
import {
  companionTextareaUndoValue,
  type CompanionTextareaUndoSnapshot,
} from './companion-textarea-undo';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { isShortcutMatch } from '../app/shortcuts';
import { preloadMonacoEditor } from '../files/monaco-editor-loader';
import {
  markCurrentChatComposerEditorModeTarget,
  registerChatComposerEditorModeTarget,
} from './chat-composer-editor-mode-shortcut';

const CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX = 36;
const CHAT_INPUT_TEXTAREA_MAX_HEIGHT_PX = 160;

type ChatSubmissionSnapshot = ChatComposerDraftSnapshot<DraftChatAttachment>;

function CodeEditorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 9-3 3 3 3" />
      <path d="m16 9 3 3-3 3" />
      <path d="m14 5-4 14" />
    </svg>
  );
}

function ChatComposerEditorToggle({
  expanded,
  enabled,
  onToggle,
}: {
  expanded: boolean;
  enabled: boolean;
  onToggle: () => void;
}) {
  const label = enabled ? 'Close editor mode' : 'Open editor mode';
  return (
    <button
      type="button"
      data-chat-composer-collapsed-action={expanded ? undefined : 'true'}
      onMouseDown={expanded ? undefined : (event) => event.preventDefault()}
      onPointerEnter={preloadMonacoEditor}
      onFocus={preloadMonacoEditor}
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={label}
      className={
        expanded
          ? `inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] border transition-opacity hover:opacity-70 ${
              enabled
                ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[var(--chat-composer-control-fg)]'
            }`
          : 'inline-flex h-[2.125rem] w-[2.125rem] flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] text-[var(--chat-composer-fg)] transition-opacity hover:opacity-70'
      }
      title={
        enabled
          ? 'Switch back to the chat composer'
          : 'Use a full text editor; queue with the button or Ctrl/Command+Enter'
      }
    >
      <CodeEditorIcon />
    </button>
  );
}

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
  promptId?: string;
};

export type ChatSendContext = {
  trigger: 'button' | 'keyboard';
  deliveryMode: ChatMessageDeliveryMode;
};

export type ChatInputDraftContent = {
  prompt: string;
  attachments: readonly DraftChatAttachment[];
};

export type ChatInputProps = {
  resetKey: string;
  draftPersistenceKey?: string;
  droneName: string;
  draftValue?: string;
  onDraftValueChange?: (next: string) => void;
  onDraftContentChange?: (content: ChatInputDraftContent) => void;
  promptError: string | null;
  waiting: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  focusTargetId?: string;
  modeHint?: string;
  attachmentsEnabled?: boolean;
  attachmentMode?: 'images' | 'files';
  composerContext?: ChatComposerContextConfig;
  composerLeadingControls?: React.ReactNode;
  composerTrailingControls?: React.ReactNode;
  composerControls?: ChatComposerControlsConfig;
  composerTopAction?: React.ReactNode;
  composerStatus?: React.ReactNode;
  composerFooter?: React.ReactNode;
  alwaysExpanded?: boolean;
  allowSendWhileWaiting?: boolean;
  continuousVoiceEnabled?: boolean;
  onSend: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onSendInNewChat?: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onPublish?: () => Promise<boolean> | boolean;
  publishing?: boolean;
  onStop?: () => Promise<void> | void;
  stopping?: boolean;
};

export function ChatInput({
  resetKey,
  draftPersistenceKey,
  droneName,
  draftValue,
  onDraftValueChange,
  onDraftContentChange,
  promptError,
  waiting,
  disabled,
  autoFocus,
  focusTargetId,
  modeHint = '',
  attachmentsEnabled,
  attachmentMode = 'images',
  composerContext,
  composerLeadingControls,
  composerTrailingControls,
  composerControls,
  composerTopAction,
  composerStatus,
  composerFooter,
  alwaysExpanded = false,
  allowSendWhileWaiting = false,
  continuousVoiceEnabled = true,
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
  const [uncontrolledEditorMode, setUncontrolledEditorMode] = React.useState(false);
  const composerRootRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const editorRef = React.useRef<ChatComposerEditorHandle | null>(null);
  const editorModeShortcutTargetId = React.useId();
  const toggleEditorModeRef = React.useRef<() => void>(() => undefined);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const onDraftContentChangeRef = React.useRef(onDraftContentChange);
  onDraftContentChangeRef.current = onDraftContentChange;
  const appendContinuousDictationRef = React.useRef<(text: string) => void>(() => undefined);
  const readCompanionComposerRef = React.useRef<() => ContinuousDictationComposerSnapshot>(() => {
    throw new Error('NO_ACTIVE_COMPOSER');
  });
  const applyCompanionComposerRef = React.useRef<(baseRevision: string, content: string) => { ok: true; revision: string }>(() => {
    throw new Error('COMPOSER_NOT_AVAILABLE');
  });
  const voiceActionInFlightRef = React.useRef(false);
  const voiceActionTokenRef = React.useRef(0);
  const persistenceKey = String(draftPersistenceKey ?? '').trim();
  const persistedDraft = useDroneHubUiStore((state) =>
    persistenceKey ? state.chatInputDrafts[persistenceKey] ?? '' : '',
  );
  const persistedEditorMode = useDroneHubUiStore((state) =>
    persistenceKey ? Boolean(state.chatInputEditorModes[persistenceKey]) : false,
  );
  const setChatInputDraft = useDroneHubUiStore((state) => state.setChatInputDraft);
  const setChatInputEditorMode = useDroneHubUiStore((state) => state.setChatInputEditorMode);
  const toggleEditorModeShortcut = useDroneHubUiStore(
    (state) => state.shortcutBindings.toggleChatComposerEditorMode,
  );
  const controlledDraftEnabled =
    typeof draftValue === 'string' && typeof onDraftValueChange === 'function';
  const draft = controlledDraftEnabled
    ? draftValue
    : persistenceKey
      ? persistedDraft
      : uncontrolledDraft;
  const editorMode = persistenceKey ? persistedEditorMode : uncontrolledEditorMode;
  const draftRef = React.useRef(draft);
  const composerSelectionRef = React.useRef<ChatComposerSelection>({
    start: draft.length,
    end: draft.length,
  });
  const composerSelectionResetKeyRef = React.useRef(resetKey);
  if (composerSelectionResetKeyRef.current !== resetKey) {
    composerSelectionResetKeyRef.current = resetKey;
    composerSelectionRef.current = { start: draft.length, end: draft.length };
  }
  const focusAfterModeChangeRef = React.useRef(false);
  const attachmentsRef = React.useRef(attachments);
  const draftRevisionRef = React.useRef(0);
  const companionUndoRef = React.useRef<CompanionTextareaUndoSnapshot | null>(null);
  const composerLocked = Boolean(disabled);
  const composerLockedRef = React.useRef(composerLocked);
  composerLockedRef.current = composerLocked;
  const attachmentControlsLocked = composerLocked;
  const continuousDictation = useContinuousDictation();
  const activeComposer = useActiveComposer();
  const composerInstanceId = React.useId();
  const activeComposerTargetId = `${composerInstanceId}:${resetKey}`;
  const editorModeRef = React.useRef(editorMode);
  editorModeRef.current = editorMode;
  const activeComposerEligible = React.useCallback(() => {
    const root = composerRootRef.current;
    return Boolean(
      root &&
      root.isConnected &&
      root.offsetParent !== null &&
      !root.closest('[aria-hidden="true"]') &&
      !composerLockedRef.current,
    );
  }, []);
  const companionComposerReadable = React.useCallback(() => {
    const root = composerRootRef.current;
    return Boolean(
      root &&
      root.isConnected &&
      root.offsetParent !== null &&
      !root.closest('[aria-hidden="true"]'),
    );
  }, []);
  React.useEffect(() => {
    return activeComposer.registerComposer({
      id: activeComposerTargetId,
      isEligible: activeComposerEligible,
      isReadable: companionComposerReadable,
      appendTranscript: (text) => appendContinuousDictationRef.current(text),
      readSnapshot: () => readCompanionComposerRef.current(),
      applyContent: (baseRevision, content) => applyCompanionComposerRef.current(baseRevision, content),
    });
  }, [
    activeComposerTargetId,
    activeComposerEligible,
    companionComposerReadable,
    composerLocked,
    activeComposer.registerComposer,
  ]);
  const ownsActiveComposer = activeComposer.activeComposerId === activeComposerTargetId;
  const continuousDictationTargeted = Boolean(
    ownsActiveComposer && continuousDictation?.status !== 'idle',
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
    if (draftRef.current === draft) return;
    draftRef.current = draft;
    draftRevisionRef.current += 1;
    const selection = composerSelectionRef.current;
    if (selection.start > draft.length || selection.end > draft.length) {
      composerSelectionRef.current = { start: draft.length, end: draft.length };
    }
  }, [draft]);

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  React.useEffect(() => {
    onDraftContentChangeRef.current?.({ prompt: draft, attachments });
  }, [attachments, draft]);

  const setDraft = React.useCallback(
    (next: React.SetStateAction<string>, markChanged = true) => {
      const resolved = typeof next === 'function' ? (next as (prev: string) => string)(draftRef.current) : next;
      if (markChanged && resolved !== draftRef.current) draftRevisionRef.current += 1;
      draftRef.current = resolved;
      onDraftContentChangeRef.current?.({ prompt: resolved, attachments: attachmentsRef.current });
      if (controlledDraftEnabled) {
        onDraftValueChange?.(resolved);
        return;
      }
      if (persistenceKey) {
        setChatInputDraft(persistenceKey, resolved);
        return;
      }
      setUncontrolledDraft(resolved);
    },
    [controlledDraftEnabled, onDraftValueChange, persistenceKey, setChatInputDraft],
  );

  readCompanionComposerRef.current = () => ({
    targetId: activeComposerTargetId,
    path: 'composer.md',
    content: draftRef.current,
    revision: String(draftRevisionRef.current),
    mode: composerLockedRef.current ? 'read-only' : 'edit',
  });
  applyCompanionComposerRef.current = (baseRevision, content) => {
    if (composerLockedRef.current) throw new Error('COMPOSER_NOT_EDITABLE');
    if (baseRevision !== String(draftRevisionRef.current)) throw new Error('STALE_COMPOSER_REVISION');
    const before = draftRef.current;
    if (editorModeRef.current) {
      if (!editorRef.current?.applyCompanionEdit(content)) throw new Error('COMPOSER_EDITOR_NOT_READY');
    } else {
      setDraft(content);
      companionUndoRef.current = {
        before,
        after: content,
        afterRevision: String(draftRevisionRef.current),
      };
    }
    return { ok: true, revision: String(draftRevisionRef.current) };
  };
  appendContinuousDictationRef.current = (text) => {
    setDraft((current) => mergeDraftWithContinuousDictation(current, text));
  };

  const setComposerAttachments = React.useCallback(
    (next: React.SetStateAction<DraftChatAttachment[]>, markChanged = true) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: DraftChatAttachment[]) => DraftChatAttachment[])(attachmentsRef.current)
          : next;
      if (markChanged && resolved !== attachmentsRef.current) draftRevisionRef.current += 1;
      attachmentsRef.current = resolved;
      onDraftContentChangeRef.current?.({ prompt: draftRef.current, attachments: resolved });
      setAttachments(resolved);
    },
    [],
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
  const continuousVoice = useContinuousChatVoice({
    resetKey,
    onTranscript: React.useCallback(
      async (text: string, deliveryId: string) =>
        await onSend(
          { prompt: text, attachments: [], promptId: deliveryId },
          {
            trigger: 'button',
            deliveryMode: allowSendWhileWaiting ? 'asap' : 'queue',
          },
        ),
      [allowSendWhileWaiting, onSend],
    ),
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
    if (!controlledDraftEnabled && !persistenceKey) {
      draftRef.current = '';
      setUncontrolledDraft('');
    }
    setAttachmentError(null);
    setComposerFocused(false);
    setCompactVoiceRecording(false);
    // Revoke any preview object URLs.
    setComposerAttachments((prev) => {
      revokeDraftImagePreviewUrls(prev);
      return [];
    }, false);
    // Keep revisions monotonic so an in-flight submission from the previous
    // chat cannot restore its draft after the composer is reset.
    draftRevisionRef.current += 1;
    companionUndoRef.current = null;
  }, [controlledDraftEnabled, persistenceKey, resetKey, setComposerAttachments]);

  React.useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => {
      if (editorMode) editorRef.current?.focus();
      else textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus, editorMode, resetKey]);

  React.useEffect(() => {
    resizeTextarea();
  }, [draft, resetKey, resizeTextarea]);

  const voiceRecordingActive = voiceRecordingStatus !== 'idle';
  const continuousVoiceActive = continuousVoice.status !== 'idle';
  const showStopAction = chatResponseStopVisible({
    waiting,
    hasStopAction: typeof onStop === 'function',
    voiceRecordingActive,
  });
  const showSeparateStopAction = showStopAction && allowSendWhileWaiting;
  const hasModeHint = modeHint.trim().length > 0;
  const voiceRecordingCanPauseOrStop =
    voiceRecordingStatus === 'recording' || voiceRecordingStatus === 'paused';
  const microphoneOwnedElsewhere = Boolean(
    continuousDictation?.microphoneOwner &&
    !voiceRecordingActive &&
    !continuousVoiceActive,
  );
  const voiceRecordButtonDisabled =
    composerLocked || voiceActionInFlight || continuousVoiceActive || microphoneOwnedElsewhere;
  const continuousVoiceButtonDisabled =
    !continuousVoiceEnabled ||
    composerLocked ||
    voiceActionInFlight ||
    voiceRecordingActive ||
    microphoneOwnedElsewhere;
  const voicePauseButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const voiceStopButtonDisabled = !voiceRecordingCanPauseOrStop || voiceActionInFlight;
  const trimmed = draft.trim();
  const sendDisabled =
    composerLocked ||
    voiceActionInFlight ||
    (trimmed.length === 0 &&
      attachments.length === 0 &&
      !voiceRecordingActive);
  const composerExpanded =
    editorMode ||
    alwaysExpanded ||
    composerFocused ||
    trimmed.length > 0 ||
    attachments.length > 0 ||
    Boolean(composerContext) ||
    Boolean(promptError || attachmentError) ||
    continuousDictationTargeted ||
    continuousVoiceActive ||
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
  const continuousVoiceDuration = formatChatVoiceDuration(continuousVoice.durationMillis);
  const continuousVoiceLabel = continuousVoiceStatusLabel(
    continuousVoice.status,
    continuousVoice.pendingCount,
  );

  React.useEffect(() => {
    if (editorMode) preloadMonacoEditor();
  }, [editorMode]);

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
    editorRef.current?.blur();
    setComposerFocused(false);
  }, [waiting]);

  function rememberComposerSelection(selection: ChatComposerSelection) {
    composerSelectionRef.current = {
      start: Math.min(Math.max(0, selection.start), draftRef.current.length),
      end: Math.min(Math.max(selection.start, selection.end), draftRef.current.length),
    };
  }

  function readComposerSelection(): ChatComposerSelection {
    const editorSelection = editorMode ? editorRef.current?.getSelection() : null;
    const textarea = textareaRef.current;
    const selection = editorSelection ??
      (textarea
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : composerSelectionRef.current);
    rememberComposerSelection(selection);
    return composerSelectionRef.current;
  }

  function focusComposerAtSelection(selection = composerSelectionRef.current) {
    rememberComposerSelection(selection);
    if (editorMode) {
      editorRef.current?.setSelection(composerSelectionRef.current);
      editorRef.current?.focus();
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(
      composerSelectionRef.current.start,
      composerSelectionRef.current.end,
    );
  }

  function activateContinuousDictationComposer() {
    focusActiveComposer();
  }

  function focusActiveComposer() {
    activeComposer.focusComposer(activeComposerTargetId);
  }

  function preserveEditorFocus(event: React.MouseEvent<HTMLButtonElement>) {
    if (editorMode) event.preventDefault();
  }

  function toggleEditorMode() {
    readComposerSelection();
    focusAfterModeChangeRef.current = true;
    if (persistenceKey) {
      setChatInputEditorMode(persistenceKey, !editorMode);
    } else {
      setUncontrolledEditorMode((current) => !current);
    }
  }
  toggleEditorModeRef.current = toggleEditorMode;

  React.useEffect(
    () =>
      registerChatComposerEditorModeTarget({
        id: editorModeShortcutTargetId,
        primary: focusTargetId === 'primary-chat',
        isEligible: () => {
          const root = composerRootRef.current;
          return Boolean(
            root &&
            root.isConnected &&
            root.getClientRects().length > 0 &&
            !root.closest('[aria-hidden="true"]'),
          );
        },
        toggle: () => toggleEditorModeRef.current(),
      }),
    [editorModeShortcutTargetId, focusTargetId],
  );

  React.useEffect(() => {
    if (!focusAfterModeChangeRef.current) return;
    focusAfterModeChangeRef.current = false;
    const id = requestAnimationFrame(() => focusComposerAtSelection());
    return () => cancelAnimationFrame(id);
  }, [editorMode]);

  function openPicker() {
    if (!attachmentsOn) return;
    if (attachmentControlsLocked) return;
    fileInputRef.current?.click();
  }

  async function beginVoiceRecordingFromComposer(compact: boolean) {
    readComposerSelection();
    if (compact) {
      setComposerFocused(false);
      setCompactVoiceRecording(true);
    } else {
      setCompactVoiceRecording(false);
    }
    if (editorMode) focusComposerAtSelection();
    const started = await startVoiceRecording();
    if (!started) setCompactVoiceRecording(false);
    if (editorMode) {
      window.requestAnimationFrame(() => focusComposerAtSelection());
    }
  }

  function removeAttachment(id: string) {
    setAttachmentError(null);
    setComposerAttachments((prev) => {
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
    setComposerAttachments((prev) => {
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
    setComposerAttachments((prev) => {
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

  function handleComposerPaste(
    clipboardData: DataTransfer,
    preventDefault: () => void,
    options: { allowTextAttachment: boolean },
  ) {
    const files = attachmentMode === 'files'
      ? filesFromClipboardData(clipboardData)
      : imageFilesFromClipboardData(clipboardData);
    if (attachmentsOn && !attachmentControlsLocked && files.length > 0) {
      preventDefault();
      addFiles(files, { source: 'paste' });
      return;
    }
    const pastedText = String(clipboardData.getData('text/plain') ?? '');
    if (
      options.allowTextAttachment &&
      attachmentsOn &&
      !attachmentControlsLocked &&
      pastedText.length >= CHAT_INPUT_PASTE_TEXT_AS_ATTACHMENT_MIN_CHARS
    ) {
      preventDefault();
      addPastedTextAttachment(pastedText);
    }
  }

  async function submitPromptSnapshot(
    snapshot: ChatSubmissionSnapshot,
    context: ChatSendContext,
    submit: ChatInputProps['onSend'] = onSend,
  ) {
    const { prompt, attachments: snapshotAttachments } = snapshot;
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
      const restored = restoreSubmissionSnapshot(snapshot);
      if (restored.draftRestored || restored.attachmentsRestored) {
        setAttachmentError(`Failed to read attachment: ${msg}`);
      }
      return;
    }

    const ok = await submit({ prompt, attachments: encoded }, context);
    if (!ok) {
      restoreSubmissionSnapshot(snapshot);
    } else {
      // Sent: revoke preview URLs for the snapshot attachments.
      companionUndoRef.current = null;
      revokeDraftImagePreviewUrls(snapshotAttachments);
    }
  }

  function takeSubmissionSnapshot(): ChatSubmissionSnapshot | null {
    const snapshot = takeChatComposerDraftSnapshot<DraftChatAttachment>({
      draft: draftRef,
      attachments: attachmentsRef,
      revision: draftRevisionRef,
    });
    if (!snapshot) return null;
    setDraft('', false);
    setComposerAttachments([], false);
    return snapshot;
  }

  function restoreSubmissionSnapshot(snapshot: ChatSubmissionSnapshot) {
    const restored = restoreChatComposerDraftSnapshot<DraftChatAttachment>({
      draft: draftRef,
      attachments: attachmentsRef,
      revision: draftRevisionRef,
      snapshot,
    });
    if (restored.draftRestored) setDraft(snapshot.prompt, false);
    if (restored.attachmentsRestored) setComposerAttachments(snapshot.attachments, false);
    else revokeDraftImagePreviewUrls(snapshot.attachments);
    return restored;
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

  async function stopVoiceRecordingAndAppendDraft(
    actionToken: number,
  ): Promise<{ draft: string; caret: number } | null> {
    const transcript = await stopVoiceRecordingForTranscript();
    if (voiceActionTokenRef.current !== actionToken) return null;
    if (!transcript) {
      return { draft: draftRef.current, caret: composerSelectionRef.current.end };
    }
    const selection = composerSelectionRef.current;
    const insertion = insertVoiceTranscriptAtSelection(
      draftRef.current,
      transcript,
      selection.start,
      selection.end,
    );
    setDraft(insertion.value);
    rememberComposerSelection({ start: insertion.caret, end: insertion.caret });
    return { draft: insertion.value, caret: insertion.caret };
  }

  async function stopVoiceRecordingAndFillDraft() {
    const actionToken = beginVoiceAction();
    if (actionToken == null) return;
    try {
      const before = draftRef.current;
      const result = await stopVoiceRecordingAndAppendDraft(actionToken);
      if (result == null) return;
      if (result.draft === before) {
        setAttachmentError((current) => current || 'No speech detected.');
      } else {
        const insertionSelection = { start: result.caret, end: result.caret };
        window.requestAnimationFrame(() => focusComposerAtSelection(insertionSelection));
      }
    } finally {
      endVoiceAction(actionToken);
    }
  }

  const sendNow = (
    context: ChatSendContext,
    submit: ChatInputProps['onSend'] = onSend,
  ) => {
    if (composerLocked) return;
    void (async () => {
      const transcribingVoiceRecording = voiceRecordingActive;
      if (voiceRecordingActive) {
        const actionToken = beginVoiceAction();
        if (actionToken == null) return;
        try {
          const result = await stopVoiceRecordingAndAppendDraft(actionToken);
          if (result == null) return;
        } finally {
          endVoiceAction(actionToken);
        }
      }
      const snapshot = takeSubmissionSnapshot();
      if (!snapshot) {
        if (transcribingVoiceRecording) {
          setAttachmentError((current) => current || 'No speech detected.');
        }
        return;
      }
      await submitPromptSnapshot(snapshot, context, submit);
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
        : waiting && !allowSendWhileWaiting
          ? 'Waiting...'
          : 'Send';

  return (
    <div
      ref={composerRootRef}
      data-onboarding-id="chat.input"
      data-continuous-dictation-target={continuousDictationTargeted ? 'true' : undefined}
      className="flex-shrink-0 bg-[var(--chat-background)] px-[.5625rem] pb-[.75rem] pt-[.375rem] [font-family:var(--chat-composer-font)]"
      onPointerDownCapture={() => {
        markCurrentChatComposerEditorModeTarget(editorModeShortcutTargetId);
      }}
      onKeyDownCapture={(event) => {
        if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing) return;
        if (!isShortcutMatch(toggleEditorModeShortcut, event)) return;
        event.preventDefault();
        event.stopPropagation();
        markCurrentChatComposerEditorModeTarget(editorModeShortcutTargetId);
        toggleEditorMode();
      }}
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
        {composerTopAction ? (
          <div className="mb-1 flex min-h-7 items-center justify-start">
            {composerTopAction}
          </div>
        ) : null}
        <div
          data-chat-composer-expanded={composerExpanded ? 'true' : 'false'}
          onFocusCapture={(event) => {
            markCurrentChatComposerEditorModeTarget(editorModeShortcutTargetId);
            focusActiveComposer();
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
          } ${composerExpanded ? 'border-[var(--chat-composer-focus-border)]' : ''} ${
            continuousDictationTargeted
              ? 'ring-1 ring-[var(--accent-muted)] ring-offset-1 ring-offset-[var(--chat-background)]'
              : ''
          }`}
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

          <div className={`relative flex ${editorMode ? 'items-stretch' : 'items-center'} ${composerExpanded ? (editorMode ? '' : 'px-4') : 'min-h-[3.125rem] px-[.5625rem]'}`}>
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
                    onClick={() =>
                      sendNow({
                        trigger: 'button',
                        deliveryMode: DEFAULT_CHAT_MESSAGE_DELIVERY_MODE,
                      })
                    }
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
            {!composerExpanded && !voiceRecordingActive ? (
              <ChatComposerEditorToggle
                expanded={false}
                enabled={false}
                onToggle={toggleEditorMode}
              />
            ) : null}
            {editorMode ? (
              <div
                className={`min-w-0 flex-1 overflow-hidden ${
                  !composerContext && attachments.length === 0
                    ? 'rounded-t-[var(--chat-composer-radius)]'
                    : ''
                }`}
                onPasteCapture={(event) =>
                  handleComposerPaste(
                    event.clipboardData,
                    () => event.preventDefault(),
                    { allowTextAttachment: false },
                  )
                }
              >
                <ChatComposerEditor
                  key={resetKey}
                  ref={editorRef}
                  value={draft}
                  disabled={composerLocked}
                  readOnly={voiceRecordingActive}
                  autoFocus={autoFocus}
                  focusTargetId={focusTargetId}
                  initialSelection={composerSelectionRef.current}
                  onChange={setDraft}
                  onSelectionChange={rememberComposerSelection}
                  onFocus={activateContinuousDictationComposer}
                  onSendQueued={() =>
                    sendNow({ trigger: 'keyboard', deliveryMode: 'queue' })
                  }
                  ariaLabel={`Edit message for ${droneName}`}
                />
              </div>
            ) : (
            <textarea
              ref={textareaRef}
              data-chat-input-focus-id={focusTargetId || undefined}
              value={draft}
              onFocus={activateContinuousDictationComposer}
              onChange={(event) => {
                setDraft(event.target.value);
                rememberComposerSelection({
                  start: event.target.selectionStart,
                  end: event.target.selectionEnd,
                });
              }}
              onSelect={(event) =>
                rememberComposerSelection({
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                })
              }
              onPaste={(event) => {
                handleComposerPaste(
                  event.clipboardData,
                  () => event.preventDefault(),
                  { allowTextAttachment: true },
                );
              }}
              onKeyDown={(event) => {
                if ((event.nativeEvent as any)?.isComposing) return;
                const companionUndoValue = companionTextareaUndoValue(
                  companionUndoRef.current,
                  draftRef.current,
                  String(draftRevisionRef.current),
                );
                if (
                  (event.metaKey || event.ctrlKey) &&
                  !event.shiftKey &&
                  event.key.toLowerCase() === 'z' &&
                  companionUndoValue !== null
                ) {
                  event.preventDefault();
                  companionUndoRef.current = null;
                  setDraft(companionUndoValue);
                  return;
                }
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
            )}
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

          {continuousVoiceActive ? (
            <div className="flex items-center gap-[.4375rem] px-3 pb-2 pt-[.3125rem] text-[.625rem] font-medium tracking-[.015625rem]">
              <span
                className={`h-[.4375rem] w-[.4375rem] rounded-full ${
                  continuousVoice.status === 'error'
                    ? 'bg-[var(--red)]'
                    : continuousVoice.status === 'paused'
                      ? 'bg-[var(--yellow)]'
                      : continuousVoice.status === 'speech'
                        ? 'bg-[var(--green)]'
                        : 'bg-[var(--accent)]'
                }`}
                aria-hidden="true"
              />
              <span className="text-[var(--accent)]" aria-live="polite">
                {continuousVoiceLabel}
              </span>
              <span
                className="font-mono text-[.6875rem] font-normal tabular-nums tracking-normal text-[var(--chat-composer-fg)]"
                aria-label={`${continuousVoiceDuration} elapsed`}
              >
                {continuousVoiceDuration}
              </span>
            </div>
          ) : null}

          {composerExpanded ? (
            <div
              className={`flex min-h-[2.9375rem] flex-wrap items-center gap-[.4375rem] px-[.5625rem] pb-[.5625rem] ${
                editorMode ? 'pt-[.4375rem]' : ''
              }`}
            >
              {voiceRecordingActive ? (
                <button
                  type="button"
                  onMouseDown={preserveEditorFocus}
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
              ) : continuousVoiceActive ? (
                <button
                  type="button"
                  onMouseDown={preserveEditorFocus}
                  onClick={() => void continuousVoice.cancel()}
                  className="inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-[.5rem] border border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] transition-opacity hover:opacity-70"
                  title="Cancel continuous voice and discard unsent audio"
                  aria-label="Cancel continuous voice and discard unsent audio"
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

              <ChatComposerEditorToggle
                expanded
                enabled={editorMode}
                onToggle={toggleEditorMode}
              />

              {!voiceRecordingActive && !continuousVoiceActive
                ? composerLeadingControls
                : null}

              <div className="min-w-2 flex-1" />

              {!voiceRecordingActive && !continuousVoiceActive ? composerStatus : null}

              {!voiceRecordingActive && !continuousVoiceActive
                ? composerTrailingControls
                : null}

              {!voiceRecordingActive && !continuousVoiceActive ? <ChatComposerControls config={composerControls} /> : null}

              {!voiceRecordingActive && !continuousVoiceActive && onPublish ? (
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
                    onMouseDown={preserveEditorFocus}
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
                    onMouseDown={preserveEditorFocus}
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
              ) : continuousVoiceActive ? (
                <>
                  <button
                    type="button"
                    onMouseDown={preserveEditorFocus}
                    onClick={continuousVoice.togglePause}
                    disabled={continuousVoice.status === 'starting' || continuousVoice.status === 'stopping'}
                    className="inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-[.5rem] border border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                    title={continuousVoice.status === 'paused' || continuousVoice.status === 'error' ? 'Resume continuous voice' : 'Pause continuous voice'}
                    aria-label={continuousVoice.status === 'paused' || continuousVoice.status === 'error' ? 'Resume continuous voice' : 'Pause continuous voice'}
                  >
                    {continuousVoice.status === 'paused' || continuousVoice.status === 'error' ? (
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
                    onMouseDown={preserveEditorFocus}
                    onClick={() => void continuousVoice.stop()}
                    disabled={continuousVoice.status === 'starting' || continuousVoice.status === 'stopping' || continuousVoice.status === 'error'}
                    className="inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-[.5rem] border border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Stop continuous voice after pending thoughts are sent"
                    aria-label="Stop continuous voice after pending thoughts are sent"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="1" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                <button
                  type="button"
                  onMouseDown={preserveEditorFocus}
                  onClick={() => void continuousVoice.start()}
                  disabled={continuousVoiceButtonDisabled}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Start continuous voice steering"
                  aria-label="Start continuous voice steering"
                  aria-pressed="false"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12h2" />
                    <path d="M8 8v8" />
                    <path d="M12 5v14" />
                    <path d="M16 8v8" />
                    <path d="M20 12h0" />
                  </svg>
                </button>
                <button
                  type="button"
                  onMouseDown={preserveEditorFocus}
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
                </>
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
                sendNow({
                  trigger: 'button',
                  deliveryMode: DEFAULT_CHAT_MESSAGE_DELIVERY_MODE,
                });
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
                  : editorMode
                    ? 'Queue message. You can also queue with Ctrl/Command+Enter.'
                  : onSendInNewChat
                    ? 'Queue message (Enter). Send ASAP with Tab. Send in a new chat with Ctrl/Command+Enter.'
                    : 'Queue message (Enter). Send ASAP with Tab.'
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
