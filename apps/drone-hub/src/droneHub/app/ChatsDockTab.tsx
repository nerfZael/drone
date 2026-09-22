import React from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { usePanelTitle } from './ChatWindowTab';
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

/** The Chats window's dock tab. Its list/grid switch lives here so the body keeps its full height. */
export function ChatsDockTab({ api }: IDockviewPanelHeaderProps) {
  const title = usePanelTitle(api);
  const view = useChatsViewStore((state) => state.view);
  const setView = useChatsViewStore((state) => state.setView);
  const middleButtonDown = React.useRef(false);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      className="dv-default-tab"
      data-testid="dockview-dv-default-tab"
      title={title}
      onPointerDown={(event) => {
        middleButtonDown.current = event.button === 1;
        if (event.button === 1) event.preventDefault();
      }}
      onPointerUp={(event) => {
        if (middleButtonDown.current && event.button === 1) api.close();
        middleButtonDown.current = false;
      }}
      onPointerLeave={() => {
        middleButtonDown.current = false;
      }}
    >
      <span className="dv-default-tab-content">{title}</span>
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
            onPointerDown={stop}
            onClick={(event) => {
              stop(event);
              setView(option);
            }}
          >
            {ICONS[option]}
          </button>
        ))}
      </div>
      <span className="dh-dock-tab-divider" aria-hidden="true" />
      <div
        className="dv-default-tab-action"
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          api.close();
        }}
      >
        <svg height="11" width="11" viewBox="0 0 28 28" aria-hidden="true" focusable={false} className="dv-svg">
          <path d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z" />
        </svg>
      </div>
    </div>
  );
}
