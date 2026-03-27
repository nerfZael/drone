import React from 'react';
import type { PlaybookDefinition, TaskPlaybookButton } from '../types';
import type { KanbanTaskType } from './kanban-board-state';
import { IconPlus } from './icons';

type KanbanTaskPlaybookButtonEditorProps = {
  taskTypes: KanbanTaskType[];
  taskPlaybookButtons: TaskPlaybookButton[];
  playbooks: PlaybookDefinition[];
  playbooksLoading: boolean;
  onAddTaskPlaybookButton: () => void;
  onUpdateTaskPlaybookButton: (buttonId: string, patch: Partial<TaskPlaybookButton>) => void;
  onRemoveTaskPlaybookButton: (buttonId: string) => void;
};

export function KanbanTaskPlaybookButtonEditor({
  taskTypes,
  taskPlaybookButtons,
  playbooks,
  playbooksLoading,
  onAddTaskPlaybookButton,
  onUpdateTaskPlaybookButton,
  onRemoveTaskPlaybookButton,
}: KanbanTaskPlaybookButtonEditorProps) {
  return (
    <div className="px-6 pb-4">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Task Buttons
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--muted)]">Map task types to playbooks and show launch buttons in the task dialog.</div>
          </div>
          <button
            type="button"
            onClick={onAddTaskPlaybookButton}
            disabled={playbooksLoading || playbooks.length === 0 || taskTypes.length === 0}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
              playbooksLoading || playbooks.length === 0 || taskTypes.length === 0
                ? 'cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] opacity-40'
                : 'border border-[rgba(167,139,250,.2)] bg-[rgba(167,139,250,.06)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.12)] hover:border-[rgba(167,139,250,.3)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            <IconPlus className="opacity-80" />
            Button
          </button>
        </div>
        {playbooksLoading ? (
          <div className="px-4 py-3 text-[11px] text-[var(--muted-dim)]">Loading playbooks...</div>
        ) : playbooks.length === 0 ? (
          <div className="px-4 py-3 text-[11px] text-[var(--muted-dim)]">No playbooks yet. Create one in Settings &gt; Playbooks first.</div>
        ) : taskTypes.length === 0 ? (
          <div className="px-4 py-3 text-[11px] text-[var(--muted-dim)]">No task types yet. Create one above before adding task buttons.</div>
        ) : taskPlaybookButtons.length === 0 ? (
          <div className="px-4 py-3 text-[11px] text-[var(--muted-dim)]">No task buttons yet.</div>
        ) : (
          <div className="space-y-px">
            {taskPlaybookButtons.map((button, idx) => (
              <div key={button.id} className={`px-4 py-3 ${idx % 2 === 0 ? 'bg-[rgba(255,255,255,.015)]' : ''}`}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,240px)_auto]">
                  <input
                    value={button.label}
                    onChange={(event) => onUpdateTaskPlaybookButton(button.id, { label: event.target.value })}
                    placeholder="Button label"
                    className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 text-[12px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] focus:bg-[rgba(0,0,0,.25)]"
                  />
                  <select
                    value={button.playbookId}
                    onChange={(event) => onUpdateTaskPlaybookButton(button.id, { playbookId: event.target.value })}
                    className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 text-[12px] text-[var(--fg)] transition-colors focus:outline-none focus:border-[var(--accent-muted)] focus:bg-[rgba(0,0,0,.25)]"
                  >
                    {playbooks.map((playbook) => (
                      <option key={playbook.id} value={playbook.id}>
                        {playbook.label || 'Untitled playbook'}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemoveTaskPlaybookButton(button.id)}
                    className="inline-flex h-9 items-center justify-self-start rounded-lg border border-[rgba(255,90,90,.15)] bg-[rgba(255,90,90,.06)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--red)] transition-all hover:bg-[rgba(255,90,90,.14)] hover:border-[rgba(255,90,90,.25)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {taskTypes.map((taskType) => {
                    const selected = button.taskTypeIds.includes(taskType.id);
                    return (
                      <label
                        key={`${button.id}:${taskType.id}`}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                          selected
                            ? 'border-[rgba(167,139,250,.24)] bg-[rgba(167,139,250,.1)] text-[var(--accent)]'
                            : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--fg)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) =>
                            onUpdateTaskPlaybookButton(button.id, {
                              taskTypeIds: event.target.checked
                                ? [...button.taskTypeIds, taskType.id]
                                : button.taskTypeIds.filter((item) => item !== taskType.id),
                            })
                          }
                          className="sr-only"
                        />
                        <span className={`h-1.5 w-1.5 rounded-full ${selected ? 'bg-[var(--accent)]' : 'bg-[var(--muted-dim)] opacity-50'}`} />
                        {taskType.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
