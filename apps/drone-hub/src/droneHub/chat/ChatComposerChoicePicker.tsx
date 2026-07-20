import React from 'react';

import { useDropdownDismiss } from '../../ui/dropdown';

export type ChatComposerChoicePickerOption = {
  value: string;
  label: string;
  title?: string;
};

export type ChatComposerChoicePickerConfig = {
  id: string;
  value: string;
  options: ChatComposerChoicePickerOption[];
  onValueChange: (value: string) => void;
  title: string;
  sectionTitle: string;
  disabled?: boolean;
};

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg className="h-[1.0625rem] w-[1.0625rem] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

export function ChatComposerChoicePicker({ config }: { config: ChatComposerChoicePickerConfig }) {
  const { value, options, onValueChange, title, sectionTitle, disabled = false } = config;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  useDropdownDismiss(rootRef, open, setOpen);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div ref={rootRef} className="relative min-w-0 flex-shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        className="inline-flex h-8 max-w-[14rem] items-center gap-1 px-2 text-[.6875rem] font-extrabold normal-case tracking-normal text-[var(--chat-composer-model-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="min-w-0 truncate">{selected?.label ?? value}</span>
        <span className="text-[var(--accent)]"><ChevronIcon up={open} /></span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={title}
          className="absolute bottom-full left-0 z-50 mb-[.375rem] flex max-h-[64vh] w-[min(11rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-[.75rem] border border-[var(--border)] bg-[var(--panel)] shadow-[0_.5rem_1.5rem_rgba(17,17,27,.36)]"
        >
          <div className="flex min-h-9 flex-shrink-0 items-center px-3">
            <div className="text-[.8125rem] font-extrabold text-[var(--fg-strong)]">
              {sectionTitle}
            </div>
          </div>
          <div className="flex flex-col gap-1 px-2 pb-2">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  title={option.title}
                  className={`flex min-h-9 items-center rounded-[.5rem] border px-2.5 text-left text-[.75rem] font-bold transition-colors disabled:opacity-40 ${
                    active
                      ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
                      : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {active ? <span className="ml-2 text-[var(--accent)]"><CheckIcon /></span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
