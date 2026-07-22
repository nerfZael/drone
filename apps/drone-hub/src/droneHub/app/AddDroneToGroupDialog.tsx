import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import { IconChevronLeft, IconFolder, IconPlus, IconSpinner } from './icons';
import type { MoveDronesToGroupResult } from './use-group-management';

const MAX_VISIBLE_GROUPS = 6;

type AddDroneToGroupTarget = {
  droneId: string;
  droneName: string;
  currentGroup: string | null;
};

type AddDroneToGroupDialogProps = {
  target: AddDroneToGroupTarget;
  groups: string[];
  onCreateGroupAndMove: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onMoveToGroup: (group: string, droneIds: string[]) => Promise<MoveDronesToGroupResult>;
  onClose: () => void;
};

function availableGroups(groups: string[], currentGroup: string | null): string[] {
  const current = String(currentGroup ?? '').trim().toLocaleLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawGroup of groups) {
    const group = String(rawGroup ?? '').trim();
    const key = group.toLocaleLowerCase();
    if (!group || isUngroupedGroupName(group) || key === current || seen.has(key)) continue;
    seen.add(key);
    result.push(group);
  }
  return result;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function AddDroneToGroupDialog({
  target,
  groups,
  onCreateGroupAndMove,
  onMoveToGroup,
  onClose,
}: AddDroneToGroupDialogProps) {
  const [mode, setMode] = React.useState<'choose' | 'new' | 'existing'>('choose');
  const [groupName, setGroupName] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pendingGroup, setPendingGroup] = React.useState<string | null>(null);
  const newGroupInputRef = React.useRef<HTMLInputElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  const options = React.useMemo(
    () => availableGroups(groups, target.currentGroup),
    [groups, target.currentGroup],
  );
  const filteredGroups = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = normalizedQuery
      ? options.filter((group) => group.toLocaleLowerCase().includes(normalizedQuery))
      : options;
    return {
      visible: matches.slice(0, MAX_VISIBLE_GROUPS),
      hiddenCount: Math.max(0, matches.length - MAX_VISIBLE_GROUPS),
    };
  }, [options, query]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      if (mode !== 'choose') {
        event.preventDefault();
        setMode('choose');
        setError(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, mode, onClose]);

  React.useEffect(() => {
    if (mode === 'new') newGroupInputRef.current?.focus();
    if (mode === 'existing') searchInputRef.current?.focus();
  }, [mode]);

  const chooseMode = (nextMode: 'new' | 'existing') => {
    setError(null);
    setMode(nextMode);
  };

  const goBack = () => {
    if (busy) return;
    setError(null);
    setMode('choose');
  };

  const createAndMove = async () => {
    const nextGroup = groupName.trim();
    if (!nextGroup) {
      setError('Group name is required.');
      return;
    }
    if (isUngroupedGroupName(nextGroup)) {
      setError('“Ungrouped” is reserved.');
      return;
    }
    if (String(target.currentGroup ?? '').trim().toLocaleLowerCase() === nextGroup.toLocaleLowerCase()) {
      setError(`${target.droneName} is already in that group.`);
      return;
    }
    if (groups.some((group) => group.trim().toLocaleLowerCase() === nextGroup.toLocaleLowerCase())) {
      setError('That group already exists. Choose it from Existing group.');
      return;
    }

    setBusy(true);
    setPendingGroup(nextGroup);
    setError(null);
    try {
      const result = await onCreateGroupAndMove(nextGroup, [target.droneId]);
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.error || 'Could not create the group.');
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? '').trim() || 'Could not create the group.');
    } finally {
      setBusy(false);
      setPendingGroup(null);
    }
  };

  const moveToExisting = async (group: string) => {
    if (busy) return;
    setBusy(true);
    setPendingGroup(group);
    setError(null);
    try {
      const result = await onMoveToGroup(group, [target.droneId]);
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.error || `Could not add the drone to ${group}.`);
    } catch (caught: any) {
      setError(String(caught?.message ?? caught ?? '').trim() || `Could not add the drone to ${group}.`);
    } finally {
      setBusy(false);
      setPendingGroup(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--scrim)] px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-drone-to-group-title"
      aria-describedby="add-drone-to-group-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-[440px] overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-overlay)] shadow-[0_28px_90px_var(--shadow-color)] animate-slide-up">
        <div className="border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-start gap-3">
            {mode !== 'choose' ? (
              <button
                type="button"
                onClick={goBack}
                disabled={busy}
                className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border-subtle)] text-[var(--muted)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)] disabled:opacity-45"
                aria-label="Back to group options"
                title="Back"
              >
                <IconChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]">
                <IconFolder className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div
                className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.14em] text-[var(--muted-dim)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Organize drone
              </div>
              <h2 id="add-drone-to-group-title" className="mt-1 text-[18px] font-[var(--weight-semibold)] text-[var(--fg-strong)]">
                {mode === 'new' ? 'Create a new group' : mode === 'existing' ? 'Choose a group' : 'Add to group'}
              </h2>
              <p id="add-drone-to-group-description" className="mt-1 truncate text-[var(--text-12)] text-[var(--muted)]" title={target.droneName}>
                Move <span className="font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{target.droneName}</span> into a group.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-45"
              aria-label="Close add to group dialog"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-5 py-5">
          {mode === 'choose' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => chooseMode('new')}
                className="group rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-4 text-left transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]">
                  <IconPlus className="h-4 w-4" />
                </span>
                <span className="mt-3 block text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)]">New group</span>
                <span className="mt-1 block text-[var(--text-11)] leading-4 text-[var(--muted)]">Name a new group and add the drone.</span>
              </button>
              <button
                type="button"
                onClick={() => chooseMode('existing')}
                disabled={options.length === 0}
                className="group rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-4 text-left transition-all hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--info-border)] bg-[var(--info-subtle)] text-[var(--info)]">
                  <IconFolder className="h-4 w-4" />
                </span>
                <span className="mt-3 block text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)]">Existing group</span>
                <span className="mt-1 block text-[var(--text-11)] leading-4 text-[var(--muted)]">
                  {options.length > 0 ? `Search or choose from ${options.length}.` : 'No other groups yet.'}
                </span>
              </button>
            </div>
          ) : mode === 'new' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy) void createAndMove();
              }}
            >
              <label htmlFor="new-drone-group-name" className="text-[var(--text-11)] font-[var(--weight-semibold)] uppercase tracking-[0.11em] text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
                Group name
              </label>
              <input
                ref={newGroupInputRef}
                id="new-drone-group-name"
                value={groupName}
                onChange={(event) => {
                  setGroupName(event.target.value);
                  setError(null);
                }}
                maxLength={80}
                disabled={busy}
                placeholder="e.g. Platform or Client work"
                className="mt-2 h-10 w-full rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-13)] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)] focus:ring-1 focus:ring-[var(--focus-ring)] disabled:opacity-60"
              />
              <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">Use “/” to create a nested group path.</div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button type="button" onClick={goBack} disabled={busy} className="h-9 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] px-3 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--hover)] disabled:opacity-45">
                  Back
                </button>
                <button type="submit" disabled={busy || !groupName.trim()} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--accent)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
                  {busy ? <IconSpinner className="h-3.5 w-3.5" /> : <IconPlus className="h-3.5 w-3.5" />}
                  {busy ? 'Creating…' : 'Create and add'}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <label htmlFor="existing-drone-group-search" className="sr-only">Search groups</label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-dim)]" />
                <input
                  ref={searchInputRef}
                  id="existing-drone-group-search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setError(null);
                  }}
                  disabled={busy}
                  placeholder="Search groups"
                  className="h-10 w-full rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] pl-9 pr-3 text-[var(--text-13)] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)] focus:ring-1 focus:ring-[var(--focus-ring)] disabled:opacity-60"
                />
              </div>
              <div className="mt-3 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)]">
                {filteredGroups.visible.length > 0 ? (
                  filteredGroups.visible.map((group, index) => (
                    <button
                      key={group}
                      type="button"
                      onClick={() => void moveToExisting(group)}
                      disabled={busy}
                      className={`flex h-10 w-full items-center gap-2.5 px-3 text-left text-[var(--text-12)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--hover)] disabled:cursor-wait disabled:opacity-60 ${index > 0 ? 'border-t border-[var(--border-subtle)]' : ''}`}
                    >
                      {pendingGroup === group ? <IconSpinner className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" /> : <IconFolder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />}
                      <span className="min-w-0 flex-1 truncate" title={group}>{group}</span>
                      {pendingGroup === group ? <span className="text-[var(--text-10)] text-[var(--muted)]">Adding…</span> : null}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-[var(--text-12)] text-[var(--muted)]">
                    No groups match “{query.trim()}”.
                  </div>
                )}
              </div>
              {filteredGroups.hiddenCount > 0 ? (
                <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
                  {filteredGroups.hiddenCount} more {filteredGroups.hiddenCount === 1 ? 'group' : 'groups'} — search to narrow the list.
                </div>
              ) : null}
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-[var(--radius-medium)] border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] leading-5 text-[var(--red)]" role="alert">
              {error}
              {mode === 'new' && /already exists/i.test(error) ? (
                <button type="button" onClick={() => chooseMode('existing')} className="ml-1 font-[var(--weight-semibold)] underline underline-offset-2">
                  Choose it
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
