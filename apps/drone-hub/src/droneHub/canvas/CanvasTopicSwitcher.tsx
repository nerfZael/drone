import React from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { UiButton, UiDialog, UiToolbarButton } from '../../ui/components';
import type { DroneDeleteMode } from '../app/settings-types';
import { contextMenuItemBaseClass, contextMenuPanelBaseClass, contextMenuSeparatorClass } from '../../ui/dropdown';
import { IconChevron } from '../icons';
import { useDroneCanvasStore, type CanvasTopic } from './use-drone-canvas-store';

const LISTED_DRONES_MAX = 6;
const MENU_WIDTH_PX = 220;

/**
 * Asks whether deleting a topic takes its drones (and their chats) too, archived or deleted as the
 * delete setting says. Only the topic goes by default; drones in other topics are called out.
 */
export function CanvasTopicDeleteDialog({ topic, topics, droneNameById, deleteMode, onDeleteTopic, onDeleteTopicAndDrones, onCancel }: {
  topic: CanvasTopic;
  /** Every topic, to tell which drones other topics would lose. */
  topics: CanvasTopic[];
  droneNameById: Record<string, string>;
  deleteMode: DroneDeleteMode;
  onDeleteTopic: () => void;
  /** Absent when drones cannot be deleted from here. */
  onDeleteTopicAndDrones?: (droneIds: string[]) => void;
  onCancel: () => void;
}) {
  const topicOnlyRef = React.useRef<HTMLButtonElement | null>(null);
  // Drones deleted since they were added are no longer anyone's to delete.
  const droneIds = topic.droneIds.filter((droneId) => droneNameById[droneId] !== undefined);
  const shared = droneIds.filter((droneId) =>
    topics.some((other) => other.id !== topic.id && other.droneIds.includes(droneId))).length;
  const verb = deleteMode === 'archive' ? 'Archive' : 'Delete';
  const count = `${droneIds.length} drone${droneIds.length === 1 ? '' : 's'}`;
  const names = droneIds.slice(0, LISTED_DRONES_MAX).map((droneId) => droneNameById[droneId] || droneId);
  const more = droneIds.length - names.length;
  return (
    <UiDialog
      open
      onClose={onCancel}
      title={`Delete topic “${topic.name}”?`}
      description={droneIds.length === 0
        ? 'The topic and its layout go. It has no drones.'
        : `The topic and its layout go either way. Its ${count} and their chats stay unless you ${verb.toLowerCase()} them too.`}
      tone="danger"
      size="small"
      showCloseButton={false}
      initialFocusRef={topicOnlyRef}
      footer={(
        <>
          <UiButton onClick={onCancel} size="medium">Cancel</UiButton>
          <UiButton ref={topicOnlyRef} onClick={onDeleteTopic} size="medium" data-canvas-topic-delete="topic">Delete topic only</UiButton>
          {droneIds.length > 0 && onDeleteTopicAndDrones ? (
            <UiButton onClick={() => onDeleteTopicAndDrones(droneIds)} variant="danger" size="medium" data-canvas-topic-delete="drones">
              {verb} {count} too
            </UiButton>
          ) : null}
        </>
      )}
    >
      {droneIds.length > 0 ? (
        <div className="grid gap-1 text-[12px] text-[var(--muted)]">
          <div className="text-[var(--fg)]">{names.join(', ')}{more > 0 ? ` and ${more} more` : ''}</div>
          {deleteMode === 'archive' ? <div>Archived drones can be restored from Settings &gt; Archive before they auto-delete.</div> : null}
          {shared > 0 ? (
            <div data-canvas-topic-delete-shared="">
              {shared === droneIds.length ? (droneIds.length === 1 ? 'It is' : 'All of them are') : `${shared} of them ${shared === 1 ? 'is' : 'are'}`} also in other topics, which would lose {shared === 1 ? 'it' : 'them'} too.
            </div>
          ) : null}
        </div>
      ) : null}
    </UiDialog>
  );
}

/**
 * The topic part of the canvas's board switch: opens a topic, makes a new one (named in place) and
 * renames or deletes the open one. Deleting a topic forgets only its layout; its drones stay.
 */
