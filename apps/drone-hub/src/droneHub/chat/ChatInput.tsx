import React from 'react';

const CHAT_INPUT_TEXTAREA_MIN_HEIGHT_PX = 36;
const CHAT_INPUT_TEXTAREA_MAX_HEIGHT_PX = 160;

export function ChatInput({
  resetKey,
  droneName,
  promptError,
  sending,
  waiting,
  disabled,
  autoFocus,
  modeHint = '',
  onSend,
}: {
  resetKey: string;
  droneName: string;
  promptError: string | null;
  sending: boolean;
  waiting: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  modeHint?: string;
  onSend: (prompt: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
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
    setDraft('');
  }, [resetKey]);

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
  const sendDisabled = Boolean(disabled) || !trimmed;
  const hasModeHint = modeHint.trim().length > 0;

  const sendNow = () => {
    const prompt = draft.trim();
    if (!prompt) return;
    setDraft('');
    void (async () => {
      const ok = await onSend(prompt);
      if (!ok) {
        // Don't clobber any new text the user started typing.
        setDraft((cur) => (cur.trim().length === 0 ? prompt : cur));
      }
    })();
  };

  return (
    <div data-onboarding-id="chat.input" className="flex-shrink-0 px-5 pt-2 pb-5 bg-transparent">
      <div className="max-w-[900px] mx-auto">
        {promptError && (
          <div className="mb-2 text-[11px] text-[var(--red)] px-1" title={promptError}>
            {promptError}
          </div>
        )}
        <div className="relative rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_0_40px_rgba(0,0,0,.2),0_0_80px_rgba(0,0,0,.1)]">
          {/* Top accent line */}
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-[var(--user-muted)] to-transparent opacity-25" />

          <div className="flex items-end gap-2.5 p-2.5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
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
              {sending ? 'Sending…' : waiting ? 'Waiting…' : 'Send'}
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
