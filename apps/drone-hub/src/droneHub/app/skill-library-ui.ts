export function inputClassName() {
  return 'dh-field-control h-[var(--control-height)] rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-3 dh-type-control text-[var(--field-fg)] placeholder:text-[var(--field-placeholder)] transition-colors';
}

export function textareaClassName() {
  return 'dh-field-control w-full rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 dh-type-control-compact leading-relaxed text-[var(--field-fg)] placeholder:text-[var(--field-placeholder)] transition-colors font-mono';
}

export function buttonClassName(kind: 'primary' | 'secondary' | 'danger' = 'secondary', disabled = false): string {
  if (disabled) {
    return 'h-8 px-2.5 rounded-[var(--radius-medium)] dh-type-control-compact border border-transparent transition-colors opacity-40 cursor-not-allowed bg-transparent text-[var(--muted-dim)]';
  }
  if (kind === 'primary') {
    return 'h-8 px-3 rounded-[var(--radius-medium)] dh-type-control border transition-colors bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110';
  }
  if (kind === 'danger') {
    return 'h-8 px-2.5 rounded-[var(--radius-medium)] dh-type-control-compact border border-transparent transition-colors bg-transparent text-[var(--red)] hover:bg-[var(--red-subtle)]';
  }
  return 'h-8 px-2.5 rounded-[var(--radius-medium)] dh-type-control-compact border border-transparent transition-colors bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)]';
}

export function importStatusClassName(status: 'importable' | 'importable_with_loss' | 'not_importable'): string {
  if (status === 'importable') {
    return 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]';
  }
  if (status === 'importable_with_loss') {
    return 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]';
  }
  return 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]';
}
