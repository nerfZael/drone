import React from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { DockTabShell, OpenDesktopToolButton, stopTabEvent } from './DockTabShell';
import { CHATS_VIEWS, useChatsViewStore, type ChatsView } from './chats-view-store';

const ICONS: Record<ChatsView, React.ReactNode> = {
  list: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M3 4h10M3 8h10M3 12h10" />
    </svg>
  ),
  grid: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  ),
};

const LABELS: Record<ChatsView, string> = {
  list: 'List: one row per chat with its latest message',
  grid: 'Grid: every chat open side by side',
};

const chatsTab = () => 'chats' as const;

/** The Chats window's dock tab. Its list/grid switch lives here so the body keeps its full height. */
export function ChatsDockTab({ api }: IDockviewPanelHeaderProps) {
  const view = useChatsViewStore((state) => state.view);
  const setView = useChatsViewStore((state) => state.setView);
  return (
    <DockTabShell api={api}>
      <div role="radiogroup" aria-label="Chat view" className="dh-dock-tab-group">
        {CHATS_VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            className="dh-dock-tab-button"
            title={LABELS[option]}
            aria-label={LABELS[option]}
            aria-checked={view === option}
            data-chats-view={option}
            onPointerDown={stopTabEvent}
            onClick={(event) => {
              stopTabEvent(event);
              setView(option);
            }}
          >
            {ICONS[option]}
          </button>
        ))}
      </div>
      <OpenDesktopToolButton tab={chatsTab} />
    </DockTabShell>
  );
}
