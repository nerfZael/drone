import * as React from 'react';

export function ComponentLibrarySection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16">
      <div className="mb-4 border-l-2 border-[var(--accent-border)] pl-3">
        <div
          className="text-[length:var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--accent)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          {eyebrow}
        </div>
        <h2
          className="mt-1 text-[17px] font-[var(--weight-semibold)] text-[var(--fg-strong)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          {title}
        </h2>
        <p className="mt-1 max-w-[72ch] text-[length:var(--text-12)] leading-relaxed text-[var(--muted)]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}
