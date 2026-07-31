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
        <div className="dh-type-eyebrow !text-[var(--accent)]">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-[17px] font-medium text-[var(--fg-strong)]">
          {title}
        </h2>
        <p className="mt-1 max-w-[72ch] dh-type-supporting !text-[var(--muted)]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}
