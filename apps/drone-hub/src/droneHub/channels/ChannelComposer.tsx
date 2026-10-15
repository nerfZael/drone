import React from 'react';
import { ChatInput } from '../chat/ChatInput';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import type { ChannelMember, ChannelMessage } from './channels-api';
import { activeMentionQuery, authorDisplay, insertMention, mentionCandidates, plainPreview, type MentionCandidate } from './channel-presentation';
import { ChannelAvatar } from './ChannelMessageList';
import { IconClose, IconReply } from './channel-icons';

type Props = {
  channelId: string;
  channelName: string;
  members: ChannelMember[];
  replyTo: ChannelMessage | null;
  onCancelReply: () => void;
  onSend: (text: string, replyTo: string | null) => Promise<void>;
};

/** Where a channel's unsent text and editor mode are kept, like a chat's. */
export function channelDraftKey(channelId: string): string {
  return `channel:${channelId}`;
}

/** The composer's own text box, not the editor-mode editor (which has a textarea of its own). */
function composerTextarea(target: EventTarget | null): HTMLTextAreaElement | null {
  return target instanceof HTMLElement && target.tagName === 'TEXTAREA' && !target.closest('.monaco-editor')
    ? (target as HTMLTextAreaElement)
    : null;
}

/**
 * The agent chat's composer, for a channel: voice recording and transcription, the Q/W/E/S
 * shortcuts, editor mode and dictation all work as they do in a chat. Channels carry text
 * only, so attachments are off. Around it: `@` autocomplete over members and the reply bar.
 */
export function ChannelComposer({ channelId, channelName, members, replyTo, onCancelReply, onSend }: Props) {
  const draftKey = channelDraftKey(channelId);
  const draft = useDroneHubUiStore((state) => state.chatInputDrafts[draftKey] ?? '');
  const setChatInputDraft = useDroneHubUiStore((state) => state.setChatInputDraft);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [caret, setCaret] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const [mentionDismissed, setMentionDismissed] = React.useState<number | null>(null);

  React.useEffect(() => setError(null), [channelId]);
  // Reply puts the caret in the composer: its text box, or the editor in editor mode.
  React.useEffect(() => {
    if (!replyTo) return;
    const root = rootRef.current;
    const editor = root?.querySelector<HTMLElement>('.monaco-editor textarea');
    const textarea = [...(root?.querySelectorAll('textarea') ?? [])].find((element) => composerTextarea(element));
    (editor ?? textarea)?.focus();
  }, [replyTo]);

  const query = focused ? activeMentionQuery(draft, caret) : null;
  const candidates: MentionCandidate[] =
    query && mentionDismissed !== query.start ? mentionCandidates(members, query.query) : [];
  const menuOpen = candidates.length > 0;
  React.useEffect(() => setHighlight(0), [query?.query, query?.start]);

  const track = (event: React.SyntheticEvent) => {
    const textarea = composerTextarea(event.target);
    if (!textarea) return;
    textareaRef.current = textarea;
    setCaret(textarea.selectionStart ?? textarea.value.length);
  };
  const choose = (candidate: MentionCandidate) => {
    if (!query) return;
    const next = insertMention(draft, query.start, caret, candidate.handle);
    setChatInputDraft(draftKey, next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea?.isConnected) return;
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    });
  };

  const replyDisplay = replyTo ? authorDisplay(replyTo.author) : null;
  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      // Bubble phase: the composer stores its draft first. A state change while an input event is still being
      // captured re-renders the controlled text box before it sees the new text, and the typing is lost.
      onInput={track}
      onSelect={track}
      onClick={track}
      onKeyUp={track}
      onFocusCapture={(event) => {
        if (composerTextarea(event.target)) {
          setFocused(true);
          track(event);
        }
      }}
      onBlurCapture={(event) => {
        if (composerTextarea(event.target)) setFocused(false);
      }}
      // Autocomplete keys are taken before the composer sees them, so Enter picks a member instead of sending.
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || !composerTextarea(event.target)) return;
        if (!menuOpen) {
          // Esc drops the reply and keeps you typing; with no reply it leaves the composer as usual.
          if (event.key === 'Escape' && replyTo) {
            event.preventDefault();
            event.stopPropagation();
            onCancelReply();
          }
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setHighlight((current) => (current + step + candidates.length) % candidates.length);
        } else if (event.key === 'Enter' || event.key === 'Tab') {
          choose(candidates[highlight] ?? candidates[0]!);
        } else if (event.key === 'Escape') {
          setMentionDismissed(query!.start);
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {menuOpen ? (
        <div
          role="listbox"
          aria-label="Mention a member"
          className="absolute bottom-full left-5 right-5 z-40 -mb-1 max-w-[22rem] overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--panel-overlay)] p-1 shadow-[var(--edge-highlight),var(--shadow-menu)] backdrop-blur-md"
        >
          <div className="px-2 pb-1 pt-0.5 dh-type-eyebrow">Members</div>
          {candidates.map((candidate, index) => {
            const member = members.find((item) => item.chatId === candidate.key)!;
            return (
              <button
                key={candidate.key}
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(candidate)}
                className={`flex w-full min-w-0 items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-12 ${
                  index === highlight ? 'bg-[var(--hover)] text-[var(--fg)]' : 'text-[var(--fg-secondary)]'
                }`}
              >
                <ChannelAvatar author={{ kind: 'chat', chatId: member.chatId, droneName: member.droneName, chatName: member.chatName }} size="small" />
                <span className="min-w-0 truncate font-[var(--weight-medium)]">{candidate.label}</span>
                {candidate.detail ? <span className="min-w-0 truncate text-11 text-[var(--muted)]">{candidate.detail}</span> : null}
                <span className="ml-auto shrink-0 font-mono text-10 text-[var(--muted)]">@{candidate.handle}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <ChatInput
        resetKey={draftKey}
        draftPersistenceKey={draftKey}
        focusTargetId={draftKey}
        droneName={`#${channelName}`}
        placeholder={`Message #${channelName}`}
        promptError={error}
        waiting={false}
        attachmentsEnabled={false}
        onSend={async (payload) => {
          const text = payload.prompt.trim();
          if (!text) return false;
          setError(null);
          try {
            await onSend(text, replyTo?.id ?? null);
            return true;
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            return false;
          }
        }}
        composerTopAction={
          replyTo && replyDisplay ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-11 text-[var(--muted)]">
              <IconReply className="h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">
                Replying to <span className="font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{replyDisplay.name}</span>
              </span>
              <span className="min-w-0 truncate opacity-75">{plainPreview(replyTo.text)}</span>
              <button
                type="button"
                className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-[var(--hover)] hover:text-[var(--fg)]"
                onClick={onCancelReply}
                aria-label="Cancel reply"
                title="Cancel reply (Esc)"
              >
                <IconClose className="h-3 w-3" />
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
