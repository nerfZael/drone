import * as React from 'react';
import { requestJson } from '../http';
import { UiButton } from '../../ui/components/Button';

type Section = { id: string; title: string; description: string; placeholders: string[]; default: string; text: string; edited: boolean };

/** Which part of the entity reads each section, for grouping the list. */
const GROUPS: { title: string; match: (id: string) => boolean }[] = [
  { title: 'Every limb', match: id => id === 'base' || id === 'code_limbs' },
  { title: 'Routing (head or voice)', match: id => id.startsWith('router') },
  { title: 'Head', match: id => id.startsWith('head_') || id === 'orchestrate' || id === 'supersede' },
  { title: 'Voice', match: id => id.startsWith('voice_') },
  { title: 'Review', match: id => id === 'reviewer_role' || id === 'review' },
  { title: 'Workers', match: id => id.startsWith('worker') },
  { title: 'Hub helpers', match: id => id.startsWith('hub_') },
];

const post = <T,>(url: string, body: unknown) => requestJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Every prompt the entity sends, section by section: edit one, save it (used from each limb's next wake), or reset it
 * to its default. Which sections a role gets, and in what order, stays fixed.
 */
export function EntityPromptsPanel({ onClose }: { onClose(): void }) {
  const [sections, setSections] = React.useState<Section[] | null>(null);
  const [selected, setSelected] = React.useState('router');
  const [draft, setDraft] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    requestJson<{ sections: Section[] }>('/api/entity/prompts').then(r => setSections(r.sections)).catch(e => setError(String(e?.message ?? e)));
  }, []);
  const section = sections?.find(s => s.id === selected);
  const text = draft ?? section?.text ?? '';
  const dirty = draft !== null && draft !== section?.text;
  const missing = section?.placeholders.filter(name => !text.includes(`{{${name}}}`)) ?? [];

  const run = async (action: () => Promise<{ sections: Section[] }>) => {
    setSaving(true);
    setError('');
    try { setSections((await action()).sections); setDraft(null); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setSaving(false); }
  };
  const save = () => { if (section && dirty) void run(() => post('/api/entity/prompts', { id: section.id, text })); };
  const choose = (id: string) => { if (id === selected) return; setSelected(id); setDraft(null); };

  return (
    <div role="dialog" aria-label="Entity prompts" className="absolute inset-0 z-40 flex min-h-0 flex-col bg-[var(--panel)] text-[13px] text-[var(--fg)]"
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      }}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 py-2">
        <span className="font-medium">Prompts</span>
        <span className="text-[12px] text-[var(--muted)]">Edits apply from each limb's next wake, in every session.</span>
        <div className="ml-auto flex items-center gap-2">
          {sections?.some(s => s.edited) ? (
            <UiButton size="small" variant="secondary" disabled={saving} onClick={() => void run(() => post('/api/entity/prompts/reset', {}))}>Reset all</UiButton>
          ) : null}
          <UiButton size="small" variant="secondary" onClick={onClose}>Close</UiButton>
        </div>
      </div>
      {error ? <div role="alert" className="border-b border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--red)]">{error}</div> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Prompt sections" className="min-h-0 overflow-y-auto border-r border-[var(--border)] py-2">
          {!sections ? <div className="px-3 text-[var(--muted)]">Loading…</div> : GROUPS.map(group => {
            const items = sections.filter(s => group.match(s.id));
            if (!items.length) return null;
            return (
              <div key={group.title} className="mb-2">
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]">{group.title}</div>
                {items.map(s => (
                  <button key={s.id} type="button" aria-current={s.id === selected} onClick={() => choose(s.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--hover)] ${s.id === selected ? 'bg-[var(--surface-strong)]' : ''}`}>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {s.edited ? <span title="Edited" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--fg-secondary,var(--fg))]" /> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        {section ? (
          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 px-4 pb-2 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium">{section.title}</span>
                {section.edited ? <span className="text-[12px] text-[var(--muted)]">edited</span> : null}
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--muted)]">{section.description}</div>
              {section.placeholders.length ? (
                <div className="mt-1 text-[12px] text-[var(--muted)]">
                  Filled in when the prompt is built: {section.placeholders.map(p => <code key={p} className="mr-1 rounded bg-[var(--surface-softest)] px-1">{`{{${p}}}`}</code>)}
                </div>
              ) : null}
            </div>
            <textarea aria-label={`${section.title} prompt`} value={text} spellCheck={false}
              onChange={e => setDraft(e.target.value)}
              className="mx-4 min-h-0 flex-1 resize-none rounded-lg bg-[var(--surface-softest)] p-3 font-mono text-[12.5px] leading-relaxed text-[var(--fg)] outline-none" />
            <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
              {missing.length ? (
                <span className="text-[12px] text-[var(--yellow)]">
                  {missing.map(m => `{{${m}}}`).join(', ')} {missing.length === 1 ? 'is' : 'are'} missing: that part will be left out.
                </span>
              ) : dirty ? <span className="text-[12px] text-[var(--muted)]">Unsaved changes</span> : null}
              <div className="ml-auto flex items-center gap-2">
                {dirty ? <UiButton size="small" variant="secondary" onClick={() => setDraft(null)}>Discard</UiButton> : null}
                {section.edited || text !== section.default ? (
                  <UiButton size="small" variant="secondary" disabled={saving}
                    onClick={() => { if (section.edited) void run(() => post('/api/entity/prompts/reset', { id: section.id })); else setDraft(null); }}>
                    Reset to default
                  </UiButton>
                ) : null}
                <UiButton size="small" variant="primary" disabled={!dirty || saving} onClick={save}>Save</UiButton>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
