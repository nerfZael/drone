import React from 'react';

import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { ChatComposerMenu, type ChatComposerMenuAction } from './ChatComposerMenu';

export type ChatComposerSelectControl = {
  kind: 'select';
  id: string;
  value: string;
  label: string;
  title: string;
  entries: UiMenuSelectEntry[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  width?: 'narrow' | 'medium' | 'wide';
};

export type ChatComposerTextControl = {
  kind: 'text';
  id: string;
  value: string;
  placeholder: string;
  title: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  width?: 'narrow' | 'medium' | 'wide';
};

export type ChatComposerButtonControl = {
  kind: 'button';
  id: string;
  label: string;
  title: string;
  onSelect: () => void;
  disabled?: boolean;
  active?: boolean;
  icon?: 'refresh' | 'star';
};

export type ChatComposerSegmentedControl = {
  kind: 'segmented';
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string; title?: string }>;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

export type ChatComposerControl =
  | ChatComposerSelectControl
  | ChatComposerTextControl
  | ChatComposerButtonControl
  | ChatComposerSegmentedControl;

export type ChatComposerControlsConfig = {
  controls: ChatComposerControl[];
  menuActions?: ChatComposerMenuAction[];
  menuLabel?: string;
  onboardingId?: string;
};

function controlWidthClass(width: 'narrow' | 'medium' | 'wide' | undefined): string {
  if (width === 'narrow') return 'w-[88px]';
  if (width === 'wide') return 'min-w-[140px] max-w-[200px]';
  return 'min-w-[112px] max-w-[180px]';
}

function RefreshIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={active ? 'animate-spin' : ''}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M13 5V2.8l-1.2 1.1A5.5 5.5 0 1 0 13.2 9" />
    </svg>
  );
}

function StarIcon({ selected }: { selected: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill={selected ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m12 3.2 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.73l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3.2Z"
      />
    </svg>
  );
}

export function ChatComposerControls({ config }: { config?: ChatComposerControlsConfig }) {
  if (!config || (config.controls.length === 0 && !config.menuActions?.length)) return null;

  return (
    <div
      data-onboarding-id={config.onboardingId}
      className="flex min-w-0 flex-shrink-0 flex-wrap items-center gap-1.5"
    >
      {config.controls.map((control) => {
        if (control.kind === 'select') {
          return (
            <UiMenuSelect
              key={control.id}
              variant="toolbar"
              value={control.value}
              onValueChange={control.onValueChange}
              entries={control.entries}
              disabled={control.disabled}
              triggerClassName={`h-[var(--control-height)] justify-between px-2 text-[var(--text-10)] uppercase tracking-wide ${controlWidthClass(control.width)}`}
              title={control.title}
              triggerLabel={control.label}
              chevron={() => (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                  className="text-[var(--muted-dim)] opacity-60"
                >
                  <path d="M4.427 6.573a.25.25 0 0 1 .177-.073h6.792a.25.25 0 0 1 .177.427l-3.396 3.396a.25.25 0 0 1-.354 0L4.427 6.927a.25.25 0 0 1 0-.354Z" />
                </svg>
              )}
              panelClassName="bottom-full mb-1.5 w-[260px]"
              menuClassName="max-h-[240px] overflow-y-auto"
              header={control.title}
              searchable={control.searchable}
              searchPlaceholder={control.searchPlaceholder}
            />
          );
        }
        if (control.kind === 'text') {
          return (
            <input
              key={control.id}
              value={control.value}
              onChange={(event) => control.onValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                control.onSubmit();
              }}
              disabled={control.disabled}
              placeholder={control.placeholder}
              className={`h-[var(--control-height)] rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 text-[var(--text-10)] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none ${controlWidthClass(control.width)} ${
                control.disabled
                  ? 'cursor-not-allowed opacity-40'
                  : 'hover:border-[var(--border)] hover:text-[var(--fg-secondary)]'
              }`}
              title={control.title}
              aria-label={control.title}
            />
          );
        }
        if (control.kind === 'segmented') {
          return (
            <div
              key={control.id}
              className="grid h-[var(--control-height)] flex-shrink-0 grid-flow-col overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)]"
              role="group"
              aria-label={control.label}
            >
              {control.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={control.disabled}
                  onClick={() => control.onValueChange(option.value)}
                  aria-pressed={control.value === option.value}
                  title={option.title}
                  className={`min-w-[42px] px-2 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide disabled:opacity-40 ${
                    control.value === option.value
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          );
        }
        const iconOnly = Boolean(control.icon);
        return (
          <button
            key={control.id}
            type="button"
            disabled={control.disabled}
            aria-pressed={control.active}
            aria-label={control.title}
            title={control.title}
            onClick={control.onSelect}
            className={`inline-flex h-[var(--control-height)] flex-shrink-0 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              iconOnly ? 'w-[var(--control-height)]' : 'px-2'
            } ${
              control.active
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'text-[var(--muted)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {control.icon === 'refresh' ? <RefreshIcon active={Boolean(control.active)} /> : null}
            {control.icon === 'star' ? <StarIcon selected={Boolean(control.active)} /> : null}
            {!control.icon ? control.label : null}
          </button>
        );
      })}
      {config.menuActions?.length ? (
        <ChatComposerMenu actions={config.menuActions} label={config.menuLabel} />
      ) : null}
    </div>
  );
}
