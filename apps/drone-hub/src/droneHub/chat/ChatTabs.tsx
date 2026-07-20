import React from 'react';

export function ChatTabs({
  chats,
  selected,
  onSelect,
}: {
  chats: string[];
  selected: string;
  onSelect: (c: string) => void;
}) {
  if (chats.length <= 1) return null;
  return (
    <div data-onboarding-id="chat.toolbar.chats" className="flex items-center gap-0.5 overflow-x-auto py-1 no-scrollbar">
      {chats.map((c) => {
        const active = c === selected;
        return (
          <button
            key={c}
            onClick={() => onSelect(c)}
            className={`px-3 py-1 rounded text-[var(--text-11)] font-[var(--weight-semibold)] whitespace-nowrap tracking-wide uppercase transition-all ${
              active
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-muted)] shadow-[var(--glow-accent)]'
                : 'text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border border-transparent'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
