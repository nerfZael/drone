import React from 'react';
import type { KanbanCard, KanbanTaskType } from './kanban-board-state';
import { KANBAN_TASK_UNTITLED_FALLBACK, resolveCommittedKanbanTaskTitle } from './kanban-task-details-dialog-state';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { IconPencil } from './icons';

type KanbanTaskDetailsDialogProps = {
  card: KanbanCard | null;
  laneTitle: string | null;
  taskTypes: KanbanTaskType[];
  controlsLocked: boolean;
  creatorDroneAvailable: boolean;
  onClose: () => void;
  onUpdate: (patch: { title?: string; description?: string; typeId?: string }) => void;
  onDelete: () => void;
  onOpenCreatorDrone: () => void;
};

export function KanbanTaskDetailsDialog({
  card,
  laneTitle,
  taskTypes,
  controlsLocked,
  creatorDroneAvailable,
  onClose,
  onUpdate,
  onDelete,
  onOpenCreatorDrone,
}: KanbanTaskDetailsDialogProps) {
  const [editingDescription, setEditingDescription] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const titleDirtyRef = React.useRef(false);
  const backdropPressedRef = React.useRef(false);
  const cardId = card?.id ?? null;

  const commitTitleDraft = React.useCallback(() => {
    if (!card) return;
    const wasDirty = titleDirtyRef.current;
    const nextTitle = resolveCommittedKanbanTaskTitle(draftTitle, card.title);
    titleDirtyRef.current = false;
    if (wasDirty && nextTitle !== draftTitle) setDraftTitle(nextTitle);
    if (!wasDirty) return;
    if (nextTitle !== card.title) onUpdate({ title: nextTitle });
  }, [card, draftTitle, onUpdate]);

  const handleRequestClose = React.useCallback(() => {
    commitTitleDraft();
    onClose();
  }, [commitTitleDraft, onClose]);

  React.useEffect(() => {
    setEditingDescription(false);
    setDraftTitle(card?.title ?? '');
    titleDirtyRef.current = false;
    backdropPressedRef.current = false;
  }, [cardId]);

  React.useEffect(() => {
    if (titleDirtyRef.current) return;
    setDraftTitle(card?.title ?? '');
  }, [card?.title, cardId]);

  React.useEffect(() => {
    if (!card) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (editingDescription) {
        setEditingDescription(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleRequestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cardId, editingDescription, handleRequestClose]);

  React.useEffect(() => {
    if (editingDescription && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editingDescription]);

  if (!card) return null;
  const activeTaskTypes = taskTypes.filter((item) => item.active !== false || item.id === card.typeId);
  const hasDescription = Boolean(card.description?.trim());

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(3,6,12,.72)] px-4 py-6 backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      aria-label="Task details"
      onPointerDown={(event) => {
        backdropPressedRef.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (!backdropPressedRef.current || event.target !== event.currentTarget) {
          backdropPressedRef.current = false;
          return;
        }
        backdropPressedRef.current = false;
        handleRequestClose();
      }}
      onPointerCancel={() => {
        backdropPressedRef.current = false;
      }}
    >
      <div
        className="animate-slide-up w-full max-w-[720px] overflow-hidden rounded-2xl border border-[rgba(167,139,250,.12)] bg-[rgba(16,18,22,.98)] shadow-[0_32px_100px_rgba(0,0,0,.6),0_0_40px_rgba(167,139,250,.04)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative border-b border-[var(--border-subtle)]">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(167,139,250,.06)_0%,transparent_60%)]" />
          <div className="relative flex items-start justify-between gap-4 px-6 py-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]" style={{ fontFamily: 'var(--display)' }}>
                  Task Details
                </div>
                {laneTitle ? (
                  <span className="rounded-md bg-[rgba(255,255,255,.04)] px-2 py-0.5 text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                    {laneTitle}
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 text-[12px] font-medium text-[var(--fg)]">{card.title || KANBAN_TASK_UNTITLED_FALLBACK}</div>
            </div>
            <button
              type="button"
              onClick={handleRequestClose}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)] transition-all hover:border-[var(--border)] hover:text-[var(--fg)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Close
            </button>
          </div>
          <div className="dh-accent-bar" />
        </div>

        <div className="flex flex-col gap-5 px-6 py-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_180px]">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Title</label>
              <input
                type="text"
                value={draftTitle}
                onChange={(event) => {
                  titleDirtyRef.current = true;
                  setDraftTitle(event.target.value);
                }}
                onBlur={commitTitleDraft}
                disabled={controlsLocked}
                placeholder="Task title"
                className="h-10 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 text-[13px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] focus:bg-[rgba(0,0,0,.28)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Type</label>
              <select
                value={card.typeId}
                onChange={(event) => onUpdate({ typeId: event.target.value })}
                disabled={controlsLocked}
                className="h-10 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 text-[12px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {activeTaskTypes.map((taskType) => (
                  <option key={taskType.id} value={taskType.id}>
                    {taskType.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Description</label>
              {!controlsLocked && (
                <button
                  type="button"
                  onClick={() => setEditingDescription((prev) => !prev)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                    editingDescription
                      ? 'bg-[rgba(167,139,250,.12)] text-[var(--accent)] border border-[rgba(167,139,250,.2)]'
                      : 'text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  <IconPencil className="opacity-70" />
                  {editingDescription ? 'Preview' : 'Edit'}
                </button>
              )}
            </div>
            {editingDescription ? (
              <textarea
                ref={textareaRef}
                value={card.description}
                onChange={(event) => onUpdate({ description: event.target.value })}
                disabled={controlsLocked}
                placeholder="Markdown supported — add task details, context, acceptance criteria..."
                rows={10}
                className="min-h-[200px] rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-4 py-3 text-[12px] leading-relaxed text-[var(--fg-secondary)] resize-y transition-colors focus:outline-none focus:border-[var(--accent-muted)] focus:bg-[rgba(0,0,0,.28)] disabled:cursor-not-allowed disabled:opacity-60"
                style={{ fontFamily: 'var(--code)' }}
              />
            ) : hasDescription ? (
              <div
                className="min-h-[80px] max-h-[360px] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-4 py-3"
                onClick={() => { if (!controlsLocked) setEditingDescription(true); }}
              >
                <MarkdownMessage text={card.description} className="dh-markdown--agent text-[12.5px]" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { if (!controlsLocked) setEditingDescription(true); }}
                disabled={controlsLocked}
                className="flex min-h-[80px] items-center justify-center rounded-lg border border-dashed border-[rgba(255,255,255,.08)] bg-[rgba(0,0,0,.08)] px-4 py-6 text-[11px] text-[var(--muted-dim)] transition-all hover:border-[var(--accent-muted)] hover:bg-[rgba(167,139,250,.04)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:hover:border-[rgba(255,255,255,.08)] disabled:hover:bg-[rgba(0,0,0,.08)] disabled:hover:text-[var(--muted-dim)]"
              >
                Click to add a description (Markdown supported)
              </button>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-4 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Metadata
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
              {[
                ['Created', card.createdAt],
                ['Updated', card.updatedAt],
                ['Playbook', card.playbookLabel],
                ['Creator', card.droneName],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="text-[10px] text-[var(--muted-dim)] shrink-0" style={{ fontFamily: 'var(--display)' }}>{label}</span>
                  <span className="text-[11px] text-[var(--muted)] truncate" style={{ fontFamily: 'var(--code)' }}>{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-6 py-4">
          <div className="flex items-center gap-2">
            {creatorDroneAvailable ? (
              <button
                type="button"
                onClick={onOpenCreatorDrone}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[rgba(167,139,250,.2)] bg-[rgba(167,139,250,.08)] px-4 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] transition-all hover:bg-[rgba(167,139,250,.14)] hover:border-[rgba(167,139,250,.3)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Open Creator Drone
              </button>
            ) : card.droneName ? (
              <div className="text-[11px] text-[var(--muted-dim)] italic">Creator drone is no longer available.</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={controlsLocked}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-[rgba(255,90,90,.2)] bg-[rgba(255,90,90,.08)] px-4 text-[10px] font-semibold uppercase tracking-wide text-[var(--red)] transition-all hover:bg-[rgba(255,90,90,.16)] hover:border-[rgba(255,90,90,.3)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            Delete Task
          </button>
        </div>
      </div>
    </div>
  );
}
