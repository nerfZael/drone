import React from 'react';
import { IconBoard, IconDrone, IconList, IconPlus, IconPlusDouble } from './icons';

export type NoDroneSelectedStateProps = {
  dronesLoading: boolean;
  sidebarDroneCount: number;
  dronesError: string | null | undefined;
  onOpenDraftChatComposer: () => void;
  onOpenCreateModal: () => void;
  onOpenKanbanBoard: () => void;
  onOpenPlaybookRuns: () => void;
};

export function NoDroneSelectedState({
  dronesLoading,
  sidebarDroneCount,
  dronesError,
  onOpenDraftChatComposer,
  onOpenCreateModal,
  onOpenKanbanBoard,
  onOpenPlaybookRuns,
}: NoDroneSelectedStateProps) {
  const hasDrones = sidebarDroneCount > 0;
  const title = hasDrones ? 'Choose where to work' : 'Start with a drone';
  const description = hasDrones
    ? 'Select a drone from the sidebar, or start something new.'
    : 'Create a workspace for your first task. You can add more whenever you need them.';

  return (
    <main className="dh-launch-state relative flex h-full min-h-0 items-center justify-center overflow-auto px-5 py-10 md:px-10">
      <div className="dh-launch-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <section className="relative w-full max-w-[760px] animate-fade-in" aria-labelledby="launch-state-title">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(167,139,250,.22)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[var(--glow-accent)]">
            <IconDrone className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Drone Hub
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--muted)]">
              {dronesLoading ? 'Loading workspaces…' : hasDrones ? 'Ready when you are' : 'No workspaces yet'}
            </div>
          </div>
        </div>

        <h1 id="launch-state-title" className="max-w-[620px] text-[30px] font-semibold leading-[1.08] tracking-[-.035em] text-[var(--fg)] md:text-[42px]" style={{ fontFamily: 'var(--display)' }}>
          {title}
        </h1>
        <p className="mt-4 max-w-[540px] text-[14px] leading-6 text-[var(--muted)] md:text-[15px]">{description}</p>

        {dronesError ? (
          <div className="mt-5 rounded-xl border border-[rgba(255,90,90,.22)] bg-[var(--red-subtle)] px-3 py-2.5 text-[12px] text-[var(--red)]" role="alert">
            {dronesError}
          </div>
        ) : null}

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <LaunchAction
            icon={<IconPlus className="h-4 w-4" />}
            eyebrow="Quick start"
            title="Create a drone"
            description="Open a fresh chat workspace and start with a prompt."
            primary
            onClick={onOpenDraftChatComposer}
          />
          <LaunchAction
            icon={<IconPlusDouble className="h-4 w-4" />}
            eyebrow="Batch"
            title="Create multiple"
            description="Prepare several workspaces in one pass."
            onClick={onOpenCreateModal}
          />
          <LaunchAction
            icon={<IconBoard className="h-4 w-4" />}
            eyebrow="Plan"
            title="Open task board"
            description="Shape tasks before assigning work."
            onClick={onOpenKanbanBoard}
          />
          <LaunchAction
            icon={<IconList className="h-4 w-4" />}
            eyebrow="Automate"
            title="Open playbook runs"
            description="Review and continue repeatable workflows."
            onClick={onOpenPlaybookRuns}
          />
        </div>

        {hasDrones ? (
          <p className="mt-6 text-[11px] text-[var(--muted-dim)]">Tip: select any drone in the sidebar to return to its latest chat.</p>
        ) : null}
      </section>
    </main>
  );
}

function LaunchAction({
  icon,
  eyebrow,
  title,
  description,
  primary = false,
  onClick,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-[112px] items-start gap-3 rounded-xl border p-4 text-left transition-all ${
        primary
          ? 'border-[rgba(167,139,250,.3)] bg-[linear-gradient(135deg,rgba(167,139,250,.14),rgba(167,139,250,.045))] hover:border-[var(--accent)] hover:shadow-[var(--glow-accent)]'
          : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.018)] hover:-translate-y-0.5 hover:border-[var(--accent-muted)] hover:bg-[rgba(255,255,255,.035)]'
      }`}
    >
      <span className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border ${primary ? 'border-[rgba(167,139,250,.24)] bg-[var(--accent-subtle)] text-[var(--accent)]' : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.025)] text-[var(--muted)] group-hover:text-[var(--accent)]'}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[9px] font-semibold uppercase tracking-[.18em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>{eyebrow}</span>
        <span className="mt-1 block text-[13px] font-semibold text-[var(--fg)]">{title}</span>
        <span className="mt-1 block text-[12px] leading-5 text-[var(--muted)]">{description}</span>
      </span>
    </button>
  );
}
