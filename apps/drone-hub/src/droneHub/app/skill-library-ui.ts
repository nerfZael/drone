export function inputClassName() {
  return 'h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors';
}

export function textareaClassName() {
  return 'w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono';
}

export function buttonClassName(kind: 'primary' | 'secondary' | 'danger' = 'secondary', disabled = false): string {
  if (disabled) {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]';
  }
  if (kind === 'primary') {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110';
  }
  if (kind === 'danger') {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]';
  }
  return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]';
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
