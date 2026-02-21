import React from 'react';

const CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX = 36;
const CHAT_INPUT_TEXTAREA_MAX_HEIGHT_PX = 160;

export type ChatImageAttachmentPayload = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
};

export type ChatSendPayload = {
  prompt: string;
  attachments: ChatImageAttachmentPayload[];
};

type DraftImageAttachment = {
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  previewUrl: string;
};

function makeId(): string {
  // Non-crypto id; only used for React keys.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isLikelyImageFile(f: File): boolean {
  const mime = String((f as any)?.type ?? '').trim().toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = String((f as any)?.name ?? '').trim().toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|tiff?)$/.test(name);
}

function formatBytes(n: number): string {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = num;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? String(Math.floor(v)) : v.toFixed(v >= 10 ? 1 : 2);
  return `${rounded} ${units[i]}`;
}

async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('Failed reading file'));
    r.onload = () => {
      const res = String(r.result ?? '');
      // data:<mime>;base64,<data>
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.readAsDataURL(file);
  });
}

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
  modeHint = '',
  attachmentsEnabled,
  onSend,
}: {
  resetKey: string;
  droneName: string;
  draftValue?: string;
  onDraftValueChange?: (next: string) => void;
  promptError: string | null;
  sending: boolean;
  waiting: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  modeHint?: string;
  attachmentsEnabled?: boolean;
  onSend: (payload: ChatSendPayload) => Promise<boolean>;
}) {
  const [uncontrolledDraft, setUncontrolledDraft] = React.useState('');
  const [attachments, setAttachments] = React.useState<DraftImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const controlledDraftEnabled = typeof draftValue === 'string' && typeof onDraftValueChange === 'function';
  const draft = controlledDraftEnabled ? draftValue : uncontrolledDraft;
  const draftRef = React.useRef(draft);

  const attachmentsOn = attachmentsEnabled !== false;
  const MAX_IMAGES = 8;
  const MAX_BYTES_EACH = 6 * 1024 * 1024;
  const MAX_BYTES_TOTAL = 20 * 1024 * 1024;

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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
    // Revoke any preview object URLs.
    setAttachments((prev) => {
      for (const a of prev) {
        try {
          URL.revokeObjectURL(a.previewUrl);
        } catch {
          // ignore
        }
      }
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

  const trimmed = draft.trim();
  const sendDisabled = Boolean(disabled) || (trimmed.length === 0 && attachments.length === 0);
  const hasModeHint = modeHint.trim().length > 0;

  function openPicker() {
    if (!attachmentsOn) return;
    if (disabled || sending || waiting) return;
    fileInputRef.current?.click();
  }

  function removeAttachment(id: string) {
    setAttachmentError(null);
    setAttachments((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx < 0) return prev;
      const next = prev.slice();
      const [removed] = next.splice(idx, 1);
      try {
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      } catch {
        // ignore
      }
      return next;
    });
  }

  function addFiles(files: File[] | FileList | null | undefined) {
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
        if (!isLikelyImageFile(f)) {
          setAttachmentError('Only image files can be attached.');
          continue;
        }
        const size = Number((f as any).size ?? 0);
        if (!Number.isFinite(size) || size <= 0) {
          setAttachmentError('One of the selected images is empty or unreadable.');
          continue;
        }
        if (size > MAX_BYTES_EACH) {
          setAttachmentError(`Image too large (${formatBytes(size)}). Max per image is ${formatBytes(MAX_BYTES_EACH)}.`);
          continue;
        }
        if (next.length >= MAX_IMAGES) {
          setAttachmentError(`Too many images. Max is ${MAX_IMAGES}.`);
          break;
        }
        if (total + size > MAX_BYTES_TOTAL) {
          setAttachmentError(`Attachments too large in total. Max total is ${formatBytes(MAX_BYTES_TOTAL)}.`);
          break;
        }

        const mime = String((f as any).type ?? '').trim() || 'application/octet-stream';
        const name = String((f as any).name ?? '').trim() || `image-${next.length + 1}`;
        const previewUrl = URL.createObjectURL(f);
        next.push({ id: makeId(), file: f, name, mime, size: Math.floor(size), previewUrl });
        total += size;
      }

      return next;
    });
  }

  const sendNow = () => {
    const prompt = draft.trim();
    const snapshotAttachments = attachments.slice();
    if (!prompt && snapshotAttachments.length === 0) return;
    setDraft('');
    setAttachments([]);
    setAttachmentError(null);
    void (async () => {
      let encoded: ChatImageAttachmentPayload[] = [];
      try {
        encoded = await Promise.all(
          snapshotAttachments.map(async (a) => ({
            name: a.name,
            mime: a.mime,
            size: a.size,
            dataBase64: await fileToBase64(a.file),
          })),
        );
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setAttachmentError(`Failed to read image attachment: ${msg}`);
        // Restore state (best-effort).
        setDraft((cur) => (cur.trim().length === 0 ? prompt : cur));
        setAttachments((cur) => (cur.length === 0 ? snapshotAttachments : cur));
        return;
      }

      const ok = await onSend({ prompt, attachments: encoded });
      if (!ok) {
        // Don't clobber any new text the user started typing.
        setDraft((cur) => (cur.trim().length === 0 ? prompt : cur));
        setAttachments((cur) => (cur.length === 0 ? snapshotAttachments : cur));
      } else {
        // Sent: revoke preview URLs for the snapshot attachments.
        for (const a of snapshotAttachments) {
          try {
            URL.revokeObjectURL(a.previewUrl);
          } catch {
            // ignore
          }
        }
      }
    })();
  };

  return (
    <div
      data-onboarding-id="chat.input"
      className="flex-shrink-0 px-5 pt-2 pb-5 bg-transparent"
      onDragEnter={(e) => {
        if (!attachmentsOn) return;
        if (disabled || sending || waiting) return;
        if (e.dataTransfer?.types?.includes?.('Files')) setDragActive(true);
      }}
      onDragOver={(e) => {
        if (!attachmentsOn) return;
        if (disabled || sending || waiting) return;
        e.preventDefault();
      }}
      onDragLeave={() => {
        if (!attachmentsOn) return;
        setDragActive(false);
      }}
      onDrop={(e) => {
        if (!attachmentsOn) return;
        if (disabled || sending || waiting) return;
        e.preventDefault();
        setDragActive(false);
        addFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <div className="max-w-[1170px] mx-auto">
        {(promptError || attachmentError) && (
          <div className="mb-2 text-[11px] text-[var(--red)] px-1" title={promptError || attachmentError || undefined}>
            {promptError || attachmentError}
          </div>
        )}
        <div
          className={`relative rounded-lg border bg-[var(--panel-alt)] shadow-[0_0_40px_rgba(0,0,0,.2),0_0_80px_rgba(0,0,0,.1)] ${
            dragActive ? 'border-[var(--accent)]' : 'border-[var(--border)]'
          }`}
        >
          {/* Top accent line */}
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-[var(--user-muted)] to-transparent opacity-25" />

          {attachmentsOn && attachments.length > 0 && (
            <div className="px-3 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="text-[10px] text-[var(--muted-dim)] tracking-wide uppercase"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {attachments.length} image{attachments.length === 1 ? '' : 's'} attached
                </div>
                <button
                  type="button"
                  onClick={() => openPicker()}
                  disabled={Boolean(disabled) || sending || waiting}
                  className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded border transition-all ${
                    Boolean(disabled) || sending || waiting
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Attach more images"
                >
                  Add
                </button>
              </div>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {attachments.map((a) => (
                  <div key={a.id} className="relative flex-shrink-0">
                    <img
                      src={a.previewUrl}
                      alt={a.name}
                      className="w-14 h-14 object-cover rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)]"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      disabled={Boolean(disabled) || sending || waiting}
                      className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border text-[10px] font-bold flex items-center justify-center transition-all ${
                        Boolean(disabled) || sending || waiting
                          ? 'opacity-40 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'bg-[var(--panel-raised)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--red)] hover:border-[var(--red)]'
                      }`}
                      title="Remove image"
                      aria-label="Remove image"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-end gap-3 p-3">
            {attachmentsOn && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.currentTarget.files);
                    // allow re-selecting same file
                    e.currentTarget.value = '';
                  }}
                  disabled={Boolean(disabled) || sending || waiting}
                />
                <button
                  type="button"
                  onClick={() => openPicker()}
                  disabled={Boolean(disabled) || sending || waiting}
                  className={`inline-flex items-center justify-center w-[44px] h-[44px] rounded-md border transition-all ${
                    Boolean(disabled) || sending || waiting
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'
                  }`}
                  title="Attach images (paste or drag and drop also works)"
                  aria-label="Attach images"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.5 5.5h3" />
                    <path d="M8 4v3" />
                    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                  </svg>
                </button>
              </>
            )}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                if (!attachmentsOn) return;
                if (disabled || sending || waiting) return;
                const items = Array.from(e.clipboardData?.items ?? []);
                const files: File[] = [];
                for (const it of items) {
                  if (it.kind !== 'file') continue;
                  const f = it.getAsFile();
                  if (f && isLikelyImageFile(f)) files.push(f);
                }
                if (files.length > 0) addFiles(files);
              }}
              onKeyDown={(e) => {
                if ((e.nativeEvent as any)?.isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendNow();
                }
              }}
              rows={1}
              placeholder="Message..."
              className="flex-1 resize-none rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 py-2 text-[13px] leading-[1.35] text-[var(--fg)] placeholder:text-[11px] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--user-muted)] transition-colors"
              style={{ minHeight: CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX }}
              disabled={Boolean(disabled)}
              autoFocus={Boolean(autoFocus)}
              aria-label={`Message ${droneName}`}
            />
            <button
              type="button"
              onClick={() => sendNow()}
              disabled={sendDisabled}
              className={`inline-flex items-center justify-center h-9 min-w-[80px] px-4 rounded-md text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                sendDisabled
                  ? 'opacity-40 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Send"
            >
              {sending ? 'Sending...' : waiting ? 'Waiting...' : 'Send'}
            </button>
          </div>
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
