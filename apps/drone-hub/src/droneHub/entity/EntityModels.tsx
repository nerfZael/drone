import * as React from 'react';
import { formatReasoningLabel } from '@drone/assistant-chat';
import { ChatComposerModelPicker, type ChatComposerModelChoice } from '../chat/ChatComposerModelPicker';
import { requestJson } from '../http';
import { UiButton } from '../../ui/components/Button';
import type { EntityModels, EntityProfile, ModelChoice } from './use-entity-session';

type Part = 'head' | 'task' | 'voice';
const PARTS: { key: Part; label: string; note: string }[] = [
  { key: 'head', label: 'Head', note: 'Plans, routes and supervises; the reviewer uses it too.' },
  { key: 'task', label: 'Workers', note: 'Does the work: one conversation per worker.' },
  { key: 'voice', label: 'Voice', note: 'Experimental: a fast model that answers first and hands off to the head. Off (the default): the head answers, which is more coherent.' },
];

const sameChoice = (a: ModelChoice | null, b: ModelChoice | null) => a?.model === b?.model && a?.reasoning === b?.reasoning;
const sameModels = (a: EntityModels, b: EntityModels) => sameChoice(a.head, b.head) && sameChoice(a.task, b.task) && sameChoice(a.voice, b.voice);
/** "One model for everything": head and workers alike, and no separate voice. */
const isSingle = (m: EntityModels) => !m.voice && sameChoice(m.head, m.task);

function split(model: string): { provider: string; id: string } {
  const at = model.indexOf('/');
  return at < 0 ? { provider: '', id: model } : { provider: model.slice(0, at), id: model.slice(at + 1) };
}

/** "Sol · high": short enough for the header. */
function short(choice: ModelChoice, options: ChatComposerModelChoice[]): string {
  const { provider, id } = split(choice.model);
  const name = options.find(o => o.provider === provider && o.id === id)?.name?.split(' · ')[0] ?? id;
  return `${name.replace(/^GPT-/, '')} · ${formatReasoningLabel(choice.reasoning as never) || choice.reasoning}`;
}

/**
 * The models the entity runs on, per part (head, workers, voice), each with its reasoning level, picked with the chat
 * composer's model picker. One switch uses a single model for everything; profiles save a setup to switch back to.
 */
