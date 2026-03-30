import React from 'react';
import { resolveKanbanCardScope, type KanbanCard, type KanbanTaskScopeType, type KanbanTaskType } from './kanban-board-state';
import { KANBAN_TASK_UNTITLED_FALLBACK, resolveCommittedKanbanTaskTitle } from './kanban-task-details-dialog-state';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { IconPencil } from './icons';
import { playbookRunsRepoLabel } from './playbook-runs-ui';
import type { TaskPlaybookButton } from '../types';

type KanbanTaskDetailsDialogProps = {
  card: KanbanCard | null;
  laneTitle: string | null;
  registeredRepoPaths: string[];
  groupScopeNames: string[];
  scopeDrones: Array<{
    id: string;
    name: string;
    group: string | null;
    repoPath: string;
  }>;
  taskTypes: KanbanTaskType[];
  taskPlaybookButtons: TaskPlaybookButton[];
  controlsLocked: boolean;
  creatorDroneAvailable: boolean;
  taskButtonBusyId: string | null;
  taskButtonError: string | null;
  onClose: () => void;
  onTitleDraftChange: () => void;
  onUpdate: (patch: {
    title?: string;
    description?: string;
    typeId?: string;
    repoPath?: string | null;
    scopeType?: KanbanTaskScopeType;
    scopeValue?: string | null;
  }) => void;
  onDelete: () => void;
  onOpenCreatorDrone: () => void;
  onRunTaskPlaybookButton: (buttonId: string) => void;
};

