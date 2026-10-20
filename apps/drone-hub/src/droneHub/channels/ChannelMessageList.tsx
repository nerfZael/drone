import React from 'react';
import type { MarkdownTextMentionLink } from '../chat/MarkdownMessage';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { ChatMessageCopyAction } from '../chat/ChatMessageCopyAction';
import { UiSpinner } from '../../ui/components';
import type { ChannelAuthor, ChannelMember, ChannelMessage } from './channels-api';
import { authorDisplay, avatarInitial, avatarTone, groupChannelMessages, plainPreview } from './channel-presentation';
import { IconReply } from './channel-icons';

const TONE_STYLE: Record<ReturnType<typeof avatarTone>, React.CSSProperties> = {
  accent: { color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
  green: { color: 'var(--green)', background: 'color-mix(in srgb, var(--green) 16%, transparent)' },
  info: { color: 'var(--info)', background: 'color-mix(in srgb, var(--info) 16%, transparent)' },
  yellow: { color: 'var(--yellow)', background: 'color-mix(in srgb, var(--yellow) 16%, transparent)' },
  red: { color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 16%, transparent)' },
  user: { color: 'var(--user)', background: 'color-mix(in srgb, var(--user) 16%, transparent)' },
};

export function ChannelAvatar({ author, size = 'large' }: { author: ChannelAuthor | { kind: 'chat'; chatId: string; droneName: string; chatName: string }; size?: 'large' | 'small' }) {
  const display = author.kind === 'user' ? { name: 'You' } : authorDisplay(author as ChannelAuthor);
  const style = author.kind === 'user' ? TONE_STYLE.user : TONE_STYLE[avatarTone(author.chatId)];
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 select-none items-center justify-center font-[var(--weight-semibold)] ${
        size === 'large' ? 'h-8 w-8 rounded-[8px] text-13' : 'h-6 w-6 rounded-[6px] text-11'
      }`}
      style={style}
    >
      {avatarInitial(display.name)}
    </span>
  );
}

function clockTime(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(at: string): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function AuthorName({ author, onOpenChat }: { author: ChannelAuthor; onOpenChat: (droneId: string, chatName: string) => void }) {
  const display = authorDisplay(author);
  if (author.kind === 'user') {
    return <span className="font-[var(--weight-semibold)] text-[var(--user)]">You</span>;
  }
  return (
    <button
      type="button"
      className="min-w-0 truncate text-left font-[var(--weight-semibold)] text-[var(--fg-strong)] hover:underline"
      title={`Open ${display.drone ? `${display.drone} / ${display.name}` : display.name}`}
      onClick={() => onOpenChat(author.droneId, author.chatName)}
    >
      {display.name}
    </button>
  );
}

function ReplyQuote({ replyTo, onJump }: { replyTo: NonNullable<ChannelMessage['replyTo']>; onJump: (id: string) => void }) {
  const display = authorDisplay(replyTo.author);
  return (
    <button
      type="button"
      onClick={() => onJump(replyTo.id)}
      className="group/quote mb-0.5 flex w-full min-w-0 items-center gap-1.5 text-left text-11 text-[var(--muted)] hover:text-[var(--fg-secondary)]"
      title="Show the message this replies to"
    >
      <span aria-hidden="true" className="ml-4 h-2.5 w-6 shrink-0 rounded-tl-[6px] border-l-2 border-t-2 border-[var(--border)]" />
      <span className="shrink-0 font-[var(--weight-semibold)]">
        {replyTo.author.kind === 'user' ? '@user' : `@${replyTo.author.handle ?? display.name}`}
      </span>
      <span className="min-w-0 truncate">{plainPreview(replyTo.text)}</span>
    </button>
  );
}

type Props = {
  channelName: string;
  messages: ChannelMessage[];
  members: ChannelMember[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Messages after this were not read when the channel was opened. */
  firstUnreadSeq: number | null;
  onReply: (message: ChannelMessage) => void;
  onOpenChat: (droneId: string, chatName: string) => void;
  emptyState: React.ReactNode;
};

/**
 * The channel's messages, newest at the bottom. Follows new messages while scrolled to the
 * end and keeps the reading position when older messages load above.
 */
export function ChannelMessageList({
  channelName,
  messages,
  members,
  hasMore,
  loadingOlder,
  onLoadOlder,
  firstUnreadSeq,
  onReply,
  onOpenChat,
  emptyState,
}: Props) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const atBottomRef = React.useRef(true);
  const previousHeightRef = React.useRef<{ first: string | undefined; last: string | undefined; height: number } | null>(null);
  const [flashId, setFlashId] = React.useState<string | null>(null);

  const mentionLinks = React.useMemo<MarkdownTextMentionLink[]>(() => {
    const links: MarkdownTextMentionLink[] = [{ key: 'user', label: '@user', title: 'You' }];
    for (const member of members) {
      links.push({ key: `chat:${member.chatId}`, label: `@${member.handle}`, title: `${member.droneName} / ${member.chatName}` });
    }
    // Mentions of chats that have since left still read as mentions.
    for (const message of messages) {
      for (const mention of message.mentions) {
        if (mention.kind === 'chat' && !links.some((link) => link.label === `@${mention.handle}`)) {
          links.push({ key: `chat:${mention.chatId}`, label: `@${mention.handle}` });
        }
      }
    }
    return links;
  }, [members, messages]);
  const openMention = React.useCallback(
    (mention: MarkdownTextMentionLink) => {
      if (!mention.key.startsWith('chat:')) return;
      const chatId = mention.key.slice(5);
      const member = members.find((item) => item.chatId === chatId);
      if (member) onOpenChat(member.droneId, member.chatName);
    },
    [members, onOpenChat],
  );

  React.useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const previous = previousHeightRef.current;
    const newest = messages[messages.length - 1];
    // Older messages were prepended: keep the same messages under the reader's eyes.
    if (previous && previous.first !== messages[0]?.id && messages.some((message) => message.id === previous.first)) {
      element.scrollTop += element.scrollHeight - previous.height;
    } else if (atBottomRef.current || (previous && newest && newest.id !== previous.last && newest.author.kind === 'user')) {
      // Following the end, or you just posted: show the newest message.
      element.scrollTop = element.scrollHeight;
      atBottomRef.current = true;
    }
    previousHeightRef.current = { first: messages[0]?.id, last: newest?.id, height: element.scrollHeight };
  }, [messages]);

  const jumpTo = React.useCallback((id: string) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-channel-message-id="${CSS.escape(id)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    window.setTimeout(() => setFlashId((current) => (current === id ? null : current)), 1600);
  }, []);

  const grouped = groupChannelMessages(messages);
  return (
    <div
      ref={scrollRef}
      className="dh-channel-messages min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3"
      onScroll={(event) => {
        const element = event.currentTarget;
        atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        if (element.scrollTop < 80 && hasMore && !loadingOlder) onLoadOlder();
      }}
      role="log"
      aria-label={`Messages in #${channelName}`}
    >
      {hasMore ? (
        <div className="flex justify-center py-2">
          {loadingOlder ? (
            <UiSpinner size="small" label="Loading earlier messages" />
          ) : (
            <button type="button" className="text-11 text-[var(--muted)] hover:text-[var(--fg)]" onClick={onLoadOlder}>
              Load earlier messages
            </button>
          )}
        </div>
      ) : messages.length ? (
        <div className="px-4 pb-4 pt-6">
          <div className="text-[20px] font-[var(--weight-semibold)] text-[var(--fg-strong)]">#{channelName}</div>
          <div className="mt-1 text-12 text-[var(--muted)]">The start of this channel.</div>
        </div>
      ) : null}
      {messages.length === 0 && !hasMore ? emptyState : null}
      {grouped.map(({ message, continued }, index) => {
        const previous = messages[index - 1];
        const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
        const unreadStart =
          firstUnreadSeq !== null &&
          message.seq >= firstUnreadSeq &&
          (!previous || previous.seq < firstUnreadSeq) &&
          message.author.kind !== 'user';
        const showHeader = !continued || newDay || unreadStart;
        const display = authorDisplay(message.author);
        return (
          <React.Fragment key={message.id}>
            {newDay ? (
              <div className="my-2 flex items-center gap-3 px-4" role="separator">
                <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                <span className="text-10 font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]">{dayLabel(message.createdAt)}</span>
                <span className="h-px flex-1 bg-[var(--border-subtle)]" />
              </div>
            ) : null}
            {unreadStart ? (
              <div className="my-1 flex items-center gap-2 px-4" role="separator" aria-label="New messages">
                <span className="h-px flex-1 bg-[var(--red-border)]" />
                <span className="rounded-full bg-[var(--red)] px-1.5 text-[9px] font-[var(--weight-bold)] uppercase tracking-wide text-white">New</span>
              </div>
            ) : null}
            <div
              data-channel-message-id={message.id}
              data-mentions-user={message.mentionsUser ? 'true' : undefined}
              className={`dh-channel-message group relative flex gap-3 px-4 transition-colors ${showHeader ? 'mt-3 pt-0.5' : 'mt-0'} ${
                message.mentionsUser
                  ? 'border-l-2 border-[var(--yellow)] bg-[var(--yellow-subtle)] pl-[14px]'
                  : 'border-l-2 border-transparent pl-[14px] hover:bg-[var(--hover)]'
              } ${flashId === message.id ? '!bg-[var(--accent-subtle)]' : ''}`}
            >
              <div className="w-8 shrink-0">
                {showHeader ? (
                  <div className={message.replyTo ? 'mt-[22px]' : 'mt-0.5'}>
                    <ChannelAvatar author={message.author} />
                  </div>
                ) : (
                  <span
                    className="block pt-[3px] text-right text-[9px] tabular-nums leading-5 text-[var(--muted-dim)] opacity-0 group-hover:opacity-100"
                    title={new Date(message.createdAt).toLocaleString()}
                  >
                    {clockTime(message.createdAt)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 pb-0.5">
                {message.replyTo ? <ReplyQuote replyTo={message.replyTo} onJump={jumpTo} /> : null}
                {showHeader ? (
                  <div className="flex min-w-0 items-baseline gap-2 text-13 leading-5">
                    <AuthorName author={message.author} onOpenChat={onOpenChat} />
                    {display.drone ? <span className="min-w-0 truncate text-11 text-[var(--muted)]">{display.drone}</span> : null}
                    <span className="shrink-0 text-10 tabular-nums text-[var(--muted-dim)]" title={new Date(message.createdAt).toLocaleString()}>
                      {clockTime(message.createdAt)}
                    </span>
                  </div>
                ) : null}
                <div className="dh-channel-message-body min-w-0 text-[length:var(--chat-font-size,14px)] leading-relaxed text-[var(--fg)]">
                  <MarkdownMessage text={message.text} textMentionLinks={mentionLinks} onOpenTextMention={openMention} />
                </div>
              </div>
              <div className="pointer-events-none absolute -top-3 right-3 z-10 flex items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => onReply(message)}
                  className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-2 text-11 text-[var(--muted)] shadow-sm hover:text-[var(--accent)]"
                  title={`Reply to ${display.name}`}
                  aria-label={`Reply to ${display.name}`}
                >
                  <IconReply className="h-3.5 w-3.5" />
                  Reply
                </button>
                <ChatMessageCopyAction text={message.text} position="hover-rail" />
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

