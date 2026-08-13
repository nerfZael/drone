import React from 'react';

import { MarkdownMessage } from '../chat/MarkdownMessage';

export type RequestOverviewFact = {
  label: string;
  value: string;
  mono?: boolean;
};

export function RequestOverview({
  id,
  labelledBy,
  description,
  facts,
}: {
  id: string;
  labelledBy: string;
  description: string;
  facts: RequestOverviewFact[];
}) {
  const normalizedDescription = description.trim();
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6"
    >
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
        <section className="min-w-0">
          {normalizedDescription ? (
            <MarkdownMessage
              text={normalizedDescription}
              className="dh-markdown text-[var(--text-11)]"
            />
          ) : (
            <p className="text-[var(--text-11)] italic text-[var(--muted)]">
              No description was provided.
            </p>
          )}
        </section>

        <aside className="min-w-0 border-t border-[var(--border-subtle)] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <dl className="divide-y divide-[var(--border-subtle)]">
            {facts.map((fact) => (
              <div key={fact.label} className="py-2.5 first:pt-0 last:pb-0">
                <dt className="text-[var(--text-9)] text-[var(--muted-dim)]">
                  {fact.label}
                </dt>
                <dd
                  className={`mt-0.5 break-words text-[var(--text-11)] text-[var(--fg-secondary)] ${fact.mono ? 'font-mono text-[var(--text-10)]' : ''}`}
                  title={fact.value}
                >
                  {fact.value || '—'}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