export function CanvasTopicSwitcher({ defaultRepoPath, onOpened, droneNameById, deleteMode = 'permanent', onDeleteDrones }: {
  /** A new topic's repository for new drones, until it is changed on that topic. */
  defaultRepoPath: string;
  /** Called after a topic is opened or made, so the canvas can take the keyboard back. */
  onOpened?: () => void;
  /** Names of the drones that still exist. */
  droneNameById: Record<string, string>;
  deleteMode?: DroneDeleteMode;
  /** Deletes (or archives) drones without asking again: the topic's delete dialog already asked. */
  onDeleteDrones?: (droneIds: string[]) => void;
}) {
  const { topics, activeTopicId, scope } = useDroneCanvasStore(
    useShallow((s) => ({ topics: s.topics, activeTopicId: s.activeTopicId, scope: s.scope })),
  );
  const active = scope === 'topic' ? topics.find((topic) => topic.id === activeTopicId) ?? null : null;
  const [open, setOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState<{ topicId: string; name: string } | null>(null);
  const [deleting, setDeleting] = React.useState<CanvasTopic | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // The toolbar scrolls sideways and the canvas covers what spills out of it: the menu goes on the page, under the button.
  const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!open) return;
    const view = buttonRef.current?.ownerDocument.defaultView ?? window;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({ left: Math.max(8, Math.min(rect.left, view.innerWidth - MENU_WIDTH_PX - 8)), top: rect.bottom + 4 });
    };
    place();
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    return () => {
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming?.topicId]);

  const store = useDroneCanvasStore.getState;
  const finishRename = (save: boolean) => {
    if (!renaming) return;
    if (save) store().renameTopic(renaming.topicId, renaming.name);
    setRenaming(null);
    onOpened?.();
  };
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  if (renaming) {
    return (
      <input
        ref={inputRef}
        data-canvas-topic-rename=""
        aria-label="Topic name"
        value={renaming.name}
        onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
        onBlur={() => finishRename(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') finishRename(true);
          else if (event.key === 'Escape') finishRename(false);
        }}
        className="h-6 w-[160px] rounded border border-[var(--accent-muted)] bg-[var(--field-bg)] px-1.5 text-[12px] text-[var(--fg)] outline-none"
      />
    );
  }

  return (
    <div className="relative flex-shrink-0" data-canvas-topic-switcher="">
      <UiToolbarButton size="xsmall"
        ref={buttonRef}
        pressed={Boolean(active)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="A board for one piece of work: the drones you add, from any repository, with all of their chats."
        trailingIcon={<IconChevron down size={10} />}
        className="max-w-[180px]"
      >
        {active ? active.name : 'Topic'}
      </UiToolbarButton>
      {open && anchor && buttonRef.current ? createPortal(
        <>
          <div className="fixed inset-0 z-[60]" aria-hidden="true" onClick={() => setOpen(false)} />
          {/* Portaled, but React still bubbles its events to the canvas: keys and clicks stay here. */}
          <div role="menu" aria-label="Topics"
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') setOpen(false); }}
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            style={{ left: anchor.left, top: anchor.top, width: MENU_WIDTH_PX }}
            className={`${contextMenuPanelBaseClass} fixed z-[61]`}>
            {topics.map((topic) => (
              <button key={topic.id} type="button" role="menuitemradio" aria-checked={topic.id === active?.id}
                className={`${contextMenuItemBaseClass} ${topic.id === active?.id ? 'text-[var(--accent)]' : ''}`}
                onClick={() => choose(() => { store().openTopic(topic.id); onOpened?.(); })}>
                <span className="min-w-0 flex-1 truncate">{topic.name}</span>
                <span className="flex-shrink-0 text-[11px] text-[var(--muted)]">{topic.droneIds.length}</span>
              </button>
            ))}
            {topics.length > 0 ? <div className={contextMenuSeparatorClass} /> : null}
            <button type="button" role="menuitem" className={contextMenuItemBaseClass}
              onClick={() => choose(() => {
                const topicId = store().createTopic({ repoPath: defaultRepoPath });
                const created = store().topics.find((topic) => topic.id === topicId);
                setRenaming({ topicId, name: created?.name ?? '' });
              })}>
              New topic
            </button>
            {active ? (
              <>
                <button type="button" role="menuitem" className={contextMenuItemBaseClass}
                  onClick={() => choose(() => setRenaming({ topicId: active.id, name: active.name }))}>
                  Rename topic
                </button>
                <button type="button" role="menuitem" className={`${contextMenuItemBaseClass} text-[var(--red)]`}
                  title="Deletes this topic, and asks whether its drones go too."
                  onClick={() => choose(() => setDeleting(active))}>
                  Delete topic…
                </button>
              </>
            ) : null}
          </div>
        </>,
        buttonRef.current.ownerDocument.body,
      ) : null}
      {deleting ? (
        <CanvasTopicDeleteDialog
          topic={deleting}
          topics={topics}
          droneNameById={droneNameById}
          deleteMode={deleteMode}
          onCancel={() => setDeleting(null)}
          onDeleteTopic={() => {
            store().deleteTopic(deleting.id);
            setDeleting(null);
          }}
          onDeleteTopicAndDrones={onDeleteDrones ? (droneIds) => {
            store().deleteTopic(deleting.id);
            setDeleting(null);
            onDeleteDrones(droneIds);
          } : undefined}
        />
      ) : null}
    </div>
  );
}
