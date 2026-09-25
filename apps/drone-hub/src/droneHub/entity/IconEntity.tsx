/** A small keypad glyph for the entity test bench. */
export function IconEntity({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2" width="4" height="4" rx="1" />
      <rect x="10" y="2" width="4" height="4" rx="1" />
      <rect x="2" y="10" width="4" height="4" rx="1" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}
