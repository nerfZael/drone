import React from 'react';

import { cn } from '../../ui/cn';
import { IconChevronLeft, IconNetwork } from './icons';

type AccessMode = 'all' | 'selected';
type AccessKind = 'read' | 'write' | 'execute';

type SelectedDrone = {
  id: string;
  label: string;
  removable?: boolean;
};

const ACCESS_OPTIONS: Array<{
  kind: AccessKind;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    kind: 'read',
    label: 'Read',
    shortLabel: 'R',
    description: 'Inspect drone status, chats, transcripts, files, and other existing state.',
  },
  {
    kind: 'write',
    label: 'Write',
    shortLabel: 'W',
    description: 'Change existing drone state, including files and chat configuration.',
  },
  {
    kind: 'execute',
    label: 'Execute',
    shortLabel: 'X',
    description: 'Trigger agents, prompts, and actions in DroneHub.',
  },
];

function AccessModeRow({
  kind,
  label,
  shortLabel,
  description,
  mode,
  disabled,
  onPaintStart,
  onPaintEnter,
  onKeyboardSelect,
}: {
  kind: AccessKind;
  label: string;
  shortLabel: string;
  description: string;
  mode: AccessMode;
  disabled: boolean;
  onPaintStart: (
    event: React.PointerEvent<HTMLButtonElement>,
    kind: AccessKind,
    mode: AccessMode,
  ) => void;
  onPaintEnter: (kind: AccessKind, mode: AccessMode) => void;
  onKeyboardSelect: (kind: AccessKind, mode: AccessMode) => void;
}) {
  return (
    <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          {shortLabel}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {label}
          </div>
          <div className="mt-1 text-[var(--text-11)] leading-5 text-[var(--muted)]">
            {description}
          </div>
        </div>
      </div>
      <div
        className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--surface-inset-faint)] p-1"
        role="group"
        aria-label={`${label} access`}
      >
        {([
          ['all', 'All drones'],
          ['selected', 'Selected drones'],
        ] as const).map(([value, optionLabel]) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            aria-pressed={mode === value}
            data-permission-kind={kind}
            data-permission-mode={value}
            onPointerDown={(event) => onPaintStart(event, kind, value)}
            onPointerEnter={() => onPaintEnter(kind, value)}
            onClick={(event) => {
              if (event.detail === 0) onKeyboardSelect(kind, value);
            }}
            className={cn(
              'h-10 touch-none select-none rounded-[calc(var(--radius-medium)-3px)] px-3 text-[var(--text-11)] font-[var(--weight-semibold)] transition-[background-color,color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50',
              mode === value
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent-muted),0_1px_4px_var(--shadow-color)]'
                : 'text-[var(--muted)] hover:text-[var(--fg-secondary)]',
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeaturePermissionRow({
  label,
  description,
  allowed,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  allowed: boolean;
  disabled: boolean;
  onChange: (allowed: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)]">
          {label}
        </div>
        <div className="mt-1 text-[var(--text-11)] leading-5 text-[var(--muted)]">
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={allowed}
        disabled={disabled}
        onClick={() => onChange(!allowed)}
        className={cn(
          'relative h-6 w-11 flex-shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          allowed
            ? 'border-[var(--accent)] bg-[var(--accent)]'
            : 'border-[var(--border)] bg-[var(--surface-inset)]',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            allowed ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  );
}

export function DroneHubPermissionsView({
  chatLabel,
  available,
  loading,
  saving,
  error,
  unavailableMessage,
  readMode,
  writeMode,
  executeMode,
  changeRequestCreate,
  changeRequestMerge,
  selectedDrones,
  dropActive,
  dropTargetRef,
  onModeChange,
  onChangeRequestPermissionChange,
  onRemoveDrone,
  onBack,
}: {
  chatLabel: string;
  available: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  unavailableMessage?: string;
  readMode: AccessMode;
  writeMode: AccessMode;
  executeMode: AccessMode;
  changeRequestCreate: boolean;
  changeRequestMerge: boolean;
  selectedDrones: SelectedDrone[];
  dropActive: boolean;
  dropTargetRef?: (node: HTMLDivElement | null) => void;
  onModeChange: (kind: AccessKind, mode: AccessMode) => void;
  onChangeRequestPermissionChange: (kind: 'create' | 'merge', allowed: boolean) => void;
  onRemoveDrone: (droneId: string) => void;
  onBack: () => void;
}) {
  const disabled = loading || !available;
  const paintGestureRef = React.useRef<{
    pointerId: number;
    visited: Set<string>;
  } | null>(null);
  const [painting, setPainting] = React.useState(false);
  const selectedModeActive =
    readMode === 'selected' || writeMode === 'selected' || executeMode === 'selected';
  const statusLabel = loading
    ? 'Loading'
    : saving
      ? 'Saving'
      : available
        ? 'Enabled'
        : 'Unavailable';

  const paintPermission = React.useCallback(
    (kind: AccessKind, mode: AccessMode) => {
      const gesture = paintGestureRef.current;
      if (!gesture || disabled) return;
      const cellKey = `${kind}:${mode}`;
      if (gesture.visited.has(cellKey)) return;
      gesture.visited.add(cellKey);
      onModeChange(kind, mode);
    },
    [disabled, onModeChange],
  );

  const stopPainting = React.useCallback(() => {
    paintGestureRef.current = null;
    setPainting(false);
  }, []);

  React.useEffect(() => {
    if (!painting) return;
    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);
    window.addEventListener('blur', stopPainting);
    return () => {
      window.removeEventListener('pointerup', stopPainting);
      window.removeEventListener('pointercancel', stopPainting);
      window.removeEventListener('blur', stopPainting);
    };
  }, [painting, stopPainting]);

  const startPainting = React.useCallback(
    (
      event: React.PointerEvent<HTMLButtonElement>,
      kind: AccessKind,
      mode: AccessMode,
    ) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      paintGestureRef.current = { pointerId: event.pointerId, visited: new Set() };
      setPainting(true);
      paintPermission(kind, mode);
    },
    [disabled, paintPermission],
  );

  const paintFromPointerPosition = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = paintGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      const cell = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-permission-kind][data-permission-mode]');
      const kind = cell?.dataset.permissionKind;
      const mode = cell?.dataset.permissionMode;
      if (
        (kind === 'read' || kind === 'write' || kind === 'execute') &&
        (mode === 'all' || mode === 'selected')
      ) {
        paintPermission(kind, mode);
      }
    },
    [paintPermission],
  );

  return (
    <div className="flex min-h-full flex-col bg-[var(--panel-alt)]">
      <div className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--panel-overlay)] px-4 py-3 backdrop-blur">
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
            title="Back to chat"
            aria-label="Back to chat"
          >
            <IconChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              DroneHub permissions
            </div>
            <div className="truncate text-[var(--text-10)] text-[var(--muted-dim)]">
              {chatLabel}
            </div>
          </div>
          <div
            className={cn(
              'rounded-full border px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide',
              available
                ? 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] text-[var(--muted-dim)]',
            )}
            role="status"
          >
            {statusLabel}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-large)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]">
            <IconNetwork className="h-5 w-5" />
          </div>
          <div>
            <h2
              className="text-[17px] font-[var(--weight-semibold)] text-[var(--fg)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Existing drone access
            </h2>
            <p className="mt-1 max-w-2xl text-[var(--text-12)] leading-5 text-[var(--muted)]">
              Choose which existing drones this chat can read from, change, or run actions on
              through the DroneHub MCP server. Changes are saved automatically for this chat.
            </p>
          </div>
        </div>

        {!available && !loading ? (
          <div className="mt-5 rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--surface-inset-faint)] px-4 py-3 text-[var(--text-11)] leading-5 text-[var(--muted)]">
            {unavailableMessage || 'DroneHub MCP access is not enabled for this chat.'}
          </div>
        ) : null}

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <div
              className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Permission scope
            </div>
            <div className="text-right text-[var(--text-10)] text-[var(--muted-dim)]">
              Click an option, or hold and drag across options to paint.
            </div>
          </div>
          <div
            onPointerMove={paintFromPointerPosition}
            className={cn(
              'divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-large)] border bg-[var(--surface-softest)] transition-colors',
              painting
                ? 'border-[var(--accent-muted)] shadow-[inset_0_0_0_1px_var(--accent-muted)]'
                : 'border-[var(--border-subtle)]',
            )}
          >
            {ACCESS_OPTIONS.map((option) => {
              const mode =
                option.kind === 'read'
                  ? readMode
                  : option.kind === 'write'
                    ? writeMode
                    : executeMode;
              return (
                <AccessModeRow
                  key={option.kind}
                  kind={option.kind}
                  label={option.label}
                  shortLabel={option.shortLabel}
                  description={option.description}
                  mode={mode}
                  disabled={disabled}
                  onPaintStart={startPainting}
                  onPaintEnter={paintPermission}
                  onKeyboardSelect={onModeChange}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 px-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted-dim)]">
            Change requests
          </div>
          <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)]">
            <FeaturePermissionRow
              label="Create and close change requests"
              description="Lets this chat create and close its own native change requests. Every agent may update open requests. Enabled by default."
              allowed={changeRequestCreate}
              disabled={disabled}
              onChange={(allowed) => onChangeRequestPermissionChange('create', allowed)}
            />
            <FeaturePermissionRow
              label="Merge change requests"
              description="Lets this chat directly squash-merge its own change requests using the host Git identity and credentials. Disabled by default."
              allowed={changeRequestMerge}
              disabled={disabled}
              onChange={(allowed) => onChangeRequestPermissionChange('merge', allowed)}
            />
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3
                className="text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Selected drones
              </h3>
              <p className="mt-1 text-[var(--text-11)] text-[var(--muted)]">
                These drones are used by every permission set to “Selected drones”.
              </p>
            </div>
            <span className="flex-shrink-0 font-mono text-[var(--text-10)] text-[var(--muted-dim)]">
              {selectedDrones.length} selected
            </span>
          </div>

          <div
            ref={dropTargetRef}
            className={cn(
              'mt-3 min-h-28 rounded-[var(--radius-large)] border border-dashed p-4 transition-colors',
              disabled
                ? 'border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] opacity-70'
                : dropActive
                  ? 'border-[var(--accent)] bg-[var(--accent-subtle)] shadow-[inset_0_0_0_1px_var(--accent-muted)]'
                  : 'border-[var(--border)] bg-[var(--surface-softest)]',
            )}
          >
            {selectedDrones.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedDrones.map((drone) => (
                  <span
                    key={drone.id}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-raised)] py-1 pl-2.5 pr-1.5 text-[var(--text-11)] text-[var(--fg-secondary)]"
                  >
                    <span className="max-w-56 truncate">{drone.label}</span>
                    {drone.removable !== false ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onRemoveDrone(drone.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--muted-dim)] transition-colors hover:bg-[var(--red-subtle)] hover:text-[var(--red)] disabled:cursor-not-allowed disabled:opacity-40"
                        title={`Remove ${drone.label}`}
                        aria-label={`Remove ${drone.label}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex min-h-20 items-center justify-center text-center">
                <div>
                  <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
                    Drop drones here
                  </div>
                  <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
                    Drag drones from the sidebar to add them to this chat.
                  </div>
                </div>
              </div>
            )}
            {selectedDrones.length > 0 ? (
              <div className="mt-3 text-[var(--text-10)] text-[var(--muted-dim)]">
                {dropActive
                  ? 'Release to add drones.'
                  : 'Drop more drones anywhere in this area to add them.'}
              </div>
            ) : null}
          </div>
          {!selectedModeActive ? (
            <p className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
              “All drones” is active for every permission, so this selection is not currently
              used.
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="mt-5 rounded-[var(--radius-medium)] border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-[var(--radius-large)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] p-4">
          <div
            className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Creating drones and chats
          </div>
          <div className="mt-1 text-[var(--text-11)] leading-5 text-[var(--muted)]">
            Creating or cloning a drone makes it independent by default and automatically grants
            this chat read, write, and execute access. A parent can be chosen explicitly and must
            be in Read scope. Cloning also requires Read access to the source drone. Managed chats
            cannot create new chats in a drone that runs directly on the host.
          </div>
        </div>

        <div className="mt-6 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] p-4 text-[var(--text-11)] leading-5 text-[var(--muted)]">
          These permissions apply only to this managed chat. Agents launched manually in a
          terminal do not receive its DroneHub credential.
        </div>
      </div>
    </div>
  );
}