export function KanbanTaskDetailsDialog({
  card,
  laneTitle,
  registeredRepoPaths,
  groupScopeNames,
  scopeDrones,
  taskTypes,
  taskPlaybookButtons,
  controlsLocked,
  creatorDroneAvailable,
  taskButtonBusyId,
  taskButtonError,
  onClose,
  onTitleDraftChange,
  onUpdate,
  onDelete,
  onOpenCreatorDrone,
  onRunTaskPlaybookButton,
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

  const repoPath = String(card?.repoPath ?? '').trim();
  const cardScope = React.useMemo(() => (card ? resolveKanbanCardScope(card) : { scopeType: 'global' as const, scopeValue: '' }), [card]);
  const repoOptions = React.useMemo(() => {
    const out = Array.from(new Set(registeredRepoPaths.map((item) => String(item ?? '').trim()).filter(Boolean)));
    if (repoPath && !out.includes(repoPath)) out.push(repoPath);
    return out;
  }, [registeredRepoPaths, repoPath]);
  const groupOptions = React.useMemo(() => {
    const out = Array.from(new Set(groupScopeNames.map((item) => String(item ?? '').trim()).filter(Boolean)));
    if (cardScope.scopeType === 'group' && cardScope.scopeValue && !out.includes(cardScope.scopeValue)) out.push(cardScope.scopeValue);
    return out.sort((a, b) => a.localeCompare(b));
  }, [cardScope.scopeType, cardScope.scopeValue, groupScopeNames]);
  const droneOptions = React.useMemo(() => {
    const byId = new Map(
      scopeDrones.map((drone) => [
        drone.id,
        {
          id: drone.id,
          label: String(drone.name ?? '').trim() || drone.id,
          repoPath: String(drone.repoPath ?? '').trim(),
        },
      ]),
    );
    if (cardScope.scopeType === 'drone' && cardScope.scopeValue && !byId.has(cardScope.scopeValue)) {
      byId.set(cardScope.scopeValue, {
        id: cardScope.scopeValue,
        label: cardScope.scopeValue,
        repoPath: '',
      });
    }
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [cardScope.scopeType, cardScope.scopeValue, scopeDrones]);

  if (!card) return null;
  const activeTaskTypes = taskTypes.filter((item) => item.active !== false || item.id === card.typeId);
  const hasDescription = Boolean(card.description?.trim());
  const boardTargetLabel =
    cardScope.scopeType === 'repo' ? 'Board Repo' : cardScope.scopeType === 'group' ? 'Board Group' : 'Board Drone';
  const boardTargetOptions =
    cardScope.scopeType === 'repo'
      ? repoOptions.map((value) => ({ value, label: playbookRunsRepoLabel(value) }))
      : cardScope.scopeType === 'group'
        ? groupOptions.map((value) => ({ value, label: value }))
        : droneOptions.map((drone) => ({ value: drone.id, label: drone.label }));
  const boardMetadataValue =
    cardScope.scopeType === 'global'
      ? 'Global'
      : cardScope.scopeType === 'repo'
        ? playbookRunsRepoLabel(cardScope.scopeValue)
        : cardScope.scopeType === 'group'
          ? cardScope.scopeValue
          : droneOptions.find((drone) => drone.id === cardScope.scopeValue)?.label ?? cardScope.scopeValue;
  const repoFieldLocked = cardScope.scopeType === 'repo';
  const taskButtonsDisabledReason = repoPath ? null : 'This task does not have a repo attached yet.';

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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_160px_160px_220px]">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Title</label>
              <input
                type="text"
                value={draftTitle}
                onChange={(event) => {
                  titleDirtyRef.current = true;
                  onTitleDraftChange();
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
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Board</label>
              <select
                value={cardScope.scopeType}
                onChange={(event) => {
                  const nextScopeType = event.target.value as KanbanTaskScopeType;
                  if (nextScopeType === 'global') {
                    onUpdate({ scopeType: 'global', scopeValue: '' });
                    return;
                  }
                  const nextScopeValue =
                    nextScopeType === 'repo'
                      ? repoPath || repoOptions[0] || ''
                      : nextScopeType === 'group'
                        ? groupOptions[0] || ''
                        : String(card.droneId ?? '').trim() || droneOptions[0]?.id || '';
                  if (!nextScopeValue) return;
                  onUpdate({
                    scopeType: nextScopeType,
                    scopeValue: nextScopeValue,
                    ...(nextScopeType === 'repo' ? { repoPath: nextScopeValue } : {}),
                  });
                }}
                disabled={controlsLocked}
                className="h-10 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 text-[12px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="global">Global</option>
                <option value="repo" disabled={repoOptions.length === 0}>Repo</option>
                <option value="group" disabled={groupOptions.length === 0}>Group</option>
                <option value="drone" disabled={droneOptions.length === 0}>Drone</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                {cardScope.scopeType === 'global' ? 'Board Target' : boardTargetLabel}
              </label>
              <select
                value={cardScope.scopeType === 'global' ? '' : cardScope.scopeValue}
                onChange={(event) => {
                  const nextScopeValue = event.target.value;
                  onUpdate({
                    scopeType: cardScope.scopeType,
                    scopeValue: nextScopeValue,
                    ...(cardScope.scopeType === 'repo' ? { repoPath: nextScopeValue } : {}),
                  });
                }}
                disabled={controlsLocked || cardScope.scopeType === 'global' || boardTargetOptions.length === 0}
                className="h-10 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 text-[12px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                title={cardScope.scopeValue || undefined}
              >
                {cardScope.scopeType === 'global' ? (
                  <option value="">No target</option>
                ) : (
                  boardTargetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Repo</label>
              <select
                value={repoPath}
                onChange={(event) => onUpdate({ repoPath: event.target.value || null })}
                disabled={controlsLocked || repoFieldLocked}
                className="h-10 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 text-[12px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                title={repoPath || undefined}
              >
                <option value="">No repo</option>
                {repoOptions.map((optionRepoPath) => (
                  <option key={optionRepoPath} value={optionRepoPath}>
                    {playbookRunsRepoLabel(optionRepoPath)}
                    {!registeredRepoPaths.includes(optionRepoPath) ? ' (unregistered)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              {repoFieldLocked ? (
                <div className="text-[11px] text-[var(--muted-dim)]">
                  Repo-scoped tasks are always attached to their board repo.
                </div>
              ) : (
                <div className="text-[11px] text-[var(--muted-dim)]">
                  Repo attachment stays separate from board ownership for global, group, and drone tasks.
                </div>
              )}
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

          {taskPlaybookButtons.length > 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-4 py-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Task Buttons
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {taskPlaybookButtons.map((button) => {
                  const busy = taskButtonBusyId === button.id;
                  return (
                    <button
                      key={button.id}
                      type="button"
                      onClick={() => onRunTaskPlaybookButton(button.id)}
                      disabled={controlsLocked || busy || Boolean(taskButtonsDisabledReason)}
                      className={`inline-flex h-9 items-center justify-center rounded-lg border px-4 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                        controlsLocked || busy || taskButtonsDisabledReason
                          ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)] opacity-60'
                          : 'border-[rgba(167,139,250,.2)] bg-[rgba(167,139,250,.08)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.14)] hover:border-[rgba(167,139,250,.3)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                      title={taskButtonsDisabledReason ?? undefined}
                    >
                      {busy ? 'Launching…' : button.label}
                    </button>
                  );
                })}
              </div>
              {taskButtonsDisabledReason ? (
                <div className="mt-3 text-[11px] text-[var(--muted-dim)]">{taskButtonsDisabledReason}</div>
              ) : null}
              {taskButtonError ? (
                <div className="mt-3 text-[11px] text-[var(--red)]">{taskButtonError}</div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] px-4 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Metadata
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
              {[
                ['Created', card.createdAt],
                ['Updated', card.updatedAt],
                ['Board', boardMetadataValue],
                ['Repo', repoPath || 'No repo'],
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
