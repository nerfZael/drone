import * as React from 'react';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { requestJson } from '../http';

type Point = { label: string; text: string; section?: string };

const plain = (text: string) => text.replace(/[*_`“”"]/g, '').trim().toLowerCase();

/**
 * The part of a Markdown report under a heading: from the heading whose text starts with `heading` to the next heading
 * at the same level or above. Empty when the report has no such heading.
 */
export function reportSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const wanted = plain(heading.replace(/^§\s*/, '').replace(/^#+\s*/, ''));
  if (!wanted) return '';
  // A heading that starts with the words, or contains them after its number ("3. Fix the copy" for "Fix the copy").
  const text = (l: string) => plain(l.replace(/^#+\s*/, ''));
  let start = lines.findIndex(l => /^#{1,6}\s/.test(l) && text(l).startsWith(wanted));
  if (start < 0) start = lines.findIndex(l => /^#{1,6}\s/.test(l) && text(l).replace(/^[\d.)\s]+/, '').startsWith(wanted));
  if (start < 0) return '';
  const level = lines[start].match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

/** The report an agent linked: the last Markdown file it attached to a message. */
export function reportOf(files: string[]): string | undefined {
  return [...files].reverse().find(f => /\.md$/i.test(f));
}

/**
 * An agent's points. A point that names a section of its report opens that section in place, so the short version
 * leads and the detail is one click away; the whole report opens in Files.
 */
export function ReportPoints({ points, report, onOpenFile }: { points: Point[]; report?: string; onOpenFile?(path: string): void }) {
  const [open, setOpen] = React.useState<ReadonlySet<number>>(() => new Set());
  const [content, setContent] = React.useState<{ path: string; text?: string; error?: string } | null>(null);
  const load = React.useCallback(() => {
    if (!report || content?.path === report) return;
    setContent({ path: report });
    requestJson<{ content: string }>(`/api/entity/home-file?path=${encodeURIComponent(report)}`)
      .then(r => setContent({ path: report, text: r.content }))
      .catch(e => setContent({ path: report, error: String(e?.message ?? e) }));
  }, [report, content]);
  const toggle = (i: number) => { load(); setOpen(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; }); };
  return (
    <ul className="flex flex-col gap-0.5 text-[12px]">
      {points.map((p, i) => {
        // Any point of an agent that wrote a report opens it: at the section it named, or else at a heading matching its label.
        const expandable = !!report;
        const isOpen = open.has(i);
        const section = isOpen && content?.path === report && content?.text !== undefined ? (p.section ? reportSection(content.text, p.section) : '') || reportSection(content.text, p.label) : '';
        return (
          <li key={i}>
            {expandable ? (
              <button type="button" onClick={() => toggle(i)} aria-expanded={isOpen} className="text-left hover:text-[var(--fg)]">
                <span className="inline-block w-3 text-[var(--muted)]">{isOpen ? '▾' : '▸'}</span><b className="font-medium">{p.label}</b> <span className="text-[var(--muted)]">{p.text}</span>
              </button>
            ) : <span><span className="inline-block w-3" /><b className="font-medium">{p.label}</b> <span className="text-[var(--muted)]">{p.text}</span></span>}
            {isOpen ? (
              <div className="my-1 ml-3 border-l-2 border-[var(--border)] pl-3">
                {content?.error ? <div className="text-[var(--muted)]">Could not read the report: {content.error}</div>
                  : content?.text === undefined ? <div className="text-[var(--muted)]">Loading…</div>
                    : section ? <MarkdownMessage text={section} className="dh-markdown text-[12.5px]" />
                      : <div className="text-[var(--muted)]">No section of the report matches this point.</div>}
                {onOpenFile ? <button type="button" onClick={() => onOpenFile(report!)} className="mt-1 text-[var(--muted)] underline-offset-2 hover:text-[var(--fg)] hover:underline">Open the whole report</button> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
