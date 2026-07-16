import React from 'react';

import { IconChatThread, IconPencil, IconPlus, IconSidebarCollapse, IconTrash } from '../app/icons';
import { assistantThreadStatusLabel, formatUpdatedAt } from './assistant-formatters';
import type { AssistantThread } from './assistant-types';

type AssistantThreadSidebarDockSide = 'left' | 'right';

export function AssistantThreadSidebar({
  threads,
  activeThreadId,
  dockSide,
  onCreateThread,
  onSelectThread,
  onDockSideChange,
  onRenameThread,
  onDeleteThread,
  onCollapse,
}: {
  threads: AssistantThread[];
  activeThreadId: string | null;
  dockSide: AssistantThreadSidebarDockSide;
  onCreateThread: () => void;
  onSelectThread: (thread: AssistantThread) => void;
  onDockSideChange: (side: AssistantThreadSidebarDockSide) => void;
  onRenameThread: (thread: AssistantThread, title: string) => Promise<void>;
  onDeleteThread: (thread: AssistantThread) => void;
  onCollapse: () => void;
}) {
  const [renamingThreadId, setRenamingThreadId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [renameSaving, setRenameSaving] = React.useState(false);
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!renamingThreadId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingThreadId]);

  const beginRename = (thread: AssistantThread) => {
    setRenameDraft(thread.title || 'Untitled thread');
    setRenamingThreadId(thread.id);
  };
  const cancelRename = () => {
    if (renameSaving) return;
    setRenamingThreadId(null);
    setRenameDraft('');
  };
  const commitRename = async (thread: AssistantThread) => {
    const title = renameDraft.trim();
    if (!title || title === thread.title) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      await onRenameThread(thread, title);
      setRenamingThreadId(null);
      setRenameDraft('');
    } finally {
      setRenameSaving(false);
    }
  };

  return (
    <aside
      data-assistant-thread-sidebar="true"
      data-dock-side={dockSide}
      className={`flex w-52 max-w-[46%] min-w-0 flex-shrink-0 flex-col border-[var(--border)] bg-[rgba(0,0,0,.14)] ${dockSide === 'right' ? 'border-l' : 'border-r'}`}
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted)]">
          <IconChatThread className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            Threads
          </div>
          <div className="text-[10px] text-[var(--muted-dim)]">{threads.length} total</div>
        </div>
        <button
          type="button"
          onClick={() => onDockSideChange(dockSide === 'left' ? 'right' : 'left')}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]"
          title={`Dock thread sidebar on the ${dockSide === 'left' ? 'right' : 'left'}`}
          aria-label={`Dock thread sidebar on the ${dockSide === 'left' ? 'right' : 'left'}`}
        >
          <IconSidebarCollapse className={`h-3.5 w-3.5 ${dockSide === 'left' ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]"
          title="Hide thread sidebar"
          aria-label="Hide thread sidebar"
        >
          <IconSidebarCollapse className={`h-3.5 w-3.5 ${dockSide === 'right' ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div className="flex-shrink-0 border-b border-[var(--border-subtle)] p-2">
        <button
          type="button"
          onClick={onCreateThread}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] hover:bg-[rgba(167,139,250,.16)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          <IconPlus className="h-3.5 w-3.5" />
          New thread
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {threads.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-[var(--muted-dim)]">No threads yet.</div>
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => {
              const active = thread.id === activeThreadId;
              const messageCount = thread.messageCount ?? thread.messages.length;
              return (
                <div
                  key={thread.id}
                  className={`group relative rounded border transition-colors ${active ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.055)]' : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'}`}
                >
                  <button type="button" onClick={() => onSelectThread(thread)} className="min-h-[50px] w-full min-w-0 px-2 py-2 text-left" aria-current={active ? 'true' : undefined} title={thread.title || 'Untitled thread'}>
                    <div className={`truncate text-[12px] font-semibold ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}>{thread.title || 'Untitled thread'}</div>
                    <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-[var(--muted-dim)]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{assistantThreadStatusLabel(thread.status, 'idle')}</span>
                        {messageCount > 0 ? <><span aria-hidden="true">·</span><span>{messageCount}</span></> : null}
                      </span>
                      <span className="flex-shrink-0 tabular-nums transition-opacity group-hover:opacity-0">{formatUpdatedAt(thread.updatedAt)}</span>
                    </div>
                  </button>
                  {renamingThreadId === thread.id ? (
                    <form className="absolute inset-x-1.5 top-1.5 z-10" onSubmit={(event) => { event.preventDefault(); void commitRename(thread); }}>
                      <input
                        ref={renameInputRef}
                        value={renameDraft}
                        maxLength={80}
                        disabled={renameSaving}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelRename(); } }}
                        onBlur={() => void commitRename(thread)}
                        className="h-7 w-full rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-2 text-[11px] font-semibold text-[var(--fg)] outline-none focus:bg-[var(--panel)]"
                        aria-label={`Rename ${thread.title || 'thread'}`}
                      />
                    </form>
                  ) : null}
                  <button type="button" onClick={() => beginRename(thread)} className="absolute bottom-1 right-7 flex h-6 w-6 items-center justify-center rounded bg-[var(--panel-alt)] text-[var(--muted-dim)] opacity-0 hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] group-hover:opacity-100 focus:opacity-100" title={`Rename ${thread.title || 'thread'}`} aria-label={`Rename ${thread.title || 'thread'}`}>
                    <IconPencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => onDeleteThread(thread)} className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded bg-[var(--panel-alt)] text-[var(--muted-dim)] opacity-0 hover:bg-[rgba(255,90,90,.1)] hover:text-[var(--red)] group-hover:opacity-100 focus:opacity-100" title={`Delete ${thread.title || 'thread'}`} aria-label={`Delete ${thread.title || 'thread'}`}>
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
