import React from 'react';

import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { ChatComposerMenu, type ChatComposerMenuAction } from './ChatComposerMenu';
import {
  ChatComposerModelPicker,
  type ChatComposerModelPickerConfig,
} from './ChatComposerModelPicker';
import {
  ChatComposerChoicePicker,
  type ChatComposerChoicePickerConfig,
} from './ChatComposerChoicePicker';

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

export type ChatComposerModelPickerControl = ChatComposerModelPickerConfig & {
  kind: 'model-picker';
};

export type ChatComposerChoicePickerControl = ChatComposerChoicePickerConfig & {
  kind: 'choice-picker';
};

export type ChatComposerControl =
  | ChatComposerSelectControl
  | ChatComposerTextControl
  | ChatComposerButtonControl
  | ChatComposerSegmentedControl
  | ChatComposerChoicePickerControl
  | ChatComposerModelPickerControl;

export type ChatComposerControlsConfig = {
  controls: ChatComposerControl[];
  menuActions?: ChatComposerMenuAction[];
  menuLabel?: string;
  onboardingId?: string;
};

function controlWidthClass(width: 'narrow' | 'medium' | 'wide' | undefined): string {
  if (width === 'narrow') return 'w-[5.5rem]';
  if (width === 'wide') return 'min-w-[8.75rem] max-w-[12.5rem]';
  return 'min-w-[7rem] max-w-[11.25rem]';
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
      className="flex min-w-0 flex-shrink-0 flex-wrap items-center gap-[.4375rem]"
    >
      {config.controls.map((control) => {
        if (control.kind === 'choice-picker') {
          return <ChatComposerChoicePicker key={control.id} config={control} />;
        }
        if (control.kind === 'model-picker') {
          return <ChatComposerModelPicker key={control.id} config={control} />;
        }
        if (control.kind === 'select') {
          return (
            <UiMenuSelect
              key={control.id}
              variant="toolbar"
              value={control.value}
              onValueChange={control.onValueChange}
              entries={control.entries}
              disabled={control.disabled}
              triggerClassName={`!h-8 justify-between !border-transparent !bg-transparent px-2 text-[.6875rem] !font-extrabold normal-case tracking-normal !text-[var(--chat-composer-model-fg)] hover:!opacity-70 ${controlWidthClass(control.width)}`}
              title={control.title}
              triggerLabel={control.label}
              chevron={() => (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                  className="text-[var(--accent)] opacity-80"
                >
                  <path d="M4.427 6.573a.25.25 0 0 1 .177-.073h6.792a.25.25 0 0 1 .177.427l-3.396 3.396a.25.25 0 0 1-.354 0L4.427 6.927a.25.25 0 0 1 0-.354Z" />
                </svg>
              )}
              panelClassName="bottom-full mb-1.5 w-[16.25rem]"
              menuClassName="max-h-[15rem] overflow-y-auto"
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
              className={`h-8 rounded-[var(--chat-composer-control-radius)] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] px-2 text-[.6875rem] font-extrabold text-[var(--chat-composer-control-fg)] placeholder:text-[var(--chat-composer-placeholder)] focus:outline-none ${controlWidthClass(control.width)} ${
                control.disabled
                  ? 'cursor-not-allowed opacity-40'
                  : 'hover:opacity-70'
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
              className="grid h-8 flex-shrink-0 grid-flow-col overflow-hidden rounded-[var(--chat-composer-control-radius)] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)]"
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
                  className={`min-w-[2.625rem] px-2 text-[.625rem] font-extrabold uppercase tracking-wide disabled:opacity-40 ${
                    control.value === option.value
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'text-[var(--chat-composer-control-fg)] hover:opacity-70'
                  }`}
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
            className={`inline-flex h-8 flex-shrink-0 items-center justify-center rounded-[var(--chat-composer-control-radius)] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-control-bg)] text-[.625rem] font-extrabold uppercase tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${
              iconOnly ? 'w-8' : 'px-2'
            } ${
              control.active
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'text-[var(--chat-composer-control-fg)] hover:opacity-70'
            }`}
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
