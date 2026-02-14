import React from 'react';

export function ChatInput({
  resetKey,
  droneName,
  promptError,
  sending,
  waiting,
  disabled,
  autoFocus,
  onSend,
}: {
  resetKey: string;
  droneName: string;
  promptError: string | null;
  sending: boolean;
  waiting: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onSend: (prompt: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

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

  const trimmed = draft.trim();
  const sendDisabled = Boolean(disabled) || !trimmed;

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

          <div className="flex items-end gap-3 p-3">
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
              rows={2}
              placeholder={`Message ${droneName}…`}
              className="flex-1 min-h-[44px] max-h-40 resize-none rounded-md border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3.5 py-2.5 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--user-muted)] transition-colors"
              disabled={Boolean(disabled)}
              autoFocus={Boolean(autoFocus)}
            />
            <button
              type="button"
              onClick={() => sendNow()}
              disabled={sendDisabled}
              className={`self-stretch inline-flex items-center justify-center min-h-[44px] min-w-[88px] px-5 rounded-md text-[11px] font-semibold tracking-wide uppercase border transition-all ${
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
        </div>
      </div>
    </div>
  );
}