export function EntityModelsControl({ models, idle, onChange }: { models: EntityModels; idle: boolean; onChange(models: EntityModels): void }) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ChatComposerModelChoice[]>([]);
  const [profiles, setProfiles] = React.useState<EntityProfile[]>([]);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let alive = true;
    requestJson<{ models: ChatComposerModelChoice[] }>('/api/entity/models').then(r => { if (alive) setOptions(r.models); }).catch(e => alive && setError(String(e?.message ?? e)));
    requestJson<{ profiles: EntityProfile[] }>('/api/entity/profiles').then(r => { if (alive) setProfiles(r.profiles); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const active = profiles.find(p => sameModels(p.models, models));
  const summary = active ? active.name : isSingle(models) ? short(models.head, options) : `${short(models.head, options)} + ${short(models.task, options)}`;
  const detail = PARTS.map(p => `${p.label}: ${models[p.key] ? `${models[p.key]!.model} (${models[p.key]!.reasoning})` : 'off'}`).join('\n');
  return (
    <div className="relative">
      <UiButton size="small" variant="secondary" aria-expanded={open} onClick={() => setOpen(o => !o)} title={`Models\n${detail}`}>
        <span className="max-w-[28ch] truncate">Models: {summary}</span>
      </UiButton>
      {open ? (
        <>
          <div className="fixed inset-0 z-20" aria-hidden="true" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Entity models" onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
            className="absolute right-0 top-full z-30 mt-1 w-[min(460px,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] p-3 text-[13px] text-[var(--fg)] shadow-[0_18px_55px_var(--shadow-color)]">
            <ModelsEditor models={models} options={options} idle={idle} onChange={onChange} />
            <Profiles profiles={profiles} active={active} models={models} idle={idle}
              onProfiles={setProfiles} onApply={p => onChange(p.models)} onError={setError} />
            {error ? <div role="alert" className="mt-2 text-[12px] text-[var(--red)]">{error}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ModelsEditor({ models, options, idle, onChange }: { models: EntityModels; options: ChatComposerModelChoice[]; idle: boolean; onChange(models: EntityModels): void }) {
  // Starts as what the models are; unticking shows each part, even while they still match.
  const [single, setSingle] = React.useState(() => isSingle(models));
  // A profile applied with separate parts shows them.
  React.useEffect(() => { if (!isSingle(models)) setSingle(false); }, [models]);
  const locked = !idle;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">Models</span>
        {locked ? <span className="text-[12px] text-[var(--muted)]">Reset the session to change them</span> : null}
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--muted)]" title="Head and workers on one model, and no separate voice">
          <input type="checkbox" checked={single} disabled={locked}
            onChange={e => { setSingle(e.target.checked); if (e.target.checked) onChange({ head: models.head, task: models.head, voice: null }); }} />
          One model for everything
        </label>
      </div>
      {single ? (
        <PartRow label="All" note="Head, workers and review" value={models.head} options={options} disabled={locked}
          onChange={choice => { if (choice) onChange({ head: choice, task: choice, voice: null }); }} />
      ) : PARTS.map(part => (
        <PartRow key={part.key} label={part.label} note={part.note} value={models[part.key]} options={options} disabled={locked}
          optional={part.key === 'voice'} fallback={models.head}
          onChange={choice => { if (choice || part.key === 'voice') onChange({ ...models, [part.key]: choice }); }} />
      ))}
    </div>
  );
}

function PartRow({ label, note, value, options, disabled, optional, fallback, onChange }: {
  label: string; note: string; value: ModelChoice | null; options: ChatComposerModelChoice[]; disabled: boolean;
  optional?: boolean; fallback?: ModelChoice; onChange(choice: ModelChoice | null): void;
}) {
  const current = value ?? fallback;
  const { provider, id } = split(current?.model ?? '');
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2" title={note}>
      <span className="flex items-center gap-1.5 text-[var(--muted)]">
        {optional ? (
          <input type="checkbox" aria-label={`Use a separate ${label.toLowerCase()} model`} checked={!!value} disabled={disabled}
            onChange={e => onChange(e.target.checked ? (fallback ?? null) : null)} />
        ) : null}
        {label}
      </span>
      {optional && !value ? (
        <span className="text-[12px] text-[var(--muted)]">Off: the head answers</span>
      ) : (
        <div className="min-w-0">
          <ChatComposerModelPicker config={{
            id: `entity-model-${label.toLowerCase()}`, currentProvider: provider, currentModel: id, currentThinkingLevel: current?.reasoning,
            options, disabled, showReasoning: true, searchable: true, menuPlacement: 'below', title: note,
            onSelect: (choice, selection) => {
              const base = current ?? { model: `${choice.provider}/${choice.id}`, reasoning: 'medium' };
              onChange(selection === 'reasoning'
                ? { ...base, reasoning: choice.thinkingLevel || base.reasoning }
                : { model: `${choice.provider}/${choice.id}`, reasoning: choice.thinkingLevel || base.reasoning });
            },
          }} />
        </div>
      )}
    </div>
  );
}

/** Saved setups: apply one, save the current models as a new one or over an old one, rename, delete. */
function Profiles({ profiles, active, models, idle, onProfiles, onApply, onError }: {
  profiles: EntityProfile[]; active?: EntityProfile; models: EntityModels; idle: boolean;
  onProfiles(profiles: EntityProfile[]): void; onApply(profile: EntityProfile): void; onError(message: string): void;
}) {
  const [name, setName] = React.useState('');
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const save = async (body: { id?: string; name: string; models: EntityModels }) => {
    try {
      onError('');
      const result = await requestJson<{ profiles: EntityProfile[] }>('/api/entity/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      onProfiles(result.profiles);
      return true;
    } catch (e: any) {
      onError(String(e?.message ?? e));
      return false;
    }
  };
  const remove = async (id: string) => {
    try {
      const result = await requestJson<{ profiles: EntityProfile[] }>('/api/entity/profiles/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      onProfiles(result.profiles);
    } catch (e: any) { onError(String(e?.message ?? e)); }
    setDeleting(null);
  };
  const small = 'rounded px-1.5 py-0.5 text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40';
  return (
    <div className="mt-3 grid gap-1 border-t border-[var(--border)] pt-3">
      <span className="font-medium">Profiles</span>
      {!profiles.length ? <span className="text-[12px] text-[var(--muted)]">None yet. Save the models above to switch back to them later.</span> : null}
      {profiles.map(p => (
        <div key={p.id} className={`flex min-h-8 items-center gap-1 rounded px-1.5 ${p === active ? 'bg-[var(--hover)]' : ''}`}>
          {renaming?.id === p.id ? (
            <form className="flex min-w-0 flex-1 gap-1" onSubmit={async e => { e.preventDefault(); if (await save({ id: p.id, name: renaming.name, models: p.models })) setRenaming(null); }}>
              <input autoFocus aria-label="Profile name" value={renaming.name} maxLength={60} onChange={e => setRenaming({ id: p.id, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }}
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 py-0.5" />
              <button type="submit" className={small}>Save</button>
            </form>
          ) : (
            <>
              <button type="button" disabled={!idle || p === active} onClick={() => onApply(p)}
                title={p === active ? 'In use' : idle ? 'Use these models' : 'Reset the session to switch profiles'}
                className="min-w-0 flex-1 truncate text-left disabled:cursor-default">
                {p.name}{p === active ? <span className="ml-1.5 text-[12px] text-[var(--muted)]">in use</span> : null}
              </button>
              {p !== active ? <button type="button" className={small} title="Replace this profile's models with the ones above" onClick={() => void save({ id: p.id, name: p.name, models })}>Overwrite</button> : null}
              <button type="button" className={small} onClick={() => setRenaming({ id: p.id, name: p.name })}>Rename</button>
              {deleting === p.id
                ? <button type="button" className={`${small} text-[var(--red)]`} onClick={() => void remove(p.id)} onBlur={() => setDeleting(null)} autoFocus>Delete?</button>
                : <button type="button" className={small} onClick={() => setDeleting(p.id)}>Delete</button>}
            </>
          )}
        </div>
      ))}
      {!active ? (
        <form className="mt-1 flex gap-1.5" onSubmit={async e => { e.preventDefault(); if (name.trim() && await save({ name: name.trim(), models })) setName(''); }}>
          <input aria-label="New profile name" placeholder="Save these models as…" value={name} maxLength={60} onChange={e => setName(e.target.value)}
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[13px] outline-none focus:border-[var(--accent-muted)]" />
          <UiButton size="small" variant="secondary" type="submit" disabled={!name.trim()}>Save</UiButton>
        </form>
      ) : null}
    </div>
  );
}
